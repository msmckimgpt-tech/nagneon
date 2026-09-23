import test from 'node:test';
import assert from 'node:assert/strict';
import { SpeechListeningController } from '../server/speech-listening-controller.js';

const turn = () => new Promise((resolve) => setImmediate(resolve));
const entry = (sequence) => ({
  sequence,
  utteranceId: 'u' + sequence,
  frameStart: sequence * 100,
  frameEnd: sequence * 100 + 80,
  sourceRef: 'audio:' + sequence,
});

test('bounded parallel recognition may finish out of order while committed speech stays ordered', async () => {
  const releases = new Map(),
    started = [];
  const controller = new SpeechListeningController({
    sessionId: 's',
    inputEpoch: 'e',
    concurrency: 2,
    maxAttempts: 1,
    idFactory: (() => {
      let i = 0;
      return () => String(++i);
    })(),
    recognize: ({ sequence }) => {
      started.push(sequence);
      return new Promise((resolve) => releases.set(sequence, resolve));
    },
  });
  controller.enqueue(entry(1));
  controller.enqueue(entry(2));
  controller.enqueue(entry(3));
  await turn();
  assert.deepEqual(started, [1, 2]);
  releases.get(2)({ status: 'final', text: '둘' });
  await turn();
  assert.deepEqual(controller.takeCommitted(), []);
  assert.deepEqual(started, [1, 2, 3]);
  releases.get(3)({ status: 'final', text: '셋' });
  await turn();
  assert.deepEqual(controller.takeCommitted(), []);
  releases.get(1)({ status: 'final', text: '하나' });
  await controller.whenIdle();
  assert.deepEqual(
    controller.takeCommitted().map((item) => item.text),
    ['하나', '둘', '셋'],
  );
});

test('failed head retries the same source reference and releases later completed speech only after success', async () => {
  const calls = [];
  const controller = new SpeechListeningController({
    sessionId: 's',
    inputEpoch: 'e',
    concurrency: 2,
    maxAttempts: 2,
    idFactory: (() => {
      let i = 0;
      return () => String(++i);
    })(),
    recognize: async ({ sequence, attemptNo, sourceRef }) => {
      calls.push({ sequence, attemptNo, sourceRef });
      if (sequence === 1 && attemptNo === 1)
        throw Object.assign(new Error('worker exit'), { code: 'WORKER_EXIT' });
      return { status: 'final', text: sequence === 1 ? '앞' : '뒤' };
    },
  });
  controller.enqueue(entry(1));
  controller.enqueue(entry(2));
  await controller.whenIdle();
  assert.deepEqual(
    calls.filter((call) => call.sequence === 1).map((call) => call.sourceRef),
    ['audio:1', 'audio:1'],
  );
  assert.deepEqual(
    controller.takeCommitted().map((item) => item.text),
    ['앞', '뒤'],
  );
  assert.equal(controller.snapshot().jobs.find((job) => job.sequence === 1).attempts, 2);
});

test('partial updates stay revisions of one utterance until the recognizer finalizes it', async () => {
  const controller = new SpeechListeningController({
    sessionId: 's',
    inputEpoch: 'e',
    recognize: async ({ publish }) => {
      publish({ status: 'partial', text: '민수한테' });
      publish({ status: 'partial', text: '민수 말고' });
      return { status: 'final', text: '민수 말고 민지한테' };
    },
  });
  controller.enqueue(entry(1));
  await controller.whenIdle();
  const [done] = controller.takeCommitted();
  assert.equal(done.text, '민수 말고 민지한테');
  assert.equal(done.revision, 3);
});

test('exhausted recognition failure is visible and blocks later ordered commit without deleting it', async () => {
  const controller = new SpeechListeningController({
    sessionId: 's',
    inputEpoch: 'e',
    concurrency: 2,
    maxAttempts: 1,
    recognize: async ({ sequence }) => {
      if (sequence === 1) throw Object.assign(new Error('model'), { code: 'MODEL_ERROR' });
      return { status: 'final', text: '뒤' };
    },
  });
  controller.enqueue(entry(1));
  controller.enqueue(entry(2));
  await controller.whenIdle();
  assert.deepEqual(controller.takeCommitted(), []);
  const state = controller.snapshot();
  assert.equal(state.jobs.find((job) => job.sequence === 1).exhausted, true);
  assert.equal(state.timeline.items.find((item) => item.sequence === 1).status, 'failed');
  assert.equal(state.timeline.items.find((item) => item.sequence === 2).status, 'final');
});

test('explicit cancellation resolves only that utterance and aborts its current recognizer', async () => {
  let signal;
  const controller = new SpeechListeningController({
    sessionId: 's',
    inputEpoch: 'e',
    recognize: ({ signal: current }) => {
      signal = current;
      return new Promise(() => {});
    },
  });
  controller.enqueue(entry(1));
  await turn();
  assert.equal(signal.aborted, false);
  assert.equal(controller.cancel(1, 'user'), true);
  assert.equal(signal.aborted, true);
  await controller.whenIdle();
  const [done] = controller.takeCommitted();
  assert.equal(done.status, 'cancelled');
  assert.equal(done.cancelReason, 'user');
});

test('cancelling queued speech does not count as a recognizer attempt', async () => {
  const controller = new SpeechListeningController({
    sessionId: 's',
    inputEpoch: 'e',
    concurrency: 1,
    recognize: () => new Promise(() => {}),
  });
  controller.enqueue(entry(1));
  controller.enqueue(entry(2));
  await turn();
  assert.equal(controller.cancel(2, 'user'), true);
  assert.equal(controller.snapshot().jobs.find((job) => job.sequence === 2).attempts, 0);
  controller.cancel(1, 'user');
  await controller.whenIdle();
  assert.deepEqual(
    controller.takeCommitted().map((item) => item.status),
    ['cancelled', 'cancelled'],
  );
});

test('controller never stores raw audio and accepts only opaque source references', () => {
  const controller = new SpeechListeningController({
    sessionId: 's',
    inputEpoch: 'e',
    recognize: async () => ({ status: 'empty' }),
  });
  controller.enqueue({ ...entry(1), sourceRef: 'spool:session/1' });
  const state = controller.snapshot();
  assert.equal(state.jobs[0].utteranceId, 'u1');
  assert.equal('sourceRef' in state.jobs[0], false);
});

test('close aborts in-flight work and prevents late results from becoming commits', async () => {
  let release, signal;
  const controller = new SpeechListeningController({
    sessionId: 's',
    inputEpoch: 'e',
    recognize: ({ signal: current }) => {
      signal = current;
      return new Promise((resolve) => (release = resolve));
    },
  });
  controller.enqueue(entry(1));
  await turn();
  controller.close();
  assert.equal(signal.aborted, true);
  release({ status: 'final', text: '늦음' });
  await controller.whenIdle();
  await turn();
  assert.deepEqual(controller.takeCommitted(), []);
  assert.equal(controller.snapshot().closed, true);
});
