import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { missionRules as rules, missionTemplates } from '../shared/mission-rules.js';

const actor = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,80}$/)
  .refine((v) => !['__proto__', 'constructor', 'prototype'].includes(v));
const id = z.string().uuid();
const key = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,160}$/)
  .refine((v) => !['__proto__', 'constructor', 'prototype'].includes(v));
const integer = z.number().int().nonnegative().safe();
const time = integer.max(8.64e15);
const templateId = z.enum(missionTemplates.map((t) => t.id));
const reason = z.string().trim().min(1).max(200);
const target = z.number().int().min(20).max(rules.maxTarget);
const amount = z.number().int().min(1).max(rules.maxPledge);
const active = (m) => ['funding', 'ready', 'accepted', 'review'].includes(m.status);
const pledged = (m) => m.contributions.reduce((sum, p) => sum + p.amount, 0);
const template = (m) => missionTemplates.find((t) => t.id === m.templateId);
const witness = z.object({ personaId: actor, joinedAt: time }).strict();
const commandBase = { requestId: key };
const userShapes = [
  z.object({ ...commandBase, kind: z.literal('enabled'), enabled: z.boolean() }).strict(),
  z.object({ ...commandBase, kind: z.literal('reopen'), templateId }).strict(),
  ...['accept', 'reject', 'cancel'].map((kind) =>
    z.object({ ...commandBase, kind: z.literal(kind), missionId: id }).strict(),
  ),
  z
    .object({ ...commandBase, kind: z.literal('revise'), missionId: id, templateId, target })
    .strict(),
  z
    .object({ ...commandBase, kind: z.literal('confirm'), missionId: id, completed: z.boolean() })
    .strict(),
];
export const MissionUserCommand = z.discriminatedUnion('kind', userShapes);
export const MissionCommand = z.discriminatedUnion('kind', [
  ...userShapes,
  z
    .object({
      ...commandBase,
      kind: z.literal('propose'),
      personaId: actor,
      templateId,
      target,
      amount,
      reason,
    })
    .strict(),
  z
    .object({
      ...commandBase,
      kind: z.literal('join'),
      personaId: actor,
      missionId: id,
      amount,
      reason,
    })
    .strict(),
  z
    .object({ ...commandBase, kind: z.literal('oppose'), personaId: actor, missionId: id, reason })
    .strict(),
  z
    .object({
      ...commandBase,
      kind: z.literal('suggest-complete'),
      personaId: actor,
      missionId: id,
      reason,
    })
    .strict(),
]);
const campaign = z
  .object({
    id,
    rootId: id,
    version: integer.min(1),
    sessionId: id,
    gameId: z.string().min(1).max(40),
    gameName: z.string().max(120),
    proposerId: actor,
    proposerName: z.string().max(40),
    templateId,
    target,
    reason,
    status: z.enum([
      'funding',
      'ready',
      'accepted',
      'review',
      'completed',
      'rejected',
      'cancelled',
      'expired',
      'revised',
      'failed',
    ]),
    createdAt: time,
    fundingDeadline: time,
    performanceDeadline: time.nullable(),
    reviewDeadline: time.nullable(),
    endedAt: time.nullable(),
    endReason: z.string().max(200),
    contributions: z.array(
      z.object({ personaId: actor, name: z.string().max(40), amount, reason, at: time }).strict(),
    ),
    opponents: z.array(
      z.object({ personaId: actor, name: z.string().max(40), reason, at: time }).strict(),
    ),
    evidence: z
      .array(
        z
          .object({ id: key, at: time, scene: z.string().max(600), witnesses: z.array(witness) })
          .strict(),
      )
      .max(5),
  })
  .strict();
export const emptyMissions = () => ({
  version: 1,
  enabled: true,
  timeFloor: 0,
  wallets: {},
  campaigns: [],
  ledger: [],
  events: [],
  receipts: {},
  blocked: {},
  lastProposalAt: 0,
  proposals: {},
});
export const MissionData = z
  .object({
    version: z.literal(1),
    enabled: z.boolean(),
    timeFloor: time,
    wallets: z.record(
      actor,
      z
        .object({
          balance: integer.max(rules.walletCap),
          issued: integer,
          consumed: integer,
          refillAt: time,
        })
        .strict(),
    ),
    campaigns: z.array(campaign),
    ledger: z.array(
      z
        .object({
          id,
          at: time,
          kind: z.enum(['grant', 'refill', 'hold', 'consume', 'release']),
          personaId: actor,
          missionId: id.nullable(),
          amount: integer.min(1),
        })
        .strict(),
    ),
    events: z.array(
      z
        .object({
          id,
          missionId: id.nullable(),
          at: time,
          text: z.string().max(600),
          witnesses: z.array(witness),
          source: z.enum(['announcement', 'user-confirmation', 'model-suggestion']),
        })
        .strict(),
    ),
    receipts: z.record(
      key,
      z
        .object({
          fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
          result: z.object({ missionId: id.nullable(), amount: integer.optional() }).strict(),
        })
        .strict(),
    ),
    blocked: z.record(id, z.array(templateId)),
    lastProposalAt: time,
    proposals: z.record(actor, time),
  })
  .strict()
  .superRefine((d, ctx) => {
    const fail = (message) => ctx.addIssue({ code: 'custom', message });
    for (const field of ['campaigns', 'ledger', 'events'])
      if (new Set(d[field].map((x) => x.id)).size !== d[field].length)
        fail('미션 기록 ID가 중복되었습니다.');
    for (const m of d.campaigns) {
      if (
        !d.campaigns.some((root) => root.id === m.rootId) ||
        d.campaigns.filter((other) => other.rootId === m.rootId && other.version === m.version)
          .length !== 1
      )
        fail('미션 조건 버전이 일치하지 않습니다.');
      if (
        pledged(m) > m.target ||
        new Set(m.contributions.map((p) => p.personaId)).size !== m.contributions.length
      )
        fail('미션 예치 합계 또는 기여자가 맞지 않습니다.');
      if (
        ['ready', 'accepted', 'review', 'completed'].includes(m.status) &&
        pledged(m) !== m.target
      )
        fail('모금되지 않은 미션은 수락하거나 정산할 수 없습니다.');
      if (['accepted', 'review'].includes(m.status) && m.performanceDeadline === null)
        fail('미션 수행 기한이 없습니다.');
      if (m.status === 'review' && m.reviewDeadline === null) fail('미션 확인 기한이 없습니다.');
      for (const p of m.contributions)
        if (!d.wallets[p.personaId]) fail('예치자의 가상 예산이 없습니다.');
      for (const p of m.contributions) {
        const rows = d.ledger.filter((e) => e.missionId === m.id && e.personaId === p.personaId);
        const total = (kind) =>
          rows.filter((e) => e.kind === kind).reduce((sum, e) => sum + e.amount, 0);
        if (
          total('hold') !== p.amount ||
          total('consume') !== (m.status === 'completed' ? p.amount : 0) ||
          total('release') !== (!active(m) && m.status !== 'completed' ? p.amount : 0)
        )
          fail('미션 상태와 기여자 정산이 일치하지 않습니다.');
      }
    }
    for (const [personaId, w] of Object.entries(d.wallets)) {
      const held = d.campaigns
        .filter(active)
        .reduce(
          (sum, m) =>
            sum +
            m.contributions
              .filter((p) => p.personaId === personaId)
              .reduce((s, p) => s + p.amount, 0),
          0,
        );
      const rows = d.ledger.filter((e) => e.personaId === personaId);
      const total = (kinds) =>
        rows.filter((e) => kinds.includes(e.kind)).reduce((s, e) => s + e.amount, 0);
      if (
        w.balance + held > rules.walletCap ||
        w.balance + held + w.consumed !== w.issued ||
        total(['grant', 'refill']) !== w.issued ||
        total(['consume']) !== w.consumed ||
        total(['hold']) - total(['consume', 'release']) !== held
      )
        fail('미션 원장과 가상 예산이 일치하지 않습니다.');
    }
    for (const row of d.ledger) {
      if (!d.wallets[row.personaId]) fail('원장의 관객 예산이 없습니다.');
      if (row.missionId && !d.campaigns.some((m) => m.id === row.missionId))
        fail('원장의 미션이 없습니다.');
      if (
        ['hold', 'consume', 'release'].includes(row.kind) &&
        (!row.missionId ||
          !d.campaigns.some(
            (m) =>
              m.id === row.missionId && m.contributions.some((p) => p.personaId === row.personaId),
          ))
      )
        fail('원장의 예치자가 미션에 없습니다.');
    }
  });
const canonical = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
export function safeMissionReason(text, blockedWords = []) {
  const normalized = String(text).normalize('NFKC').toLowerCase();
  return (
    !/(?:개인정보|전화번호|주소|비밀번호|계좌|결제|구매|현금|송금|자해|자살|음주|술\s*마|약물|도박|위험한|죽어|payment|purchase|password|address|self.harm)/u.test(
      normalized,
    ) && !blockedWords.some((w) => normalized.includes(w.normalize('NFKC').toLowerCase()))
  );
}
export class MissionBoard {
  constructor(data = emptyMissions(), save = () => {}, now = Date.now) {
    this.data = MissionData.parse(structuredClone(data));
    this.save = save;
    this.clock = now;
    this.lastNow = Math.max(now(), data.timeFloor);
    if (this.data.campaigns.some(active))
      this.change((d) => {
        for (const m of d.campaigns.filter(active))
          this.release(d, m, 'cancelled', '앱 재시작으로 예치를 반환했습니다.');
      });
  }
  now() {
    return (this.lastNow = Math.max(this.lastNow, this.clock()));
  }
  change(fn) {
    const next = structuredClone(this.data),
      result = fn(next);
    next.timeFloor = this.now();
    const validated = MissionData.parse(next);
    try {
      this.save(validated);
    } catch (cause) {
      const error = new Error(
        '미션 원장 저장에 실패했습니다. 기록을 보존하고 다시 시도하세요. ' + cause.message,
        { cause },
      );
      error.code = 'MISSION_STORAGE';
      throw error;
    }
    this.data = validated;
    return result;
  }
  entry(d, kind, personaId, missionId, amount) {
    if (amount)
      d.ledger.push({ id: randomUUID(), at: this.now(), kind, personaId, missionId, amount });
  }
  held(d, personaId) {
    return d.campaigns
      .filter(active)
      .reduce(
        (sum, m) => sum + (m.contributions.find((p) => p.personaId === personaId)?.amount || 0),
        0,
      );
  }
  wallet(d, personaId) {
    actor.parse(personaId);
    const now = this.now();
    if (!d.wallets[personaId]) {
      d.wallets[personaId] = {
        balance: rules.walletCap,
        issued: rules.walletCap,
        consumed: 0,
        refillAt: now,
      };
      this.entry(d, 'grant', personaId, null, rules.walletCap);
    }
    const w = d.wallets[personaId],
      steps = Math.floor((now - w.refillAt) / rules.refillMs),
      room = rules.walletCap - this.held(d, personaId) - w.balance;
    if (steps > 0) {
      const refill = Math.min(steps, room);
      w.balance += refill;
      w.issued += refill;
      w.refillAt = room <= steps ? now : w.refillAt + steps * rules.refillMs;
      this.entry(d, 'refill', personaId, null, refill);
    }
    if (room === 0) w.refillAt = now;
    return w;
  }
  event(d, m, text, witnesses = [], source = 'announcement') {
    d.events.push({
      id: randomUUID(),
      missionId: m?.id || null,
      at: this.now(),
      text,
      witnesses,
      source,
    });
  }
  release(d, m, status, endReason, witnesses = []) {
    if (!active(m)) return;
    for (const p of m.contributions) {
      d.wallets[p.personaId].balance += p.amount;
      this.entry(d, 'release', p.personaId, m.id, p.amount);
    }
    m.status = status;
    m.endedAt = this.now();
    m.endReason = endReason;
    this.event(
      d,
      m,
      `${template(m).title}: ${endReason} 예치 ${pledged(m)}미션점 반환.`,
      witnesses,
    );
  }
  deadline(m) {
    return m.status === 'review'
      ? Math.min(m.reviewDeadline, m.performanceDeadline)
      : m.status === 'accepted'
        ? m.performanceDeadline
        : m.fundingDeadline;
  }
  expire(sessionId, gameId) {
    const rows = this.data.campaigns.filter(
      (m) =>
        active(m) &&
        (m.sessionId !== sessionId ||
          (gameId && m.gameId !== gameId) ||
          this.now() >= this.deadline(m)),
    );
    if (!rows.length) return false;
    this.change((d) => {
      for (const m of d.campaigns.filter((m) => rows.some((row) => row.id === m.id)))
        this.release(
          d,
          m,
          m.sessionId !== sessionId || (gameId && m.gameId !== gameId) ? 'cancelled' : 'expired',
          '방송·게임이 바뀌었거나 확인 기한이 끝났습니다.',
        );
    });
    return true;
  }
  stop() {
    this.expire(null);
  }
  find(d, missionId, ctx) {
    const m = d.campaigns.find((m) => m.id === missionId);
    if (
      !m ||
      !active(m) ||
      m.sessionId !== ctx.sessionId ||
      m.gameId !== ctx.gameId ||
      this.now() >= this.deadline(m)
    )
      throw Error('현재 방송에서 진행 중인 유효한 미션이 아닙니다.');
    return m;
  }
  person(personaId, ctx) {
    const p = ctx.people?.find((p) => p.id === personaId);
    if (!p || !ctx.witnesses?.some((w) => w.personaId === personaId))
      throw Error('현재 요청을 목격한 일반 관객만 참여할 수 있습니다.');
    return p;
  }
  hold(d, m, personaId, requested, text, ctx) {
    if (m.status !== 'funding' || m.contributions.some((p) => p.personaId === personaId))
      throw Error('이미 참여했거나 모금이 끝난 미션입니다.');
    const p = this.person(personaId, ctx),
      w = this.wallet(d, personaId);
    const accepted = Math.min(requested, m.target - pledged(m), w.balance);
    if (accepted <= 0) throw Error('예치할 가상 예산이 없습니다.');
    w.balance -= accepted;
    m.contributions.push({
      personaId,
      name: p.name,
      amount: accepted,
      reason: text,
      at: this.now(),
    });
    this.entry(d, 'hold', personaId, m.id, accepted);
    if (pledged(m) === m.target) m.status = 'ready';
    return accepted;
  }
  create(d, values, ctx, { rootId, version = 1 } = {}) {
    const p = this.person(values.personaId, ctx),
      missionId = randomUUID();
    const m = {
      id: missionId,
      rootId: rootId || missionId,
      version,
      sessionId: ctx.sessionId,
      gameId: ctx.gameId,
      gameName: ctx.gameName || '',
      proposerId: p.id,
      proposerName: p.name,
      templateId: values.templateId,
      target: values.target,
      reason: values.reason,
      status: 'funding',
      createdAt: this.now(),
      fundingDeadline: this.now() + rules.fundingMs,
      performanceDeadline: null,
      reviewDeadline: null,
      endedAt: null,
      endReason: '',
      contributions: [],
      opponents: [],
      evidence: [],
    };
    d.campaigns.push(m);
    return m;
  }
  execute(input, ctx) {
    const command = MissionCommand.parse(input),
      { requestId, ...values } = command;
    // Durable request IDs remain retries after a restart or a later broadcast.
    // Reusing one never revives the old mission or allocates another budget.
    const fingerprint = createHash('sha256').update(canonical(values)).digest('hex');
    const prior = this.data.receipts[requestId];
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw Error('같은 요청 ID를 다른 미션 요청에 사용할 수 없습니다.');
      return { ...prior.result, duplicate: true };
    }
    if (values.kind !== 'enabled' && (!ctx.running || !ctx.sessionId))
      throw Error('방송 중에만 미션을 결정할 수 있습니다.');
    this.expire(ctx.running ? ctx.sessionId : null, ctx.gameId);
    return this.change((d) => {
      let result = { missionId: null };
      const witnesses = ctx.witnesses || [];
      if (values.kind === 'enabled') {
        d.enabled = values.enabled;
        if (!d.enabled)
          for (const m of d.campaigns.filter(active))
            this.release(d, m, 'cancelled', '미션 전체 중지로 예치를 반환했습니다.', witnesses);
      } else if (values.kind === 'reopen') {
        d.blocked[ctx.sessionId] = (d.blocked[ctx.sessionId] || []).filter(
          (t) => t !== values.templateId,
        );
      } else {
        if (['propose', 'join', 'oppose', 'suggest-complete'].includes(values.kind)) {
          if (!d.enabled || !ctx.allowAI || !safeMissionReason(values.reason, ctx.blockedWords))
            throw Error('미션 제안이 중지되었거나 방송 규칙에 맞지 않습니다.');
          this.person(values.personaId, ctx);
        }
        if (values.kind === 'propose') {
          if (!ctx.gaming || (d.blocked[ctx.sessionId] || []).includes(values.templateId))
            throw Error('이 게임 미션의 제안을 허용하지 않았습니다.');
          if (
            d.campaigns.filter(active).length >= rules.maxActive ||
            d.campaigns.some((m) => active(m) && m.templateId === values.templateId)
          )
            throw Error('진행 중인 미션을 먼저 마쳐주세요.');
          if (
            (d.lastProposalAt && this.now() - d.lastProposalAt < rules.globalCooldownMs) ||
            (d.proposals[values.personaId] &&
              this.now() - d.proposals[values.personaId] < rules.proposalCooldownMs)
          )
            throw Error('새 미션 제안은 잠시 쉬어갑니다.');
          const m = this.create(d, values, ctx);
          const accepted = this.hold(d, m, values.personaId, values.amount, values.reason, ctx);
          d.lastProposalAt = this.now();
          d.proposals[values.personaId] = this.now();
          result = { missionId: m.id, amount: accepted };
          this.event(
            d,
            m,
            `${m.proposerName}의 AI 관객 미션 제안: ${template(m).title}. ${accepted}/${m.target}미션점 예치. 이유: ${values.reason}. 수락은 자유입니다.`,
            witnesses,
          );
        } else {
          const m = this.find(d, values.missionId, ctx);
          result.missionId = m.id;
          if (values.kind === 'join') {
            result.amount = this.hold(d, m, values.personaId, values.amount, values.reason, ctx);
            this.event(
              d,
              m,
              `${this.person(values.personaId, ctx).name}도 ${template(m).title}에 ${result.amount}미션점 동참: ${values.reason}`,
              witnesses,
            );
          }
          if (values.kind === 'oppose') {
            if (
              !['funding', 'ready'].includes(m.status) ||
              m.opponents.some((p) => p.personaId === values.personaId)
            )
              throw Error('이미 의견을 남겼거나 검토가 끝났습니다.');
            m.opponents.push({
              personaId: values.personaId,
              name: this.person(values.personaId, ctx).name,
              reason: values.reason,
              at: this.now(),
            });
            this.event(
              d,
              m,
              `${this.person(values.personaId, ctx).name}는 ${template(m).title}에 반대: ${values.reason}`,
              witnesses,
            );
          }
          if (values.kind === 'accept') {
            if (m.status !== 'ready') throw Error('목표를 모은 미션만 수락할 수 있습니다.');
            m.status = 'accepted';
            m.performanceDeadline = this.now() + rules.performanceMs;
            this.event(
              d,
              m,
              `스트리머가 ${template(m).title}을 수락했습니다. 완료 조건: ${template(m).condition} 확인 전에는 미정산입니다.`,
              witnesses,
            );
          }
          if (values.kind === 'reject') {
            (d.blocked[ctx.sessionId] ||= []).push(m.templateId);
            d.lastProposalAt = this.now();
            this.release(
              d,
              m,
              'rejected',
              '스트리머가 거절했습니다. 이 방송에서 같은 조건을 다시 제안하지 않습니다.',
              witnesses,
            );
          }
          if (values.kind === 'cancel')
            this.release(d, m, 'cancelled', '스트리머가 취소했습니다.', witnesses);
          if (values.kind === 'revise') {
            if (!['funding', 'ready'].includes(m.status))
              throw Error('수락 전 미션의 조건만 다시 제안할 수 있습니다.');
            if (
              d.campaigns.some(
                (other) =>
                  other.id !== m.id && active(other) && other.templateId === values.templateId,
              )
            )
              throw Error('같은 조건의 다른 미션이 이미 진행 중입니다.');
            this.release(
              d,
              m,
              'revised',
              '조건이 바뀌어 이전 동의와 예치를 해제했습니다.',
              witnesses,
            );
            // A streamer revision creates new terms, never a new viewer pledge.
            const next = {
              ...m,
              id: randomUUID(),
              version: m.version + 1,
              templateId: values.templateId,
              target: values.target,
              status: 'funding',
              createdAt: this.now(),
              fundingDeadline: this.now() + rules.fundingMs,
              endedAt: null,
              endReason: '',
              contributions: [],
              opponents: [],
              evidence: [],
            };
            d.campaigns.push(next);
            result.missionId = next.id;
            this.event(
              d,
              next,
              `스트리머의 조건 수정: ${template(next).title}, 목표 ${next.target}미션점. 새 동참이 필요합니다.`,
              witnesses,
            );
          }
          if (values.kind === 'suggest-complete') {
            if (m.status !== 'accepted')
              throw Error('진행 중인 미션만 완료 후보를 제시할 수 있습니다.');
            m.status = 'review';
            m.reviewDeadline = Math.min(m.performanceDeadline, this.now() + rules.reviewMs);
            this.event(
              d,
              m,
              `${template(m).title}: AI의 완료 후보입니다 (${values.reason}). 스트리머가 확인하기 전에는 미정산입니다.`,
              witnesses,
              'model-suggestion',
            );
          }
          if (values.kind === 'confirm') {
            if (!['accepted', 'review'].includes(m.status))
              throw Error('수락 후 수행한 미션만 확인할 수 있습니다.');
            if (!values.completed)
              this.release(
                d,
                m,
                'failed',
                '스트리머가 완료 조건을 충족하지 않았다고 확인했습니다.',
                witnesses,
              );
            else {
              for (const p of m.contributions) {
                d.wallets[p.personaId].consumed += p.amount;
                this.entry(d, 'consume', p.personaId, m.id, p.amount);
              }
              m.status = 'completed';
              m.endedAt = this.now();
              m.endReason = '스트리머가 표시된 완료 조건을 충족했다고 확인했습니다.';
              this.event(
                d,
                m,
                `${template(m).title}: 스트리머 완료 확인. 예치 ${pledged(m)}미션점 소비. P 잔액에 지급되지 않습니다.`,
                witnesses,
                'user-confirmation',
              );
            }
          }
        }
      }
      d.receipts[requestId] = { fingerprint, result };
      return result;
    });
  }
  observeEvidence({ requestId, capturedAt, scene, witnesses, sessionId, gameId }) {
    if (!safeMissionReason(scene)) return;
    const rows = this.data.campaigns.filter(
      (m) =>
        ['accepted', 'review'].includes(m.status) &&
        m.sessionId === sessionId &&
        m.gameId === gameId &&
        capturedAt >= m.performanceDeadline - rules.performanceMs &&
        !m.evidence.some((e) => e.id === requestId),
    );
    if (!rows.length) return;
    this.change((d) => {
      for (const m of d.campaigns.filter((m) => rows.some((row) => row.id === m.id))) {
        m.evidence.push({ id: requestId, at: capturedAt, scene: scene.slice(0, 600), witnesses });
        m.evidence = m.evidence.slice(-5);
      }
    });
  }
  canChat(missionId, sessionId) {
    return (
      this.data.enabled &&
      this.data.campaigns.some(
        (m) =>
          m.id === missionId &&
          m.sessionId === sessionId &&
          active(m) &&
          this.now() < this.deadline(m),
      )
    );
  }
  snapshot(people = []) {
    const copy = structuredClone(this.data),
      wallets = {};
    for (const p of people) {
      const w = this.wallet(copy, p.id);
      wallets[p.id] = { balance: w.balance, held: this.held(copy, p.id), consumed: w.consumed };
    }
    return {
      enabled: this.data.enabled,
      wallets,
      templates: structuredClone(missionTemplates),
      rules: structuredClone(rules),
      campaigns: structuredClone(this.data.campaigns.slice(-20)).map((m) => ({
        ...m,
        total: pledged(m),
        supporterCount: m.contributions.length,
        template: structuredClone(template(m)),
      })),
    };
  }
  viewerContext(personaId) {
    return {
      events: this.data.events
        .filter((e) => e.witnesses.some((w) => w.personaId === personaId))
        .slice(-8)
        .map(({ witnesses, ...event }) => event),
      scenes: this.data.campaigns
        .flatMap((m) =>
          m.evidence
            .filter((e) => e.witnesses.some((w) => w.personaId === personaId))
            .map(({ witnesses, ...e }) => ({
              ...e,
              missionId: m.id,
              source: 'model-described-observation',
              outcome: m.status,
            })),
        )
        .slice(-5),
    };
  }
}
