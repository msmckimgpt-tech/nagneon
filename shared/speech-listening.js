const UPDATE_STATUSES = new Set(['partial', 'final', 'empty', 'failed', 'cancelled']);
const RESOLVED_STATUSES = new Set(['final', 'empty', 'cancelled']);
const ATTEMPT_TERMINAL_STATUSES = new Set(['final', 'empty', 'failed', 'cancelled']);

function integer(value, name, min = 0) {
  if (!Number.isSafeInteger(value) || value < min)
    throw new TypeError(`${name} must be an integer >= ${min}`);
  return value;
}
function nonEmpty(value, name) {
  if (typeof value !== 'string' || !value)
    throw new TypeError(`${name} must be a non-empty string`);
  return value;
}
function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}
function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function generationMatches(expected, value) {
  return value?.sessionId === expected.sessionId && value?.inputEpoch === expected.inputEpoch;
}

export function createCaptureContinuity({ sampleRate }) {
  integer(sampleRate, 'sampleRate', 1);
  let nextSequence = 1,
    latestCapturedFrame = 0,
    durableThrough = 0,
    recognizedThrough = 0;
  const chunks = new Map(),
    discontinuities = [];

  const snapshot = () => ({
    sampleRate,
    nextSequence,
    latestCapturedFrame,
    durableThrough,
    recognizedThrough,
    backlogFrames: Math.max(0, latestCapturedFrame - recognizedThrough),
    discontinuities: clone(discontinuities),
    chunks: [...chunks.values()].map(clone),
  });

  return {
    append({ sequence, startFrame, frameCount }) {
      integer(sequence, 'sequence', 1);
      integer(startFrame, 'startFrame');
      integer(frameCount, 'frameCount', 1);
      const value = { sequence, startFrame, frameCount, endFrame: startFrame + frameCount },
        prior = chunks.get(sequence);
      if (prior) {
        if (same(prior, value)) return { duplicate: true, value: clone(prior) };
        throw new Error('같은 오디오 순번의 범위가 달라졌습니다.');
      }
      if (sequence !== nextSequence)
        throw new Error(
          `오디오 순번이 연속되지 않습니다. expected=${nextSequence} actual=${sequence}`,
        );
      if (startFrame !== latestCapturedFrame)
        discontinuities.push({
          sequence,
          expectedFrame: latestCapturedFrame,
          actualFrame: startFrame,
          missingFrames: Math.max(0, startFrame - latestCapturedFrame),
          overlapFrames: Math.max(0, latestCapturedFrame - startFrame),
        });
      chunks.set(sequence, value);
      nextSequence++;
      latestCapturedFrame = Math.max(latestCapturedFrame, value.endFrame);
      return { duplicate: false, value: clone(value) };
    },
    advanceDurable(frame) {
      integer(frame, 'durable frame');
      if (frame > latestCapturedFrame)
        throw new RangeError('확보하지 않은 오디오까지 저장 완료로 표시할 수 없습니다.');
      if (frame < durableThrough) return false;
      durableThrough = frame;
      return true;
    },
    advanceRecognized(frame) {
      integer(frame, 'recognized frame');
      if (frame > latestCapturedFrame)
        throw new RangeError('확보하지 않은 오디오까지 인식 완료로 표시할 수 없습니다.');
      if (frame < recognizedThrough) return false;
      recognizedThrough = frame;
      return true;
    },
    snapshot,
  };
}

export function createSpeechRevisionTimeline({ sessionId, inputEpoch, firstSequence = 1 }) {
  const generation = {
    sessionId: nonEmpty(sessionId, 'sessionId'),
    inputEpoch: nonEmpty(inputEpoch, 'inputEpoch'),
  };
  integer(firstSequence, 'firstSequence', 1);
  const items = new Map(),
    utteranceIds = new Map();
  let nextCommitSequence = firstSequence;

  const publicItem = (item) => ({
    sessionId: generation.sessionId,
    inputEpoch: generation.inputEpoch,
    sequence: item.sequence,
    utteranceId: item.utteranceId,
    frameStart: item.frameStart,
    frameEnd: item.frameEnd,
    revision: item.revision,
    status: item.status,
    text: item.text,
    cues: clone(item.cues),
    errorCode: item.errorCode,
    cancelReason: item.cancelReason,
    attemptId: item.activeAttemptId,
    attemptNo: item.attemptNo,
    committed: item.committed,
  });
  const stale = (reason) => ({ accepted: false, stale: true, reason });
  const itemFor = (sequence) => {
    integer(sequence, 'sequence', 1);
    const item = items.get(sequence);
    if (!item) throw new Error(`등록되지 않은 발언 순번입니다: ${sequence}`);
    return item;
  };
  const validateOrder = (candidate) => {
    for (const item of items.values()) {
      if (item.sequence < candidate.sequence && item.frameStart > candidate.frameStart)
        throw new Error('발언 순번과 원본 오디오 시작 위치가 역전되었습니다.');
      if (item.sequence > candidate.sequence && item.frameStart < candidate.frameStart)
        throw new Error('발언 순번과 원본 오디오 시작 위치가 역전되었습니다.');
    }
  };

  return {
    register(value) {
      if (!generationMatches(generation, value)) return stale('generation');
      integer(value.sequence, 'sequence', 1);
      nonEmpty(value.utteranceId, 'utteranceId');
      integer(value.frameStart, 'frameStart');
      integer(value.frameEnd, 'frameEnd', 1);
      if (value.frameEnd <= value.frameStart)
        throw new RangeError('발언 종료 위치는 시작 위치보다 뒤여야 합니다.');
      const existing = items.get(value.sequence);
      if (existing) {
        if (
          existing.utteranceId === value.utteranceId &&
          existing.frameStart === value.frameStart &&
          existing.frameEnd === value.frameEnd
        )
          return { accepted: true, duplicate: true, item: publicItem(existing) };
        throw new Error('같은 발언 순번의 식별 정보가 달라졌습니다.');
      }
      const otherSequence = utteranceIds.get(value.utteranceId);
      if (otherSequence !== undefined)
        throw new Error('같은 발언 ID를 다른 순번에 재사용할 수 없습니다.');
      const item = {
        sequence: value.sequence,
        utteranceId: value.utteranceId,
        frameStart: value.frameStart,
        frameEnd: value.frameEnd,
        revision: 0,
        status: 'pending',
        text: '',
        cues: undefined,
        errorCode: undefined,
        cancelReason: undefined,
        activeAttemptId: null,
        attemptNo: 0,
        committed: false,
      };
      validateOrder(item);
      items.set(item.sequence, item);
      utteranceIds.set(item.utteranceId, item.sequence);
      return { accepted: true, duplicate: false, item: publicItem(item) };
    },
    startAttempt(value) {
      if (!generationMatches(generation, value)) return stale('generation');
      const item = itemFor(value.sequence);
      nonEmpty(value.attemptId, 'attemptId');
      if (item.committed) throw new Error('이미 순서 확정된 발언은 다시 인식할 수 없습니다.');
      if (item.activeAttemptId === value.attemptId)
        return { accepted: true, duplicate: true, item: publicItem(item) };
      item.activeAttemptId = value.attemptId;
      item.attemptNo++;
      item.status = 'pending';
      item.errorCode = undefined;
      item.cancelReason = undefined;
      return { accepted: true, duplicate: false, item: publicItem(item) };
    },
    apply(value) {
      if (!generationMatches(generation, value)) return stale('generation');
      const item = itemFor(value.sequence);
      nonEmpty(value.attemptId, 'attemptId');
      integer(value.revision, 'revision', 1);
      if (item.activeAttemptId !== value.attemptId) return stale('attempt');
      if (item.committed) return stale('committed');
      if (!UPDATE_STATUSES.has(value.status))
        throw new TypeError('알 수 없는 발언 인식 상태입니다.');
      const text = value.text ?? '';
      if (typeof text !== 'string') throw new TypeError('발언 전사는 문자열이어야 합니다.');
      if (value.status === 'empty' && text)
        throw new Error('정상 빈 전사는 텍스트를 포함할 수 없습니다.');
      if ((value.status === 'partial' || value.status === 'final') && !text)
        throw new Error('부분/확정 전사는 빈 텍스트일 수 없습니다.');
      const candidate = {
        revision: value.revision,
        status: value.status,
        text,
        cues: clone(value.cues),
        errorCode: value.errorCode,
        cancelReason: value.cancelReason,
      };
      if (value.revision < item.revision) return stale('revision');
      if (value.revision === item.revision) {
        const prior = {
          revision: item.revision,
          status: item.status,
          text: item.text,
          cues: item.cues,
          errorCode: item.errorCode,
          cancelReason: item.cancelReason,
        };
        if (same(prior, candidate))
          return { accepted: true, duplicate: true, item: publicItem(item) };
        throw new Error('같은 발언 revision의 내용이 달라졌습니다.');
      }
      if (ATTEMPT_TERMINAL_STATUSES.has(item.status))
        throw new Error('종료된 인식 시도는 새 revision으로 되돌릴 수 없습니다.');
      item.revision = candidate.revision;
      item.status = candidate.status;
      item.text = candidate.text;
      item.cues = candidate.cues;
      item.errorCode = candidate.errorCode;
      item.cancelReason = candidate.cancelReason;
      return { accepted: true, duplicate: false, item: publicItem(item) };
    },
    drainReady() {
      const ready = [];
      while (true) {
        const item = items.get(nextCommitSequence);
        if (!item || !RESOLVED_STATUSES.has(item.status)) break;
        item.committed = true;
        ready.push(publicItem(item));
        nextCommitSequence++;
      }
      return ready;
    },
    snapshot() {
      return {
        sessionId: generation.sessionId,
        inputEpoch: generation.inputEpoch,
        nextCommitSequence,
        items: [...items.values()].sort((a, b) => a.sequence - b.sequence).map(publicItem),
      };
    },
  };
}
