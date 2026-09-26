import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DecisionMode,
  DecisionService,
  DecisionTask,
  JevAdapter,
  decisionObservation,
  decisionProposal,
  parseDecisionConfig,
} from '../server/decision/index.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
};

test('off mode is a true no-op: it never allocates a request id or calls the adapter', async () => {
  let ids = 0,
    calls = 0,
    events = 0;
  const service = new DecisionService({
    config: { mode: 'off' },
    adapter: {
      evaluate: async () => {
        calls++;
        return { value: 'unexpected' };
      },
    },
    idFactory: () => {
      ids++;
      return 'id';
    },
    onEvent: () => events++,
  });
  const result = await service.advise(DecisionTask.MEMORY_RERANK, { secret: 'do-not-send' });
  assert.deepEqual(result, {
    kind: 'abstain',
    task: 'memory-rerank',
    mode: 'off',
    requestId: null,
    scopeToken: null,
    questionVersion: null,
    startedAt: null,
    receivedAt: null,
    apply: false,
    reason: 'disabled',
  });
  assert.equal(ids, 0);
  assert.equal(calls, 0);
  assert.equal(events, 0);
});

test('timeout returns fallback while an uncooperative adapter retains capacity until drained', async () => {
  const hold = deferred();
  const events = [];
  const service = new DecisionService({
    config: { mode: 'assist', timeoutMs: 50, maxInFlight: 1 },
    adapter: { evaluate: () => hold.promise },
    onEvent: (event) => events.push(event),
  });
  const watchdog = setTimeout(() => hold.reject(new Error('test watchdog')), 1500);
  try {
    const result = await service.advise(DecisionTask.INTENT_HINT, {});
    assert.equal(result.reason, 'timeout');
    assert.equal(service.status().inFlight, 1);
    assert.equal((await service.advise(DecisionTask.INTENT_HINT, {})).reason, 'busy');
    let drained = false;
    const closing = service.close().then(() => {
      drained = true;
    });
    await Promise.resolve();
    assert.equal(drained, false);
    hold.resolve({ value: 'late-result' });
    await closing;
    assert.equal(service.status().inFlight, 0);
    assert.equal(
      events.some((event) => event.type === 'completed'),
      false,
    );
  } finally {
    clearTimeout(watchdog);
    hold.resolve({ value: 'cleanup' });
    await service.close();
  }
});

test('caller cancellation rejects promptly while a late adapter rejection is owned', async () => {
  const hold = deferred(),
    started = deferred(),
    caller = new AbortController();
  const service = new DecisionService({
    config: { mode: 'assist' },
    adapter: {
      evaluate: () => {
        started.resolve();
        return hold.promise;
      },
    },
  });
  const pending = service.advise(DecisionTask.INTENT_HINT, {}, { signal: caller.signal });
  await started.promise;
  caller.abort(new Error('caller stopped'));
  await assert.rejects(pending, /caller stopped/);
  assert.equal(service.status().inFlight, 1);
  hold.reject(new Error('late provider failure'));
  await service.close();
  assert.equal(service.status().inFlight, 0);
});

test('result helpers preserve controller identity and discard arbitrary provider metadata', () => {
  const meta = {
    task: 'memory-rerank',
    mode: 'shadow',
    requestId: 'owned',
    scopeToken: 'scope',
    questionVersion: 3,
  };
  const hostile = {
    kind: 'proposal',
    mode: 'assist',
    apply: true,
    requestId: 'forged',
    scopeToken: 'other',
    questionVersion: 9,
    value: 'replaced',
    privateText: 'secret',
  };
  for (const factory of [decisionObservation, decisionProposal]) {
    const result = factory(meta, 'original', hostile);
    assert.equal(result.kind, factory === decisionObservation ? 'observation' : 'proposal');
    assert.equal(result.mode, 'shadow');
    assert.equal(result.requestId, 'owned');
    assert.equal(result.scopeToken, 'scope');
    assert.equal(result.questionVersion, 3);
    assert.equal(result.apply, false);
    assert.equal(result.value, 'original');
    assert.equal(Object.hasOwn(result, 'privateText'), false);
  }
});

test('all injected adapters must return a defined value and diagnostics omit opaque revisions', async () => {
  for (const value of [null, [], {}, { value: undefined }]) {
    const events = [];
    const service = new DecisionService({
      config: { mode: 'assist' },
      adapter: { evaluate: async () => value },
      onEvent: (event) => events.push(event),
    });
    assert.equal(
      (
        await service.advise(
          DecisionTask.INTENT_HINT,
          {},
          { questionVersion: { privateText: 'secret' } },
        )
      ).reason,
      'invalid_response',
    );
    assert.equal(JSON.stringify(events).includes('secret'), false);
    await service.close();
  }
  await assert.rejects(new JevAdapter({ judge: async () => ({ value: undefined }) }).evaluate({}), {
    code: 'invalid_response',
  });
});

test('missing adapter and saturated queue abstain without changing the caller path', async () => {
  const unavailable = new DecisionService({ config: { mode: 'assist' } });
  assert.equal((await unavailable.advise(DecisionTask.INTENT_HINT, {})).reason, 'unavailable');

  const hold = deferred();
  const service = new DecisionService({
    config: { mode: 'assist', maxInFlight: 1, timeoutMs: 1000 },
    adapter: { evaluate: async () => hold.promise },
    idFactory: () => 'first',
  });
  const first = service.advise(DecisionTask.INTENT_HINT, { text: 'one' });
  await Promise.resolve();
  const second = await service.advise(DecisionTask.INTENT_HINT, { text: 'two' });
  assert.equal(second.reason, 'busy');
  assert.equal(second.requestId, null);
  hold.resolve({ value: { intent: 'statement' } });
  assert.equal((await first).kind, 'proposal');
  await service.close();
});

test('shadow can observe a JEV result but cannot produce an applyable proposal', async () => {
  const service = new DecisionService({
    config: { mode: DecisionMode.SHADOW },
    now: (() => {
      let n = 10;
      return () => n++;
    })(),
    idFactory: () => 'shadow-1',
    adapter: new JevAdapter({
      modelVersion: 'jev-test',
      judge: async () => ({
        value: { order: ['b', 'a'] },
        confidence: 0.72,
        usage: { inputTokens: 12 },
      }),
    }),
  });
  const result = await service.advise(
    DecisionTask.MEMORY_RERANK,
    { candidates: ['a', 'b'] },
    { scopeToken: 'viewer-1', questionVersion: 3 },
  );
  assert.equal(result.kind, 'observation');
  assert.equal(result.apply, false);
  assert.deepEqual(result.value, { order: ['b', 'a'] });
  assert.equal(result.modelVersion, 'jev-test');
  assert.equal(result.confidence, 0.72);
  assert.deepEqual(result.usage, { inputTokens: 12 });
  assert.equal(result.scopeToken, 'viewer-1');
  assert.equal(result.questionVersion, 3);
});

test('assist returns a bounded proposal while diagnostics never receive prompt or result content', async () => {
  const events = [],
    secret = 'private-memory-text',
    answer = 'sensitive-ranked-value';
  const service = new DecisionService({
    config: { mode: 'assist' },
    idFactory: () => 'assist-1',
    onEvent: (event) => events.push(event),
    adapter: new JevAdapter({
      judge: async ({ input }) => ({
        value: { chosen: input.secret === secret ? answer : 'wrong' },
      }),
    }),
  });
  const result = await service.advise(DecisionTask.MEMORY_RERANK, { secret });
  assert.equal(result.kind, 'proposal');
  assert.equal(result.apply, false);
  assert.equal(result.value.chosen, answer);
  const logged = JSON.stringify(events);
  assert.equal(logged.includes(secret), false);
  assert.equal(logged.includes(answer), false);
});

test('adapter failure is sanitized into fallback and caller cancellation still propagates', async () => {
  const events = [];
  const service = new DecisionService({
    config: { mode: 'assist' },
    idFactory: () => 'failure-1',
    onEvent: (event) => events.push(event),
    adapter: {
      evaluate: async () => {
        throw Object.assign(Error('upstream secret response'), { code: 'network' });
      },
    },
  });
  const result = await service.advise(DecisionTask.REACTION_CHECK, {});
  assert.equal(result.kind, 'abstain');
  assert.equal(result.reason, 'network');
  assert.equal(JSON.stringify(events).includes('upstream secret response'), false);

  const started = deferred(),
    abort = new AbortController();
  const cancelling = new DecisionService({
    config: { mode: 'assist', timeoutMs: 1000 },
    idFactory: () => 'cancel-1',
    adapter: {
      evaluate: async ({ signal }) => {
        started.resolve();
        await new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        );
      },
    },
  });
  const pending = cancelling.advise(DecisionTask.INTENT_HINT, {}, { signal: abort.signal });
  await started.promise;
  abort.abort(new Error('caller cancelled'));
  await assert.rejects(pending, /caller cancelled/);
  await cancelling.close();
});

test('timeout signals cooperative adapter cleanup and close drains it', async () => {
  let cleaned = false;
  const service = new DecisionService({
    config: { mode: 'assist', timeoutMs: 50 },
    idFactory: () => 'timeout-1',
    adapter: {
      evaluate: async ({ signal }) =>
        new Promise((_, reject) =>
          signal.addEventListener(
            'abort',
            () => {
              cleaned = true;
              reject(signal.reason);
            },
            { once: true },
          ),
        ),
    },
  });
  const keep = setInterval(() => {}, 20);
  try {
    const result = await service.advise(DecisionTask.COMMUNITY_AFFINITY, {});
    assert.equal(result.reason, 'timeout');
    assert.equal(cleaned, true);
    await service.close();
    assert.equal(service.status().inFlight, 0);
  } finally {
    clearInterval(keep);
    await service.close();
  }
});

test('close owns pending cleanup, rejects late success and forbids new work', async () => {
  const started = deferred(),
    cleanup = deferred();
  let finished = false;
  const service = new DecisionService({
    config: { mode: 'assist', timeoutMs: 1000 },
    idFactory: () => 'close-1',
    adapter: {
      evaluate: async () => {
        started.resolve();
        await cleanup.promise;
        finished = true;
        return { value: 'late' };
      },
    },
  });
  const pending = service.advise(DecisionTask.ROUTE_HINT, {});
  await started.promise;
  const rejection = assert.rejects(pending, /판단 서비스 종료/);
  let closed = false;
  const closing = service.close();
  assert.equal(service.close(), closing);
  closing.then(() => (closed = true));
  await Promise.resolve();
  assert.equal(closed, false);
  assert.equal(finished, false);
  await assert.rejects(service.advise(DecisionTask.ROUTE_HINT, {}), /판단 서비스 종료/);
  cleanup.resolve();
  await rejection;
  await closing;
  assert.equal(finished, true);
  assert.equal(service.status().inFlight, 0);
});

test('JEV adapter validates response shape without binding product code to a provider SDK', async () => {
  const adapter = new JevAdapter({
    judge: async ({ task, input }) => ({ value: [task, input.id], modelVersion: 'jev-r1' }),
  });
  assert.deepEqual(await adapter.evaluate({ task: 'memory-rerank', input: { id: 7 } }), {
    value: ['memory-rerank', 7],
    modelVersion: 'jev-r1',
  });
  const broken = new JevAdapter({ judge: async () => ({ confidence: 0.9 }) });
  await assert.rejects(
    broken.evaluate({ task: 'memory-rerank', input: {} }),
    (error) => error.code === 'invalid_response',
  );
});

test('decision configuration and task names are bounded before any external call', async () => {
  assert.deepEqual(parseDecisionConfig({}), { mode: 'off', timeoutMs: 1000, maxInFlight: 2 });
  for (const config of [
    { mode: 'auto' },
    { timeoutMs: 0 },
    { timeoutMs: 60001 },
    { maxInFlight: 0 },
    { maxInFlight: 9 },
  ])
    assert.throws(() => parseDecisionConfig(config));
  let called = false;
  const service = new DecisionService({
    config: { mode: 'assist' },
    adapter: {
      evaluate: async () => {
        called = true;
        return { value: true };
      },
    },
  });
  assert.throws(() => service.advise('unregistered-task', {}));
  assert.equal(called, false);
});

test('live per-call allowance can shorten but never extend configured timeout', async () => {
  const hold = deferred();
  const service = new DecisionService({
    config: { mode: 'assist', timeoutMs: 500, maxInFlight: 1 },
    adapter: { evaluate: () => hold.promise },
  });
  const keepAlive = setTimeout(() => hold.resolve({ value: 'too late' }), 1000);
  try {
    const started = performance.now();
    const result = await service.advise(DecisionTask.INTENT_HINT, {}, { timeoutMs: 20 });
    assert.equal(result.reason, 'timeout');
    assert.ok(performance.now() - started < 250, 'uses phase allowance, not 500 ms config');
    assert.equal(service.status().inFlight, 1);
    hold.resolve({ value: 'drain' });
  } finally {
    clearTimeout(keepAlive);
    hold.resolve({ value: 'cleanup' });
    await service.close();
  }
});
test('exhausted live allowance does not send a decision request', async () => {
  let calls = 0;
  const service = new DecisionService({
    config: { mode: 'assist' },
    adapter: {
      evaluate: async () => {
        calls++;
        return { value: 'wrong' };
      },
    },
  });
  const result = await service.advise(DecisionTask.INTENT_HINT, {}, { timeoutMs: 0 });
  assert.equal(result.reason, 'timeout');
  assert.equal(calls, 0);
  await service.close();
});
