import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  PRICING_CATALOG,
  costStatsShape,
  zeroCostStats,
  pricingSchema,
  pricingVendor,
  priceUsage,
  addPriceToStats,
  backfillPrices,
} from './ai-pricing.js';
import features from '../shared/ai-features.json' with { type: 'json' };

export const AI_ATTEMPT = Symbol('nagneon-ai-attempt');
export const AI_FEATURES = features;
const featureMap = new Map(features.map((f) => [f.id, f]));
const finite = z.number().finite().nonnegative();
const usageSchema = z.object({
  input: finite.nullable(),
  cached: finite.nullable(),
  output: finite.nullable(),
  total: finite.nullable(),
  cacheWrite: finite.nullable().optional(),
});
const statsSchema = z.object({
  ...costStatsShape,
  calls: finite,
  failed: finite,
  cancelled: finite,
  unknown: finite,
  input: finite,
  cached: finite,
  output: finite,
  total: finite,
  estimatedUsd: finite,
  priced: finite,
});
const statsMap = z.record(z.string().max(80), statsSchema);
const rateSchema = z
  .object({
    connection: z.string().trim().max(64),
    model: z.string().trim().min(1).max(200),
    input: finite.max(100000),
    cached: finite.max(100000),
    output: finite.max(100000),
  })
  .strict();
const policySchema = z
  .object({
    paused: z.boolean(),
    background: z.boolean(),
    features: z.record(z.string().max(80), z.boolean()),
    rates: z.array(rateSchema).max(40),
  })
  .strict();
const communityKinds = [
  'social-birth',
  'social-daily',
  'social-mention',
  'social-read',
  'social-discuss',
  'clip-comment',
  'gallery-comment',
  'community-review',
];
const communityResults = [
  'resident-created',
  'post-created',
  'comment-created',
  'read-only',
  'no-post',
];
const attemptSchema = z.object({
  id: z.string().uuid(),
  operationId: z.string().uuid(),
  featureId: z.string().max(80),
  sessionId: z.string().nullable(),
  at: finite,
  endedAt: finite.nullable(),
  day: z.string(),
  provider: z.string().max(40),
  model: z.string().max(200),
  connection: z.string().max(64),
  status: z.enum(['running', 'completed', 'failed', 'cancelled', 'interrupted']),
  usage: usageSchema.nullable(),
  estimatedUsd: finite.nullable(),
  pricingVendor: z.enum(['openai', 'custom']).optional(),
  pricing: pricingSchema.optional(),
  application: z.enum(['unconfirmed', 'accepted']),
  activityKind: z.enum(communityKinds).optional(),
  activityResult: z.enum(communityResults).optional(),
});
export const AiControlData = z
  .object({
    version: z.literal(1),
    clock: finite,
    // Discard only the retired cap when reading older profiles; keep strict validation.
    policy: z.preprocess((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
      const { dailyLimit: _retiredLimit, ...policy } = value;
      return policy;
    }, policySchema),
    days: z.array(z.object({ day: z.string(), features: statsMap })).max(31),
    sessions: z.array(z.object({ id: z.string(), features: statsMap })).max(8),
    recent: z.array(attemptSchema).max(500),
  })
  .strict()
  .refine(
    (v) => Buffer.byteLength(JSON.stringify(v)) <= 4 * 1024 * 1024,
    'AI 사용 기록의 보관 상한을 초과했습니다.',
  );
export const emptyAiControl = () => ({
  version: 1,
  clock: 0,
  policy: {
    paused: false,
    background: false,
    rates: [],
    features: Object.fromEntries(features.map((f) => [f.id, f.enabledByDefault])),
  },
  days: [],
  sessions: [],
  recent: [],
});
export const AiPolicyPatch = policySchema
  .partial()
  .strict()
  .superRefine((p, ctx) => {
    for (const id of Object.keys(p.features || {}))
      if (!featureMap.has(id))
        ctx.addIssue({ code: 'custom', message: '등록되지 않은 AI 기능입니다.' });
  });
const zero = () => ({
  ...zeroCostStats(),
  calls: 0,
  failed: 0,
  cancelled: 0,
  unknown: 0,
  input: 0,
  cached: 0,
  output: 0,
  total: 0,
  estimatedUsd: 0,
  priced: 0,
});
const count = (n) => (Number.isFinite(n) && n >= 0 ? n : null);
export function normalizeUsage(value) {
  if (!value || typeof value !== 'object') return null;
  const input = count(value.input_tokens ?? value.prompt_tokens),
    output = count(value.output_tokens ?? value.completion_tokens);
  const total =
    count(value.total_tokens) ?? (input !== null && output !== null ? input + output : null);
  const cached = count(
    value.cached_input_tokens ??
      value.input_tokens_details?.cached_tokens ??
      value.prompt_tokens_details?.cached_tokens,
  );
  return [input, output, total, cached].some((n) => n !== null)
    ? {
        input,
        output,
        total,
        cached,
        ...(value.input_tokens_details?.cache_write_tokens != null ||
        value.prompt_tokens_details?.cache_write_tokens != null
          ? {
              cacheWrite: count(
                value.input_tokens_details?.cache_write_tokens ??
                  value.prompt_tokens_details?.cache_write_tokens,
              ),
            }
          : {}),
      }
    : null;
}
export const aiDay = (at) => new Date(at + 9 * 3600000).toISOString().slice(0, 10);
const blocked = (text) => Object.assign(new Error(text), { code: 'ai_blocked' });
const cancelled = () =>
  Object.assign(new Error('AI 실행 설정이 바뀌어 요청을 취소했습니다.'), { code: 'ai_cancelled' });

// Called by the stable provider facade/router at every actual backend attempt.
// Standalone backend tests may call providers without a running application.
export function runAiAttempt(args, backend, signal, call, connection = '') {
  return args?.[AI_ATTEMPT]
    ? args[AI_ATTEMPT](backend, signal, call, connection, args)
    : call(args, signal);
}

export class AiControl {
  constructor({ data = emptyAiControl(), save = () => {}, now = Date.now } = {}) {
    this.data = AiControlData.parse(data);
    this.save = save;
    this.now = now;
    this.operations = new Map();
    this.generation = new Map();
    this.storageError = '';
    this.closed = false;
    this.context = () => ({});
    this.onChange = () => {};
    this.onPolicy = () => {};
    // A process exit cannot establish whether a provider charged a pending request.
    for (const row of this.data.recent) if (row.status === 'running') row.status = 'interrupted';
    // Pure in-memory upgrade; the next normal ledger save persists it.
    backfillPrices(this.data);
  }
  bind({ context, onChange, onPolicy }) {
    this.context = context;
    this.onChange = onChange;
    this.onPolicy = onPolicy;
  }
  time() {
    return Math.max(this.now(), this.data.clock);
  }
  mutate(edit) {
    const next = structuredClone(this.data);
    edit(next);
    next.clock = this.time();
    try {
      const valid = AiControlData.parse(next);
      this.save(valid);
      this.data = valid;
    } catch {
      this.storageError =
        'AI 사용 기록을 저장하지 못해 새 호출을 차단했습니다. 저장 공간과 권한을 확인한 뒤 앱을 다시 시작하세요.';
      for (const op of this.operations.values()) op.controller.abort(blocked(this.storageError));
      this.onChange();
      throw blocked(this.storageError);
    }
  }
  reason(id) {
    const f = featureMap.get(id),
      p = this.data.policy,
      ctx = this.context();
    if (!f) return '등록되지 않은 AI 기능은 실행할 수 없습니다.';
    if (this.storageError) return this.storageError;
    if (this.closed) return '앱 종료로 AI 호출을 차단했습니다.';
    if (p.paused) return 'AI 호출을 모두 차단한 상태입니다.';
    if (!p.features[id]) return '이 AI 기능의 실행 허용이 꺼져 있습니다.';
    if (f.scope === 'background' && !p.background)
      return '방송 밖 자동 AI 호출이 차단되어 있습니다.';
    if (
      id === 'community' &&
      ctx.settings?.communityActivityEnabled === false &&
      !ctx.social?.enabled
    )
      return '기존 설정에서 커뮤니티 자동 활동을 껐습니다.';
    if (id === 'culture' && ctx.settings?.memesEnabled === false)
      return '기존 설정에서 문화·밈 사용을 껐습니다.';
    return '';
  }
  allowed(id) {
    return !this.reason(id);
  }
  assertAllowed(id) {
    const reason = this.reason(id);
    if (reason) throw blocked(reason);
  }
  update(value) {
    const patch = AiPolicyPatch.parse(value),
      before = this.data.policy;
    this.mutate((d) => {
      d.policy = { ...d.policy, ...patch, features: { ...d.policy.features, ...patch.features } };
      if (patch.rates) backfillPrices(d);
    });
    const affected = features.filter((f) => this.reason(f.id)).map((f) => f.id);
    for (const id of affected) this.generation.set(id, (this.generation.get(id) || 0) + 1);
    for (const op of this.operations.values())
      if (affected.includes(op.featureId)) op.controller.abort(cancelled());
    this.onPolicy(affected, before);
    this.onChange();
    return this.snapshot();
  }
  startSession(id) {
    this.mutate((d) => {
      d.sessions = [...d.sessions.filter((s) => s.id !== id), { id, features: {} }].slice(-8);
    });
  }
  buckets(data, row) {
    let day = data.days.find((d) => d.day === row.day);
    if (!day) {
      day = { day: row.day, features: {} };
      data.days.push(day);
      data.days.sort((a, b) => a.day.localeCompare(b.day));
      data.days = data.days.slice(-31);
    }
    const session = data.sessions.find((s) => s.id === row.sessionId);
    return [day, session].filter(Boolean).map((b) => (b.features[row.featureId] ??= zero()));
  }
  async attempt(op, backend, signal, call, connection, preparedArgs = op.args) {
    signal.throwIfAborted();
    this.assertAllowed(op.featureId);
    if (this.operations.size > 32) throw blocked('동시에 처리할 AI 요청이 너무 많습니다.');
    const status = backend.status?.() || {},
      row = {
        id: randomUUID(),
        operationId: op.id,
        featureId: op.featureId,
        sessionId: op.sessionId,
        at: this.time(),
        endedAt: null,
        day: aiDay(this.time()),
        provider: String(status.kind || 'unknown').slice(0, 40),
        model: String(
          backend.model ||
            status.model ||
            (op.featureId === 'remote-stt' ? backend.transcriptionModel : '') ||
            'unknown',
        ).slice(0, 200),
        connection: connection.slice(0, 64),
        status: 'running',
        usage: null,
        estimatedUsd: null,
        application: 'unconfirmed',
      };
    if (op.featureId === 'community' && communityKinds.includes(op.args.special?.kind))
      row.activityKind = op.args.special.kind;
    if (op.featureId === 'remote-stt') {
      row.model = String(backend.transcriptionModel || 'unknown').slice(0, 200);
      row.provider = 'openai';
      row.connection = String(backend.transcriptionConnection || connection).slice(0, 64);
    }
    row.pricingVendor = pricingVendor(backend.base);
    const rates = structuredClone(this.data.policy.rates);
    this.mutate((d) => {
      for (const s of this.buckets(d, row)) {
        s.calls++;
        s.unknown++;
      }
      d.recent.push(row);
      // Keep active requests so finishing one never loses its usage record.
      while (d.recent.length > 500) {
        const i = d.recent.findIndex((r) => r.status !== 'running');
        if (i < 0) throw blocked('AI 실행 기록이 가득 찼습니다.');
        d.recent.splice(i, 1);
      }
    });
    op.attempts.push(row.id);
    this.onChange();
    let reported,
      outcome = 'completed';
    try {
      const result = await call(
        {
          ...preparedArgs,
          onAiUsage: (value) => {
            reported = normalizeUsage(value);
          },
        },
        signal,
      );
      reported = normalizeUsage(result?.usage) || reported;
      if (signal.aborted)
        throw Object.assign(new Error(signal.reason?.message || 'AI 요청이 취소되었습니다.'), {
          code: signal.reason?.code,
          aiGenerated: result?.observation?.messages?.length,
        });
      return result;
    } catch (error) {
      outcome = signal.aborted ? 'cancelled' : 'failed';
      throw error;
    } finally {
      const usage = reported || null;
      const pricing = priceUsage({ ...row, status: outcome, usage }, rates);
      const cost = pricing.kind === 'api' ? pricing.usd : null;
      this.mutate((d) => {
        const stored = d.recent.find((r) => r.id === row.id);
        Object.assign(stored, {
          status: outcome,
          endedAt: this.time(),
          usage,
          estimatedUsd: cost,
          pricing,
        });
        for (const s of this.buckets(d, row)) {
          if (usage?.total !== null && usage?.total !== undefined) s.unknown--;
          for (const key of ['input', 'cached', 'output', 'total']) s[key] += usage?.[key] || 0;
          if (outcome === 'failed') s.failed++;
          if (outcome === 'cancelled') s.cancelled++;
          addPriceToStats(s, pricing);
        }
      });
      this.onChange();
    }
  }
  async run(args, signal, provider, kind = 'react', call, connection = '') {
    const featureId = args.aiFeature;
    this.assertAllowed(featureId);
    signal?.throwIfAborted();
    const op = {
      id: randomUUID(),
      featureId,
      sessionId: this.context().sessionId || null,
      controller: new AbortController(),
      args,
      attempts: [],
      generation: this.generation.get(featureId) || 0,
    };
    this.operations.set(op.id, op);
    const combined = AbortSignal.any([op.controller.signal, ...(signal ? [signal] : [])]);
    const monitored = {
      ...args,
      [AI_ATTEMPT]: (b, s, fn, c = '', prepared) => this.attempt(op, b, s, fn, c, prepared),
    };
    op.args = monitored;
    try {
      let result;
      if (kind === 'react' && provider.managesAiAttempts)
        result = await provider.react(monitored, combined);
      else
        result = await this.attempt(
          op,
          provider,
          combined,
          call || ((a, s) => provider.react(a, s)),
          connection,
        );
      combined.throwIfAborted();
      return result && typeof result === 'object'
        ? { ...result, aiReceipt: { featureId, generation: op.generation, attempts: op.attempts } }
        : result;
    } finally {
      this.operations.delete(op.id);
      this.onChange();
    }
  }
  assertCurrent(result) {
    const r = result?.aiReceipt;
    if (
      r &&
      (r.generation !== (this.generation.get(r.featureId) || 0) ||
        this.data.policy.paused ||
        !this.data.policy.features[r.featureId])
    )
      throw cancelled();
  }
  accepted(result, activityResult) {
    this.assertCurrent(result);
    const ids = result?.aiReceipt?.attempts;
    if (!ids?.length) return;
    // The product result was committed already; a ledger write failure blocks future calls, without refunding or duplicating that result.
    try {
      this.mutate((d) => {
        for (const r of d.recent)
          if (ids.includes(r.id) && r.status === 'completed') {
            r.application = 'accepted';
            if (r.featureId === 'community' && activityResult) r.activityResult = activityResult;
          }
      });
    } catch {
      /* storageError is published by mutate */
    }
    this.onChange();
  }
  wrap(provider, connection = '') {
    if (provider.aiControl === this) return provider;
    const self = this;
    return new Proxy(provider, {
      get(target, key, receiver) {
        if (key === 'aiControl') return self;
        if (key === 'react')
          return (args, signal) => self.run(args, signal, target, 'react', undefined, connection);
        if (key === 'transcribe')
          return (buffer, mime, signal) =>
            target.localSpeech
              ? target.transcribe(buffer, mime, signal)
              : self.run({ aiFeature: 'remote-stt' }, signal, target, 'transcribe', (args, s) =>
                  target.transcribe(buffer, mime, s, args.onAiUsage),
                );
        return Reflect.get(target, key, receiver);
      },
    });
  }
  close() {
    this.closed = true;
    for (const op of this.operations.values()) op.controller.abort(cancelled());
  }
  aggregate(period) {
    const ctx = this.context(),
      today = aiDay(this.time()),
      from = aiDay(this.time() - 6 * 86400000);
    const buckets =
      period === 'session'
        ? [this.data.sessions.find((s) => s.id === ctx.sessionId)].filter(Boolean)
        : this.data.days.filter((d) =>
            period === 'week' ? d.day >= from && d.day <= today : d.day === today,
          );
    const result = {};
    for (const b of buckets)
      for (const [id, value] of Object.entries(b.features)) {
        const s = (result[id] ??= zero());
        for (const k of Object.keys(s)) s[k] += value[k];
      }
    return result;
  }
  snapshot() {
    const ctx = this.context(),
      now = this.time();
    return {
      policy: structuredClone(this.data.policy),
      pricingCatalog: structuredClone(PRICING_CATALOG),
      timezone: 'Asia/Seoul',
      day: aiDay(now),
      storageError: this.storageError,
      active: [...this.operations.values()].map((op) => ({
        id: op.id,
        featureId: op.featureId,
        status: op.controller.signal.aborted ? 'cancelling' : 'running',
      })),
      features: features.map((f) => ({
        ...f,
        enabled: !!this.data.policy.features[f.id],
        reason: this.reason(f.id),
        ready:
          f.id === 'culture'
            ? !!ctx.settings?.cultureDomains?.length
            : f.id === 'remote-stt'
              ? !ctx.localSpeech
              : true,
        nextAt:
          f.id === 'community'
            ? ctx.community?.nextAt || null
            : f.id === 'culture'
              ? ctx.culture?.sources?.length
                ? Math.min(...ctx.culture.sources.map((s) => s.nextAt))
                : null
              : null,
      })),
      usage: {
        today: this.aggregate('today'),
        week: this.aggregate('week'),
        session: this.aggregate('session'),
      },
      recent: this.data.recent
        .slice(-40)
        .reverse()
        .map((r) => ({ ...r, pricing: r.pricing || priceUsage(r, this.data.policy.rates) })),
      retained: { days: 31, requests: 500 },
    };
  }
}
