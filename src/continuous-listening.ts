import { SubscriptionVoiceStream } from './subscription-voice.ts';
import { createCaptureContinuity } from '../shared/speech-listening.js';
import { SpeechListeningController } from '../server/speech-listening-controller.js';
import {
  ContinuousSpeechSegmenter,
  startContinuousMicrophone,
  type AudioFrames,
  type SpeechSegment,
} from './continuous-microphone.ts';
import { recognizeWithRecovery, type SpeechCapture } from './speech-flow.ts';
import { runSpeechOperation } from './speech-operation.ts';

const RATE = 16000,
  RAW_FRAMES = RATE,
  MAX_RETRY_MS = 30000,
  MAX_BACKLOG_BYTES = 64 * 1024 * 1024;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
type Pending = { sequence: number; startFrame: number; endFrame: number; capture: SpeechCapture };

export class ContinuousListening {
  readonly inputEpoch = crypto.randomUUID();
  readonly continuity = createCaptureContinuity({ sampleRate: RATE });
  readonly segmenter: ContinuousSpeechSegmenter;
  readonly controller: SpeechListeningController;
  rawParts: Int16Array[] = [];
  rawStart = 0;
  rawQueue: {
    sequence: number;
    startFrame: number;
    samples: Int16Array;
    capture?: SpeechCapture;
  }[] = [];
  segments: Pending[] = [];
  captures = new Map<number, SpeechCapture>();
  rawSequence = 0;
  speechSequence = 0;
  durableThrough = 0;
  queuedBytes = 0;
  uploading = false;
  captureStopped = false;
  stoppingCapture = false;
  captureFailure: Error | null = null;
  closed = false;
  backlogExceeded = false;
  storageError = false;
  storageFull = false;
  disposeCapture: (() => void) | null = null;
  subscription: SubscriptionVoiceStream | null = null;
  retryTimer: ReturnType<typeof setInterval> | null = null;
  finishTimer: ReturnType<typeof setInterval> | null = null;
  lastErrorAt = 0;
  stoppedAt = 0;
  startController = new AbortController();
  readonly drained: Promise<void>;
  resolveDrain: (() => void) | null = null;
  readonly options: {
    inputSource?: 'microphone' | 'system-output';
    remote?: boolean;
    signal?: AbortSignal;
    sessionId: string;
    track: MediaStreamTrack;
    onLevel: (value: number) => void;
    onTranscript: (text: string, capture: SpeechCapture, cues?: { delivery?: string }) => void;
    onError: (message: string) => void;
    onCaptureFailure?: (error?: Error) => void;
    onStorageFailure?: () => void;
    attachScreen?: (capture: SpeechCapture) => void;
  };
  constructor(options: {
    inputSource?: 'microphone' | 'system-output';
    remote?: boolean;
    signal?: AbortSignal;
    sessionId: string;
    track: MediaStreamTrack;
    onLevel: (value: number) => void;
    onTranscript: (text: string, capture: SpeechCapture, cues?: { delivery?: string }) => void;
    onError: (message: string) => void;
    onCaptureFailure?: (error?: Error) => void;
    onStorageFailure?: () => void;
    attachScreen?: (capture: SpeechCapture) => void;
  }) {
    this.options = options;
    this.drained = new Promise((resolve) => {
      this.resolveDrain = resolve;
    });
    this.segmenter = new ContinuousSpeechSegmenter(Date.now(), (segment) =>
      this.acceptSegment(segment),
    );
    this.controller = new SpeechListeningController({
      sessionId: options.sessionId,
      inputEpoch: this.inputEpoch,
      recognize: async (job) => {
        const request = async (signal: AbortSignal) => {
          const path = `/api/audio/raw/${options.sessionId}/${this.inputEpoch}?start=${job.frameStart}&end=${job.frameEnd}`;
          const saved = await fetch(path, { signal });
          if (!saved.ok) {
            const result = await saved.json();
            throw new Error(result.error || '보존된 원음을 읽지 못했습니다.');
          }
          const blob = await saved.blob();
          const response = await fetch('/api/audio', {
            method: 'POST',
            headers: { 'Content-Type': 'audio/wav', 'X-Backseat-Client': 'studio' },
            body: blob,
            signal,
          });
          const result = await response.json();
          if (!response.ok)
            throw Object.assign(new Error(result.error || '음성 인식 실패'), {
              needsPreparation: result.needsPreparation === true,
            });
          if (!result.text?.trim())
            throw new Error('말소리가 감지됐지만 전사되지 않았습니다. 보존된 원음을 재시도합니다.');
          return { status: 'final' as const, text: result.text, cues: result.cues };
        };
        try {
          return await runSpeechOperation(
            (signal) =>
              recognizeWithRecovery(
                () => request(signal),
                async () => {
                  const response = await fetch('/api/audio/prepare', {
                    method: 'POST',
                    headers: { 'X-Backseat-Client': 'studio' },
                    signal,
                  });
                  const result = await response.json();
                  if (!response.ok) throw new Error(result.error || '음성 인식 재연결 실패');
                },
                signal,
              ),
            {
              signal: job.signal,
              timeoutMs: 180000,
              timeoutMessage: '음성 인식 시간이 초과되어 원음으로 재시도합니다.',
            },
          );
        } catch (error) {
          this.report(
            error instanceof Error
              ? error.message
              : '음성 인식 실패 · 원음을 보존하고 재시도합니다.',
          );
          throw error;
        }
      },
      onCommit: (item) => {
        const capture = this.captures.get(item.sequence);
        this.captures.delete(item.sequence);
        if (item.status === 'final' && item.text && capture)
          this.options.onTranscript(
            item.text,
            capture,
            item.cues as { delivery?: string } | undefined,
          );
      },
    });
  }
  get endpoint(): 'native-audio' | 'subscription-sound' {
    return this.options.inputSource === 'system-output' ? 'subscription-sound' : 'native-audio';
  }
  async start() {
    const signal = AbortSignal.any([
      this.startController.signal,
      ...(this.options.signal ? [this.options.signal] : []),
    ]);
    signal.throwIfAborted();
    if (this.options.remote) {
      const response = await fetch(`/api/${this.endpoint}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Backseat-Client': 'studio' },
        body: JSON.stringify({
          sessionId: this.options.sessionId,
          inputEpoch: this.inputEpoch,
          startedAt: this.segmenter.wallStartedAt,
        }),
        signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '원격 원음 연결을 시작하지 못했습니다.');
      this.segmenter.wallStartedAt = result.startedAt;
      if (result.transport === 'subscription') {
        this.subscription = new SubscriptionVoiceStream({
          endpoint: this.endpoint,
          inputEpoch: this.inputEpoch,
          signal,
          onRecoveryError: (message) => this.report(message),
          onError: (message) => {
            this.captureFailure = new Error(message);
            this.report(message);
            this.stopCapture();
            this.options.onCaptureFailure?.(this.captureFailure);
          },
        });
        try {
          await this.subscription.connect();
        } catch (error) {
          this.subscription.close();
          throw error;
        }
      }
    }
    signal.throwIfAborted();
    let captureReady = !this.subscription;
    const startingFrames: AudioFrames[] = [];
    if (this.subscription) this.segmenter.wallStartedAt = Date.now();
    this.disposeCapture = await startContinuousMicrophone({
      track: this.options.track,
      onFrames: (frames) => {
        try {
          if (!captureReady) {
            startingFrames.push(frames);
            if (startingFrames.reduce((n, part) => n + part.samples.length, 0) > 32000)
              throw new Error('마이크 시작 시각 등록이 지연되어 중지했습니다.');
          } else this.acceptFrames(frames);
        } catch (error) {
          this.captureFailure =
            error instanceof Error ? error : new Error('연속 입력을 시작하지 못했습니다.');
          this.report(error instanceof Error ? error.message : '마이크 연속 캡처 오류');
          this.stopCapture();
          this.options.onCaptureFailure?.(this.captureFailure);
        }
      },
      onFailure: (error) => {
        this.captureFailure = error;
        this.report(error.message);
        this.stopCapture();
        this.options.onCaptureFailure?.(error);
      },
    });
    // A reader can fail before its asynchronously returned disposer is assigned.
    // Release it here as well and preserve that cause instead of a later RTP error.
    if (this.captureStopped || this.closed || signal.aborted) {
      this.disposeCapture?.();
      this.disposeCapture = null;
      throw this.captureFailure || new Error('음성 입력 시작을 취소했습니다.');
    }
    if (this.subscription) {
      try {
        await this.subscription.attach(this.options.track);
        await this.subscription.registerClock(this.segmenter.wallStartedAt);
        captureReady = true;
        for (const frames of startingFrames) this.acceptFrames(frames);
        startingFrames.length = 0;
        void this.subscription.recover();
      } catch (error) {
        this.stopCapture();
        throw error;
      }
    }
    if (this.closed) {
      this.disposeCapture();
      this.disposeCapture = null;
      return this;
    }
    if (!this.options.remote)
      this.retryTimer = setInterval(() => this.controller.retryFailed(), 5000);
    return this;
  }
  report(message: string) {
    if (Date.now() - this.lastErrorAt < 30000) return;
    this.lastErrorAt = Date.now();
    this.options.onError(message);
  }
  acceptFrames(frames: AudioFrames) {
    if (this.captureStopped) return;
    let rms: number | undefined;
    if (this.options.remote) {
      let power = 0;
      for (const sample of frames.samples) power += (sample / 32768) ** 2;
      rms = frames.samples.length ? Math.sqrt(power / frames.samples.length) : 0;
    } else rms = this.segmenter.add(frames);
    this.options.onLevel(Math.min(1, (rms || 0) * 8));
    this.rawParts.push(frames.samples.slice());
    const count = this.rawParts.reduce((n, part) => n + part.length, 0);
    if (count >= RAW_FRAMES) this.flushRaw();
  }
  flushRaw() {
    const count = this.rawParts.reduce((n, part) => n + part.length, 0);
    if (!count) return;
    const samples = new Int16Array(count);
    let offset = 0;
    for (const part of this.rawParts) {
      samples.set(part, offset);
      offset += part.length;
    }
    this.rawParts = [];
    const capture = {
      startedAt: this.segmenter.wallStartedAt + (this.rawStart / RATE) * 1000,
      endedAt: this.segmenter.wallStartedAt + ((this.rawStart + count) / RATE) * 1000,
    };
    if (this.options.remote) this.options.attachScreen?.(capture);
    const entry = {
      sequence: ++this.rawSequence,
      startFrame: this.rawStart,
      samples,
      ...(this.options.remote ? { capture } : {}),
    };
    this.rawStart += count;
    this.continuity.append({
      sequence: entry.sequence,
      startFrame: entry.startFrame,
      frameCount: count,
    });
    this.rawQueue.push(entry);
    this.queuedBytes += samples.byteLength;
    void this.uploadRaw();
    // Recognition lag never stops capture. This bound applies only after raw
    // storage itself has failed; those unsaved bytes would be lost on exit.
    if (this.storageError && this.queuedBytes > MAX_BACKLOG_BYTES && !this.backlogExceeded) {
      this.backlogExceeded = true;
      this.options.onError(
        '원음 저장 장치가 오래 실패해 미저장 음성이 메모리 한도에 도달했습니다. 마이크를 중지했습니다. 앱을 종료하면 미저장 원음은 복구할 수 없습니다.',
      );
      this.options.onStorageFailure?.();
    }
  }
  async uploadRaw() {
    if (this.uploading || this.closed || this.storageFull) return;
    this.uploading = true;
    let delay = 1000;
    try {
      while (this.rawQueue.length && !this.closed) {
        const entry = this.rawQueue[0];
        try {
          const append =
            typeof window === 'undefined' ? undefined : window.backseat?.appendSpeechRaw;
          let result: { durableThrough: number; storageNearlyFull?: boolean };
          if (append) {
            const bytes = new Uint8Array(
              entry.samples.buffer,
              entry.samples.byteOffset,
              entry.samples.byteLength,
            );
            result = await append({
              sessionId: this.options.sessionId,
              inputEpoch: this.inputEpoch,
              sequence: entry.sequence,
              startFrame: entry.startFrame,
              frameCount: entry.samples.length,
              data: bytes,
              ...(entry.capture ? { capture: entry.capture } : {}),
            });
          } else {
            if (entry.capture) {
              const contextResponse = await fetch(`/api/${this.endpoint}/context`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Backseat-Client': 'studio' },
                body: JSON.stringify({
                  sessionId: this.options.sessionId,
                  inputEpoch: this.inputEpoch,
                  startFrame: entry.startFrame,
                  capture: entry.capture,
                }),
              });
              if (!contextResponse.ok)
                this.report('발언 당시 화면 근거를 전달하지 못했습니다. 원음 저장은 계속합니다.');
            }
            const response = await fetch('/api/audio/raw', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/octet-stream',
                'X-Backseat-Client': 'studio',
                'X-Speech-Session': this.options.sessionId,
                'X-Speech-Epoch': this.inputEpoch,
                'X-Speech-Sequence': String(entry.sequence),
                'X-Speech-Frame': String(entry.startFrame),
                'X-Speech-Count': String(entry.samples.length),
              },
              body: entry.samples.buffer.slice(0) as ArrayBuffer,
            });
            result = await response.json();
            if (!response.ok)
              throw new Error((result as { error?: string }).error || '마이크 원음 저장 실패');
          }
          this.durableThrough = result.durableThrough;
          this.continuity.advanceDurable(this.durableThrough);
          this.rawQueue.shift();
          this.queuedBytes -= entry.samples.byteLength;
          this.storageError = false;
          this.releaseSegments();
          delay = 1000;
          if (result.storageNearlyFull && !this.captureStopped) {
            this.options.onError(
              '원음 보관 용량이 거의 가득 차서 음성 입력을 중지했습니다. 마지막 원음을 보존하고 있습니다. 지난 원음을 정리하거나 보관 용량을 늘려주세요.',
            );
            this.stopCapture();
            this.options.onStorageFailure?.();
          }
        } catch (error) {
          this.storageError = true;
          if (error instanceof Error && /원음 보관 용량이 가득/.test(error.message)) {
            this.storageFull = true;
            this.stopCapture();
            this.options.onStorageFailure?.();
            this.options.onError(
              error.message + ' 아직 저장하지 못한 마지막 원음이 메모리에 남아 있습니다.',
            );
            return;
          }
          this.report(
            (error instanceof Error ? error.message : '마이크 원음 저장 실패') +
              ' 원음을 메모리에 유지하며 다시 시도합니다.',
          );
          await wait(delay);
          delay = Math.min(MAX_RETRY_MS, delay * 2);
        }
      }
    } finally {
      this.uploading = false;
    }
  }
  acceptSegment(segment: SpeechSegment) {
    const capture = segment.capture;
    this.options.attachScreen?.(capture);
    this.segments.push({
      sequence: ++this.speechSequence,
      startFrame: segment.startFrame,
      endFrame: segment.endFrame,
      capture,
    });
    this.releaseSegments();
  }
  releaseSegments() {
    while (this.segments.length && this.segments[0].endFrame <= this.durableThrough) {
      const segment = this.segments.shift()!;
      this.captures.set(segment.sequence, segment.capture);
      this.controller.enqueue({
        sequence: segment.sequence,
        utteranceId: crypto.randomUUID(),
        frameStart: segment.startFrame,
        frameEnd: segment.endFrame,
        sourceRef: `${this.options.sessionId}/${this.inputEpoch}/${segment.startFrame}-${segment.endFrame}`,
      });
    }
  }
  stopCapture() {
    if (this.captureStopped || this.stoppingCapture) return;
    this.stoppingCapture = true;
    this.startController.abort();
    this.subscription?.close();
    const dispose = this.disposeCapture;
    this.disposeCapture = null;
    dispose?.();
    this.captureStopped = true;
    if (this.options.remote)
      void fetch(`/api/${this.endpoint}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Backseat-Client': 'studio' },
        body: JSON.stringify({ inputEpoch: this.inputEpoch }),
      }).catch(() =>
        this.report('원격 청취 중단을 확인하지 못했습니다. 방송 종료로 연결을 중단해주세요.'),
      );
    this.segmenter.finish();
    this.flushRaw();
    this.stoppedAt = Date.now();
    this.finishTimer = setInterval(() => {
      if (
        !this.rawQueue.length &&
        !this.uploading &&
        !this.segments.length &&
        !this.captures.size
      ) {
        this.close();
        return;
      }
      if (Date.now() - this.stoppedAt >= 600000) {
        this.options.onError(
          '마이크 연결 종료 후에도 처리되지 않은 발언이 있습니다. 최근 24시간의 로컬 원음 파일에서 복구할 수 있습니다.',
        );
        this.close();
      }
    }, 1000);
  }
  close() {
    if (this.closed) return;
    if (!this.captureStopped) this.stopCapture();
    this.closed = true;
    if (this.retryTimer) clearInterval(this.retryTimer);
    if (this.finishTimer) clearInterval(this.finishTimer);
    this.controller.close();
    this.resolveDrain?.();
    this.resolveDrain = null;
  }
  status() {
    return {
      captured: this.continuity.snapshot().latestCapturedFrame,
      durable: this.durableThrough,
      rawQueued: this.rawQueue.length,
      speechQueued: this.segments.length,
      recognition: this.controller.snapshot(),
    };
  }
}
