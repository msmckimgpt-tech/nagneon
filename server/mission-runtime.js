import { randomUUID } from 'node:crypto';
import { MissionBoard, safeMissionReason } from './mission-board.js';

// This boundary only closes missions. Speech never accepts or settles them and
// never opens the existing advice/search permission path.
export function refusesMissions(speech) {
  const text = String(speech)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/(?<=[a-z])[‘’ʼ](?=[a-z])/gu, "'")
    .replace(/"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’|「[^」\n]*」|『[^』\n]*』/gu, '');
  // Only direct present refusals close the board. A different topic, quoted
  // history or negating refusal ("거절하지 않을게") cannot become a stop.
  return text
    .split(/[.!?。！？\n,]|\s*(?:하지만|그런데|근데|대신)\s*/u)
    .some(
      (clause) =>
        /(?:미션(?:\s*제안)?|도전\s*제안)(?:은|는|을|도|이|가)?\s*(?:(?:이제|지금은?|오늘은?|이번(?:엔|에는)|좀|더는)\s*){0,3}(?:그만(?:해(?:줘|주세요)?|하자|할래|할게|두자|둘래|둘게|하겠습니다)?|안\s*(?:할래|할게|해|하겠어)|하지\s*(?:마(?:세요)?|말(?:아(?:줘|주세요)?|자))|거절(?:해(?:줘|주세요)?|할게|할래|합니다|하겠습니다)?|싫(?:어|어요|다)|사양(?:할게|합니다)?|필요\s*없(?:어|어요|다))(?=$|\s)/u.test(
          clause.trim(),
        ) ||
        /^(?:please\s+)?(?:no\s+more|no|stop|don't\s+(?:offer|suggest)|do\s+not\s+(?:offer|suggest))\s+(?:any\s+|more\s+)?missions?\b/u.test(
          clause.trim(),
        ),
    );
}
export class MissionRuntime {
  constructor(studio, board) {
    this.studio = studio;
    this.board = board || new MissionBoard(undefined, undefined, studio.now);
  }
  people() {
    const s = this.studio;
    return s.settings.personas.filter(
      (p) => p.enabled && !p.system && p.id !== s.settings.managerId && p.role === 'viewer',
    );
  }
  witnesses(visits) {
    const s = this.studio;
    return this.people()
      .filter(
        (p) =>
          ['active', 'lurking'].includes(s.audience.presence[p.id]) &&
          Number.isFinite(s.audience.data.members[p.id]?.joinedAt) &&
          (!visits || visits.get(p.id) === s.audience.data.members[p.id].joinedAt),
      )
      .map((p) => ({ personaId: p.id, joinedAt: s.audience.data.members[p.id].joinedAt }));
  }
  context(visits) {
    const s = this.studio,
      game = s.settings.games.find((g) => g.id === s.settings.gameId);
    return {
      running: s.running && s.settings.mode === 'live',
      sessionId: s.sessionId,
      gameId: game.id,
      gameName: game.name,
      gaming: s.settings.category === 'gaming',
      allowAI: s.ai.allowed('reaction') && !this.storageError,
      blockedWords: s.settings.blockedWords,
      people: this.people(),
      witnesses: this.witnesses(visits),
    };
  }
  snapshot() {
    return { ...this.board.snapshot(this.people()), error: this.storageError || '' };
  }
  announce(previous) {
    const s = this.studio;
    for (const e of this.board.data.events.slice(previous)) {
      if (!s.running || !e.witnesses.length) continue;
      s.publishMessage(
        {
          ...s.prepareMessage(s.settings.managerId, e.text, 'notice'),
          missionEvent: true,
          missionId: e.missionId,
        },
        { witnesses: e.witnesses.map((w) => w.personaId), publishState: false },
      );
    }
    // Queued and late-generated mission pitches cannot survive a refusal.
    s.queue = s.queue.filter((m) => !m.missionId || this.allowsMessage(m));
    s.publish();
  }
  command(command) {
    const previous = this.board.data.events.length;
    try {
      const result = this.board.execute(command, this.context());
      this.storageError = '';
      if (!result.duplicate) this.announce(previous);
      return result;
    } catch (error) {
      if (error.code === 'MISSION_STORAGE') this.storageError = error.message;
      // Expiry can commit a refund before the requested decision is rejected.
      // Publish that authoritative state even when the command returns 409.
      if (this.board.data.events.length !== previous) this.announce(previous);
      else this.studio.publish();
      throw error;
    }
  }
  tick() {
    const s = this.studio;
    if (this.retryAfter && s.now() < this.retryAfter) return;
    try {
      if (this.board.expire(s.running ? s.sessionId : null, s.settings.gameId)) {
        this.storageError = '';
        s.publish();
      }
    } catch (error) {
      this.storageError = error.message;
      this.retryAfter = s.now() + 5000;
      throw error;
    }
  }
  stop() {
    try {
      this.board.stop();
    } catch (error) {
      this.storageError = error.message;
      throw error;
    }
  }
  speech(text) {
    if (this.board.data.enabled && refusesMissions(text)) {
      try {
        this.command({ kind: 'enabled', enabled: false, requestId: randomUUID() });
      } catch (error) {
        this.studio.queue = this.studio.queue.filter((m) => !m.missionId);
        this.studio.log(error.message);
      }
    }
  }
  allowsMessage(m) {
    return (
      !m.missionId || (!this.storageError && this.board.canChat(m.missionId, this.studio.sessionId))
    );
  }
  packet(personas, viewerContext) {
    const s = this.studio,
      state = this.snapshot(),
      ctx = this.context();
    for (const p of personas)
      if (viewerContext[p.id])
        viewerContext[p.id].missionExperience = this.board.viewerContext(p.id);
    return {
      enabled: state.enabled && ctx.running && ctx.gaming && ctx.allowAI,
      templates: state.templates,
      rules: state.rules,
      blockedTemplates: this.board.data.blocked[s.sessionId] || [],
      budgets: Object.fromEntries(
        personas.filter((p) => state.wallets[p.id]).map((p) => [p.id, state.wallets[p.id]]),
      ),
      campaigns: state.campaigns
        .filter(
          (m) =>
            m.sessionId === s.sessionId &&
            ['funding', 'ready', 'accepted', 'review'].includes(m.status),
        )
        .map(({ evidence, ...m }) => m),
      instructions:
        'AI 관객의 가상 미션점. P 잔액·현금·실제 후원과 분리. 완료와 소비는 스트리머 확인으로만 결정. 모금 달성은 수락 의무가 아닙니다.',
    };
  }
  observe(
    actions = [],
    {
      diagnosticId,
      witnessVisits,
      capturedAt,
      scene,
      confidence,
      excitement,
      image,
      stale,
      chatDriven,
      sourceRemoved,
      eligible,
    },
  ) {
    const s = this.studio,
      ctx = this.context(witnessVisits),
      previous = this.board.data.events.length;
    if (
      !ctx.running ||
      !ctx.gaming ||
      !ctx.allowAI ||
      stale ||
      chatDriven ||
      sourceRemoved ||
      !this.board.data.enabled
    )
      return;
    if (image && confidence >= 0.75 && safeMissionReason(scene, ctx.blockedWords)) {
      try {
        this.board.observeEvidence({
          requestId: diagnosticId,
          capturedAt,
          scene,
          witnesses: ctx.witnesses,
          sessionId: ctx.sessionId,
          gameId: ctx.gameId,
        });
      } catch (error) {
        if (error.code === 'MISSION_STORAGE') this.storageError = error.message;
        throw error;
      }
    }
    for (const [index, action] of actions.slice(0, 3).entries()) {
      if (confidence < 0.75 || excitement >= 0.75) continue;
      if (
        !eligible.includes(action.personaId) ||
        !ctx.witnesses.some((w) => w.personaId === action.personaId)
      )
        continue;
      const values =
        action.kind === 'propose'
          ? {
              kind: action.kind,
              personaId: action.personaId,
              templateId: action.templateId,
              target: action.target,
              amount: action.amount,
              reason: action.reason,
            }
          : {
              kind: action.kind,
              personaId: action.personaId,
              missionId: action.missionId,
              reason: action.reason,
              ...(action.kind === 'join' ? { amount: action.amount } : {}),
            };
      try {
        this.board.execute({ ...values, requestId: `${diagnosticId}_${index}` }, ctx);
      } catch (error) {
        if (error.code === 'MISSION_STORAGE') {
          this.storageError = error.message;
          throw error;
        }
        s.log('미션 제안 보류: ' + error.message);
      }
    }
    if (this.board.data.events.length !== previous) this.announce(previous);
  }
}
