import {
  ownProfileWriter,
  inspectWorldFormat,
  markWorldFormat,
  backupWorldV1,
} from './profile-writer.js';
import {
  readProfileFormat,
  requiredProfileFormat,
  mergeProfileFormat,
} from './profile-capabilities.js';
import { socialRoutes } from './social-runtime.js';
import { Tutorial, TutorialData, initialTutorial, tutorialRoutes } from './tutorial.js';
import { SpeechCapture } from './speech-screen.js';
import { DebugConfig, initialDebug, withDebugPrompt, debugRoutes } from './debug-mode.js';
import express from 'express';
import { decodeFrameWire } from './frame-wire.js';
import { FRAME_WIRE_TYPE, FRAME_JSON_LIMIT } from '../shared/frame-wire.js';
import { createServer } from 'node:http';
import { listenBrowserLoopback, validateBrowserListenPort } from './browser-loopback.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenAIProvider } from './provider.js';
import { ProviderChoice, ProviderSelection, hostedModelEnv } from './provider-choice.js';
import { OllamaProvider } from './ollama-provider.js';
import { ConfiguredApiProvider } from './configured-api-provider.js';
import { CodexProvider } from './codex-provider.js';
import { Knowledge } from './knowledge.js';
import { LocalSound } from './local-sound.js';
import { soundRoutes } from './sound-routes.js';
import { LocalSpeech } from './local-speech.js';
import { SpeechRecoveryStore } from './speech-recovery-store.js';
import { MicrophoneConfig, defaultMicrophoneConfig } from '../shared/microphone-config.js';
import { SpeechRetentionConfig, defaultSpeechRetention } from '../shared/speech-retention.js';
import { Audience } from './audience.js';
import { Economy } from './economy.js';
import { Clips } from './clips.js';
import { ClipPerception } from './clip-perception.js';
import { ClipInspector } from './clip-inspector.js';
import { clipRecordingRoutes } from './clip-recording-routes.js';
import { randomUUID } from 'node:crypto';
import { Studio } from './studio.js';
import { BroadcastTrace } from './broadcast-trace.js';
import { AiControl, AiControlData, emptyAiControl } from './ai-control.js';
import { NativeAudio, NativeAudioConfig } from './native-audio.js';
import { throwAudioFailures } from './audio-lifetime.js';
import { nativeAudioRoutes } from './native-audio-routes.js';
import { SubscriptionSound, subscriptionSoundRoutes } from './subscription-sound.js';
import {
  CultureLearningData,
  emptyCultureLearning,
  withCultureContext,
} from './culture/learning.js';
import { Settings, Frame } from './schema.js';
import { z } from 'zod';
import { defaults } from '../shared/defaults.js';
import { JsonStore } from './storage.js';
import {
  KnowledgeData,
  AudienceData,
  EconomyData,
  ClipsData,
  EpisodesData,
} from './data-schema.js';
import { createLocalAccess, connectPage, connectScript } from './local-access.js';
import { existsSync } from 'node:fs';
import { OnboardingData, initialOnboarding, finishOnboarding } from './onboarding.js';
import { ConnectionProbe } from './connection-probe.js';
import { SeasonsData, emptySeasons } from './seasons-schema.js';
import { ConversationJournal, emptyJournal } from './conversation-journal.js';
import { JournalStore } from './journal-store.js';
import { World, WorldData, migrateWorld } from './world.js';
import { RequestLifetime, ownProviderRequests } from './request-lifetime.js';
import { StateFeed } from './state-stream.js';
import { ObsInput } from './obs-input.js';
import { externalChatRoutes } from './external-chat-session.js';
import { RuntimeComponents } from './runtime-components.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function startServer(options = {}) {
  validateBrowserListenPort(
    options.port === undefined ? Number(process.env.PORT) || 4318 : options.port,
  );
  const release =
    options.persist === false
      ? () => {}
      : ownProfileWriter(options.dataDir || resolve(root, 'data'));
  const cleanups = [];
  try {
    const service = await startServerImpl(options, (cleanup) => cleanups.push(cleanup));
    const close = service.close;
    let closing;
    service.close = () => {
      if (closing) return closing;
      let complete, fail;
      closing = new Promise((done, reject) => {
        complete = done;
        fail = reject;
      });
      (async () => {
        const errors = [];
        try {
          await close();
        } catch (error) {
          errors.push(error);
        }
        try {
          release();
        } catch (error) {
          errors.push(error);
        }
        // Keep the server's existing AggregateError boundary when release
        // succeeds; a second release error must not replace that original.
        if (errors.length === 1) throw errors[0];
        if (errors.length) throw new AggregateError(errors, '앱 종료 정리를 완료하지 못했습니다.');
      })().then(complete, fail);
      return closing;
    };
    return service;
  } catch (error) {
    await Promise.allSettled(cleanups.map((cleanup) => Promise.resolve().then(cleanup)));
    release();
    throw error;
  }
}
async function startServerImpl(
  {
    port = Number(process.env.PORT) || 4318,
    dataDir = resolve(root, 'data'),
    provider,
    persist = true,
    localSpeech = true,
    speechWorker,
    soundWorker,
    browserConnect = false,
    developmentOrigin,
    runtime = {},
    obsClientFactory,
    youtubeFactory,
    chzzkFactory,
    authFactory,
    openExternalAuth,
    providerFactories,
    providerSwitchAllowed = () => true,
    nativeAudioProviderFactory,
  } = {},
  onResource = () => {},
) {
  const access = createLocalAccess({ browserConnect });
  let expectedHost;
  const stores = [];
  const worldFormat = persist ? inspectWorldFormat(dataDir) : { protected: false, migrate: false };
  let profileFormat = persist ? readProfileFormat(dataDir) : null;
  const namedStores = new Map();
  const protectExpandedReaders = (required) => {
    if (!required) return;
    const next = mergeProfileFormat(profileFormat, required);
    if (JSON.stringify(next) === JSON.stringify(profileFormat)) return;
    // Reader 3 protects both files from fallback. Materialize an absent, validated
    // clip store before raising the marker, so a gallery-only profile can restart.
    const clip = namedStores.get('clips');
    if (!existsSync(clip.store.file)) clip.store.save(clip.data);
    profileFormat = markWorldFormat(dataDir, required);
    for (const name of ['world', 'clips']) namedStores.get(name).store.forbidRecovery = true;
  };
  const useStore = (name, schema, initial) => {
    if (!persist) return { data: initial(), save: () => {} };
    const store = new JsonStore(resolve(dataDir, name + '.json'), {
      validate: (value) => schema.parse(value),
      initial,
      backupCount: 3,
      skipUnchanged: name === 'world',
      forbidRecovery:
        (name === 'world' && worldFormat.protected) ||
        (name === 'clips' && profileFormat?.minReader >= 3),
    });
    const data = store.load();
    stores.push(store);
    namedStores.set(name, { store, data });
    return {
      data,
      save: (value) => {
        if (name === 'world' || name === 'clips') {
          const validated = schema.parse(value);
          protectExpandedReaders(requiredProfileFormat(name, validated));
          return store.save(validated);
        }
        return store.save(value);
      },
    };
  };
  let providerChoice;
  if (!provider) {
    const selectionStore = useStore('provider-choice', ProviderSelection.nullable(), () => null);
    const initial =
      selectionStore.data ||
      (process.env.AI_PROVIDER === 'ollama'
        ? {
            kind: 'ollama',
            model: process.env.OLLAMA_MODEL || 'unconfigured',
            base: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
            contextSize: Number(process.env.OLLAMA_CONTEXT_SIZE || 65536),
          }
        : { kind: process.env.AI_PROVIDER === 'openai' ? 'openai' : 'codex' });
    providerChoice = new ProviderChoice({
      initial,
      save: selectionStore.save,
      factories: providerFactories || {
        codex: (config) =>
          new CodexProvider({
            ...process.env,
            ...hostedModelEnv(config),
            ...(runtime.codexBin ? { CODEX_BIN: runtime.codexBin } : {}),
          }),
        openai: (config) => new OpenAIProvider({ ...process.env, ...hostedModelEnv(config) }),
        configuredApi: (config) => new ConfiguredApiProvider(config),
        ollama: (config) =>
          new OllamaProvider({
            OLLAMA_MODEL: config.model,
            OLLAMA_BASE_URL: config.base,
            OLLAMA_CONTEXT_SIZE: config.contextSize,
            ...(config.think !== undefined ? { OLLAMA_THINK: String(config.think) } : {}),
          }),
      },
    });
    provider = providerChoice.proxy;
  }
  if (provider.check) await provider.check();
  const speech = speechWorker || new LocalSpeech(runtime.speech);
  const sound = soundWorker || new LocalSound(runtime.sound);
  onResource(() => speech.close?.());
  onResource(() => sound.close?.());
  const clipInspector = new ClipInspector(runtime.clips);
  const runtimeComponents = runtime.components ? new RuntimeComponents(runtime.components) : null;
  if (runtimeComponents) {
    onResource(() => runtimeComponents.close());
    runtime.speech.prepare = (signal, device) =>
      runtimeComponents.prepare('microphone', signal, device);
    runtime.sound.prepare = (signal) => runtimeComponents.prepare('sound', signal);
    runtime.clipPerception.prepare = (signal) => runtimeComponents.prepare('perception', signal);
  }
  const providerStatus = provider.status.bind(provider);
  provider.status = () => ({
    ...providerStatus(),
    localAudio: speech.ready,
    localAudioModel: speech.model,
    localAudioDevice: speech.device,
    audioFallback: speech.fallback,
    audioError: speech.error,
    audioPreparing: !!speech.child && !speech.ready && !speech.error,
  });
  if (localSpeech) {
    provider.localSpeech = true;
    provider.transcribe = (buffer, _mime, signal) => speech.transcribe(buffer, signal);
  }
  let debug;
  const requests = new RequestLifetime();
  onResource(() => requests.close());
  provider = ownProviderRequests(
    withDebugPrompt(provider, () => debug?.read()),
    requests,
  );
  let closing;
  const hasWorld =
    persist &&
    ['world.json', 'world.json.bak.1', 'world.json.bak.2', 'world.json.bak.3'].some((n) =>
      existsSync(resolve(dataDir, n)),
    );
  const hasPreviousSettings =
    hasWorld ||
    (persist &&
      ['settings.json', 'settings.json.bak.1', 'settings.json.bak.2', 'settings.json.bak.3'].some(
        (n) => existsSync(resolve(dataDir, n)),
      ));
  const settingsStore = hasWorld
    ? null
    : useStore('settings', Settings, () => structuredClone(defaults));
  const onboardingStore = useStore('onboarding', OnboardingData, () =>
    initialOnboarding(hasPreviousSettings),
  );
  const tutorialStore = useStore('tutorial', TutorialData, () =>
    initialTutorial(onboardingStore.data.status !== 'new'),
  );
  const debugStore = useStore('debug', DebugConfig, initialDebug);
  const knowledgeStore = useStore('knowledge', KnowledgeData, () => ({}));
  const audienceStore = hasWorld
    ? null
    : useStore('audience', AudienceData, () => new Audience().data);
  const economyStore = hasWorld ? null : useStore('economy', EconomyData, () => new Economy().data);
  const worldStore = useStore('world', WorldData, () =>
    migrateWorld(settingsStore.data, audienceStore.data, economyStore.data, {
      fresh: !hasPreviousSettings,
    }),
  );
  const cultureStore = useStore('culture-learning', CultureLearningData, emptyCultureLearning);
  const aiStore = useStore('ai-control', AiControlData, () => {
    const value = emptyAiControl();
    value.policy.background = true;
    value.policy.features.culture = false;
    return value;
  });
  const clipsStore = useStore('clips', ClipsData, () => []);
  const microphoneStore = useStore('microphone', MicrophoneConfig, defaultMicrophoneConfig);
  const speechRetentionStore = useStore(
    'speech-retention',
    SpeechRetentionConfig,
    defaultSpeechRetention,
  );
  const episodesStore = useStore('episodes', EpisodesData, () => []);
  const seasonsStore = useStore('seasons', SeasonsData, emptySeasons);
  const nativeAudioStore = useStore('native-audio', NativeAudioConfig, () => ({
    mode: persist && !hasPreviousSettings ? 'remote' : 'local',
    transport: 'subscription',
    consent: false,
  }));
  const journalStorage = persist ? new JournalStore(dataDir) : null;
  const journalStore = {
    data: journalStorage?.load() || emptyJournal(),
    save: (value) => {
      if (!journalStorage) return;
      protectExpandedReaders(requiredProfileFormat('journal', value));
      journalStorage.save(value);
    },
  };
  if (journalStorage) stores.push(journalStorage);
  // Validate every existing store before writing anything. Then record the
  // first-run identity so a partial completion cannot become a legacy profile.
  if (persist && !existsSync(resolve(dataDir, 'onboarding.json')))
    onboardingStore.save(onboardingStore.data);
  if (persist) {
    backupWorldV1(dataDir);
    // A world with reader-4 source metadata can also contain a long journal.
    // Inspect every validated representation, including journals already saved
    // by builds that assigned both capabilities the same reader number.
    for (const [name, data] of [
      ['world', worldStore.data],
      ['clips', clipsStore.data],
      ['journal', journalStore.data],
    ])
      protectExpandedReaders(requiredProfileFormat(name, data));
    profileFormat = markWorldFormat(dataDir);
  }
  if (!hasWorld || worldFormat.migrate) worldStore.save(worldStore.data);
  const world = new World(worldStore.data, worldStore.save);
  const speechRecovery = persist
    ? new SpeechRecoveryStore(resolve(dataDir, 'speech-recovery'), {
        policy: () => speechRetentionStore.data,
        isActive: (sessionId) => studio.running && studio.sessionId === sessionId,
      })
    : null;
  if (
    stores.some(
      (store) =>
        store.recoveredFrom && (store === journalStorage || store.file?.endsWith('clips.json')),
    )
  )
    world.change((d) => {
      d.socialWorld.quarantined = true;
    });
  world.recover();
  const knowledge = new Knowledge(knowledgeStore.data, knowledgeStore.save);
  const audience = new Audience(world.data.audience, (value) => world.part('audience', value));
  const journal = new ConversationJournal(journalStore.data, journalStore.save, {
    legacyAudienceIds: () => {
      const settings = world.snapshot().settings;
      return settings.personas
        .filter((persona) => persona.role === 'viewer' && persona.id !== settings.managerId)
        .map((persona) => persona.id);
    },
  });
  const economy = new Economy(world.data.economy, (value) => world.part('economy', value));
  const clips = new Clips({
    data: clipsStore.data,
    dir: persist ? resolve(dataDir, 'clip-media') : undefined,
    save: clipsStore.save,
  });
  const storageStatus = () => ({
    warnings: stores.flatMap((s) => s.warnings).slice(-6),
    recovered: stores.filter((s) => s.recoveredFrom).map((s) => s.recoveredFrom),
  });
  let studio;
  provider = withCultureContext(provider, () => studio);
  const aiControl = new AiControl(aiStore);
  if (stores.some((s) => s.file?.endsWith('ai-control.json') && s.recoveredFrom))
    aiControl.storageError =
      'AI 사용 기록을 백업에서 복구해 새 호출을 차단했습니다. 사용 기록과 실행 허용 설정을 확인해주세요.';
  studio = new Studio({
    trace: new BroadcastTrace({ dir: persist ? resolve(dataDir, 'broadcast-trace') : undefined }),
    aiControl,
    cultureLearning: { data: cultureStore.data, save: cultureStore.save },
    provider,
    settings: world.data.settings,
    persist: (value) => world.part('settings', value),
    world,
    knowledge,
    audience,
    journal,
    economy,
    clips,
    clipPerception: new ClipPerception(runtime),
    storageStatus,
  });
  studio.trace.lifecycle('service', 'started', undefined, 'startup');
  onResource(() => studio.trace.lifecycle('service', 'failed', undefined, 'startup'));
  const nativeAudio = new NativeAudio({
    studio,
    recovery: speechRecovery,
    config: nativeAudioStore.data,
    save: nativeAudioStore.save,
    dir: persist ? resolve(dataDir, 'native-audio') : undefined,
    key: nativeAudioStore.data.transport === 'subscription' ? '' : process.env.OPENAI_API_KEY || '',
    subscriptionBin: provider.bin || provider.codex?.bin,
    subscriptionEnv: provider.env || provider.codex?.env,
    releaseLocal: () => speech.stopWorker?.(),
    providerFactory: nativeAudioProviderFactory,
  });
  onResource(() => nativeAudio.close());
  const subscriptionSound = new SubscriptionSound({
    studio,
    recovery: speechRecovery,
    dir: persist ? resolve(dataDir, 'native-audio', 'system-subscription') : undefined,
    bin: provider.bin || provider.codex?.bin,
    env: provider.env || provider.codex?.env,
    config: () => nativeAudio.config,
    releaseLocal: () => sound.close?.(),
  });
  onResource(() => subscriptionSound.close());
  const stopSpeechInputs = (reason) =>
    Promise.allSettled([
      Promise.resolve().then(() => nativeAudio.stop(reason)),
      Promise.resolve().then(() => subscriptionSound.stop(reason)),
    ]).then((results) =>
      results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : [])),
    );
  const appendSpeechRaw = (entry) => {
    const owner = subscriptionSound.inputs.has(entry.inputEpoch) ? subscriptionSound : nativeAudio;
    return owner.acceptInput(entry, async () => {
      if (!speechRecovery) throw new Error('로컬 원음 보존을 사용할 수 없습니다.');
      let captureStopErrors = Promise.resolve([]);
      try {
        if (subscriptionSound.inputs.has(entry.inputEpoch)) subscriptionSound.capture(entry);
        else nativeAudio.capture(entry);
      } catch {
        nativeAudio.error =
          '원격 청취 입력을 확인하지 못해 전송을 중단했습니다. 원음 저장은 계속합니다.';
        captureStopErrors = stopSpeechInputs('capture-invalid');
      }
      let result;
      try {
        result = await speechRecovery.append({
          ...entry,
          source: subscriptionSound.inputs.has(entry.inputEpoch) ? 'system-output' : 'microphone',
        });
      } catch (error) {
        nativeAudio.error = error.message;
        const stopped = await Promise.all([captureStopErrors, stopSpeechInputs('storage-error')]);
        const failures = [error, ...stopped.flat()];
        try {
          studio.publish();
        } catch (publishError) {
          failures.push(publishError);
        }
        throwAudioFailures(failures);
      }
      let storedError;
      try {
        if (subscriptionSound.inputs.has(entry.inputEpoch))
          await subscriptionSound.stored(entry, result);
        else await nativeAudio.stored(entry, result);
      } catch (error) {
        storedError = error;
      }
      throwAudioFailures([storedError, ...(await captureStopErrors)]);
      return result;
    });
  };
  onResource(() => studio.close());
  onResource(() => studio.culture.close());
  onResource(() => studio.communityActivity.yield());
  provider = studio.provider;
  const app = express();
  if (providerChoice) providerChoice.onFallback = () => studio.reserveCall();
  const tutorial = new Tutorial(studio, tutorialStore);
  studio.tutorialReady = () => ['completed', 'skipped'].includes(tutorial.store.data.status);
  const probe = new ConnectionProbe(provider, () => studio.publish());
  const obsInput = new ObsInput({
    createClient: obsClientFactory,
    onChange: () => studio.publish(),
    onEnd: (sourceId) => studio.endVideo({ sessionId: studio.sessionId, sourceId }),
  });
  app.disable('x-powered-by');
  app.use((_req, res, next) =>
    requests.controller.signal.aborted
      ? res.status(503).json({ error: '앱을 종료하고 있습니다.' })
      : next(),
  );
  app.use((req, res, next) => {
    const host = req.headers.host || '';
    if (host !== expectedHost)
      return res.status(403).json({ error: '올바른 로컬 앱 연결만 허용됩니다.' });
    const allowed = new Set([`http://${host}`, ...(developmentOrigin ? [developmentOrigin] : [])]);
    if (req.headers.origin && !allowed.has(req.headers.origin))
      return res.status(403).json({ error: '다른 사이트의 요청은 허용하지 않습니다.' });
    if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-backseat-client'] !== 'studio')
      return res.status(403).json({ error: '올바른 앱 요청이 아닙니다.' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'",
    );
    next();
  });
  if (browserConnect) {
    app.get('/connect', (_req, res) => res.type('html').send(connectPage));
    app.get('/connect.js', (_req, res) => res.type('js').send(connectScript));
    app.post('/api/session', express.json({ limit: '1kb' }), (req, res) =>
      access.redeem(req.body?.token, res)
        ? res.json({ ok: true })
        : res.status(401).json({ error: '연결 주소가 만료되었거나 올바르지 않습니다.' }),
    );
  }
  app.use((req, res, next) =>
    access.authenticated(req)
      ? next()
      : res
          .status(401)
          .json({ error: '앱 연결 인증이 필요합니다. Nagneon 창에서 다시 연결하세요.' }),
  );
  // Studio users may read/moderate resident attachments, not upload into
  // another resident's post. Reject before parsing bodies; internal resident
  // generation/storage remains available through SocialRuntime.
  app.post('/api/social/threads/:id/attachments', (_req, res) =>
    res.status(403).json({
      code: 'resident-attachments-only',
      error: '이 게시글에는 스트리머가 파일을 추가할 수 없습니다. 주민의 첨부는 열람할 수 있어요.',
    }),
  );
  app.use(express.json({ limit: '3mb' }));
  app.use((req, res, next) =>
    probe.controller &&
    !['GET', 'HEAD'].includes(req.method) &&
    !['/api/connection/probe/cancel', '/api/stop', '/api/ai/policy'].includes(req.path)
      ? res.status(409).json({ error: '연결 응답 확인을 마친 뒤 다시 시도하세요.' })
      : next(),
  );
  app.use((req, res, next) =>
    providerChoice?.changing &&
    !['GET', 'HEAD'].includes(req.method) &&
    !['/api/stop', '/api/ai/policy'].includes(req.path)
      ? res.status(409).json({ error: 'AI 제공처 변경을 마친 뒤 다시 시도하세요.' })
      : next(),
  );
  socialRoutes(app, studio, persist ? resolve(dataDir, 'social-media') : undefined);
  app.get('/api/state', (_req, res) => res.json(studio.state()));
  app.get('/api/ai', (_req, res) => res.json(studio.ai.snapshot()));
  app.patch('/api/ai/policy', (req, res) => res.json(studio.ai.update(req.body)));
  debug = debugRoutes(app, studio, debugStore, {
    idle: () =>
      !requests.pending.size &&
      !providerChoice?.changing &&
      !probe.controller &&
      providerSwitchAllowed(),
  });
  const external = externalChatRoutes(app, studio, {
    youtubeFactory,
    chzzkFactory,
    authFactory,
    openExternalAuth,
  });
  studio.attachRuntime({
    snapshot: () => ({
      onboarding: { ...onboardingStore.data },
      tutorial: tutorial.snapshot(),
      connectionProbe: probe.status(),
      nativeAudio: nativeAudio.snapshot(),
      microphone: microphoneStore.data,
      subscriptionSound: subscriptionSound.snapshot(),
      ...(providerChoice ? { providerChoice: providerChoice.snapshot() } : {}),
      obsInput: obsInput.snapshot(),
      debug: debug.summary(),
      externalChat: external.snapshot(),
      ...(runtimeComponents ? { runtimeComponents: runtimeComponents.snapshot() } : {}),
    }),
    beforeStop: [
      ['원격 원음', () => nativeAudio.stop('broadcast-stop')],
      ['게임·시스템 소리', () => subscriptionSound.stop('broadcast-stop')],
      ['외부 채팅', () => external.disconnect()],
      ['OBS', () => obsInput.disconnect()],
    ],
    onAiPolicy: (affected) => {
      if (affected.includes('native-audio')) {
        nativeAudio.stop('policy');
        void subscriptionSound.stop('policy');
      }
    },
  });
  nativeAudioRoutes(app, nativeAudio, studio);
  subscriptionSoundRoutes(app, subscriptionSound, studio);
  if (runtimeComponents) runtimeComponents.onChange = () => studio.publish();
  app.post('/api/runtime/prepare', async (req, res) => {
    const { feature } = z
      .object({ feature: z.enum(['microphone', 'sound', 'clips', 'perception']) })
      .strict()
      .parse(req.body);
    if (['microphone', 'sound'].includes(feature) && nativeAudio.config.mode === 'remote')
      return res.json({ ok: true, local: false, nativeAudio: true });
    const controller = new AbortController();
    const disconnect = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on('close', disconnect);
    try {
      await runtimeComponents?.prepare(feature, controller.signal, studio.settings.speechDevice);
      if (!controller.signal.aborted) res.json({ ok: true });
    } finally {
      res.off('close', disconnect);
    }
  });
  app.post('/api/runtime/cancel', (_req, res) => {
    runtimeComponents?.cancel();
    res.json({ ok: true });
  });
  app.post('/api/obs/connect', async (req, res) => {
    const settings = z
      .object({ port: z.number().int().min(1).max(65535), password: z.string().max(1024) })
      .strict()
      .parse(req.body);
    if (res.destroyed) return;
    const pending = obsInput.connect(settings),
      client = obsInput.client;
    const cancel = () => {
      if (!res.writableEnded && obsInput.client === client) obsInput.disconnect();
    };
    res.on('close', cancel);
    try {
      const result = await pending;
      if (!res.destroyed) res.json(result);
    } finally {
      res.off('close', cancel);
    }
  });
  app.post('/api/obs/select', (req, res) =>
    res.json(
      obsInput.select(
        z
          .object({ scene: z.string().min(1).max(240) })
          .strict()
          .parse(req.body).scene,
      ),
    ),
  );
  app.post('/api/obs/frame', async (req, res) =>
    res.json(
      await obsInput.frame(
        z.object({ sourceId: z.string().uuid() }).strict().parse(req.body).sourceId,
      ),
    ),
  );
  app.post('/api/obs/disconnect', (_req, res) => {
    obsInput.disconnect();
    res.json(obsInput.snapshot());
  });
  app.use(async (req, _res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) await studio.communityActivity.yield();
    next();
  });
  app.get('/api/donations', (_req, res) =>
    res.json({ entries: economy.donationHistory(studio.settings.personas) }),
  );
  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const feed = new StateFeed(res, {
      patches: req.query.transport === 'patches',
      currentState: () => studio.state(),
    });
    const send = (state) => feed.send(state);
    send(studio.state());
    studio.on('state', send);
    const display = (value) => feed.display(value);
    studio.on('chat-display', display);
    const timer = setInterval(() => feed.heartbeat(), 15000);
    req.on('close', () => {
      clearInterval(timer);
      feed.close();
      studio.off('state', send);
      studio.off('chat-display', display);
    });
  });
  app.put('/api/settings', (req, res) => {
    studio.configure(req.body);
    res.json(studio.state());
  });
  app.post('/api/audience/arrive', async (req, res) => {
    const { requestId } = z.object({ requestId: z.string().uuid() }).strict().parse(req.body);
    const { source, ...receipt } = await studio.autonomy.requestArrival(requestId);
    res.json(receipt);
  });
  app.put('/api/audience/:id/note', (req, res) =>
    res.json(
      studio.autonomy.note(
        z.string().max(40).parse(req.params.id),
        z
          .object({ text: z.string().max(2000) })
          .strict()
          .parse(req.body).text,
      ),
    ),
  );
  app.delete('/api/audience/:id', (req, res) =>
    res.json(studio.autonomy.remove(z.string().max(40).parse(req.params.id))),
  );
  tutorialRoutes(app, tutorial);
  app.post('/api/onboarding', (req, res) =>
    res.json(finishOnboarding(studio, onboardingStore, req.body)),
  );
  app.post('/api/connection/provider', async (req, res) => {
    if (!providerChoice) throw Error('이 실행 환경에서는 제공처를 변경할 수 없습니다.');
    const config = ProviderSelection.parse(req.body);
    const idle = () => !studio.running && !requests.pending.size && providerSwitchAllowed();
    if (studio.busy || !idle()) throw Error('방송·계정 연결과 모델 요청을 마친 뒤 변경해주세요.');
    const epoch = studio.epoch,
      controller = new AbortController();
    const cancel = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on('close', cancel);
    studio.busy = true;
    try {
      const pending = providerChoice.select(config, {
        signal: AbortSignal.any([controller.signal, requests.controller.signal]),
        canApply: () => idle() && studio.epoch === epoch,
      });
      studio.publish();
      await pending;
      probe.value = { status: 'untested' };
      if (!res.destroyed) res.json(providerChoice.snapshot());
    } finally {
      res.off('close', cancel);
      if (studio.epoch === epoch) studio.busy = false;
      studio.publish();
    }
  });
  app.post('/api/connection', (req, res) => {
    if (studio.running || studio.busy || requests.pending.size || !providerSwitchAllowed())
      throw new Error('방송과 요청을 마친 뒤 연결 설정을 변경하세요.');
    if (provider.status().kind === 'ollama') throw Error('Ollama는 API 키를 사용하지 않습니다.');
    const config = z.object({ apiKey: z.string().trim().min(1).max(500) }).parse(req.body);
    if (providerChoice?.config.kind === 'routing')
      providerChoice.setConnectionKey(providerChoice.active.primary.id, config.apiKey);
    else provider.key = config.apiKey;
    studio.publish();
    res.json(provider.status());
  });
  app.post('/api/connection/routing/key', (req, res) => {
    if (
      studio.running ||
      studio.busy ||
      requests.pending.size ||
      providerChoice?.changing ||
      !providerSwitchAllowed()
    )
      throw Error('방송과 요청을 마친 뒤 연결 설정을 변경하세요.');
    const { id, apiKey } = z
      .object({ id: z.string().max(64), apiKey: z.string().trim().max(500) })
      .strict()
      .parse(req.body);
    if (!providerChoice) throw Error('제공처 설정을 사용할 수 없습니다.');
    providerChoice.setConnectionKey(id, apiKey);
    studio.publish();
    res.json(providerChoice.snapshot());
  });
  app.post('/api/connection/routing/probe', async (req, res) => {
    if (
      studio.running ||
      studio.busy ||
      requests.pending.size ||
      providerChoice?.changing ||
      !providerSwitchAllowed()
    )
      throw Error('방송과 요청을 마친 뒤 연결을 확인하세요.');
    const { id } = z
      .object({ id: z.string().max(64) })
      .strict()
      .parse(req.body);
    if (providerChoice?.config.kind !== 'routing') throw Error('역할별 연결을 먼저 저장하세요.');
    const entry = providerChoice.active.entries.get(id);
    if (!entry) throw Error('연결을 찾지 못했습니다.');
    studio.busy = true;
    studio.publish();
    try {
      const target = studio.ai.wrap(ownProviderRequests(entry.backend, requests), id);
      res.json(await probe.run(target));
    } finally {
      studio.busy = false;
      studio.publish();
    }
  });
  app.post('/api/connection/check', async (_req, res) => {
    if (provider.check) await provider.check();
    studio.publish();
    res.json(provider.status());
  });
  app.post('/api/connection/probe', async (_req, res) => {
    if (studio.running || studio.busy) throw new Error('방송을 종료한 뒤 응답을 확인하세요.');
    studio.busy = true;
    try {
      res.json(await probe.run());
    } finally {
      studio.busy = false;
      studio.publish();
    }
  });
  app.post('/api/connection/probe/cancel', (_req, res) => res.json(probe.cancel()));
  app.post('/api/knowledge', (req, res) => {
    const { name, text } = z
      .object({ name: z.string().trim().min(1).max(120), text: z.string().trim().min(1).max(3000) })
      .parse(req.body);
    knowledge.teach(name, text);
    studio.publish();
    res.json(studio.state());
  });
  app.delete('/api/knowledge', (req, res) => {
    const { name } = z.object({ name: z.string().min(1).max(120) }).parse(req.body);
    knowledge.forget(name);
    studio.publish();
    res.json(studio.state());
  });
  app.post('/api/community/lore', (req, res) => {
    const { text } = z.object({ text: z.string().trim().min(1).max(300) }).parse(req.body);
    const entry = audience.lore(text);
    studio.publish();
    res.json(entry);
  });
  app.delete('/api/community/lore/:id', (req, res) => {
    const id = z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,64}$/)
      .parse(req.params.id);
    if (!audience.forgetLore(id))
      return res.status(404).json({ error: '기억을 찾을 수 없습니다.' });
    if (studio.liveReaction?.loreIds?.has(id)) {
      studio.liveReaction.superseded = true;
      studio.liveReaction.controller.abort();
    }
    studio.queue = studio.queue.filter((m) => !m.loreIds?.includes(id));
    studio.publish();
    res.json({ ok: true });
  });
  app.get('/api/community/posts', (_req, res) => res.json(studio.community.list()));
  app.post('/api/community/post', (req, res) => {
    const body = z
      .object({
        text: z.string().trim().min(1).max(1000),
        title: z.string().trim().min(1).max(100).optional(),
        category: z.enum(['자유', '후기', '질문', '공지']).default('자유'),
      })
      .parse(req.body);
    res.json(studio.community.post({ ...body, title: body.title || body.text.slice(0, 70) }));
  });
  app.get('/api/community/posts/:id', (req, res) => res.json(studio.community.get(req.params.id)));
  app.delete('/api/community/posts/:id', (req, res) => {
    studio.community.remove(req.params.id);
    res.json({ ok: true });
  });
  app.post('/api/community/posts/:id/recommend', (req, res) =>
    res.json(
      studio.community.recommend(
        req.params.id,
        z.object({ recommended: z.boolean() }).parse(req.body).recommended,
      ),
    ),
  );
  app.post('/api/community/posts/:id/comments', (req, res) =>
    res.json(
      studio.community.comment(
        req.params.id,
        z
          .object({
            text: z.string().trim().min(1).max(1000),
            parentId: z.string().uuid().nullable().default(null),
          })
          .parse(req.body),
      ),
    ),
  );
  app.delete('/api/community/posts/:id/comments/:commentId', (req, res) => {
    studio.community.removeComment(req.params.id, req.params.commentId);
    res.json({ ok: true });
  });
  const autonomousCommunityOnly = (_req, res) =>
    res.status(410).json({
      error:
        '관객은 앱이 켜져 있는 동안 스스로 방문하고 댓글과 추천을 결정합니다. 방송 응답이 먼저 진행됩니다.',
    });
  app.post('/api/community/posts/:id/react', autonomousCommunityOnly);
  app.post('/api/community/reflect', autonomousCommunityOnly);
  app.post('/api/start', (_req, res) => {
    if (probe.controller) throw new Error('연결 응답 확인을 마친 뒤 방송을 시작하세요.');
    studio.start();
    res.json(studio.state());
  });
  // Retired story engines: old clients cannot mutate or restart archived stories.
  const retiredStory = (_req, res) =>
    res.status(410).json({
      error:
        '기획 방송 기능은 종료되었습니다. 관객과의 이야기는 방송실 대화로 이어가세요. 예전 기록은 내보내기에 보관되어 있습니다.',
    });
  app.use(['/api/director', '/api/seasons', '/api/training'], (req, res, next) =>
    req.method === 'GET' ? next() : retiredStory(req, res),
  );
  app.get('/api/seasons/:id', (req, res) => {
    const item = seasonsStore.data.seasons.find(
      (s) => s.id === z.string().uuid().parse(req.params.id),
    );
    if (!item) return res.status(404).json({ error: '기록을 찾을 수 없습니다.' });
    res.json(item);
  });
  const viewerClipOnly = (_req, res) =>
    res.status(409).json({ error: '핫클립은 관객이 마음에 든 순간을 직접 골라 만듭니다.' });
  app.post('/api/clips', viewerClipOnly);
  app.get('/api/clips/:id', (req, res) =>
    res.json(clips.get(z.string().uuid().parse(req.params.id))),
  );
  app.delete('/api/clips/:id', (req, res) => {
    clips.remove(z.string().uuid().parse(req.params.id));
    studio.publish();
    res.json({ ok: true });
  });
  app.get('/api/clips/:id/media/:kind', (req, res) => {
    const c = clips.get(z.string().uuid().parse(req.params.id)),
      kind = req.params.kind;
    const ext =
      (kind === 'video' && c.video) || (kind === 'audio' && c.audio)
        ? 'webm'
        : kind === 'voice' && c.voice
          ? 'voice.webm'
          : kind === 'thumbnail'
            ? c.thumbnail
            : null;
    if (!ext) throw new Error('클립 미디어가 없습니다.');
    if (kind === 'audio' || kind === 'voice') res.type('audio/webm');
    res.sendFile(clips.file(c.id, ext));
  });
  clipRecordingRoutes(app, { studio, clips, inspector: clipInspector });
  app.post('/api/clips/:id/comments', (req, res) => {
    const body = z
      .object({
        text: z.string().trim().min(1).max(1000),
        parentId: z.string().uuid().nullable().optional(),
      })
      .parse(req.body);
    const comment = clips.comment(z.string().uuid().parse(req.params.id), {
      ...body,
      name: studio.settings.streamer,
    });
    studio.publish();
    res.json(comment);
  });
  app.delete('/api/clips/:id/comments/:commentId', (req, res) => {
    clips.removeComment(
      z.string().uuid().parse(req.params.id),
      z.string().uuid().parse(req.params.commentId),
    );
    studio.publish();
    res.json({ ok: true });
  });
  app.post('/api/clips/:id/react', autonomousCommunityOnly);
  const requestId = z.string().uuid();
  app.post('/api/special/unlock', (req, res) =>
    res.json(
      studio.special.unlock(
        z
          .object({
            kind: z.enum(['profile', 'relations']),
            personaId: z.string().max(40),
            requestId,
          })
          .parse(req.body),
      ),
    ),
  );
  app.post('/api/special/generate', async (req, res) =>
    res.json(
      await studio.special.generate(
        z
          .discriminatedUnion('kind', [
            z.object({ kind: z.literal('thought'), messageId: z.string().uuid(), requestId }),
            z.object({
              kind: z.literal('interview'),
              personaId: z.string().max(40),
              question: z.string().trim().min(1).max(600),
              requestId,
            }),
            z.object({ kind: z.literal('contract'), quoteId: z.string().uuid(), requestId }),
          ])
          .parse(req.body),
      ),
    ),
  );
  app.post('/api/special/quote', (req, res) =>
    res.json(
      studio.special.quote(
        z
          .object({
            targets: z.array(z.string().max(40)).min(1).max(8),
            kind: z.enum(['cheer', 'debate', 'roleplay', 'custom']),
            text: z.string().trim().min(1).max(600),
          })
          .parse(req.body),
      ),
    ),
  );
  app.post('/api/special/bid', (req, res) => {
    const { id, amount } = z
      .object({ id: z.string().uuid(), amount: z.number().int().min(1).max(10000) })
      .parse(req.body);
    studio.special.bid({ id, amount });
    res.json({ ok: true });
  });
  app.post('/api/special/cancel', (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.body);
    economy.cancel(id);
    studio.publish();
    res.json({ ok: true });
  });
  app.post('/api/stop', (_req, res) => {
    if (probe.controller) probe.cancel();
    else studio.stop();
    res.json(studio.state());
  });
  app.post('/api/speech', (req, res) =>
    res.json(
      studio.receiveSpeech(
        z
          .object({
            id: z.string().uuid(),
            sessionId: z.string().uuid(),
            text: z.string().trim().min(1).max(3000),
            source: z.enum(['keyboard', 'microphone']).default('keyboard'),
            capture: SpeechCapture.optional(),
          })
          .strict()
          .parse(req.body),
      ),
    ),
  );
  app.post('/api/chat/display', (req, res) =>
    res.json(
      studio.setChatDisplay(
        z.object({ showStreamerMessages: z.boolean() }).strict().parse(req.body)
          .showStreamerMessages,
      ),
    ),
  );
  app.get('/api/chat/history', (req, res) => {
    const query = z
      .object({
        sessionId: z.string().uuid(),
        revision: z.coerce.number().int().min(0),
        before: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(100),
      })
      .strict()
      .parse(req.query);
    res.set('Cache-Control', 'no-store').json(studio.chatHistory.page(query));
  });
  app.post(
    '/api/react',
    express.raw({ type: FRAME_WIRE_TYPE, limit: FRAME_JSON_LIMIT }),
    async (req, res) => {
      const input = Frame.parse(req.is(FRAME_WIRE_TYPE) ? decodeFrameWire(req.body) : req.body);
      if (input.obsSourceId) {
        const sessionId = studio.sessionId;
        if (!studio.running || studio.settings.mode !== 'live')
          throw Error('실제 AI 방송을 시작한 뒤 OBS 화면을 전달할 수 있습니다.');
        const frame = await obsInput.frame(input.obsSourceId);
        if (sessionId !== studio.sessionId || !studio.running)
          throw Error('OBS 화면을 받은 방송이 끝났습니다.');
        input.video = {
          sessionId,
          sourceId: frame.sourceId,
          frames: [{ image: frame.image, at: frame.at }],
        };
        delete input.obsSourceId;
      }
      res.json(await studio.react(input));
    },
  );
  app.post('/api/viewing-end', (req, res) =>
    res.json(
      studio.endVideo(
        z.object({ sessionId: z.string().uuid(), sourceId: z.string().uuid() }).parse(req.body),
      ),
    ),
  );
  soundRoutes(app, studio, sound, subscriptionSound);
  app.post('/api/audio/prepare', async (_req, res) => {
    if (nativeAudio.config.mode === 'remote') {
      nativeAudio.allowed();
      return res.json({ ok: true, local: false, nativeAudio: true });
    }
    if (!localSpeech) return res.json({ ok: true, local: false });
    const controller = new AbortController();
    const disconnect = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on('close', disconnect);
    try {
      await speech.prepare(controller.signal, studio.settings.speechDevice);
      if (!controller.signal.aborted) res.json({ ok: true, local: true });
    } finally {
      res.off('close', disconnect);
      studio.publish();
    }
  });
  app.post(
    '/api/audio',
    express.raw({ type: ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav'], limit: '8mb' }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body) || !req.body.length)
        throw new Error('음성 데이터가 비어 있습니다.');
      if (nativeAudio.config.mode === 'remote')
        throw new Error('원격 원음 모드에서는 로컬 전사 경로를 실행하지 않습니다.');
      const controller = new AbortController();
      const disconnect = () => {
        if (!res.writableEnded) controller.abort();
      };
      res.on('close', disconnect);
      try {
        const result = await studio.transcribe(
          req.body,
          req.headers['content-type'].split(';')[0],
          controller.signal,
        );
        if (!controller.signal.aborted) res.json(result);
      } catch (error) {
        if (localSpeech && !speech.ready) {
          if (!controller.signal.aborted)
            res.status(409).json({ error: error.message, needsPreparation: true });
        } else throw error;
      } finally {
        res.off('close', disconnect);
      }
    },
  );
  app.post(
    '/api/audio/raw',
    express.raw({ type: 'application/octet-stream', limit: '64kb' }),
    async (req, res) => {
      if (!speechRecovery)
        return res.status(503).json({ error: '로컬 원음 보존을 사용할 수 없습니다.' });
      const result = await appendSpeechRaw({
        sessionId: req.headers['x-speech-session'],
        inputEpoch: req.headers['x-speech-epoch'],
        sequence: Number(req.headers['x-speech-sequence']),
        startFrame: Number(req.headers['x-speech-frame']),
        frameCount: Number(req.headers['x-speech-count']),
        data: req.body,
      });
      res.json({ ok: true, ...result });
    },
  );
  app.get('/api/audio/storage', async (_req, res) => {
    if (!speechRecovery)
      return res.status(503).json({ error: '로컬 원음 보존을 사용할 수 없습니다.' });
    res.set('Cache-Control', 'no-store').json(await speechRecovery.status());
  });
  app.get('/api/microphone/config', (_req, res) => {
    res.set('Cache-Control', 'no-store').json(microphoneStore.data);
  });
  app.post('/api/microphone/config', (req, res) => {
    const config = MicrophoneConfig.parse(req.body);
    if (!config.deviceId) throw new Error('사용할 마이크를 선택해주세요.');
    microphoneStore.save(config);
    microphoneStore.data = config;
    studio.publish();
    res.json(config);
  });
  app.post('/api/audio/storage/config', async (req, res) => {
    if (studio.running) throw new Error('방송을 중지한 뒤 원음 보관 설정을 바꿔주세요.');
    if (!speechRecovery) throw new Error('로컬 원음 보존을 사용할 수 없습니다.');
    const config = SpeechRetentionConfig.parse(req.body);
    speechRetentionStore.save(config);
    speechRetentionStore.data = config;
    await speechRecovery.sweep();
    await nativeAudio.subscription.refreshRetainedAudio();
    await subscriptionSound.refreshRetainedAudio();
    studio.publish();
    res.json(await speechRecovery.status());
  });
  app.post('/api/audio/storage/delete', async (req, res) => {
    if (!speechRecovery) throw new Error('로컬 원음 보존을 사용할 수 없습니다.');
    const value = z
      .object({
        sessionId: z.string().uuid(),
        inputEpoch: z.string().uuid(),
        confirm: z.literal(true),
      })
      .strict()
      .parse(req.body);
    await speechRecovery.remove(value.sessionId, value.inputEpoch);
    await nativeAudio.subscription.refreshRetainedAudio();
    await subscriptionSound.refreshRetainedAudio();
    studio.publish();
    res.json(await speechRecovery.status());
  });
  app.get('/api/audio/storage/:sessionId/:inputEpoch', async (req, res) => {
    if (!speechRecovery) throw new Error('로컬 원음 보존을 사용할 수 없습니다.');
    const ids = z
      .object({ sessionId: z.string().uuid(), inputEpoch: z.string().uuid() })
      .parse(req.params);
    const audio = await speechRecovery.download(ids.sessionId, ids.inputEpoch);
    if (!audio)
      return res.status(404).json({ error: '보관된 원음이 없거나 보관 기간이 지났습니다.' });
    res.attachment('nagneon-original-audio.wav').type('audio/wav');
    res.set('Cache-Control', 'no-store');
    res.set('Content-Length', String(audio.bytes));
    res.once('close', () => audio.stream.destroy());
    audio.stream.once('error', () => res.destroy());
    audio.stream.pipe(res);
  });
  app.get('/api/audio/raw/:sessionId/:inputEpoch', async (req, res) => {
    if (!speechRecovery)
      return res.status(503).json({ error: '로컬 원음 보존을 사용할 수 없습니다.' });
    const audio = await speechRecovery.readRange(
      req.params.sessionId,
      req.params.inputEpoch,
      Number(req.query.start),
      Number(req.query.end),
    );
    res.type('audio/wav').send(audio);
  });
  app.post('/api/moderate', (req, res) => {
    const { action, id } = z
      .object({ action: z.enum(['delete', 'ban', 'unban', 'clear']), id: z.string().default('') })
      .parse(req.body);
    studio.moderate(action, id);
    res.json(studio.state());
  });
  app.get('/api/journal', (req, res) =>
    res.json(
      journal.list(
        z
          .object({
            viewerId: z.string().max(80).optional(),
            query: z.string().max(300).optional(),
            pinned: z
              .enum(['true', 'false'])
              .optional()
              .transform((v) => v === 'true'),
            offset: z.coerce.number().int().min(0).max(4000).default(0),
            limit: z.coerce.number().int().min(1).max(40).default(30),
          })
          .parse(req.query),
      ),
    ),
  );
  app.post('/api/journal/:id/pin', (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const { pinned } = z.object({ pinned: z.boolean() }).parse(req.body);
    journal.pin(id, pinned);
    studio.publish();
    res.json({ ok: true });
  });
  app.delete('/api/journal/:id', (req, res) => {
    if (studio.busy) throw new Error('관객 응답이 끝난 뒤 기억을 지울 수 있습니다.');
    studio.moderate('delete', z.string().uuid().parse(req.params.id));
    studio.queue = [];
    studio.publish();
    res.json({ ok: true });
  });
  app.get('/api/diagnostics/reactions', (req, res) => {
    if (req.query.download === 'true') res.attachment('nagneon-reaction-diagnostics.json');
    res.set('Cache-Control', 'no-store').json({
      ...studio.reactions.snapshot(studio.queue),
      trace: studio.trace.status(),
    });
  });
  app.get('/api/diagnostics/input-latency', (req, res) => {
    if (req.query.download === 'true') res.attachment('nagneon-input-latency.json');
    res.set('Cache-Control', 'no-store').json(studio.inputLatency.snapshot());
  });
  app.get('/api/diagnostics/broadcast-trace', (req, res) => {
    if (req.query.download === 'true') res.attachment('nagneon-broadcast-trace.json');
    res.set('Cache-Control', 'no-store').json(studio.trace.snapshot());
  });
  app.post('/api/diagnostics/input-latency/rendered', (req, res) => {
    const value = z
      .object({
        sessionId: z.string().uuid(),
        ids: z.array(z.string().min(1).max(100)).max(100),
        at: z.number().finite(),
      })
      .strict()
      .parse(req.body);
    if (value.sessionId !== studio.sessionId) throw new Error('이미 끝난 방송의 표시 기록입니다.');
    studio.inputLatency.rendered(value.ids, value.at);
    studio.trace.rendered(value.sessionId, value.ids, value.at);
    res.json({ ok: true });
  });
  app.get('/api/export', (_req, res) => {
    res.attachment(`nagneon-${studio.sessionId || 'session'}.json`).json({
      exportedAt: new Date().toISOString(),
      ...studio.state(),
      seasonsArchive: seasonsStore.data,
      episodesArchive: episodesStore.data,
      conversationJournal: journal.data,
    });
  });
  app.use(express.static(resolve(root, 'dist')));
  app.get(['/', '/overlay'], (_req, res) =>
    res.sendFile('index.html', { root: resolve(root, 'dist') }),
  );
  app.use((error, _req, res, _next) =>
    res.status(error instanceof z.ZodError ? 400 : 409).json({
      error:
        error instanceof z.ZodError
          ? '입력 설정을 확인하세요: ' + error.issues.map((i) => i.message).join(', ')
          : error.message || '요청 처리 실패',
    }),
  );
  const server = await listenBrowserLoopback(createServer(app), { port });
  expectedHost = `127.0.0.1:${server.address().port}`;
  // 기존 설치는 앱 시작을 막지 않고 확인한다. 다운로드나 음성 장치는 시작하지 않는다.
  void runtimeComponents?.inspectInstalled();
  // Start the local worker only when the renderer requests audio preparation.
  const health = setInterval(() => studio.publish(), 5000);
  health.unref();
  if (speechRecovery)
    void speechRecovery
      .sweep()
      .catch((error) => console.warn('마이크 원음 보존 정리 실패:', error.message));
  const speechRetention = setInterval(() => {
    if (speechRecovery)
      void speechRecovery
        .sweep()
        .catch((error) => console.warn('마이크 원음 보존 정리 실패:', error.message));
  }, 60000);
  speechRetention.unref();
  studio.trace.lifecycle('service', 'completed', undefined, 'startup');
  return {
    server,
    studio,
    appendSpeechRaw,
    nativeAudio,
    subscriptionSound,
    obsInput,
    url: `http://${expectedHost}`,
    accessToken: access.token,
    close: () => {
      if (closing) return closing;
      let complete, fail;
      closing = new Promise((done, reject) => {
        complete = done;
        fail = reject;
      });
      (async () => {
        const closingAt = performance.now();
        studio.trace.lifecycle('service', 'started');
        clearInterval(health);
        clearInterval(speechRetention);
        // Start every cleanup even if another one fails, and keep the event loop
        // alive until all owned requests have left their cleanup/finally blocks.
        const invoke = (component, fn) => {
          const started = performance.now();
          studio.trace.lifecycle(component, 'started');
          let task;
          try {
            task = Promise.resolve(fn());
          } catch (error) {
            task = Promise.reject(error);
          }
          return task.then(
            (value) => {
              studio.trace.lifecycle(component, 'completed', performance.now() - started);
              return value;
            },
            (error) => {
              studio.trace.lifecycle(component, 'failed', performance.now() - started);
              throw error;
            },
          );
        };
        const tasks = [
          invoke('obs', () => obsInput.disconnect()),
          invoke('native-audio', () => nativeAudio.close()),
          invoke('system-audio', () => subscriptionSound.close()),
          invoke('runtime-components', () => runtimeComponents?.close()),
          invoke('requests', () => requests.close()),
          invoke('tutorial', () => tutorial.operation),
          invoke('probe', () => probe.cancel()),
          invoke('studio', () => studio.close()),
          invoke('culture', () => studio.culture.close()),
          invoke('clip-inspector', () => clipInspector.close()),
          invoke('speech', () => speech.close()),
          invoke('community', () => studio.communityActivity.yield()),
          invoke('clip-perception', () => studio.clipPerception.close()),
          invoke('sound', () => sound.close()),
          invoke(
            'http',
            () =>
              new Promise((done, fail) => {
                server.close((error) => (error ? fail(error) : done()));
                server.closeAllConnections();
              }),
          ),
        ];
        return Promise.allSettled(tasks).then((results) => {
          const errors = results
            .filter((result) => result.status === 'rejected')
            .map((result) => result.reason);
          studio.trace.lifecycle(
            'service',
            errors.length ? 'failed' : 'completed',
            performance.now() - closingAt,
          );
          if (errors.length)
            throw new AggregateError(errors, '앱 종료 정리를 완료하지 못했습니다.');
        });
      })().then(complete, fail);
      return closing;
    },
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const service = await startServer({
    browserConnect: true,
    developmentOrigin: 'http://127.0.0.1:5173',
  });
  console.log(
    `Nagneon 개발용 일회용 연결 주소 (공유하지 마세요):\n${service.url}/connect#${service.accessToken}`,
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => service.close().then(() => process.exit(0)));
}
