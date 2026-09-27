import { randomUUID, createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { SubscriptionVoiceHost } from './subscription-voice-host.js';
import { SubscriptionInputEvent, SubscriptionTranscript } from '../shared/subscription-voice.js';
import { SpeechCapture } from './speech-screen.js';

const RATE = 16000,
  RETENTION = 86400000,
  SCREEN_RETENTION = 120000;
const Start = z
  .object({
    sessionId: z.string().uuid(),
    inputEpoch: z.string().uuid(),
    startedAt: z.number().finite().nonnegative(),
  })
  .strict();
const Clock = z
  .object({
    inputEpoch: z.string().uuid(),
    runId: z.string().uuid(),
    startedAt: z.number().finite().nonnegative(),
    monotonicMs: z.number().finite().nonnegative(),
  })
  .strict();
const Connect = z
  .object({ inputEpoch: z.string().uuid(), sdp: z.string().min(20).max(65536) })
  .strict();
const Events = z
  .object({
    inputEpoch: z.string().uuid(),
    runId: z.string().uuid(),
    sequence: z.number().int().positive(),
    events: z.array(SubscriptionInputEvent).max(24),
  })
  .strict();
const digest = (value) => createHash('sha256').update(value).digest('hex');
const RecoveryOwner = z.object({ inputEpoch: z.string().uuid() }).strict();
const RecoveryFinish = z
  .object({ inputEpoch: z.string().uuid(), runId: z.string().uuid() })
  .strict();

// Raw capture, provider transcription, application receipt, and audience
// response are different states. Neither an RPC ack nor silence is inference.
export class SubscriptionVoice {
  constructor({
    studio,
    recovery,
    dir,
    bin,
    env,
    config,
    releaseLocal = async () => {},
    hostFactory = (options) => new SubscriptionVoiceHost(options),
    now = Date.now,
  } = {}) {
    Object.assign(this, {
      studio,
      recovery,
      dir,
      bin,
      env,
      config,
      releaseLocal,
      hostFactory,
      now,
    });
    this.inputs = new Map();
    this.runs = new Map();
    this.writes = Promise.resolve();
    this.pendingWrites = 0;
    this.applied = 0;
    this.error = '';
    this.closed = false;
    this.ready = this.restore();
    this.timer = setInterval(() => {
      void this.pump();
      void this.expire();
    }, 250);
    this.timer.unref?.();
  }
  selected() {
    return this.config().mode === 'remote' && this.config().transport === 'subscription';
  }
  allowed() {
    if (this.closed || this.ledgerFailed || this.stopUnconfirmed)
      throw Error('음성 복구 기록을 확인하지 못했습니다. 마이크 연결을 중단했습니다.');
    if (!this.selected() || !this.config().consent)
      throw Error('연결 설정에서 구독 음성 전송 안내를 확인해주세요.');
    if (!this.studio.running || this.studio.settings.mode !== 'live')
      throw Error('실제 AI 방송에서 마이크를 켜주세요.');
    if (this.studio.provider?.status?.().kind !== 'codex')
      throw Error('구독 음성은 ChatGPT 구독 연결에서 사용할 수 있습니다.');
    this.studio.ai.assertAllowed('native-audio');
  }
  create(input) {
    return {
      ...input,
      frame: 0,
      durable: 0,
      storedSequence: 0,
      contexts: new Map(),
      publications: [],
      unresolved: [],
      active: false,
      clock: false,
      recoveryCount: 0,
    };
  }
  async start(value, signal) {
    await this.ready;
    this.allowed();
    signal?.throwIfAborted();
    this.failures = (this.failures || []).filter((at) => this.now() - at < 60000);
    if (this.failures.length >= 3)
      throw Error('음성 연결이 반복해서 끊겼습니다. 잠시 뒤 마이크를 다시 켜주세요.');
    const input = Start.parse(value);
    if (input.sessionId !== this.studio.sessionId || Math.abs(this.now() - input.startedAt) > 15000)
      throw Error('현재 방송의 마이크 시작 정보를 확인하세요.');
    if (this.inputs.has(input.inputEpoch))
      throw Error('새 마이크 연결에는 새 원음 식별자가 필요합니다.');
    await this.stop('input-replaced');
    if (this.inputs.size >= 128)
      throw Error('보존 중인 음성 연결이 너무 많습니다. 복구 기록을 확인해주세요.');
    this.allowed();
    signal?.throwIfAborted();
    const s = this.create(input);
    s.active = true;
    s.stage = 'preparing';
    s.controller = new AbortController();
    s.signal = AbortSignal.any([
      s.controller.signal,
      this.studio.controller.signal,
      ...(signal ? [signal] : []),
    ]);
    s.signal.addEventListener(
      'abort',
      () => {
        if (s.active) void this.stop('cancelled');
      },
      { once: true },
    );
    this.inputs.set(s.inputEpoch, s);
    this.session = s;
    this.error = '';
    await this.record(s, { type: 'start', startedAt: s.startedAt });
    await this.releaseLocal();
    this.allowed();
    s.signal.throwIfAborted();
    return this.snapshot();
  }
  async connect(value, signal) {
    await this.ready;
    this.allowed();
    const request = Connect.parse(value),
      s = this.inputs.get(request.inputEpoch);
    if (!s?.active || s !== this.session || s.runId)
      throw Error('새 구독 음성 연결을 준비해주세요.');
    const runId = randomUUID(),
      run = {
        id: runId,
        input: s,
        owner: s,
        active: true,
        createdAt: this.now(),
        kind: 'live',
        originFrame: 0,
        leadMs: 0,
        sequence: 0,
        receipts: new Map(),
        transcript: new SubscriptionTranscript({ now: this.now }),
        publications: [],
        lastHeartbeat: this.now(),
      };
    s.runId = runId;
    this.runs.set(runId, run);
    const host = this.hostFactory({
      bin: this.bin,
      env: this.env,
      dir: join(this.dir, 'host'),
      onError: () => {
        if (s.active) {
          this.error = '구독 음성 연결이 끊겼습니다. 보존한 원음 구간은 복구 기록에 남습니다.';
          void this.stop('transport-failed');
          this.studio.publish();
        }
      },
    });
    run.host = host;
    const deadline = setTimeout(() => {
      this.error = '구독 음성 연결 준비 시간이 초과됐습니다.';
      void this.stop('connect-timeout');
    }, 35000);
    try {
      const connected = await host.start({
        sdp: request.sdp,
        signal: signal ? AbortSignal.any([s.signal, signal]) : s.signal,
      });
      s.signal.throwIfAborted();
      this.allowed();
      s.stage = 'connected';
      run.connectedAt = this.now();
      await this.record(s, { type: 'run', runId, kind: 'live', originFrame: 0, leadMs: 0 });
      return { sdp: connected.sdp, runId };
    } catch (error) {
      if (s.active) {
        this.error = error.message;
        await this.stop('connect-failed');
      }
      throw error;
    } finally {
      clearTimeout(deadline);
      this.studio.publish();
    }
  }
  async clock(value) {
    this.allowed();
    const clock = Clock.parse(value),
      s = this.inputs.get(clock.inputEpoch),
      run = this.runs.get(clock.runId);
    if (
      s !== this.session ||
      !s?.active ||
      run?.input !== s ||
      s.clock ||
      s.frame ||
      Math.abs(this.now() - clock.startedAt) > 10000
    )
      throw Error('마이크 원음의 시작 시각을 등록하지 못했습니다.');
    s.startedAt = clock.startedAt;
    s.clock = true;
    s.monotonicMs = clock.monotonicMs;
    s.stage = 'listening';
    run.lastHeartbeat = this.now();
    await this.record(s, {
      type: 'clock',
      startedAt: s.startedAt,
      monotonicMs: s.monotonicMs,
      receivedAt: this.now(),
    });
    this.studio.publish();
    return { accepted: true };
  }
  capture(entry) {
    const s = this.inputs.get(entry.inputEpoch);
    if (!s || s.sessionId !== entry.sessionId) return;
    if (
      !s.clock ||
      !Number.isSafeInteger(entry.startFrame) ||
      !Number.isSafeInteger(entry.frameCount) ||
      entry.frameCount < 1 ||
      entry.frameCount > RATE ||
      !Buffer.isBuffer(entry.data) ||
      entry.data.length !== entry.frameCount * 2
    )
      throw Error('구독 음성 원음 구간이 올바르지 않습니다.');
    if (entry.startFrame < s.frame) return;
    if (entry.startFrame !== s.frame) throw Error('구독 음성 원음에 빈 구간이 있습니다.');
    const capture = SpeechCapture.parse(
      entry.capture ||
        s.pendingContexts?.get(entry.startFrame) || {
          startedAt: s.startedAt + (entry.startFrame / RATE) * 1000,
          endedAt: s.startedAt + ((entry.startFrame + entry.frameCount) / RATE) * 1000,
        },
    );
    if (
      Math.abs(capture.startedAt - (s.startedAt + (entry.startFrame / RATE) * 1000)) > 2 ||
      Math.abs(
        capture.endedAt - (s.startedAt + ((entry.startFrame + entry.frameCount) / RATE) * 1000),
      ) > 2 ||
      (capture.screen && capture.screen.sessionId !== s.sessionId)
    )
      throw Error('원음 구간과 화면의 캡처 시각이 일치하지 않습니다.');
    s.pendingContexts?.delete(entry.startFrame);
    s.contexts.set(entry.startFrame, {
      sequence: entry.sequence,
      startFrame: entry.startFrame,
      frameCount: entry.frameCount,
      capture,
      sha256: digest(entry.data),
      hearers: (this.studio.presentWitnesses?.() || []).filter(
        (id) => this.studio.audience.data.members[id]?.joinedAt <= capture.startedAt,
      ),
    });
    s.frame += entry.frameCount;
    for (const [frame, context] of s.contexts)
      if (context.capture.endedAt < this.now() - SCREEN_RETENTION) s.contexts.delete(frame);
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
    if (!s || s.sessionId !== entry.sessionId) return;
    s.pendingContexts ||= new Map();
    if (s.pendingContexts.size >= 4 && !s.pendingContexts.has(entry.startFrame))
      throw Error('음성 화면 근거의 전송이 밀리고 있습니다.');
    s.pendingContexts.set(entry.startFrame, entry.capture);
  }
  async stored(entry, result) {
    const s = this.inputs.get(entry.inputEpoch);
    if (!s || s.sessionId !== entry.sessionId) return;
    if (entry.sequence <= s.storedSequence) return;
    const context = s.contexts.get(entry.startFrame);
    if (!context) throw Error('원음 보존 구간의 캡처 근거가 없습니다.');
    const persisted = await this.persistContext(context);
    await this.record(s, { type: 'raw', ...persisted, durableThrough: result.durableThrough });
    s.durable = Math.max(s.durable, result.durableThrough);
    s.storedSequence = entry.sequence;
    if (!s.active) this.markTail(s);
    void this.pump();
  }
  isRunActive(run) {
    return (
      !!run?.active &&
      run.owner === this.session &&
      run.owner.active &&
      run.input.sessionId === this.studio.sessionId
    );
  }
  async events(value) {
    await this.ready;
    const request = Events.parse(value),
      s = this.inputs.get(request.inputEpoch),
      run = this.runs.get(request.runId);
    if (!s || run?.input !== s) throw Error('음성 전사 연결을 확인하지 못했습니다.');
    const active = this.isRunActive(run);
    const fingerprint = digest(JSON.stringify(request.events)),
      prior = run.receipts.get(request.sequence);
    if (prior) {
      if (prior !== fingerprint) throw Error('같은 음성 전송 순번의 내용이 달라졌습니다.');
      return { accepted: true, duplicate: true, active };
    }
    if (request.sequence !== run.sequence + 1)
      throw Error('음성 전사 전송 순번에 빈 구간이 있습니다.');
    if (!active && this.now() - (run.stoppedAt || s.stoppedAt || 0) > 5000)
      throw Error('종료된 음성 연결의 수신 유예 시간이 지났습니다.');
    const receivedAt = this.now();
    for (const event of request.events) {
      await this.record(s, { type: 'event', runId: run.id, receivedAt, event, late: !active });
      run.transcript.accept(event, receivedAt);
    }
    run.sequence = request.sequence;
    run.receipts.set(request.sequence, fingerprint);
    if (run.receipts.size > 128) run.receipts.delete(run.receipts.keys().next().value);
    run.lastHeartbeat = receivedAt;
    if (active) void this.pump();
    else this.markTail(s);
    return { accepted: true, active };
  }
  heartbeat(inputEpoch, runId) {
    const s = this.inputs.get(inputEpoch),
      run = this.runs.get(runId);
    if (run?.input !== s || !this.isRunActive(run)) throw Error('음성 연결이 종료됐습니다.');
    run.lastHeartbeat = this.now();
    return { active: true };
  }
  async pump() {
    if (this.processing || this.closed || this.ledgerFailed) return;
    const owner = this.session;
    if (!owner?.active) return;
    if (owner.sessionId !== this.studio.sessionId) {
      await this.stop('broadcast-changed');
      return;
    }
    if (!owner.runId) {
      if (this.now() - owner.startedAt > 40000) {
        this.error = '음성 연결 준비 시간이 초과됐습니다.';
        await this.stop('startup-timeout');
      }
      return;
    }
    const live = this.runs.get(owner.runId);
    if (!live) return;
    if (!owner.clock && live.connectedAt && this.now() - live.connectedAt > 15000) {
      this.error = '마이크 입력 시작을 확인하지 못했습니다.';
      await this.stop('capture-start-timeout');
      return;
    }
    if (owner.clock && this.now() - live.lastHeartbeat > 6000) {
      this.error = '마이크 연결 상태를 확인하지 못해 전송을 중지했습니다.';
      await this.stop('heartbeat-timeout');
      this.studio.publish();
      return;
    }
    if (!owner.clock) return;
    this.processing = true;
    try {
      for (const run of [
        live,
        ...[...this.runs.values()].filter(
          (run) => run.kind === 'recovery' && this.isRunActive(run),
        ),
      ]) {
        if (!this.isRunActive(run)) continue;
        if (run.kind === 'recovery' && !run.connectedAt) continue;
        if (run.kind === 'recovery' && this.now() - run.lastHeartbeat > 8000) {
          await this.finishRun(run, 'recovery-heartbeat-timeout');
          continue;
        }
        await this.pumpRun(run);
      }
    } finally {
      this.processing = false;
      this.studio.publish();
    }
  }
  async pumpRun(run) {
    const s = run.input;
    try {
      this.allowed();
      let plan = run.pendingPlan;
      if (!plan) {
        const group = run.transcript.ready(this.now());
        if (group) {
          if (
            run.kind === 'recovery' &&
            (group.endMs <= run.leadMs ||
              group.startMs >= run.leadMs + ((run.endFrame - run.originFrame) / RATE) * 1000)
          ) {
            run.transcript.acknowledge(group.ids);
            await this.record(s, { type: 'outside-source', runId: run.id, fragmentIds: group.ids });
            return;
          }
          plan = await this.makePlan(run, group);
          if (!plan) return;
        } else {
          const corrections = (run.corrections ||= []);
          corrections.push(...run.transcript.canonicalChanges(run.publications));
          if (corrections.length) {
            const correction = corrections[0];
            if (correction.endMs - correction.startMs > 12000 || correction.text.length > 2500) {
              s.unresolved.push({
                frameStart: Math.max(
                  0,
                  run.originFrame + Math.floor(((correction.startMs - run.leadMs) * RATE) / 1000),
                ),
                frameEnd: Math.min(
                  s.durable,
                  run.originFrame + Math.ceil(((correction.endMs - run.leadMs) * RATE) / 1000),
                ),
                status: 'canonical-conflict',
                attempts: 2,
              });
              corrections.shift();
              await this.record(s, { type: 'unresolved', ranges: s.unresolved });
              this.error = '긴 발언의 확정 전사가 달라 원음 확인이 필요한 구간을 보존했습니다.';
              return;
            }
            plan = await this.makePlan(run, { ...correction, ids: [], final: true }, true);
            if (!plan) return;
            corrections.shift();
          } else return;
        }
        run.pendingPlan = plan;
        const evidence = await this.persistContext({ capture: plan.capture });
        await this.record(s, {
          type: 'delivery-plan',
          runId: run.id,
          plan: { ...plan, capture: evidence.capture },
        });
      }
      if (plan.nextAt && this.now() < plan.nextAt) return;
      this.allowed();
      if (!this.isRunActive(run)) return;
      this.studio.receiveSpeech({
        id: plan.id,
        sessionId: s.sessionId,
        text: plan.text,
        source: 'microphone',
        capture: plan.capture,
        capturedHearers: plan.hearers,
      });
      await this.record(s, {
        type: 'published',
        runId: run.id,
        id: plan.id,
        fragmentIds: plan.fragmentIds,
        frameStart: plan.frameStart,
        frameEnd: plan.frameEnd,
        at: this.now(),
        correction: plan.correction,
      });
      run.transcript.acknowledge(
        plan.fragmentIds,
        plan.finalFallback ? plan.capture.voice.providerTurnId : undefined,
      );
      run.publications.push({
        id: plan.id,
        fragmentIds: plan.fragmentIds,
        frameStart: plan.frameStart,
        frameEnd: plan.frameEnd,
      });
      s.publications.push({ id: plan.id, frameStart: plan.frameStart, frameEnd: plan.frameEnd });
      run.pendingPlan = null;
      this.applied++;
      run.owner.stage = 'received';
      this.error = '';
      if (run.kind === 'recovery') {
        this.markTail(s);
        await this.record(s, { type: 'unresolved', ranges: s.unresolved });
      }
    } catch (error) {
      this.error = error.message;
      const plan = run.pendingPlan;
      if (plan) {
        plan.attempts = (plan.attempts || 0) + 1;
        plan.nextAt = this.now() + Math.min(8000, 1000 * 2 ** plan.attempts);
        if (plan.attempts >= 3) {
          s.unresolved.push({
            frameStart: plan.frameStart,
            frameEnd: plan.frameEnd,
            status: 'delivery-failed',
            attempts: 2,
          });
          run.transcript.acknowledge(
            plan.fragmentIds,
            plan.finalFallback ? plan.capture.voice.providerTurnId : undefined,
          );
          run.pendingPlan = null;
          await this.record(s, { type: 'unresolved', ranges: s.unresolved }).catch(() => {});
        }
      } else if (run.kind === 'recovery') await this.finishRun(run, 'recovery-processing-failed');
      else if (s.active) await this.stop('processing-failed');
    }
  }
  async prepareRecovery(value) {
    await this.ready;
    this.allowed();
    const { inputEpoch } = RecoveryOwner.parse(value),
      owner = this.session;
    if (!owner?.active || owner.inputEpoch !== inputEpoch || !owner.clock)
      throw Error('현재 마이크 연결에서만 원음을 복구할 수 있습니다.');
    if (
      owner.recoveryCount >= 2 ||
      [...this.runs.values()].some((run) => run.kind === 'recovery' && this.isRunActive(run))
    )
      return { recovery: null };
    for (const s of this.inputs.values()) {
      if (s === owner || s.active || s.sessionId !== this.studio.sessionId || !s.clock) continue;
      this.markTail(s);
      const range = s.unresolved.find(
        (range) =>
          range.attempts < 2 &&
          this.now() - (s.startedAt + (range.frameStart / RATE) * 1000) < SCREEN_RETENTION,
      );
      if (!range) continue;
      const frameEnd = Math.min(range.frameEnd, range.frameStart + 12 * RATE),
        piece = { ...range, frameEnd, attempts: range.attempts + 1, status: 'replay-pending' };
      const index = s.unresolved.indexOf(range);
      s.unresolved.splice(
        index,
        1,
        piece,
        ...(frameEnd < range.frameEnd ? [{ ...range, frameStart: frameEnd }] : []),
      );
      owner.recoveryCount++;
      const run = {
        id: randomUUID(),
        input: s,
        owner,
        active: true,
        kind: 'recovery',
        originFrame: piece.frameStart,
        endFrame: piece.frameEnd,
        leadMs: 1000,
        sequence: 0,
        receipts: new Map(),
        transcript: new SubscriptionTranscript({ now: this.now }),
        publications: [],
        lastHeartbeat: this.now(),
        createdAt: this.now(),
        piece,
      };
      this.runs.set(run.id, run);
      await this.record(s, { type: 'unresolved', ranges: s.unresolved });
      await this.record(s, {
        type: 'recovery-lease',
        runId: run.id,
        ownerEpoch: owner.inputEpoch,
        frameStart: run.originFrame,
        frameEnd: run.endFrame,
        leadMs: run.leadMs,
        attempt: piece.attempts,
      });
      run.deadline = setTimeout(() => {
        void this.finishRun(run, 'recovery-timeout');
      }, 60000);
      run.deadline.unref?.();
      return {
        recovery: {
          runId: run.id,
          inputEpoch: s.inputEpoch,
          sessionId: s.sessionId,
          frameStart: run.originFrame,
          frameEnd: run.endFrame,
          startedAt: s.startedAt,
          leadMs: run.leadMs,
        },
      };
    }
    return { recovery: null };
  }
  recoveryRun(value) {
    const { inputEpoch, runId } = RecoveryFinish.parse(value),
      run = this.runs.get(runId);
    if (run?.kind !== 'recovery' || run.owner.inputEpoch !== inputEpoch || !this.isRunActive(run))
      throw Error('원음 복구 연결이 종료됐습니다.');
    this.allowed();
    return run;
  }
  async recoveryAudio(value) {
    const run = this.recoveryRun(value),
      s = run.input;
    const first = Math.floor(run.originFrame / RATE) * RATE,
      last = Math.min(s.durable, Math.ceil(run.endFrame / RATE) * RATE);
    const audio = await this.recovery.readRange(s.sessionId, s.inputEpoch, first, last),
      pcm = audio.subarray(44);
    let cursor = first;
    for (const context of [...s.contexts.values()]
      .filter((c) => c.startFrame >= first && c.startFrame < last)
      .sort((a, b) => a.startFrame - b.startFrame)) {
      if (
        context.startFrame !== cursor ||
        digest(pcm.subarray((cursor - first) * 2, (cursor - first + context.frameCount) * 2)) !==
          context.sha256
      )
        throw Error('복구 원음의 연속성과 원본 해시를 확인하지 못했습니다.');
      cursor += context.frameCount;
    }
    if (cursor !== last) throw Error('복구 원음의 시각 근거가 만료되었습니다.');
    this.recoveryRun(value);
    const bytes = await this.recovery.readRange(
      s.sessionId,
      s.inputEpoch,
      run.originFrame,
      run.endFrame,
    );
    // Check the second range against the bytes already verified, including partial chunks.
    if (
      !bytes
        .subarray(44)
        .equals(pcm.subarray((run.originFrame - first) * 2, (run.endFrame - first) * 2))
    )
      throw Error('복구 원음이 조회 중 변경됐습니다.');
    run.audioHash = digest(bytes);
    await this.record(s, {
      type: 'recovery-audio',
      runId: run.id,
      sha256: run.audioHash,
      frameStart: run.originFrame,
      frameEnd: run.endFrame,
    });
    return { audio: bytes.toString('base64'), sha256: run.audioHash };
  }
  async connectRecovery(value, signal) {
    const request = z
        .object({
          inputEpoch: z.string().uuid(),
          runId: z.string().uuid(),
          sdp: z.string().min(20).max(65536),
        })
        .strict()
        .parse(value),
      run = this.recoveryRun({ inputEpoch: request.inputEpoch, runId: request.runId });
    if (run.host || !run.audioHash) throw Error('복구 원음 검증을 먼저 완료해주세요.');
    const host = this.hostFactory({
      bin: this.bin,
      env: this.env,
      dir: join(this.dir, 'host'),
      onError: () => {
        void this.finishRun(run, 'recovery-transport-failed');
      },
    });
    run.host = host;
    try {
      const result = await host.start({
        sdp: request.sdp,
        signal: signal ? AbortSignal.any([run.owner.signal, signal]) : run.owner.signal,
      });
      if (!this.isRunActive(run)) throw Error('원음 복구 연결을 취소했습니다.');
      run.lastHeartbeat = this.now();
      run.connectedAt = this.now();
      return { sdp: result.sdp, runId: run.id };
    } catch (error) {
      await this.finishRun(run, 'recovery-connect-failed');
      throw error;
    }
  }
  async finishRecovery(value) {
    const run = this.recoveryRun(value),
      deadline = this.now() + 3000;
    for (let i = 0; this.processing && i < 60; i++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    if (this.processing) throw Error('원음 복구 접수를 마치는 중입니다.');
    this.processing = true;
    try {
      for (let i = 0; i < 32 && this.isRunActive(run) && this.now() <= deadline; i++) {
        const before = run.publications.length;
        await this.pumpRun(run);
        if (run.publications.length === before) break;
      }
    } finally {
      this.processing = false;
    }
    await this.finishRun(run, 'recovery-finished');
    return { accepted: true };
  }
  async finishRun(run, reason) {
    if (run.finishing) return run.finishing;
    run.active = false;
    run.stoppedAt = this.now();
    clearTimeout(run.deadline);
    run.finishing = (async () => {
      const result = await run.host?.close(reason);
      if (result?.exited === false) {
        this.stopUnconfirmed = true;
        await this.stop('recovery-stop-unconfirmed');
      }
      const s = run.input;
      this.markTail(s);
      for (const range of s.unresolved)
        if (range.frameStart < run.endFrame && range.frameEnd > run.originFrame)
          range.status =
            reason === 'recovery-finished' ? 'replayed-unconfirmed' : 'replay-interrupted';
      await this.record(s, { type: 'unresolved', ranges: s.unresolved });
      await this.record(s, { type: 'recovery-stopped', runId: run.id, reason });
      this.studio.publish();
    })();
    run.finishing.catch(() => {});
    return run.finishing;
  }
  async makePlan(run, group, correction = false) {
    const s = run.input;
    const frameStart = Math.max(
      run.originFrame,
      run.originFrame + Math.floor(((group.startMs - run.leadMs) * RATE) / 1000),
    );
    const frameEnd = Math.min(
      run.endFrame ?? Infinity,
      Math.max(
        frameStart + 1,
        run.originFrame + Math.ceil(((group.endMs - run.leadMs) * RATE) / 1000),
      ),
    );
    if (frameEnd <= frameStart) throw Error('복구 발언이 원음 구간 밖에 있습니다.');
    if (frameEnd > s.durable) return null;
    const paddedStart = Math.max(0, frameStart - RATE / 2),
      paddedEnd = Math.min(s.durable, frameEnd + RATE / 2);
    const startedAt = s.startedAt + (paddedStart / RATE) * 1000,
      endedAt = s.startedAt + (paddedEnd / RATE) * 1000;
    if (endedAt <= startedAt || endedAt - startedAt > 15000)
      throw Error('발언의 원음 시간 구간을 확인하지 못했습니다.');
    const contexts = [...s.contexts.values()].filter(
      (context) =>
        context.startFrame + context.frameCount > paddedStart && context.startFrame < paddedEnd,
    );
    const screen = await this.screenFor(s, contexts, startedAt, endedAt);
    const hearers = contexts.length
      ? contexts
          .slice(1)
          .reduce(
            (ids, context) => ids.filter((id) => context.hearers.includes(id)),
            contexts[0].hearers,
          )
      : [];
    const id = randomUUID();
    const capture = {
      startedAt,
      endedAt,
      ...(screen ? { screen } : {}),
      voice: {
        provider: 'chatgpt-subscription',
        kind: correction ? 'correction' : 'transcript',
        runId: run.id,
        fragmentCount: group.ids.length,
        sourceInputEpoch: s.inputEpoch,
        sourceFrameStart: frameStart,
        sourceFrameEnd: frameEnd,
        timing: 'approximate-provider-interval',
        receivedAt: group.observedAt || this.now(),
        ...(group.providerTurnId ? { providerTurnId: group.providerTurnId } : {}),
        ...(correction ? { revises: group.revises } : {}),
        recovered: run.kind === 'recovery',
      },
    };
    return {
      id,
      text: group.text,
      finalFallback: !!group.finalFallback,
      fragmentIds: group.ids,
      frameStart,
      frameEnd,
      capture,
      hearers,
      correction,
    };
  }
  async screenFor(s, contexts, startedAt, endedAt) {
    const selected = contexts.find((context) => context.capture.screen)?.capture.screen;
    if (!selected || this.now() - endedAt > SCREEN_RETENTION) return undefined;
    const candidates = contexts
      .flatMap((context) =>
        context.capture.screen?.sourceId === selected.sourceId ? context.capture.screen.frames : [],
      )
      .filter((frame) => frame.at >= startedAt - 500 && frame.at <= endedAt);
    const unique = [...new Map(candidates.map((frame) => [frame.at, frame])).values()].sort(
      (a, b) => a.at - b.at,
    );
    const chosen =
      unique.length > 3
        ? [unique[0], unique[Math.floor(unique.length / 2)], unique.at(-1)]
        : unique;
    const frames = [];
    for (const frame of chosen) {
      if (frame.image) frames.push({ at: frame.at, image: frame.image });
      else if (/^[a-f0-9]{64}$/.test(frame.hash) && ['jpeg', 'png'].includes(frame.mime)) {
        const bytes = await readFile(
          join(this.dir, 'screens', frame.hash + '.' + frame.mime),
        ).catch((error) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        if (bytes && digest(bytes) === frame.hash)
          frames.push({
            at: frame.at,
            image: `data:image/${frame.mime};base64,${bytes.toString('base64')}`,
          });
      }
    }
    return frames.length
      ? { sessionId: s.sessionId, sourceId: selected.sourceId, frames }
      : undefined;
  }
  async persistContext(context) {
    const copy = structuredClone(context),
      screen = copy.capture.screen;
    if (screen) {
      await mkdir(join(this.dir, 'screens'), { recursive: true });
      for (const frame of screen.frames) {
        const [, mime, encoded] = /^data:image\/(jpeg|png);base64,(.+)$/.exec(frame.image) || [];
        if (!encoded) throw Error('음성 화면 근거를 보존하지 못했습니다.');
        const bytes = Buffer.from(encoded, 'base64'),
          hash = digest(bytes);
        await writeFile(join(this.dir, 'screens', hash + '.' + mime), bytes, { flag: 'wx' }).catch(
          (error) => {
            if (error.code !== 'EEXIST') throw error;
          },
        );
        delete frame.image;
        frame.hash = hash;
        frame.mime = mime;
      }
    }
    return copy;
  }
  markTail(s) {
    // Absence of transcript does not prove silence. Preserve gaps and retry
    // counters by source interval, rather than by text or current receipt time.
    const edges = [
        ...new Set([
          0,
          s.durable,
          ...s.publications.flatMap((p) => [p.frameStart, p.frameEnd]),
          ...s.unresolved.flatMap((r) => [r.frameStart, r.frameEnd]),
        ]),
      ]
        .filter((n) => n >= 0 && n <= s.durable)
        .sort((a, b) => a - b),
      ranges = [];
    for (let i = 1; i < edges.length; i++) {
      const frameStart = edges[i - 1],
        frameEnd = edges[i];
      const prior = s.unresolved
        .filter((r) => r.frameStart <= frameStart && r.frameEnd >= frameEnd)
        .sort((a, b) => b.attempts - a.attempts)[0];
      if (
        s.publications.some((p) => p.frameStart <= frameStart && p.frameEnd >= frameEnd) &&
        !['canonical-conflict', 'delivery-uncertain'].includes(prior?.status)
      )
        continue;
      const next = {
          frameStart,
          frameEnd,
          status: prior?.status || 'tail-unconfirmed',
          attempts: prior?.attempts || 0,
        },
        last = ranges.at(-1);
      if (
        last &&
        last.frameEnd === frameStart &&
        last.status === next.status &&
        last.attempts === next.attempts
      )
        last.frameEnd = frameEnd;
      else ranges.push(next);
    }
    s.unresolved = ranges;
  }
  stop(reason = 'microphone-off') {
    const s = this.session;
    if (!s?.active) return this.closing || Promise.resolve();
    if (/failed|timeout/.test(reason)) (this.failures ||= []).push(this.now());
    s.active = false;
    s.stage = 'stopped';
    s.stopReason = reason;
    s.stoppedAt = this.now();
    s.controller?.abort();
    this.markTail(s);
    this.closing = (async () => {
      const owned = [...this.runs.values()].filter((run) => run.owner === s);
      for (const run of owned) {
        run.active = false;
        run.stoppedAt = s.stoppedAt;
        clearTimeout(run.deadline);
      }
      const results = await Promise.allSettled(owned.map((run) => run.host?.close(reason)));
      for (const run of owned.filter((run) => run.kind === 'recovery')) {
        this.markTail(run.input);
        await this.record(run.input, { type: 'unresolved', ranges: run.input.unresolved });
      }
      if (
        results.some((result) => result.status === 'rejected' || result.value?.exited === false)
      ) {
        this.error = '음성 호스트 종료를 확인하지 못했습니다. 앱을 종료한 뒤 다시 연결해주세요.';
        this.stopUnconfirmed = true;
      }
      await this.record(s, { type: 'stopped', reason, at: s.stoppedAt, ranges: s.unresolved });
      this.studio.publish();
    })();
    this.closing.catch(() => {});
    return this.closing;
  }
  snapshot() {
    const s = this.session,
      unresolved = [...this.inputs.values()].flatMap((input) =>
        input.unresolved.map((range) => ({
          inputEpoch: input.inputEpoch,
          sessionId: input.sessionId,
          ...range,
        })),
      );
    return {
      mode: 'remote',
      transport: 'subscription',
      consent: this.config().consent,
      configured: !!this.bin,
      model: 'ChatGPT Voice',
      active: !!s?.active,
      stage: s?.stage || 'stopped',
      error: this.error,
      ...(s ? { inputEpoch: s.inputEpoch, startedAt: s.startedAt } : {}),
      captured: s?.frame || 0,
      durable: s?.durable || 0,
      pending: unresolved.length,
      applied: this.applied,
      unresolved: unresolved.slice(0, 32),
    };
  }
  record(s, value) {
    if (this.ledgerFailed) return Promise.reject(Error('음성 복구 기록 저장이 중단됐습니다.'));
    if (++this.pendingWrites > 200) {
      this.pendingWrites--;
      this.ledgerFailed = true;
      void this.stop('ledger-backpressure');
      return Promise.reject(Error('음성 복구 기록 저장이 밀려 연결을 중단했습니다.'));
    }
    const at = this.now(),
      line =
        JSON.stringify({ at, sessionId: s.sessionId, inputEpoch: s.inputEpoch, ...value }) + '\n';
    const operation = this.writes.then(async () => {
      await mkdir(this.dir, { recursive: true });
      await appendFile(join(this.dir, `voice-${Math.floor(at / 60000)}.jsonl`), line, {
        mode: 0o600,
        flush: true,
      });
    });
    this.writes = operation
      .catch(() => {
        this.ledgerFailed = true;
        this.error = '음성 복구 기록을 저장하지 못해 전송을 중단했습니다.';
        void this.stop('ledger-failed');
      })
      .finally(() => {
        this.pendingWrites--;
      });
    return operation;
  }
  async restore() {
    if (!this.dir) return;
    try {
      const files = (
        await readdir(this.dir).catch((error) => {
          if (error.code === 'ENOENT') return [];
          throw error;
        })
      )
        .filter((file) => /^voice-\d+\.jsonl$/.test(file))
        .sort();
      let total = 0;
      const uncertain = new Map();
      for (const file of files) {
        const minute = Number(/^voice-(\d+)/.exec(file)[1]);
        if (this.now() - (minute + 1) * 60000 > RETENTION) continue;
        const details = await stat(join(this.dir, file));
        total += details.size;
        if (total > 64 * 1024 * 1024 || details.size > 4 * 1024 * 1024)
          throw Error('Voice journal capacity');
        for (const line of (await readFile(join(this.dir, file), 'utf8'))
          .split('\n')
          .filter(Boolean)) {
          const value = JSON.parse(line);
          const identity = Start.parse({
            sessionId: value.sessionId,
            inputEpoch: value.inputEpoch,
            startedAt: value.startedAt ?? value.at,
          });
          let s = this.inputs.get(value.inputEpoch);
          if (value.type === 'start') {
            s = this.create(identity);
            this.inputs.set(s.inputEpoch, s);
          }
          if (!s) continue;
          if (value.type === 'clock') {
            s.startedAt = value.startedAt;
            s.clock = true;
            s.monotonicMs = value.monotonicMs;
          }
          if (value.type === 'raw') {
            s.frame = Math.max(s.frame, value.startFrame + value.frameCount);
            s.durable = Math.max(s.durable, value.durableThrough);
            s.storedSequence = Math.max(s.storedSequence, value.sequence);
            if (value.capture.endedAt >= this.now() - SCREEN_RETENTION)
              s.contexts.set(value.startFrame, {
                sequence: value.sequence,
                startFrame: value.startFrame,
                frameCount: value.frameCount,
                capture: value.capture,
                sha256: value.sha256,
                hearers: value.hearers,
              });
          }
          if (value.type === 'delivery-plan')
            uncertain.set(value.plan.id, {
              input: s,
              frameStart: value.plan.frameStart,
              frameEnd: value.plan.frameEnd,
              status: 'delivery-uncertain',
              attempts: 2,
            });
          if (value.type === 'published') {
            uncertain.delete(value.id);
            s.publications.push({
              id: value.id,
              frameStart: value.frameStart,
              frameEnd: value.frameEnd,
            });
          }
          if (value.type === 'stopped' || value.type === 'unresolved')
            s.unresolved = value.ranges || [];
        }
      }
      for (const { input, ...range } of uncertain.values()) input.unresolved.push(range);
      for (const s of this.inputs.values()) {
        s.active = false;
        s.stage = 'stopped';
        this.markTail(s);
      }
    } catch {
      this.ledgerFailed = true;
      this.error = '보존된 구독 음성 기록을 읽지 못했습니다. 원본 파일은 보존했습니다.';
    }
  }
  async expire() {
    if (this.sweeping || this.now() - (this.lastSweep || 0) < 60000 || !this.dir) return;
    this.sweeping = true;
    this.lastSweep = this.now();
    try {
      for (const [key, s] of this.inputs) {
        if (!s.active && this.now() - s.startedAt > RETENTION) this.inputs.delete(key);
        for (const [frame, context] of s.contexts)
          if (this.now() - context.capture.endedAt > SCREEN_RETENTION) s.contexts.delete(frame);
      }
      for (const [id, run] of this.runs)
        if (!this.isRunActive(run) && run.stoppedAt && this.now() - run.stoppedAt > 10000)
          this.runs.delete(id);
      const files = await readdir(this.dir).catch((error) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
      for (const file of files) {
        const match = /^voice-(\d+)\.jsonl$/.exec(file);
        if (match && this.now() - (Number(match[1]) + 1) * 60000 > RETENTION)
          await unlink(join(this.dir, file));
      }
      const keep = new Set(
        [...this.inputs.values()].flatMap((s) =>
          [...s.contexts.values()]
            .filter((context) => context.capture.endedAt >= this.now() - SCREEN_RETENTION)
            .flatMap((context) =>
              (context.capture.screen?.frames || []).map(
                (frame) => frame.hash || digest(Buffer.from(frame.image.split(',')[1], 'base64')),
              ),
            ),
        ),
      );
      const images = await readdir(join(this.dir, 'screens')).catch((error) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
      for (const file of images) {
        const match = /^([a-f0-9]{64})\.(jpeg|png)$/.exec(file);
        if (match && !keep.has(match[1])) {
          const details = await stat(join(this.dir, 'screens', file));
          if (this.now() - details.mtimeMs > SCREEN_RETENTION)
            await unlink(join(this.dir, 'screens', file));
        }
      }
    } catch {
      if (!this.error) this.error = '만료된 음성 복구 기록의 정리를 미뤘습니다.';
    } finally {
      this.sweeping = false;
    }
  }
  async close() {
    if (this.closed) return;
    await this.stop('app-close');
    this.closed = true;
    clearInterval(this.timer);
    await this.writes;
  }
}
