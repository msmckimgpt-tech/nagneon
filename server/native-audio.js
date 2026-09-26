import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  NativeAudioProvider,
  NATIVE_AUDIO_MODEL,
  ListeningResult,
} from './native-audio-provider.js';
import { SpeechCapture } from './speech-screen.js';

export const NativeAudioConfig = z
  .object({ mode: z.enum(['local', 'remote']), consent: z.boolean() })
  .strict();
const Start = z
  .object({
    sessionId: z.string().uuid(),
    inputEpoch: z.string().uuid(),
    startedAt: z.number().finite().nonnegative(),
  })
  .strict();
const RATE = 16000,
  WINDOW = RATE * 2,
  RETENTION = 86400000,
  MAX_MEMORY = 2 * 1024 * 1024;
const fault = (message) => new Error(message);

export function listeningText(value) {
  const result = ListeningResult.parse(value);
  if (result.state === 'non_speech') return '';
  return (
    '[원음 이해 · 전사문 아님]\n' +
    result.utterances
      .map(
        (u) =>
          `${u.uncertain ? '불확실 · ' : ''}${u.kind}: ${u.heard ? `청취 문구 후보: ${u.heard}; ` : ''}의미: ${u.meaning}`,
      )
      .join('\n')
  );
}

function listeningParts(value, eventId) {
  const groups = [];
  let utterances = [];
  for (const utterance of value.utterances) {
    if (
      utterances.length &&
      listeningText({ ...value, utterances: [...utterances, utterance] }).length > 3000
    ) {
      groups.push(utterances);
      utterances = [];
    }
    utterances.push(utterance);
  }
  if (utterances.length) groups.push(utterances);
  return groups.map((items, index) => ({
    id: index === 0 ? eventId : randomUUID(),
    text: listeningText({ ...value, utterances: items }),
  }));
}

// Bound cancellation even when an adapter does not cooperate. The underlying
// promise still has a rejection handler and cannot publish a late result.
function bounded(call, signal, timeoutMs) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const done = (fn, value) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      fn(value);
    };
    const abort = () => done(reject, signal.reason || fault('원격 청취를 중단했습니다.'));
    const timer = setTimeout(
      () => done(reject, fault('원음 이해 응답 시간이 초과됐습니다.')),
      timeoutMs,
    );
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve()
      .then(call)
      .then(
        (value) => done(resolve, value),
        (error) => done(reject, error),
      );
  });
}

// Capture, durable storage, protocol acknowledgement, interpretation and product
// acceptance are distinct. One missing result never turns into successful silence.
export class NativeAudio {
  constructor({
    studio,
    recovery,
    config = { mode: 'local', consent: false },
    save = () => {},
    dir,
    key = '',
    providerFactory = (options) => new NativeAudioProvider(options),
    now = Date.now,
    operationTimeoutMs = 45000,
    releaseLocal = async () => {},
  } = {}) {
    this.studio = studio;
    this.recovery = recovery;
    this.config = NativeAudioConfig.parse(config);
    this.save = save;
    this.dir = dir;
    this.key = key;
    this.providerFactory = providerFactory;
    this.now = now;
    this.operationTimeoutMs = operationTimeoutMs;
    this.releaseLocal = releaseLocal;
    this.inputs = new Map();
    this.session = null;
    this.context = null;
    this.processing = false;
    this.turn = 0;
    this.error = '';
    this.writes = Promise.resolve();
    this.closed = false;
    this.applied = 0;
    this.lastSweep = 0;
    this.timer = setInterval(() => {
      for (const s of this.inputs.values()) this.expire(s);
      void this.pump();
      if (this.now() - this.lastSweep >= 60000) {
        this.lastSweep = this.now();
        void this.sweep().catch(() => {
          this.error = '청취 복구 기록을 정리하지 못했습니다.';
        });
      }
    }, 1000);
    this.timer.unref?.();
  }
  configure(value) {
    if (this.studio.running || this.studio.busy || this.context)
      throw fault('방송과 마이크를 마친 뒤 음성 연결을 변경하세요.');
    const { apiKey, ...config } = z
      .object({
        mode: z.enum(['local', 'remote']),
        consent: z.boolean(),
        apiKey: z.string().trim().max(500).optional(),
      })
      .strict()
      .parse(value);
    this.save(config);
    this.config = config;
    if (
      config.mode === 'remote' &&
      config.consent &&
      this.studio.ai.data.policy.features['native-audio'] === undefined
    )
      this.studio.ai.update({ features: { 'native-audio': true } });
    if (apiKey !== undefined) this.key = apiKey;
    if (config.mode === 'local' || !config.consent) this.key = '';
    this.error = '';
    return this.snapshot();
  }
  allowed() {
    if (this.closed) throw fault('앱이 종료 중입니다.');
    if (this.ledgerFailed) throw fault('청취 처리 기록 저장 실패로 원격 처리를 중단했습니다.');
    if (this.config.mode !== 'remote' || !this.config.consent)
      throw fault('연결 설정에서 마이크 원음 전송 안내를 확인해주세요.');
    if (!this.key) throw fault('연결 설정에서 원격 원음 이해용 OpenAI API 키를 입력해주세요.');
    if (!this.studio.running || this.studio.settings.mode !== 'live')
      throw fault('실제 AI 방송에서 마이크를 켜주세요.');
    this.studio.ai.assertAllowed('native-audio');
  }
  async start(value, signal) {
    this.allowed();
    const input = Start.parse(value);
    if (input.sessionId !== this.studio.sessionId || Math.abs(this.now() - input.startedAt) > 15000)
      throw fault('현재 방송의 마이크 시작 시각을 확인하세요.');
    if (this.context && this.session?.inputEpoch === input.inputEpoch) return this.snapshot();
    if (this.inputs.has(input.inputEpoch))
      throw fault('새 마이크 연결에는 새 원음 식별자가 필요합니다.');
    this.stop('input-replaced');
    for (const [id, old] of this.inputs) {
      this.expire(old);
      // Old broadcasts remain in the local journal, never in a new audience's input.
      if (
        old.sessionId !== input.sessionId ||
        (!old.jobs.size && this.now() - (old.stoppedAt || this.now()) > 600000)
      )
        this.inputs.delete(id);
    }
    if (this.inputs.size >= 128)
      throw fault(
        '미처리 마이크 연결이 많이 남아 있습니다. 복구 기록을 확인한 뒤 새 방송을 시작하세요.',
      );
    const s = {
      ...input,
      jobs: new Map(),
      contexts: new Map(),
      parts: [],
      screen: null,
      hearers: null,
      frame: 0,
      windowStart: 0,
      durable: 0,
      sequence: 0,
      memory: 0,
      protocolAccepted: 0,
      interpreted: 0,
      applied: 0,
      nonSpeech: 0,
      uncertain: 0,
      expired: 0,
      stopped: false,
    };
    this.inputs.set(s.inputEpoch, s);
    this.session = s;
    const controller = new AbortController();
    const context = {
      controller,
      signal: AbortSignal.any([
        controller.signal,
        this.studio.controller.signal,
        ...(signal ? [signal] : []),
      ]),
      provider: null,
      previousItem: null,
      previousSource: '',
      nextConnectAt: 0,
      failures: 0,
    };
    this.context = context;
    context.signal.addEventListener('abort', () => context.provider?.close(), { once: true });
    try {
      await bounded(() => this.releaseLocal(), context.signal, this.operationTimeoutMs);
      await bounded(() => this.connection(context), context.signal, this.operationTimeoutMs);
      context.signal.throwIfAborted();
      s.startedAt = this.now();
      this.record(s, {
        type: 'start',
        sourceSampleRate: RATE,
        startedAt: s.startedAt,
        model: NATIVE_AUDIO_MODEL,
      });
    } catch (error) {
      if (this.context === context) {
        this.error = error.message;
        this.stop('connect-failed');
      }
      throw error;
    }
    return this.snapshot();
  }
  async connection(context) {
    this.allowed();
    context.signal.throwIfAborted();
    if (
      context.provider &&
      !context.provider.closed &&
      this.now() - context.provider.openedAt < 55 * 60000
    )
      return context.provider;
    context.provider?.close();
    context.previousItem = null;
    context.previousSource = '';
    const provider = this.providerFactory({ key: this.key });
    context.provider = provider;
    await provider.connect(context.signal);
    return provider;
  }
  capture(entry) {
    const s = this.inputs.get(entry.inputEpoch);
    if (!s || s.sessionId !== entry.sessionId || this.closed) return;
    if (
      !Number.isSafeInteger(entry.startFrame) ||
      !Number.isSafeInteger(entry.frameCount) ||
      entry.frameCount < 1 ||
      entry.frameCount > RATE ||
      !Buffer.isBuffer(entry.data) ||
      entry.data.length !== entry.frameCount * 2
    )
      throw fault('원격 청취 원음 범위가 올바르지 않습니다.');
    if (entry.startFrame < s.frame) return;
    if (entry.startFrame !== s.frame) throw fault('원격 청취 원음에 빈 구간이 있습니다.');
    const startedAt = s.startedAt + (entry.startFrame / RATE) * 1000;
    const endedAt = startedAt + (entry.frameCount / RATE) * 1000;
    const sourceCapture = entry.capture || s.contexts.get(entry.startFrame);
    s.contexts.delete(entry.startFrame);
    const capture = SpeechCapture.parse({
      startedAt,
      endedAt,
      ...(sourceCapture?.screen ? { screen: sourceCapture.screen } : {}),
    });
    if (capture.screen && capture.screen.sessionId !== s.sessionId)
      throw fault('다른 방송의 화면은 청취에 사용할 수 없습니다.');
    if (s.parts.length && (s.screen?.sourceId || '') !== (capture.screen?.sourceId || ''))
      this.finishWindow(s);
    const hearers = (this.studio.presentWitnesses?.() || []).filter(
      (id) => this.studio.audience.data.members[id]?.joinedAt <= startedAt,
    );
    s.hearers = s.hearers ? s.hearers.filter((id) => hearers.includes(id)) : hearers;
    if (capture.screen) {
      const frames = [...(s.screen?.frames || []), ...capture.screen.frames];
      s.screen = {
        ...capture.screen,
        frames: [...new Map(frames.map((f) => [f.at, f])).values()]
          .sort((a, b) => a.at - b.at)
          .slice(-3),
      };
    }
    s.parts.push(Buffer.from(entry.data));
    s.memory += entry.data.length;
    s.frame += entry.frameCount;
    if (s.frame - s.windowStart >= WINDOW || s.stopped) this.finishWindow(s);
    this.trimMemory();
    void this.pump();
  }
  attachContext(value) {
    const entry = z
      .object({
        sessionId: z.string().uuid(),
        inputEpoch: z.string().uuid(),
        startFrame: z.number().int().nonnegative(),
        capture: SpeechCapture,
      })
      .strict()
      .parse(value);
    const s = this.inputs.get(entry.inputEpoch);
    if (!s || s.sessionId !== entry.sessionId || entry.startFrame < s.frame) return;
    if (s.contexts.size >= 4 && !s.contexts.has(entry.startFrame))
      throw fault('화면 근거 전송이 밀리고 있습니다.');
    s.contexts.set(entry.startFrame, entry.capture);
  }
  stored(entry, result) {
    const s = this.inputs.get(entry.inputEpoch);
    if (!s || s.sessionId !== entry.sessionId) return;
    s.durable = Math.max(s.durable, result.durableThrough);
    this.trimMemory();
    void this.pump();
  }
  finishWindow(s) {
    if (s.frame <= s.windowStart) return;
    const job = {
      eventId: randomUUID(),
      sequence: ++s.sequence,
      revision: 0,
      frameStart: s.windowStart,
      frameEnd: s.frame,
      createdAt: s.startedAt + (s.windowStart / RATE) * 1000,
      attempts: 0,
      deliveryAttempts: 0,
      status: 'pending',
      nextAt: 0,
      bytes: Buffer.concat(s.parts),
      result: null,
      screen: s.screen,
      hearers: s.hearers || [],
    };
    s.parts = [];
    s.screen = null;
    s.hearers = null;
    s.windowStart = s.frame;
    s.jobs.set(job.sequence, job);
    this.record(s, {
      type: 'captured',
      eventId: job.eventId,
      sequence: job.sequence,
      startedAt: s.startedAt,
      frameStart: job.frameStart,
      frameEnd: job.frameEnd,
    });
  }
  trimMemory() {
    let total = [...this.inputs.values()].reduce((n, s) => n + s.memory, 0);
    for (const s of this.inputs.values())
      for (const job of s.jobs.values()) {
        if (total <= MAX_MEMORY) return;
        if (job.bytes && job.frameEnd <= s.durable && job.status !== 'running') {
          total -= job.bytes.length;
          s.memory -= job.bytes.length;
          job.bytes = null;
        }
      }
    if (total > MAX_MEMORY * 2) {
      this.error =
        '원음 저장 지연으로 원격 전송을 중단했습니다. 미저장 원음은 마이크 저장 상태에서 확인하세요.';
      this.stop('storage-backpressure');
    }
  }
  expire(s) {
    for (const [sequence, job] of s.jobs) {
      if (this.now() - job.createdAt > 120000) job.screen = null;
      if (this.now() - job.createdAt < RETENTION || job.status === 'running') continue;
      if (job.bytes) s.memory -= job.bytes.length;
      s.jobs.delete(sequence);
      s.expired++;
      this.record(s, { type: 'expired-unresolved', eventId: job.eventId, sequence });
    }
  }
  async pump() {
    const context = this.context;
    if (this.processing || !context || context.signal.aborted || this.now() < context.nextConnectAt)
      return;
    try {
      this.allowed();
    } catch (error) {
      this.error = error.message;
      this.stop('policy');
      return;
    }
    const candidates = [...this.inputs.values()]
      .filter((s) => s.sessionId === this.studio.sessionId)
      .flatMap((s) => [...s.jobs.values()].map((job) => ({ s, job })))
      .filter(
        ({ job }) =>
          job.status !== 'running' &&
          job.status !== 'uncertain' &&
          (job.result ? job.deliveryAttempts < 12 : job.attempts < 3) &&
          job.nextAt <= this.now(),
      )
      .sort((a, b) => a.job.createdAt - b.job.createdAt);
    const fresh = candidates.find(({ job }) => job.status === 'pending');
    const recovery = candidates.find(({ job }) => job.status !== 'pending');
    const selected = ++this.turn % 5 === 0 ? recovery || fresh : fresh || recovery;
    if (!selected) return;
    const { s, job } = selected;
    this.processing = true;
    this.pendingCleanup = new Promise((resolve) => {
      this.resolveIdle = resolve;
    });
    job.status = 'running';
    try {
      if (!job.result) {
        job.attempts++;
        job.revision++;
        let bytes = job.bytes;
        if (!bytes)
          bytes = (
            await bounded(
              () =>
                this.recovery.readRange(s.sessionId, s.inputEpoch, job.frameStart, job.frameEnd),
              context.signal,
              this.operationTimeoutMs,
            )
          ).subarray(44);
        if (bytes.length < 3200) bytes = Buffer.concat([bytes, Buffer.alloc(3200 - bytes.length)]);
        if (bytes.length % 4) bytes = Buffer.concat([bytes, bytes.subarray(-2)]);
        const provider = await bounded(
          () => this.connection(context),
          context.signal,
          this.operationTimeoutMs,
        );
        const result = await this.studio.ai.run(
          { aiFeature: 'native-audio' },
          context.signal,
          provider,
          'native-audio',
          (args, signal) =>
            bounded(
              async () => {
                for (let offset = 0; offset < bytes.length; offset += 3200) {
                  this.allowed();
                  signal.throwIfAborted();
                  await provider.append(bytes.subarray(offset, offset + 3200), signal);
                }
                signal.throwIfAborted();
                const itemId = await provider.commitInput(signal);
                s.protocolAccepted++;
                const previousItemId =
                  context.previousSource === `${s.inputEpoch}:${job.sequence - 1}`
                    ? context.previousItem
                    : undefined;
                const result = await provider.understand(itemId, {
                  previousItemId,
                  signal,
                  onUsage: args.onAiUsage,
                });
                signal.throwIfAborted();
                if (context.previousItem && context.previousItem !== itemId)
                  provider.forget(context.previousItem);
                context.previousItem = itemId;
                context.previousSource = `${s.inputEpoch}:${job.sequence}`;
                return result;
              },
              signal,
              this.operationTimeoutMs,
            ),
        );
        this.studio.ai.assertCurrent(result);
        this.allowed();
        context.signal.throwIfAborted();
        job.result = result;
        s.interpreted++;
        this.record(s, {
          type: 'interpreted',
          eventId: job.eventId,
          revision: job.revision,
          providerSessionEpoch: result.providerSessionEpoch,
          providerItemId: result.providerItemId,
          listening: result.listening,
        });
      }
      const result = job.result;
      this.studio.ai.assertCurrent(result);
      this.allowed();
      context.signal.throwIfAborted();
      if (result.listening.state === 'uncertain') {
        s.uncertain++;
        job.status = 'uncertain';
        this.error =
          '확실히 이해되지 않은 원음 구간이 있습니다. 복구 기록에 미해결 상태로 남겼습니다.';
        return;
      }
      if (result.listening.state === 'non_speech') s.nonSpeech++;
      else {
        if (!job.publications) {
          job.publications = listeningParts(result.listening, job.eventId);
          job.deliveredParts = 0;
          this.record(s, {
            type: 'publication-plan',
            eventId: job.eventId,
            parts: job.publications.map((p) => p.id),
          });
        }
        const unresolvedBefore = [...this.inputs.values()].some((input) =>
          [...input.jobs.values()].some((other) => other.createdAt < job.createdAt),
        );
        const capture = {
          startedAt: s.startedAt + (job.frameStart / RATE) * 1000,
          endedAt: s.startedAt + (job.frameEnd / RATE) * 1000,
          ...(job.screen ? { screen: job.screen } : {}),
          listening: {
            eventId: job.eventId,
            inputEpoch: s.inputEpoch,
            sequence: job.sequence,
            revision: job.revision,
            frameStart: job.frameStart,
            frameEnd: job.frameEnd,
            unresolvedBefore,
          },
        };
        for (let part = job.deliveredParts; part < job.publications.length; part++) {
          this.allowed();
          context.signal.throwIfAborted();
          const publication = job.publications[part];
          this.studio.receiveSpeech({
            id: publication.id,
            sessionId: s.sessionId,
            text: publication.text,
            source: 'microphone',
            capture: {
              ...capture,
              listening: {
                ...capture.listening,
                partIndex: part,
                partCount: job.publications.length,
              },
            },
            capturedHearers: job.hearers,
            interpretation: true,
          });
          job.deliveredParts = part + 1;
          s.applied++;
          this.applied++;
          this.record(s, {
            type: 'published-part',
            eventId: job.eventId,
            id: publication.id,
            partIndex: part,
          });
        }
      }
      this.studio.ai.accepted(result);
      this.record(s, {
        type: 'accepted',
        eventId: job.eventId,
        sequence: job.sequence,
        revision: job.revision,
        durable: job.frameEnd <= s.durable,
      });
      if (job.bytes) s.memory -= job.bytes.length;
      s.jobs.delete(job.sequence);
      context.failures = 0;
      this.error = '';
    } catch (error) {
      if (context.signal.aborted || this.context !== context) {
        job.status = 'cancelled-unresolved';
        job.nextAt = 0;
        this.record(s, {
          type: 'cancelled-unresolved',
          eventId: job.eventId,
          sequence: job.sequence,
        });
        return;
      }
      job.status = 'failed';
      if (job.result) job.deliveryAttempts++;
      job.nextAt = this.now() + Math.min(60000, 5000 * 2 ** Math.min(job.attempts, 4));
      this.error = error.message;
      this.record(s, {
        type: 'failed',
        eventId: job.eventId,
        sequence: job.sequence,
        attempts: job.attempts,
        deliveryAttempts: job.deliveryAttempts,
      });
      if (!job.result) {
        context.provider?.close();
        context.provider = null;
        context.previousItem = null;
        context.nextConnectAt =
          this.now() + Math.min(30000, 1000 * 2 ** Math.min(context.failures++, 5));
      }
    } finally {
      this.processing = false;
      this.resolveIdle?.();
      this.resolveIdle = null;
      this.trimMemory();
      this.studio.publish();
      if (this.context) queueMicrotask(() => void this.pump());
    }
  }
  record(s, value) {
    if (!this.dir || this.ledgerFailed) return;
    const at = this.now(),
      minute = Math.floor(at / 60000);
    const line =
      JSON.stringify({ at, sessionId: s.sessionId, inputEpoch: s.inputEpoch, ...value }) + '\n';
    this.writes = this.writes
      .then(async () => {
        await mkdir(this.dir, { recursive: true });
        await appendFile(join(this.dir, `listening-${minute}.jsonl`), line, { mode: 0o600 });
      })
      .catch(() => {
        this.ledgerFailed = true;
        this.error =
          '청취 처리 기록 저장 실패로 원격 처리를 중단했습니다. 원음 보존 상태를 확인해주세요.';
        this.stop('ledger-failed');
      });
  }
  stop(reason = 'microphone-off') {
    const s = this.session;
    if (s && !s.stopped) {
      this.finishWindow(s);
      s.stopped = true;
      s.stoppedAt = this.now();
      this.record(s, {
        type: 'stopped',
        reason,
        captured: s.frame,
        durable: s.durable,
        unresolved: s.jobs.size,
      });
    }
    const context = this.context;
    this.context = null;
    context?.controller.abort();
    context?.provider?.close();
  }
  snapshot() {
    const s = this.session,
      inputs = [...this.inputs.values()];
    let pending = 0,
      oldest = this.now();
    const unresolved = [];
    for (const input of inputs)
      for (const job of input.jobs.values()) {
        pending++;
        oldest = Math.min(oldest, job.createdAt);
        if (unresolved.length < 8) {
          const { sequence, frameStart, frameEnd, status, attempts } = job;
          unresolved.push({
            inputEpoch: input.inputEpoch,
            sequence,
            frameStart,
            frameEnd,
            status,
            attempts,
          });
        }
      }
    return {
      ...this.config,
      configured: !!this.key,
      model: NATIVE_AUDIO_MODEL,
      error: this.error,
      active: !!this.context && !this.context.signal.aborted,
      ...(s ? { startedAt: s.startedAt, inputEpoch: s.inputEpoch } : {}),
      captured: s?.frame || 0,
      durable: s?.durable || 0,
      pending,
      applied: this.applied,
      ...Object.fromEntries(
        ['protocolAccepted', 'interpreted', 'nonSpeech', 'uncertain', 'expired'].map((k) => [
          k,
          inputs.reduce((n, i) => n + i[k], 0),
        ]),
      ),
      memoryBytes: inputs.reduce((n, i) => n + i.memory, 0),
      oldestPendingMs: pending ? Math.max(0, this.now() - oldest) : 0,
      unresolved,
    };
  }
  async sweep() {
    if (!this.dir) return;
    await this.writes;
    for (const file of await readdir(this.dir).catch((e) => {
      if (e.code === 'ENOENT') return [];
      throw e;
    })) {
      const match = /^listening-(\d+)\.jsonl$/.exec(file);
      if (match && this.now() >= (Number(match[1]) + 1) * 60000 + RETENTION)
        await unlink(join(this.dir, file));
    }
  }
  async close() {
    if (this.closed) return;
    this.stop('app-close');
    this.closed = true;
    this.key = '';
    clearInterval(this.timer);
    await this.pendingCleanup;
    await this.writes;
    this.inputs.clear();
    this.session = null;
  }
}
