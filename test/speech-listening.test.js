import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCaptureContinuity,
  createSpeechRevisionTimeline,
} from '../shared/speech-listening.js';

const gen = { sessionId: 'session-1', inputEpoch: 'input-1' };
const utterance = (sequence, frameStart = sequence * 100) => ({
  ...gen,
  sequence,
  utteranceId: 'u' + sequence,
  frameStart,
  frameEnd: frameStart + 80,
});

test('capture continuity never drops accepted chunks and records gaps explicitly', () => {
  const capture = createCaptureContinuity({ sampleRate: 48000 });
  assert.equal(capture.append({ sequence: 1, startFrame: 0, frameCount: 480 }).duplicate, false);
  assert.equal(capture.append({ sequence: 1, startFrame: 0, frameCount: 480 }).duplicate, true);
  capture.append({ sequence: 2, startFrame: 520, frameCount: 480 });
  const state = capture.snapshot();
  assert.equal(state.latestCapturedFrame, 1000);
  assert.equal(state.discontinuities.length, 1);
  assert.deepEqual(state.discontinuities[0], {
    sequence: 2,
    expectedFrame: 480,
    actualFrame: 520,
    missingFrames: 40,
    overlapFrames: 0,
  });
  assert.throws(
    () => capture.append({ sequence: 4, startFrame: 1000, frameCount: 10 }),
    /연속되지/,
  );
  assert.throws(
    () => capture.append({ sequence: 2, startFrame: 520, frameCount: 481 }),
    /범위가 달라/,
  );
});

test('capture processing cursors are monotonic and cannot claim unseen audio', () => {
  const capture = createCaptureContinuity({ sampleRate: 16000 });
  capture.append({ sequence: 1, startFrame: 0, frameCount: 1600 });
  assert.equal(capture.advanceDurable(1000), true);
  assert.equal(capture.advanceDurable(900), false);
  assert.equal(capture.advanceRecognized(800), true);
  assert.equal(capture.advanceRecognized(700), false);
  assert.throws(() => capture.advanceDurable(1601), /확보하지 않은/);
  assert.throws(() => capture.advanceRecognized(1601), /확보하지 않은/);
  assert.equal(capture.snapshot().backlogFrames, 800);
});

test('out-of-order recognition completion commits only the contiguous original order', () => {
  const timeline = createSpeechRevisionTimeline(gen);
  for (const sequence of [1, 2, 3]) {
    timeline.register(utterance(sequence));
    timeline.startAttempt({ ...gen, sequence, attemptId: 'a' + sequence });
  }
  timeline.apply({
    ...gen,
    sequence: 3,
    attemptId: 'a3',
    revision: 1,
    status: 'final',
    text: '셋',
  });
  assert.deepEqual(timeline.drainReady(), []);
  timeline.apply({
    ...gen,
    sequence: 1,
    attemptId: 'a1',
    revision: 1,
    status: 'final',
    text: '하나',
  });
  assert.deepEqual(
    timeline.drainReady().map((x) => x.sequence),
    [1],
  );
  timeline.apply({
    ...gen,
    sequence: 2,
    attemptId: 'a2',
    revision: 1,
    status: 'final',
    text: '둘',
  });
  assert.deepEqual(
    timeline.drainReady().map((x) => x.sequence),
    [2, 3],
  );
});

test('partial revisions update one utterance without becoming an ordered commit', () => {
  const timeline = createSpeechRevisionTimeline(gen);
  timeline.register(utterance(1));
  timeline.startAttempt({ ...gen, sequence: 1, attemptId: 'attempt' });
  timeline.apply({
    ...gen,
    sequence: 1,
    attemptId: 'attempt',
    revision: 1,
    status: 'partial',
    text: '민수한테',
  });
  timeline.apply({
    ...gen,
    sequence: 1,
    attemptId: 'attempt',
    revision: 2,
    status: 'partial',
    text: '민수 말고',
  });
  assert.deepEqual(timeline.drainReady(), []);
  timeline.apply({
    ...gen,
    sequence: 1,
    attemptId: 'attempt',
    revision: 3,
    status: 'final',
    text: '민수 말고 민지한테',
  });
  const [done] = timeline.drainReady();
  assert.equal(done.text, '민수 말고 민지한테');
  assert.equal(done.revision, 3);
});

test('a failed head blocks later speech until the same utterance succeeds on a new attempt', () => {
  const timeline = createSpeechRevisionTimeline(gen);
  timeline.register(utterance(1));
  timeline.register(utterance(2));
  timeline.startAttempt({ ...gen, sequence: 1, attemptId: 'first' });
  timeline.startAttempt({ ...gen, sequence: 2, attemptId: 'second' });
  timeline.apply({
    ...gen,
    sequence: 1,
    attemptId: 'first',
    revision: 1,
    status: 'failed',
    errorCode: 'WORKER_EXIT',
  });
  timeline.apply({
    ...gen,
    sequence: 2,
    attemptId: 'second',
    revision: 1,
    status: 'final',
    text: '뒤 발언',
  });
  assert.deepEqual(timeline.drainReady(), []);
  timeline.startAttempt({ ...gen, sequence: 1, attemptId: 'retry' });
  timeline.apply({
    ...gen,
    sequence: 1,
    attemptId: 'retry',
    revision: 2,
    status: 'final',
    text: '앞 발언',
  });
  assert.deepEqual(
    timeline.drainReady().map((x) => x.text),
    ['앞 발언', '뒤 발언'],
  );
});

test('late results from retired attempts and old input generations are ignored', () => {
  const timeline = createSpeechRevisionTimeline(gen);
  timeline.register(utterance(1));
  timeline.startAttempt({ ...gen, sequence: 1, attemptId: 'old' });
  timeline.apply({
    ...gen,
    sequence: 1,
    attemptId: 'old',
    revision: 1,
    status: 'failed',
    errorCode: 'TIMEOUT',
  });
  timeline.startAttempt({ ...gen, sequence: 1, attemptId: 'new' });
  assert.deepEqual(
    timeline.apply({
      ...gen,
      sequence: 1,
      attemptId: 'old',
      revision: 2,
      status: 'final',
      text: '늦은 결과',
    }),
    { accepted: false, stale: true, reason: 'attempt' },
  );
  assert.deepEqual(
    timeline.apply({
      sessionId: 'session-1',
      inputEpoch: 'old-input',
      sequence: 1,
      attemptId: 'new',
      revision: 2,
      status: 'final',
      text: '구세대',
    }),
    { accepted: false, stale: true, reason: 'generation' },
  );
  timeline.apply({
    ...gen,
    sequence: 1,
    attemptId: 'new',
    revision: 2,
    status: 'final',
    text: '정상 결과',
  });
  assert.equal(timeline.drainReady()[0].text, '정상 결과');
});

test('same revision retries are idempotent but conflicting payloads are rejected', () => {
  const timeline = createSpeechRevisionTimeline(gen);
  timeline.register(utterance(1));
  timeline.startAttempt({ ...gen, sequence: 1, attemptId: 'a' });
  const value = {
    ...gen,
    sequence: 1,
    attemptId: 'a',
    revision: 1,
    status: 'partial',
    text: '같은 내용',
  };
  assert.equal(timeline.apply(value).duplicate, false);
  assert.equal(timeline.apply(value).duplicate, true);
  assert.throws(() => timeline.apply({ ...value, text: '다른 내용' }), /revision의 내용이 달라/);
});

test('empty transcription, explicit cancellation and recognition failure remain distinct', () => {
  const timeline = createSpeechRevisionTimeline(gen);
  for (const sequence of [1, 2, 3]) {
    timeline.register(utterance(sequence));
    timeline.startAttempt({ ...gen, sequence, attemptId: 'a' + sequence });
  }
  timeline.apply({ ...gen, sequence: 1, attemptId: 'a1', revision: 1, status: 'empty' });
  timeline.apply({
    ...gen,
    sequence: 2,
    attemptId: 'a2',
    revision: 1,
    status: 'cancelled',
    cancelReason: 'user',
  });
  timeline.apply({
    ...gen,
    sequence: 3,
    attemptId: 'a3',
    revision: 1,
    status: 'failed',
    errorCode: 'MODEL_ERROR',
  });
  assert.deepEqual(
    timeline.drainReady().map((x) => x.status),
    ['empty', 'cancelled'],
  );
  assert.equal(timeline.snapshot().nextCommitSequence, 3);
  assert.throws(
    () =>
      timeline.apply({
        ...gen,
        sequence: 3,
        attemptId: 'a3',
        revision: 2,
        status: 'empty',
        text: 'not empty',
      }),
    /빈 전사/,
  );
});

test('terminal attempt state cannot regress to a later partial or alternate final revision', () => {
  const timeline = createSpeechRevisionTimeline(gen);
  timeline.register(utterance(1));
  timeline.startAttempt({ ...gen, sequence: 1, attemptId: 'a' });
  timeline.apply({
    ...gen,
    sequence: 1,
    attemptId: 'a',
    revision: 1,
    status: 'final',
    text: '확정',
  });
  assert.throws(
    () =>
      timeline.apply({
        ...gen,
        sequence: 1,
        attemptId: 'a',
        revision: 2,
        status: 'partial',
        text: '되돌림',
      }),
    /종료된 인식 시도/,
  );
  assert.throws(
    () =>
      timeline.apply({
        ...gen,
        sequence: 1,
        attemptId: 'a',
        revision: 2,
        status: 'final',
        text: '다른 확정',
      }),
    /종료된 인식 시도/,
  );
});

test('committed utterances cannot be rewritten by later responses', () => {
  const timeline = createSpeechRevisionTimeline(gen);
  timeline.register(utterance(1));
  timeline.startAttempt({ ...gen, sequence: 1, attemptId: 'a' });
  timeline.apply({
    ...gen,
    sequence: 1,
    attemptId: 'a',
    revision: 1,
    status: 'final',
    text: '확정',
  });
  timeline.drainReady();
  assert.deepEqual(
    timeline.apply({
      ...gen,
      sequence: 1,
      attemptId: 'a',
      revision: 2,
      status: 'final',
      text: '뒤늦은 변경',
    }),
    { accepted: false, stale: true, reason: 'committed' },
  );
});

test('sequence order remains authoritative even when registrations arrive out of order', () => {
  const timeline = createSpeechRevisionTimeline(gen);
  timeline.register(utterance(3, 300));
  timeline.register(utterance(1, 100));
  timeline.register(utterance(2, 200));
  assert.deepEqual(
    timeline.snapshot().items.map((x) => x.sequence),
    [1, 2, 3],
  );
  assert.throws(() => timeline.register(utterance(4, 150)), /역전/);
});
