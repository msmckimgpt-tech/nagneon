export type SpeechGeneration = { sessionId: string; inputEpoch: string };
export type SpeechUpdateStatus = 'partial' | 'final' | 'empty' | 'failed' | 'cancelled';
export type SpeechTimelineItem = SpeechGeneration & {
  sequence: number;
  utteranceId: string;
  frameStart: number;
  frameEnd: number;
  revision: number;
  status: 'pending' | SpeechUpdateStatus;
  text: string;
  cues?: unknown;
  errorCode?: string;
  cancelReason?: string;
  attemptId: string | null;
  attemptNo: number;
  committed: boolean;
};

export declare function createCaptureContinuity(options: { sampleRate: number }): {
  append: (value: { sequence: number; startFrame: number; frameCount: number }) => {
    duplicate: boolean;
    value: { sequence: number; startFrame: number; frameCount: number; endFrame: number };
  };
  advanceDurable: (frame: number) => boolean;
  advanceRecognized: (frame: number) => boolean;
  snapshot: () => {
    sampleRate: number;
    nextSequence: number;
    latestCapturedFrame: number;
    durableThrough: number;
    recognizedThrough: number;
    backlogFrames: number;
    discontinuities: Array<{
      sequence: number;
      expectedFrame: number;
      actualFrame: number;
      missingFrames: number;
      overlapFrames: number;
    }>;
    chunks: Array<{ sequence: number; startFrame: number; frameCount: number; endFrame: number }>;
  };
};

export declare function createSpeechRevisionTimeline(
  options: SpeechGeneration & { firstSequence?: number },
): {
  register: (
    value: SpeechGeneration & {
      sequence: number;
      utteranceId: string;
      frameStart: number;
      frameEnd: number;
    },
  ) => {
    accepted: boolean;
    stale?: boolean;
    reason?: string;
    duplicate?: boolean;
    item?: SpeechTimelineItem;
  };
  startAttempt: (value: SpeechGeneration & { sequence: number; attemptId: string }) => {
    accepted: boolean;
    stale?: boolean;
    reason?: string;
    duplicate?: boolean;
    item?: SpeechTimelineItem;
  };
  apply: (
    value: SpeechGeneration & {
      sequence: number;
      attemptId: string;
      revision: number;
      status: SpeechUpdateStatus;
      text?: string;
      cues?: unknown;
      errorCode?: string;
      cancelReason?: string;
    },
  ) => {
    accepted: boolean;
    stale?: boolean;
    reason?: string;
    duplicate?: boolean;
    item?: SpeechTimelineItem;
  };
  drainReady: () => SpeechTimelineItem[];
  snapshot: () => SpeechGeneration & { nextCommitSequence: number; items: SpeechTimelineItem[] };
};
