import { VoiceBoundary, VOICE_MAX_MS, type SpeechCapture } from './speech-flow.ts';

export const CONTINUOUS_SPEECH_RATE = 16000;
export type AudioFrames = { startFrame: number; samples: Int16Array };
export type SpeechSegment = {
  startFrame: number;
  endFrame: number;
  blob: Blob;
  capture: SpeechCapture;
};

export function wavFromPcm(
  parts: readonly Int16Array[],
  sampleRate = CONTINUOUS_SPEECH_RATE,
): Blob {
  const length = parts.reduce((sum, part) => sum + part.length, 0),
    header = new ArrayBuffer(44),
    view = new DataView(header);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, length * 2, true);
  return new Blob([header, ...parts.map((part) => part.slice().buffer)], { type: 'audio/wav' });
}

// A single sample stream is segmented without stopping or replacing the
// capture node. Raw frames must be stored by the caller before recognition.
export class ContinuousSpeechSegmenter {
  nextFrame = 0;
  windowStart = 0;
  parts: Int16Array[] = [];
  boundary = new VoiceBoundary(0);
  wallStartedAt: number;
  readonly onSegment: (segment: SpeechSegment) => void;
  constructor(wallStartedAt: number, onSegment: (segment: SpeechSegment) => void) {
    this.wallStartedAt = wallStartedAt;
    this.onSegment = onSegment;
  }
  add({ startFrame, samples }: AudioFrames) {
    if (startFrame !== this.nextFrame)
      throw new Error(`마이크 원음 구간이 이어지지 않습니다: ${this.nextFrame} → ${startFrame}`);
    if (!samples.length) return;
    this.parts.push(samples.slice());
    this.nextFrame += samples.length;
    const now = (this.nextFrame / CONTINUOUS_SPEECH_RATE) * 1000;
    let power = 0;
    for (const sample of samples) power += (sample / 32768) ** 2;
    const rms = Math.sqrt(power / samples.length);
    const reason = this.boundary.sample(rms, now);
    if (reason || now - (this.windowStart / CONTINUOUS_SPEECH_RATE) * 1000 >= VOICE_MAX_MS)
      this.finish();
    return rms;
  }
  finish() {
    const capture = this.boundary.capture(
      this.wallStartedAt + (this.windowStart / CONTINUOUS_SPEECH_RATE) * 1000,
    );
    if (this.boundary.hasSpeech && capture && this.parts.length)
      this.onSegment({
        startFrame: this.windowStart,
        endFrame: this.nextFrame,
        blob: wavFromPcm(this.parts),
        capture,
      });
    this.parts = [];
    this.windowStart = this.nextFrame;
    this.boundary = new VoiceBoundary((this.nextFrame / CONTINUOUS_SPEECH_RATE) * 1000);
  }
}

// Read from the capture track's clock. A hidden Electron window can advance
// its AudioContext clock slower than wall time even while the mic track itself
// delivers every frame, so an AudioWorklet is not the durable capture source.
export class ContinuousPcmEncoder {
  readonly targetRate = CONTINUOUS_SPEECH_RATE;
  sourceRate = 0;
  phase = 0;
  sum = 0;
  count = 0;
  frame = 0;
  pending = new Int16Array(1600);
  length = 0;
  push(samples: Float32Array, sampleRate: number, onFrames: (frames: AudioFrames) => void) {
    if (!Number.isFinite(sampleRate) || sampleRate < this.targetRate)
      throw new Error('지원하지 않는 마이크 샘플 속도입니다.');
    if (this.sourceRate && this.sourceRate !== sampleRate)
      throw new Error('마이크 샘플 속도가 녹음 중 바뀌었습니다.');
    this.sourceRate = sampleRate;
    for (const sample of samples) {
      this.sum += sample;
      this.count++;
      this.phase += this.targetRate / sampleRate;
      if (this.phase < 1) continue;
      this.phase -= 1;
      const value = Math.max(-1, Math.min(1, this.sum / this.count));
      this.pending[this.length++] = Math.round(value < 0 ? value * 32768 : value * 32767);
      this.sum = 0;
      this.count = 0;
      if (this.length === this.pending.length) {
        const output = this.pending,
          startFrame = this.frame;
        this.frame += output.length;
        this.pending = new Int16Array(1600);
        this.length = 0;
        onFrames({ startFrame, samples: output });
      }
    }
  }
  finish(onFrames: (frames: AudioFrames) => void) {
    if (this.length) {
      const output = this.pending.slice(0, this.length),
        startFrame = this.frame;
      this.frame += output.length;
      this.length = 0;
      onFrames({ startFrame, samples: output });
    }
  }
}

type CapturedAudioData = {
  numberOfFrames: number;
  numberOfChannels: number;
  sampleRate: number;
  timestamp: number;
  copyTo: (
    destination: Float32Array,
    options: { planeIndex: number; format: 'f32-planar' },
  ) => void;
  close: () => void;
};
type TrackProcessor = { readable: ReadableStream<CapturedAudioData> };

export async function startContinuousMicrophone(options: {
  track: MediaStreamTrack;
  onFrames: (frames: AudioFrames) => void;
  onFailure: (error: Error) => void;
}) {
  const Constructor = (
    globalThis as typeof globalThis & {
      MediaStreamTrackProcessor?: new (options: { track: MediaStreamTrack }) => TrackProcessor;
    }
  ).MediaStreamTrackProcessor;
  if (!Constructor) throw new Error('연속 마이크 입력을 지원하지 않는 실행 환경입니다.');
  const clone = options.track.clone(),
    processor = new Constructor({ track: clone }),
    reader = processor.readable.getReader();
  const encoder = new ContinuousPcmEncoder();
  let stopped = false,
    lastEndUs: number | null = null;
  void (async () => {
    try {
      while (!stopped) {
        const { value, done } = await reader.read();
        if (done) break;
        try {
          if (lastEndUs !== null && Math.abs(value.timestamp - lastEndUs) > 5000)
            throw new Error('마이크 장치 입력 시간이 이어지지 않습니다.');
          lastEndUs = value.timestamp + (value.numberOfFrames / value.sampleRate) * 1_000_000;
          if (value.numberOfChannels < 1) throw new Error('마이크 입력 채널이 없습니다.');
          const mono = new Float32Array(value.numberOfFrames);
          for (let channel = 0; channel < value.numberOfChannels; channel++) {
            const plane = new Float32Array(value.numberOfFrames);
            value.copyTo(plane, { planeIndex: channel, format: 'f32-planar' });
            for (let index = 0; index < plane.length; index++)
              mono[index] += plane[index] / value.numberOfChannels;
          }
          encoder.push(mono, value.sampleRate, options.onFrames);
        } finally {
          value.close();
        }
      }
      if (!stopped) throw new Error('마이크 입력 스트림이 종료되었습니다.');
    } catch (error) {
      if (!stopped) options.onFailure(error instanceof Error ? error : new Error(String(error)));
    }
  })();
  return () => {
    if (stopped) return;
    stopped = true;
    clone.stop();
    void reader.cancel().catch(() => {});
    encoder.finish(options.onFrames);
  };
}
