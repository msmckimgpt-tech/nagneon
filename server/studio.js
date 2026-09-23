import { SpeechCapture, witnessedSpeech } from './speech-screen.js';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { defaults } from '../shared/defaults.js';
import { Settings, Observation } from './schema.js';
import { Knowledge } from './knowledge.js';
import { Audience } from './audience.js';
import { viewerKnowledgeByPersona, liveViewerContext } from './viewer-context.js';
import { Economy } from './economy.js';
import { SpecialFeatures } from './special-features.js';
import { Clips, ClipFeatures } from './clips.js';
import { SoundScene } from './sound-scene.js';
import { ConversationJournal } from './conversation-journal.js';
import { AudienceAutonomy } from './audience-autonomy.js';
import { Ambient } from './ambient.js';
import { requestsAdvice, adviceIntent, liveAdvicePolicy } from './advice-intent.js';
import { SpeechInbox } from './speech-inbox.js';
import { repeatedChat } from './chat-quality.js';
import { admitTranscriptCorrection, transcriptAnomaly } from './transcript-correction.js';
import { revisesLiveSituation } from './streamer-expression.js';
import { Community } from './community.js';
import { AiControl } from './ai-control.js';
import { CommunityActivity } from './community-activity.js';
import { CultureLearning } from './culture/learning.js';
import { ClipPerception } from './clip-perception.js';
import { ViewingContinuity, SCREEN_REACTION_TTL_MS } from './viewing-continuity.js';
import { donationMessage } from './chat-attention.js';
import { temporalVideo } from './temporal-video.js';
import { VIDEO_REACTION_TTL_MS } from '../shared/temporal-policy.js';
import { sameViewingVisit, retainPresentReactions } from './live-presence.js';
import { ReactionDiagnostics } from './reaction-diagnostics.js';

export class Studio extends EventEmitter {
  constructor({
    provider,
    settings = defaults,
    persist = () => {},
    world,
    now = Date.now,
    random = Math.random,
    knowledge = new Knowledge(),
    audience = new Audience(),
    journal = new ConversationJournal(),
    economy,
    clips,
    clipPerception,
    cultureLearning,
    aiControl,
    storageStatus = () => ({ warnings: [], recovered: [] }),
  } = {}) {
    super();
    this.runtime = { snapshot: () => ({}), beforeStop: [] };
    this.ai = aiControl || new AiControl({ now: () => this.now() });
    this.provider = this.ai.wrap(provider);
    this.settings = Settings.parse(settings);
    this.persist = persist;
    this.now = now;
    this.random = random;
    this.storageStatus = storageStatus;
    this.audience = audience;
    this.journal = journal;
    this.knowledge = knowledge;
    this.running = false;
    this.messages = [];
    this.events = [];
    this.queue = [];
    this.controller = new AbortController();
    this.epoch = 0;
    this.economy = economy || new Economy(undefined, () => {}, now);
    this.economy.ensureWallets(this.settings.personas);
    this.special = new SpecialFeatures(this);
    this.clips = clips || new Clips({ now });
    this.clipFeatures = new ClipFeatures(this, this.clips);
    this.sound = new SoundScene(this);
    this.viewing = new ViewingContinuity();
    this.reactions = new ReactionDiagnostics(now);
    this.resetCounters();
    this.timer = setInterval(() => this.pump(), 250);
    this.timer.unref();
    this.world = world;
    this.ambient = new Ambient(this);
    this.community = new Community(this);
    if (world) {
      world.bind(this);
      this.autonomy = new AudienceAutonomy(this, world);
    }
    this.communityActivity = new CommunityActivity(this);
    this.culture = new CultureLearning(this, cultureLearning);
    this.clipPerception = clipPerception || new ClipPerception();
    this.ai.bind({
      context: () => ({
        settings: this.settings,
        sessionId: this.sessionId,
        localSpeech: this.provider.localSpeech,
        community: this.communityActivity.snapshot(),
        culture: this.culture.snapshot(),
      }),
      onChange: () => this.publish(),
      onPolicy: (affected, before) => {
        const after = this.ai.data.policy;
        if (
          affected.includes('community') ||
          before.paused !== after.paused ||
          before.background !== after.background ||
          before.features.community !== after.features.community
        )
          this.communityActivity.interrupt();
        if (
          affected.includes('culture') ||
          before.paused !== after.paused ||
          before.background !== after.background ||
          before.features.culture !== after.features.culture
        )
          this.culture.interrupt();
        if (affected.includes('reaction') || affected.includes('ambient')) {
          if (affected.includes(this.liveReaction?.aiFeature)) this.liveReaction.controller.abort();
          this.queue = this.queue.filter(
            (m) => m.origin !== 'live' || !affected.includes(m.aiFeature || 'reaction'),
          );
          this.speechInbox.clear();
          this.ambient.reset();
          this.viewing.reset();
        }
      },
    });
  }
  resetCounters() {
    this.reactions.reset();
    this.speechInbox = new SpeechInbox();
    this.liveReaction = null;
    this.endedVideoSources = new Map();
    this.ambient?.reset();
    this.sound?.stop();
    this.viewing.reset();
    this.calls = 0;
    this.tokens = 0;
    this.busy = false;
    this.audioBusy = false;
    this.lastRequest = 0;
    this.lastSpeaker = new Map();
    this.observation = null;
    this.lastError = '';
    this.sessionId = null;
    this.startedAt = null;
    this.voiceCues = null;
    this.failures = 0;
    this.retryAt = 0;
  }
  endVideo({ sessionId, sourceId }) {
    if (sessionId !== this.sessionId || !this.running) return { ok: true };
    for (const [id, at] of this.endedVideoSources)
      if (this.now() - at > 120000) this.endedVideoSources.delete(id);
    this.endedVideoSources.set(sourceId, this.now());
    if (
      this.liveReaction?.sourceId === sourceId ||
      this.liveReaction?.speechSourceIds?.has(sourceId)
    ) {
      this.liveReaction.superseded = true;
      this.liveReaction.controller.abort();
    }
    this.queue = this.queue.filter((m) => m.screenSourceId !== sourceId);
    if (this.viewing.last?.video?.sourceId === sourceId) {
      this.viewing.reset();
      this.knowledge.lastSeen = null;
      this.observation = null;
    }
    this.publish();
    return { ok: true };
  }
  attachRuntime(runtime) {
    this.runtime = runtime;
  }
  state() {
    return {
      ambient: this.ambient.snapshot(),
      sound: this.sound.snapshot(),
      journal: this.journal.summary(),
      storage: this.storageStatus(),
      settings: this.world?.publicSettings() || this.settings,
      autonomy: this.autonomy?.snapshot(),
      clips: this.clips.list(),
      economy: this.economy.snapshot(this.settings.personas),
      audience: this.world?.publicAudience() || {
        ...this.audience.data,
        communityActivity: undefined,
        posts: this.community.list().reverse(),
        presence: this.audience.presence,
      },
      knowledge: Object.values(this.knowledge.entries),
      running: this.running,
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      messages: this.messages,
      events: this.events,
      observation: this.observation,
      ai: this.ai.snapshot(),
      calls: this.calls,
      tokens: this.tokens,
      busy: this.busy && !this.communityActivity?.active,
      communityActivity: this.communityActivity?.snapshot(),
      culture: this.culture?.snapshot(),
      lastError: this.lastError,
      provider: this.provider.status(),
      queued: this.queue.length,
      ...this.runtime.snapshot(),
    };
  }
  publish() {
    this.emit('state', this.state());
  }
  receiveSpeech({ id, sessionId, text, source = 'keyboard', capture }) {
    this.communityActivity.interrupt();
    if (!this.running || sessionId !== this.sessionId)
      throw new Error('이미 끝난 방송의 발언은 전달할 수 없습니다.');
    if (
      capture &&
      (source !== 'microphone' ||
        !Number.isFinite(capture.startedAt) ||
        !Number.isFinite(capture.endedAt) ||
        capture.startedAt < this.startedAt - 2000 ||
        capture.endedAt > this.now() + 2000 ||
        capture.endedAt <= capture.startedAt ||
        capture.endedAt - capture.startedAt > 15000)
    )
      throw new Error('발언을 녹음한 시각을 확인하세요.');
    if (capture) {
      capture = SpeechCapture.parse(capture);
      if (capture.screen && capture.screen.sessionId !== sessionId)
        throw new Error('이미 끝난 방송의 화면은 전달할 수 없습니다.');
    }
    if (this.settings.mode === 'live' && !this.ai.allowed('reaction'))
      throw new Error(this.ai.reason('reaction'));
    const hearers = this.presentWitnesses().filter(
      (id) => !capture || this.audience.data.members[id]?.joinedAt <= capture.startedAt,
    );
    const result = this.speechInbox.receive(
      id,
      text,
      () =>
        this.publishMessage(
          {
            ...this.prepareMessage('streamer', text, 'streamer'),
            ...(source === 'microphone' ? { transcription: { source: 'microphone' } } : {}),
          },
          { witnesses: hearers },
        ),
      source,
      capture,
      hearers,
    );
    if (!result.duplicate) {
      this.queue = this.queue.filter((m) => m.origin !== 'live');
      // A screen-only analysis should yield to the person speaking. The live
      // session signal and paid interactions are deliberately left intact.
      if (
        this.liveReaction &&
        (!this.liveReaction.hasSpeech || revisesLiveSituation(text) || adviceIntent(text).refused)
      ) {
        this.liveReaction.superseded = true;
        this.liveReaction.controller.abort();
      }
    }
    this.publish();
    return { ...result, pending: this.speechInbox.pending.length };
  }
  log(text) {
    this.events.push({ id: randomUUID(), time: this.now(), text });
    this.events = this.events.slice(-60);
  }
  setChatDisplay(showStreamerMessages) {
    if (typeof showStreamerMessages !== 'boolean')
      throw new Error('표시 설정은 참 또는 거짓이어야 합니다.');
    const result = { showStreamerMessages };
    if (this.settings.showStreamerMessages === showStreamerMessages) return result;
    const next = { ...this.settings, showStreamerMessages };
    this.persist(next);
    this.settings = next;
    // A display preference does not invalidate messages, memories or audience state.
    this.emit('chat-display', result);
    return result;
  }
  correctTranscripts(proposals, candidates) {
    let rejected = false;
    const eligible = new Map(candidates.map((e) => [e.messageId, e]));
    for (const proposal of proposals || []) {
      const original = eligible.get(proposal.messageId);
      if (!original) continue;
      eligible.delete(proposal.messageId);
      if (proposal.text?.trim() === original.text) continue;
      if (!admitTranscriptCorrection(original.text, proposal)) {
        rejected = true;
        continue;
      }
      const correction = {
        text: proposal.text.trim(),
        confidence: proposal.confidence,
        reason: proposal.reason,
        at: this.now(),
      };
      try {
        if (this.journal.annotateTranscription(original.messageId, correction)) {
          const message = this.messages.find((m) => m.id === original.messageId);
          if (message) message.transcription = { source: 'microphone', correction };
          this.speechInbox.annotate(original.messageId, correction.text);
          this.publish();
        } else rejected = true;
      } catch (error) {
        this.log('음성 교정 저장을 미뤘습니다. ' + error.message);
        rejected = true;
      }
    }
    return { rejected };
  }
  configure(settings) {
    if (this.running || this.busy) throw new Error('방송·관객 응답을 종료한 뒤 설정을 변경하세요.');
    const next = Settings.parse(this.autonomy ? this.autonomy.configure(settings) : settings);
    this.economy.ensureWallets(next.personas);
    this.persist(next);
    this.settings = next;
    this.culture.interrupt();
    this.culture.sync();
    this.publish();
  }
  start() {
    this.culture.interrupt();
    if (this.autonomy?.firstTutorialPending && this.settings.mode === 'live')
      throw Error(
        '첫 관객을 준비하고 있어요. 완료 후 실제 방송을 시작하세요. 리허설은 지금 할 수 있어요.',
      );
    this.communityActivity.interrupt();
    if (this.running) return;
    if (this.settings.mode === 'live' && !this.provider.status().configured)
      throw new Error('방송 설정에서 ChatGPT 계정 또는 선택한 AI 제공처의 연결을 확인하세요.');
    this.controller.abort();
    this.controller = new AbortController();
    this.epoch++;
    this.queue = [];
    this.messages = [];
    this.events = [];
    this.resetCounters();
    this.running = true;
    this.sessionId = randomUUID();
    this.startedAt = this.now();
    try {
      this.ai.startSession(this.sessionId);
      if (this.settings.mode === 'live') {
        this.audience.start(this.settings, this.now()).forEach((e) => this.log(e));
        this.autonomy?.start();
      }
    } catch (error) {
      this.running = false;
      this.sessionId = null;
      this.startedAt = null;
      this.controller.abort();
      this.lastError = error.message;
      this.publish();
      throw error;
    }
    this.log(this.settings.mode === 'live' ? 'AI 방송 시작' : '리허설 시작');
    this.publish();
  }
  stop() {
    this.culture.interrupt();
    this.communityActivity?.interrupt();
    this.sound.stop();
    this.running = false;
    this.epoch++;
    this.controller.abort();
    this.busy = false;
    this.audioBusy = false;
    this.queue = [];
    this.speechInbox.clear();
    this.knowledge.lastSeen = null;
    this.ambient?.reset();
    for (const [label, stop] of this.runtime.beforeStop) {
      try {
        stop();
      } catch (error) {
        this.lastError = `${label} 연결 해제 실패: ${error.message}`;
        this.log(this.lastError);
      }
    }
    // Storage failure must never keep the live session or its pending model alive.
    for (const [label, save] of [
      ['관객', () => this.audience.stop()],
      ['시청 시간', () => this.autonomy?.stop()],
    ]) {
      try {
        save();
      } catch (error) {
        this.lastError = `${label} 종료 기록 저장 실패: ${error.message}`;
        this.log(this.lastError);
      }
    }
    this.log('방송 종료 · 대기 반응 취소');
    this.publish();
  }
  close() {
    this.ai.close();
    void this.culture.close();
    this.communityActivity.close();
    void this.clipPerception.close();
    this.stop();
    clearInterval(this.timer);
  }
  prepareMessage(personaId, text, kind = 'chat') {
    const p = this.settings.personas.find((p) => p.id === personaId);
    return {
      id: randomUUID(),
      personaId,
      name: p?.name || this.settings.streamer,
      color: p?.color || '#ffffff',
      text,
      kind,
      time: this.now(),
    };
  }
  publishMessage(msg, { witnesses = this.presentWitnesses() } = {}) {
    this.messages.push(msg);
    if (this.running && this.settings.mode === 'live')
      try {
        this.journal.record(msg, {
          sessionId: this.sessionId,
          witnesses,
          title: this.settings.title,
        });
      } catch (error) {
        this.log(`대화 기억 보관 실패: ${error.message}`);
        this.lastError = '대화는 표시됐지만 기억에 보관하지 못했습니다. ' + error.message;
      }
    if (this.settings.mode === 'live')
      try {
        this.audience.message(msg.personaId, msg.text, this.settings);
      } catch (error) {
        this.log(`관객 기억 저장 실패: ${error.message}`);
        this.lastError = error.message;
      }
    if (msg.meme) this.culture.recordUse(msg.personaId);
    this.messages = this.messages.slice(-500);
    this.publish();
    return msg;
  }
  addMessage(personaId, text, kind = 'chat') {
    return this.publishMessage(this.prepareMessage(personaId, text, kind));
  }
  moderate(action, id) {
    if (action === 'delete') {
      this.journal.forget([id]);
      this.speechInbox.forget(id);
      this.messages = this.messages.filter((m) => m.id !== id);
      this.log('메시지 삭제');
    }
    if (action === 'ban' || action === 'unban') {
      const p = this.settings.personas.find((p) => p.id === id);
      if (!p) throw new Error('관객을 찾을 수 없습니다.');
      if (action === 'ban' && p.id === this.settings.managerId)
        throw new Error('매니저 변경은 방송 설정에서 할 수 있습니다.');
      const next = {
        ...this.settings,
        personas: this.settings.personas.map((p) =>
          p.id === id ? { ...p, enabled: action === 'unban' } : p,
        ),
      };
      this.persist(next);
      this.settings = next;
      this.queue = this.queue.filter((m) => m.personaId !== id);
      this.log(`${p.name} ${action === 'ban' ? '차단' : '차단 해제'}`);
      if (this.running && this.settings.mode === 'live') {
        if (action === 'ban') this.audience.setPresence(id, 'away', this.now());
        else if (this.audience.data.members[id]?.joinedAt >= this.startedAt)
          this.audience.setPresence(id, 'active', this.now());
        else if (this.autonomy) this.audience.presence[id] = 'away';
        else if (this.settings.discovery.enabled) this.audience.presence[id] = 'waiting';
        else this.log(this.audience.join(p, this.settings, this.now()));
      }
    }
    if (action === 'clear') {
      this.journal.forget(this.messages.map((m) => m.id));
      this.speechInbox.clear();
      this.messages = [];
      this.queue = [];
      this.log('채팅 비우기');
    }
    this.publish();
  }
  admittedAdvice(requestId) {
    // A retry after downstream storage failure is the same speech request.
    // Count shown hints and still-deliverable queued hints, not discarded work.
    return requestId
      ? [
          ...this.messages,
          ...this.queue.filter(
            (m) =>
              (!Number.isFinite(m.expiresAt) || this.now() < m.expiresAt) &&
              sameViewingVisit(this.audience, m.personaId, m.viewingVisit),
          ),
        ].filter((m) => m.advice && m.adviceRequestId === requestId).length
      : 0;
  }
  accept(
    observation,
    observedAt = this.now(),
    fictional = false,
    origin = 'other',
    {
      expiresAt,
      chatDriven = false,
      loreIds,
      screenSourceId,
      visits,
      advicePolicy,
      adviceRequestId,
      diagnosticId,
      responseStartedAt,
      externalIds,
    } = {},
  ) {
    const obs = Observation.parse(observation);
    if (!fictional)
      this.observation = {
        game: obs.game,
        scene: obs.scene,
        confidence: obs.confidence,
        excitement: obs.excitement,
        positiveMoment: {
          positive: obs.positiveMoment.positive,
          impact: obs.positiveMoment.impact,
        },
        at: observedAt,
      };
    // Inference already consumes the first viewer's reaction time. Credit it
    // once, after filtering; keep spacing between the remaining messages.
    // Use the request start, never an older captured frame or observation.
    const responseWait =
      origin === 'live' && this.settings.mode === 'live' && Number.isFinite(responseStartedAt)
        ? Math.max(0, this.now() - responseStartedAt)
        : 0;
    let delay = 0,
      first = true,
      admittedHints = this.admittedAdvice(adviceRequestId);
    this.reactions.reject(
      diagnosticId,
      'pace',
      Math.max(0, obs.messages.length - this.settings.chatPace),
    );
    for (const m of obs.messages.slice(0, this.settings.chatPace)) {
      if (origin === 'live' && Number.isFinite(expiresAt) && this.now() >= expiresAt) {
        this.reactions.reject(diagnosticId, 'expired');
        continue;
      }
      const p = this.settings.personas.find((p) => p.id === m.personaId && p.enabled);
      const blocked = this.settings.blockedWords.some((w) =>
        m.text
          .normalize('NFKC')
          .toLocaleLowerCase()
          .includes(w.normalize('NFKC').toLocaleLowerCase()),
      );
      const recent = [...this.messages.slice(-60), ...this.queue];
      const duplicate =
        origin === 'live'
          ? repeatedChat(m, recent, this.now())
          : recent.some((x) => x.text === m.text);
      if (!p || blocked || duplicate || (m.spoiler && this.settings.spoilerGuard)) {
        this.reactions.reject(
          diagnosticId,
          !p ? 'disabled' : blocked ? 'blocked' : duplicate ? 'duplicate' : 'spoiler',
        );
        if (p && !duplicate) this.log(`매니저: ${p.name} 메시지 보류`);
        continue;
      }
      if (origin === 'live' && m.advice) {
        const policy =
          advicePolicy || liveAdvicePolicy('', this.settings.adviceMode, this.messages);
        if (
          !policy.allowed ||
          (policy.maxMessages !== null && admittedHints >= policy.maxMessages)
        ) {
          this.reactions.reject(diagnosticId, 'advice');
          continue;
        }
        admittedHints++;
      }
      delay += 600 + this.random() * 1600;
      if (first) {
        delay = Math.max(0, delay - responseWait);
        first = false;
      }
      this.reactions.admit(diagnosticId);
      this.queue.push({
        ...m,
        origin,
        chatDriven,
        ...(loreIds?.length ? { loreIds } : {}),
        ...(externalIds?.length ? { externalIds } : {}),
        ...(diagnosticId ? { diagnosticId } : {}),
        ...(m.advice && adviceRequestId ? { adviceRequestId } : {}),
        ...(origin === 'live' && this.settings.mode === 'live'
          ? {
              viewingVisit:
                visits?.get(m.personaId) ?? this.audience.data.members[m.personaId]?.joinedAt,
            }
          : {}),
        ...(screenSourceId ? { screenSourceId } : {}),
        ...(Number.isFinite(expiresAt) ? { expiresAt } : {}),
        createdAt: this.now(),
        kind: m.kind === 'notice' && p.id === this.settings.managerId ? 'notice' : 'chat',
        due: this.now() + delay,
      });
    }
    this.publish();
  }
  tickAudience() {
    if (this.settings.mode !== 'live') return;
    const before = this.audience.presenceRevision,
      events = this.audience.tick(this.settings, this.now(), this.observation?.excitement || 0);
    events.forEach((e) => this.log(e));
    if (events.length || before !== this.audience.presenceRevision) this.publish();
    try {
      this.autonomy?.tick();
    } catch (error) {
      this.lastError = error.message;
    }
  }
  pump() {
    this.culture?.tick();
    this.externalChat?.prune();
    if (!this.running) {
      this.communityActivity?.tick();
      return;
    }
    const now = this.now();
    this.tickAudience();
    const count = this.queue.length;
    this.queue = this.queue.filter((m) => {
      if (m.origin !== 'live') return true;
      const expired = Number.isFinite(m.expiresAt) && now >= m.expiresAt,
        absent =
          this.settings.mode === 'live' &&
          !sameViewingVisit(this.audience, m.personaId, m.viewingVisit);
      if (expired || absent) {
        this.reactions.drop(m.diagnosticId, expired ? 'expired' : 'absent');
        return false;
      }
      return true;
    });
    if (this.queue.length !== count) this.publish();
    const index = this.queue.findIndex(
      (m) =>
        m.due <= now &&
        now - (this.lastSpeaker.get(m.personaId) || 0) >= this.settings.slowModeSeconds * 1000,
    );
    if (index < 0) {
      this.communityActivity?.tick();
      return;
    }
    const [m] = this.queue.splice(index, 1);
    if (!this.settings.personas.some((p) => p.id === m.personaId && p.enabled)) {
      this.reactions.drop(m.diagnosticId, 'disabled');
      return;
    }
    if (m.meme && !this.culture.canUse(m.personaId)) {
      this.reactions.drop(m.diagnosticId, 'expired');
      return;
    }
    this.lastSpeaker.set(m.personaId, now);
    try {
      this.publishMessage({
        ...this.prepareMessage(m.personaId, m.text, m.kind),
        ...(m.meme ? { meme: true } : {}),
        ...(m.advice
          ? { advice: true, ...(m.adviceRequestId ? { adviceRequestId: m.adviceRequestId } : {}) }
          : {}),
        ...(m.chatDriven ? { chatDriven: true } : {}),
      });
      this.reactions.delivered(m.diagnosticId);
    } catch (error) {
      this.reactions.drop(m.diagnosticId, 'delivery-error');
      this.lastError = error.message;
      this.log(`채팅 기록 저장 실패: ${error.message}`);
      this.publish();
    }
  }
  reserveCall() {
    this.calls++;
  }
  // 요청 캡처 시점의 목격자 스냅샷: 화면을 함께 본 것으로 인정할, 이번 세션에 실제 입장한(joinedAt>=startedAt) active/lurking 관객.
  // 모델 응답이 지연되어 그 사이 입장/이탈이 생겨도 이 스냅샷을 기준으로 목격을 판단한다(늦게 온 관객은 목격자가 아니다).
  presentWitnesses() {
    if (this.settings.mode !== 'live') return [];
    return this.settings.personas
      .filter(
        (p) =>
          p.enabled &&
          ['active', 'lurking'].includes(this.audience.presence[p.id]) &&
          this.audience.data.members[p.id]?.joinedAt >= this.startedAt,
      )
      .map((p) => p.id);
  }
  async react(input) {
    const sessionId = this.sessionId,
      result = await this.reactInput(input);
    if (sessionId === this.sessionId && this.settings.mode === 'live' && result?.skipped)
      this.reactions.skip(result.skipped);
    return result;
  }
  async reactInput({ image, video, speech = '' }) {
    if (this.communityActivity.active) await this.communityActivity.yield();
    else this.communityActivity.interrupt();
    if (video && this.endedVideoSources.has(video.sourceId)) return { skipped: 'ended-screen' };
    if (!this.running) throw new Error('방송을 먼저 시작하세요.');
    if (
      this.settings.mode === 'live' &&
      !this.ai.allowed('reaction') &&
      !this.ai.allowed('ambient')
    ) {
      this.speechInbox.clear();
      return { skipped: 'ai-blocked' };
    }
    if (this.busy) return { skipped: 'busy' };
    if (this.autonomy?.waiting) return { skipped: 'audience-arrival' };
    const speechBatch = speech ? { text: speech, ids: [] } : this.speechInbox.batch();
    speech = speechBatch.text;
    const uncertain = this.speechInbox
      .sources(speechBatch.ids)
      .filter((e) => e.source === 'microphone' && transcriptAnomaly(e.text));
    if (uncertain.length) {
      const ids = new Set(uncertain.map((e) => e.messageId));
      this.speechInbox.acknowledge(
        this.speechInbox.pending.filter((e) => ids.has(e.messageId)).map((e) => e.id),
      );
      this.log('음성 인식에 긴 반복이 있어 해당 발언의 해석을 보류했습니다.');
      this.publish();
      return { ok: true, transcriptionNeedsReview: true };
    }
    const speechHearers = speechBatch.ids.length ? this.speechInbox.hearers(speechBatch.ids) : null;
    if (this.now() < this.retryAt) return { skipped: 'backoff' };
    if (
      this.now() - Math.max(this.lastRequest, this.viewing.checkedAt) <
        this.settings.intervalSeconds * 1000 &&
      !speech
    )
      return { skipped: 'interval' };
    if (speech && this.now() - this.lastRequest < 2000) return { skipped: 'interval' };
    const epoch = this.epoch;
    const prepared = this.prepareReactionViewing({ image, video, speech });
    if (prepared.skipped) return prepared;
    const { viewing, frames, screenTimeline, idleConversation, watchingCompany } = prepared;
    image = prepared.image;
    const aiFeature = idleConversation ? 'ambient' : 'reaction';
    if (this.settings.mode === 'live' && !this.ai.allowed(aiFeature)) {
      this.speechInbox.acknowledge(speechBatch.ids);
      return { skipped: 'ai-blocked' };
    }
    let diagnosticId,
      diagnosticOutcome = 'accepted';
    const operation = {
      controller: new AbortController(),
      hasSpeech: !!speech,
      aiFeature,
      superseded: false,
      sourceId: idleConversation ? undefined : screenTimeline?.sourceId,
    };
    this.liveReaction = operation;
    const signal = AbortSignal.any([this.controller.signal, operation.controller.signal]);
    this.lastRequest = viewing?.at ?? this.now();
    this.busy = true;
    this.lastError = '';
    this.publish();
    try {
      if (
        speech &&
        !speechBatch.ids.length &&
        !(this.messages.at(-1)?.kind === 'streamer' && this.messages.at(-1)?.text === speech)
      ) {
        this.queue = this.queue.filter((m) => m.origin !== 'live');
        this.addMessage('streamer', speech, 'streamer');
      }
      if (this.settings.mode === 'rehearsal') {
        const rehearsal = this.reactRehearsal(speech);
        if (rehearsal) return rehearsal;
      } else {
        const context = this.prepareLiveReaction({
          speech,
          speechBatch,
          speechHearers,
          viewing,
          screenTimeline,
          idleConversation,
          watchingCompany,
          operation,
        });
        const {
          eligiblePersonas,
          eligibleSettings,
          witnesses,
          personalContext,
          transcriptCandidates,
          viewerKnowledge,
          liveSpeech,
          adviceRequested,
          advicePolicy,
          ambient,
        } = context;
        this.reserveCall();
        diagnosticId = this.reactions.begin({
          hasSpeech: !!speech,
          frameCount: idleConversation ? 0 : frames.length || (image ? 1 : 0),
          present: witnesses.length,
          eligible: eligiblePersonas.length,
          eligibleViewers: eligiblePersonas.filter(
            (p) => !p.system && p.id !== this.settings.managerId,
          ).length,
          lurkingEligible: eligiblePersonas.filter(
            (p) => this.audience.presence[p.id] === 'lurking',
          ).length,
          company: idleConversation ? 'idle' : watchingCompany ? 'watching' : null,
          latestFrameAt: idleConversation ? undefined : screenTimeline?.through,
        });
        const responseStartedAt = this.now();
        const result = await this.provider.react(
          {
            aiFeature,
            settings: eligibleSettings,
            history: [],
            previous: null,
            image: idleConversation ? undefined : image,
            frames: idleConversation ? [] : frames,
            screenTimeline: idleConversation ? undefined : screenTimeline,
            speech,
            viewerKnowledge,
            adviceRequested,
            advicePolicy,
            ...personalContext,
            liveSpeech,
            transcriptCandidates,
            ambient,
            voiceCues:
              !idleConversation && this.voiceCues && this.now() - this.voiceCues.at < 30000
                ? this.voiceCues
                : null,
          },
          signal,
        );
        this.ai.assertCurrent(result);
        const previousQueue = new Set(this.queue);
        const accepted = this.acceptLiveReaction({
          context,
          result,
          operation,
          epoch,
          diagnosticId,
          responseStartedAt,
          speech,
          speechBatch,
          viewing,
          screenTimeline,
          idleConversation,
          image,
        });
        for (const message of this.queue)
          if (!previousQueue.has(message)) message.aiFeature = aiFeature;
        if (!accepted) this.ai.accepted(result);
        if (accepted) {
          diagnosticOutcome = accepted.outcome;
          return accepted.result;
        }
      }
      if (viewing) this.viewing.acknowledge(viewing);
      this.speechInbox.acknowledge(speechBatch.ids);
      this.failures = 0;
      this.retryAt = 0;
      return { ok: true };
    } catch (error) {
      if (Number.isFinite(error.aiGenerated))
        this.reactions.generated(diagnosticId, error.aiGenerated);
      if (['ai_blocked', 'ai_cancelled'].includes(error.code)) {
        diagnosticOutcome = 'stopped';
        this.speechInbox.acknowledge(speechBatch.ids);
        return { skipped: 'ai-blocked' };
      }
      if (epoch !== this.epoch) {
        diagnosticOutcome = 'stopped';
        return { skipped: 'stopped' };
      }
      diagnosticOutcome = operation.superseded
        ? 'superseded'
        : epoch !== this.epoch
          ? 'stopped'
          : 'error';
      if (operation.superseded && epoch === this.epoch) return { skipped: 'superseded' };
      if (epoch === this.epoch) {
        this.failures++;
        this.retryAt = this.now() + Math.min(60000, 3000 * 2 ** this.failures);
        this.lastError = error.message;
        this.log(error.message);
      }
      throw error;
    } finally {
      this.reactions.finish(diagnosticId, diagnosticOutcome);
      if (this.liveReaction === operation) this.liveReaction = null;
      if (epoch === this.epoch) {
        this.busy = false;
        this.publish();
      }
    }
  }
  prepareReactionViewing({ image, video, speech }) {
    let viewing,
      frames = [],
      screenTimeline,
      idleConversation,
      watchingCompany;
    if (this.settings.mode === 'live') {
      this.tickAudience();
      if (this.autonomy?.waiting) return { skipped: 'audience-arrival' };
      const witnesses = this.presentWitnesses();
      const temporal = temporalVideo(video, {
        now: this.now(),
        sessionId: this.sessionId,
        startedAt: this.startedAt,
        joinedAt: witnesses.map((id) => this.audience.data.members[id].joinedAt),
        previous: this.viewing.last?.video,
      });
      if (temporal?.ignored) return { skipped: temporal.ignored };
      if (temporal) {
        frames = temporal.frames;
        screenTimeline = temporal.timeline;
        image = frames.at(-1)?.image;
      }
      const soundIds = this.sound.events
        .filter(
          (e) =>
            !e.silent &&
            this.now() - e.endedAt < 30000 &&
            e.witnesses.some((id) => witnesses.includes(id)),
        )
        .map((e) => e.id);
      // A fresh, witnessed address to another viewer is conversation input even
      // on a paused game. Ordinary cheers do not continually wake themselves.
      const peerIds = this.messages
        .filter(
          (m) =>
            !m.chatDriven &&
            !m.fictional &&
            m.time <= this.now() &&
            this.now() - m.time < 60000 &&
            (m.kind === 'donation'
              ? witnesses.some((id) => m.time >= this.audience.data.members[id].joinedAt)
              : m.kind === 'chat' &&
                witnesses.includes(m.personaId) &&
                this.settings.personas.some(
                  (p) =>
                    p.id !== m.personaId &&
                    witnesses.includes(p.id) &&
                    m.time >= this.audience.data.members[p.id].joinedAt &&
                    m.text.includes(p.name),
                )),
        )
        .slice(-40)
        .map((m) => m.id);
      for (const id of new Set(
        witnesses.flatMap(
          (id) =>
            this.externalChat?.context(this.audience.data.members[id].joinedAt).map((m) => m.id) ||
            [],
        ),
      ))
        peerIds.push(id);
      viewing = this.viewing.observe({
        image,
        frames,
        screenTimeline,
        people: witnesses.map((id) => ({ id, joinedAt: this.audience.data.members[id].joinedAt })),
        soundIds,
        peerIds,
        scope: this.settings.category + ':' + this.settings.gameId,
        at: this.now(),
      });
      if (!image) this.knowledge.lastSeen = null;
      const ambient = this.autonomy ? this.ambient.snapshot() : null;
      if (!speech.trim() && !ambient?.active) {
        // Animated menus and repeated music change samples without necessarily
        // changing the conversation. Offer company without dropping fresh input.
        if (this.viewing.unchanged(viewing)) idleConversation = this.ambient.idle(witnesses);
        else watchingCompany = this.ambient.idle(witnesses, { observing: true });
      }
      if (
        !speech.trim() &&
        !ambient?.active &&
        !idleConversation &&
        this.viewing.unchanged(viewing)
      ) {
        // Identical current pixels still count as watching. Do not resurrect a
        // forgotten record or infer viewing while the image is disconnected.
        try {
          if (
            image &&
            this.knowledge.lastSeen &&
            this.observation?.confidence >= 0.7 &&
            this.settings.category === 'gaming'
          ) {
            const game = this.settings.games.find((g) => g.id === this.settings.gameId);
            this.knowledge.observe(
              this.settings.gameId === 'auto' ? this.observation.game : game.name,
              this.observation.scene,
              viewing.at,
              game.popularity,
              witnesses,
            );
            this.publish();
          }
        } catch (error) {
          this.failures++;
          this.retryAt = this.now() + Math.min(60000, 3000 * 2 ** this.failures);
          this.lastError = error.message;
          this.log(error.message);
          this.publish();
          throw error;
        }
        this.failures = 0;
        this.retryAt = 0;
        if (this.lastError) {
          this.lastError = '';
          this.publish();
        }
        this.viewing.acknowledge(viewing);
        return { skipped: 'unchanged-input' };
      }
    }
    return { image, viewing, frames, screenTimeline, idleConversation, watchingCompany };
  }

  reactRehearsal(speech) {
    const lines = speech
      ? [
          '말 들었어요! 오늘은 어떤 플레이 보여줄 건가요?',
          'ㅋㅋㅋ 채팅이랑 얘기하면서 하니까 방송 같네',
          '저도 같이 볼게요 🍿',
        ]
      : [
          '오늘 방송 출석! 다들 어서 와요 👋',
          '팝콘 준비 완료 🍿',
          '오늘은 무슨 게임 하나요?',
          '방장 오늘 텐션 좋은데 ㅋㅋ',
          '이런 편한 분위기 좋다',
          '다들 채팅 규칙 한 번씩 확인해주세요',
        ];
    const active = this.settings.personas.filter((p) => p.enabled && !p.system);
    const offset = Math.floor(this.random() * lines.length);
    if (!active.length) {
      this.addMessage(
        this.settings.managerId,
        '지금은 리허설입니다. 관객이 아직 없어요. 화면 배치와 채팅 입력을 먼저 살펴보세요.',
        'notice',
      );
      return { ok: true, rehearsal: true };
    }
    this.accept(
      {
        game: '리허설',
        scene: '첫 인사를 나누며 방송을 준비하고 있어요.',
        confidence: 0,
        excitement: 0.35,
        messages: active.slice(0, this.settings.chatPace).map((p, i) => ({
          personaId: p.id,
          text: lines[(offset + i) % lines.length],
          kind: 'chat',
          spoiler: false,
        })),
      },
      this.now(),
      false,
      'live',
    );
  }

  prepareLiveReaction({
    speech,
    speechBatch,
    speechHearers,
    viewing,
    screenTimeline,
    idleConversation,
    watchingCompany,
    operation,
  }) {
    const game = this.settings.games.find((g) => g.id === this.settings.gameId);
    const name = game.id === 'auto' ? this.observation?.game || '알 수 없음' : game.name;
    const adviceRequested = requestsAdvice(speech, this.settings.adviceMode);
    const ambient = idleConversation || watchingCompany || this.ambient.context(speech);
    // A quiet watcher must be able to notice this turn's result before its
    // excitement has been inferred. Eligibility is not a forced chat.
    const reactive = !ambient?.quiet && (!!speech.trim() || !this.viewing.unchanged(viewing));
    const audience = this.audience.context(
      this.settings,
      speech,
      this.observation?.excitement || 0,
      { hearers: speechHearers, company: ambient?.id === 'quiet-company', reactive },
    );
    operation.loreIds = new Set(audience.lore.map((item) => item.id));
    const eligiblePersonas = this.settings.personas.filter((p) => audience.eligible.includes(p.id));
    const eligibleSettings = { ...this.settings, personas: eligiblePersonas };
    const witnesses = this.presentWitnesses().filter(
        (id) => !speechHearers || speechHearers.includes(id),
      ),
      capturedAt = this.lastRequest;
    const visits = new Map(
      eligiblePersonas.map((p) => [p.id, this.audience.data.members[p.id]?.joinedAt]),
    );
    const personalContext = liveViewerContext(
      audience,
      eligiblePersonas,
      this.messages,
      screenTimeline?.sourceChanged ? null : this.observation,
      {
        journal: this.journal,
        clips: this.clips,
        speech,
        sound: this.sound,
        now: capturedAt,
        viewing,
        externalChat: this.externalChat,
      },
    );
    operation.externalIds = [
      ...new Set(
        Object.values(personalContext.viewerContext).flatMap((p) =>
          (p.externalChat || []).map((m) => m.id),
        ),
      ),
    ];
    const transcriptCandidates = this.settings.contextualTranscription
      ? this.speechInbox.candidates(speechBatch.ids)
      : [];
    const viewerKnowledge =
      this.settings.category === 'just-chatting'
        ? null
        : viewerKnowledgeByPersona(this.knowledge.get(name, game.popularity), eligiblePersonas, {
            popularity: game.popularity,
          });
    const liveSpeech = witnessedSpeech(this.speechInbox.sources(speechBatch.ids), {
      sessionId: this.sessionId,
      now: this.now(),
      joinedAt: eligiblePersonas.map((p) => this.audience.data.members[p.id]?.joinedAt),
      endedSources: this.endedVideoSources,
    });
    operation.speechSourceIds = new Set(
      liveSpeech.map((s) => s.capture?.screen?.sourceId).filter(Boolean),
    );
    const adviceRequestId =
      speechBatch.ids.at(-1) ||
      (speech
        ? this.messages.findLast((m) => m.kind === 'streamer' && m.text === speech)?.id
        : undefined);
    let advicePolicy = liveAdvicePolicy(speech, this.settings.adviceMode, this.messages);
    if (advicePolicy?.maxMessages === 1 && this.admittedAdvice(adviceRequestId) > 0)
      advicePolicy = { allowed: false, scope: 'response-reserved', maxMessages: 0 };
    return {
      game,
      audience,
      eligiblePersonas,
      eligibleSettings,
      witnesses,
      capturedAt,
      visits,
      personalContext,
      transcriptCandidates,
      viewerKnowledge,
      liveSpeech,
      adviceRequested,
      advicePolicy,
      adviceRequestId,
      ambient,
    };
  }

  acceptLiveReaction({
    context,
    result,
    operation,
    epoch,
    diagnosticId,
    responseStartedAt,
    speech,
    speechBatch,
    viewing,
    screenTimeline,
    idleConversation,
    image,
  }) {
    const {
      capturedAt,
      visits,
      audience,
      advicePolicy,
      transcriptCandidates,
      adviceRequestId,
      witnesses,
      personalContext,
      game,
    } = context;
    this.reactions.generated(diagnosticId, result.observation.messages.length);
    if (epoch !== this.epoch || !this.running) {
      return { outcome: 'stopped', result: { skipped: 'stopped' } };
    }
    this.tokens += Number(result.usage?.total_tokens) || 0;
    if (operation.superseded) {
      return { outcome: 'superseded', result: { skipped: 'superseded' } };
    }
    const visualExpiresAt = screenTimeline
      ? screenTimeline.through + VIDEO_REACTION_TTL_MS
      : capturedAt + SCREEN_REACTION_TTL_MS;
    if (
      screenTimeline &&
      !idleConversation &&
      !operation.hasSpeech &&
      this.now() >= visualExpiresAt
    ) {
      this.reactions.reject(diagnosticId, 'expired', result.observation.messages.length);
      this.viewing.acknowledge(viewing);
      this.observation = null;
      this.knowledge.lastSeen = null;
      return { outcome: 'stale-screen', result: { skipped: 'stale-screen' } };
    }
    const observation = retainPresentReactions(result.observation, visits, this.audience);
    const eligibleMessages = observation.messages.filter((m) =>
      audience.eligible.includes(m.personaId),
    );
    this.reactions.reject(
      diagnosticId,
      'absent',
      result.observation.messages.length - eligibleMessages.length,
    );
    if (idleConversation) {
      // A chat opportunity is not a fresh visual observation, achievement,
      // donation trigger, clip pick or evidence of changed preferences.
      this.reactions.reject(diagnosticId, 'pace', Math.max(0, eligibleMessages.length - 1));
      this.accept(
        { ...observation, messages: eligibleMessages.slice(0, 1) },
        capturedAt,
        true,
        'live',
        {
          diagnosticId,
          responseStartedAt,
          externalIds: operation.externalIds,
          loreIds: [...operation.loreIds],
          chatDriven: true,
          visits,
          advicePolicy,
          expiresAt: capturedAt + SCREEN_REACTION_TTL_MS,
        },
      );
      this.viewing.acknowledge(viewing);
      this.failures = 0;
      this.retryAt = 0;
      return { outcome: 'accepted', result: { ok: true } };
    }
    const correction = this.correctTranscripts(
      result.observation.transcriptCorrections,
      transcriptCandidates,
    );
    if (correction.rejected) {
      this.log('음성 교정의 의미가 불확실해 이 반응을 보류했습니다.');
      this.speechInbox.acknowledge(speechBatch.ids);
      return {
        outcome: 'transcription-review',
        result: { ok: true, transcriptionNeedsReview: true },
      };
    }
    const chatDriven = !speech.trim() && this.viewing.sameExternalInput(viewing);
    this.accept({ ...observation, messages: eligibleMessages }, capturedAt, false, 'live', {
      diagnosticId,
      responseStartedAt,
      externalIds: operation.externalIds,
      loreIds: [...operation.loreIds],
      chatDriven,
      visits,
      advicePolicy,
      adviceRequestId,
      screenSourceId: screenTimeline?.sourceId,
      ...(operation.hasSpeech ? {} : { expiresAt: visualExpiresAt }),
    });
    this.recordReactionExperience({
      observation,
      result,
      speech,
      speechBatch,
      chatDriven,
      image,
      witnesses,
      capturedAt,
      personalContext,
      game,
    });
  }
  recordReactionExperience({
    observation,
    result,
    speech,
    speechBatch,
    chatDriven,
    image,
    witnesses,
    capturedAt,
    personalContext,
    game,
  }) {
    const donations = this.economy.reward({
      observation,
      settings: this.settings,
      audience: this.audience,
      hasInput: !chatDriven && (!!image || !!speech),
      paid: false,
    });
    for (const d of donations) this.publishMessage(donationMessage(d));
    if (this.autonomy) {
      const clipSpeech = this.speechInbox.sources(speechBatch.ids);
      try {
        this.autonomy.evolve(observation.viewerChanges, speech, witnesses);
        this.clipFeatures.spectatorPicks(observation, {
          image,
          speech: speechBatch.ids.length ? clipSpeech.map((e) => e.text).join('\n') : speech,
          witnesses,
          capturedAt,
          liveSpeech: clipSpeech,
          heardByViewer: Object.fromEntries(
            Object.entries(personalContext.viewerContext).map(([id, p]) => [id, p.heardSounds]),
          ),
        });
      } catch (error) {
        this.log(`관객 경험 저장 보류: ${error.message}`);
      }
    }
    if (
      !this.autonomy &&
      this.settings.autoHighlights &&
      observation.positiveMoment?.positive &&
      observation.positiveMoment.impact >= 0.8 &&
      observation.confidence >= 0.75 &&
      observation.excitement >= 0.8
    ) {
      try {
        this.clips.create({
          game: result.observation.game,
          scene: result.observation.scene,
          title: result.observation.positiveMoment.reason,
          participants: this.settings.personas
            .filter((p) => ['active', 'lurking'].includes(this.audience.presence[p.id]))
            .map((p) => ({ id: p.id, name: p.name })),
          messages: this.messages,
          image,
          sessionId: this.sessionId,
          source: 'automatic-moment',
          startedAt: this.startedAt,
          signature: result.observation.positiveMoment.signature,
          observedAt: this.lastRequest,
        });
        this.publish();
      } catch (error) {
        this.log(`자동 핫클립 저장 보류: ${error.message}`);
      }
    }
    if (
      this.settings.category !== 'just-chatting' &&
      image &&
      result.observation.confidence >= 0.7
    ) {
      this.knowledge.observe(
        game.id === 'auto' ? result.observation.game : game.name,
        result.observation.scene,
        capturedAt,
        game.popularity,
        witnesses,
      );
      this.publish();
    }
  }
  async transcribe(buffer, mime, requestSignal) {
    if (!this.running || this.settings.mode !== 'live')
      throw new Error('음성 인식은 실제 AI 방송에서 사용할 수 있습니다.');
    if (this.audioBusy) throw new Error('이전 음성을 인식하고 있습니다.');
    if (!this.provider.localSpeech) this.reserveCall();
    this.audioBusy = true;
    const epoch = this.epoch;
    this.publish();
    const signal = requestSignal
      ? AbortSignal.any([this.controller.signal, requestSignal])
      : this.controller.signal;
    try {
      const result = await this.provider.transcribe(buffer, mime, signal);
      if (epoch !== this.epoch || !this.running || signal.aborted) return { text: '' };
      const value = typeof result === 'string' ? { text: result } : result;
      if (value.cues) this.voiceCues = { ...value.cues, at: this.now() };
      return value;
    } finally {
      if (epoch === this.epoch) {
        this.audioBusy = false;
        this.publish();
      }
    }
  }
  async reflect() {
    if (this.running || this.busy) throw new Error('방송 종료 후에 후일담을 만들 수 있습니다.');
    if (!this.messages.length || this.settings.mode !== 'live')
      throw new Error('실제 방송에서 나눈 대화가 먼저 필요합니다.');
    const participants = this.settings.personas.filter(
      (p) => p.enabled && this.audience.data.members[p.id]?.joinedAt >= this.startedAt,
    );
    if (!participants.length) throw new Error('함께 방송을 본 관객이 없습니다.');
    this.reserveCall();
    this.busy = true;
    const epoch = this.epoch;
    const controller = new AbortController();
    this.controller = controller;
    this.publish();
    try {
      const result = await this.provider.react(
        {
          settings: { ...this.settings, personas: participants },
          history: this.messages,
          previous: this.observation,
          aiFeature: 'summary',
          speech: '방송을 함께 본 관객들의 짧은 후기를 작성해주세요.',
          audience: this.audience.data,
          offStream: true,
        },
        controller.signal,
      );
      if (epoch !== this.epoch || this.running) return { skipped: 'stopped' };
      this.tokens += Number(result.usage?.total_tokens) || 0;
      for (const m of result.observation.messages) {
        const p = participants.find((p) => p.id === m.personaId);
        if (
          !p ||
          (m.spoiler && this.settings.spoilerGuard) ||
          this.settings.blockedWords.some((w) => m.text.includes(w))
        )
          continue;
        this.audience.post({
          id: randomUUID(),
          name: p.name,
          personaId: p.id,
          text: m.text,
          time: this.now(),
          kind: 'ai',
        });
      }
      this.ai.accepted(result);
      this.log('방송 후 관객 후기 생성');
      return { ok: true };
    } finally {
      if (epoch === this.epoch) {
        this.busy = false;
        this.publish();
      }
    }
  }
}
