import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioLifetime, AudioClosingError, throwAudioFailures } from '../server/audio-lifetime.js';
const turn = () => new Promise(setImmediate);
const deferred = () => {
  let resolve;
  return {
    promise: new Promise((r) => {
      resolve = r;
    }),
    release: () => resolve(),
  };
};

test('ownership is registered before a synchronous callback or a reentrant shutdown', async () => {
  const life = new AudioLifetime(),
    gate = deferred();
  let draining,
    touched = false;
  const operation = life.run(() => {
    assert.equal(life.pending.size, 1);
    touched = true;
    draining = life.drain();
    return gate.promise;
  });
  assert.equal(touched, true);
  let done = false;
  void draining.then(() => {
    done = true;
  });
  await turn();
  assert.equal(done, false);
  gate.release();
  await operation;
  assert.deepEqual(await draining, []);
});

test('drain waits for descendants started by accepted work after sealing', async () => {
  const life = new AudioLifetime(),
    first = deferred(),
    child = deferred();
  let childStarted = false;
  const operation = life.run(async () => {
    await first.promise;
    void life.run(async () => {
      childStarted = true;
      await child.promise;
    });
  });
  const draining = life.drain();
  let done = false;
  void draining.then(() => {
    done = true;
  });
  first.release();
  await operation;
  assert.equal(childStarted, true);
  await turn();
  assert.equal(done, false);
  child.release();
  assert.deepEqual(await draining, []);
  assert.equal(life.pending.size, 0);
});

test('external and finished-context callbacks cannot use an old admission after seal', async () => {
  const life = new AudioLifetime(),
    gate = deferred();
  let delayed,
    touched = false;
  await life.run(() => {
    delayed = gate.promise.then(() =>
      life.run(() => {
        touched = true;
      }),
    );
  });
  life.seal();
  await assert.rejects(
    life.run(() => {
      touched = true;
    }),
    AudioClosingError,
  );
  gate.release();
  await assert.rejects(delayed, AudioClosingError);
  assert.equal(touched, false);
  assert.deepEqual(await life.drain(), []);
});

test('closing one owner does not grant another owner admission', async () => {
  const a = new AudioLifetime(),
    b = new AudioLifetime();
  b.seal();
  await a.run(async () => {
    await assert.rejects(
      b.run(() => assert.fail()),
      AudioClosingError,
    );
  });
  await a.drain();
  await b.drain();
});

test('drain preserves failures while intentional cancellation does not become a storage failure', async () => {
  const life = new AudioLifetime(),
    gate = deferred(),
    failure = new Error('synthetic storage failure');
  const a = life.run(async () => {
    await gate.promise;
    throw failure;
  });
  const b = life.run(async () => {
    await gate.promise;
    throw new DOMException('cancel', 'AbortError');
  });
  const draining = life.drain();
  gate.release();
  await Promise.allSettled([a, b]);
  assert.deepEqual(await draining, [failure]);
});

test('synchronous callback failure retains its exact object and finished ownership', async () => {
  const life = new AudioLifetime(),
    failure = new Error('synthetic synchronous failure');
  await assert.rejects(
    life.run(() => {
      throw failure;
    }),
    (e) => e === failure,
  );
  assert.equal(life.pending.size, 0);
  assert.deepEqual(await life.drain(), []);
});

test('error reporting deduplicates original failures and preserves explicit host AbortError', () => {
  const a = new Error('journal'),
    b = new DOMException('host close failed', 'AbortError');
  assert.throws(
    () => throwAudioFailures([a, a]),
    (e) => e === a,
  );
  assert.throws(
    () => throwAudioFailures([a, new AggregateError([a, b])]),
    (e) =>
      e instanceof AggregateError &&
      e.errors.length === 2 &&
      e.errors[0] === a &&
      e.errors[1] === b,
  );
});
