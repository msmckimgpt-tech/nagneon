import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { defaultDecisionConfig } from '../server/decision/index.js';

const provider = {
  model: 'synthetic',
  status: () => ({ kind: 'openai', configured: true }),
  react: async () => ({ observation: { messages: [] } }),
};
const wire = () => ({
  ok: true,
  status: 200,
  json: async () => ({
    model: 'jev-1.13.0',
    answers: { relevant: { type: 'noul', noul: 0.9 } },
    usage: { input_tokens: 10, output_tokens: 2 },
  }),
});
const req = (service, path, method = 'GET', body, studio = true, signal) =>
  fetch(service.url + '/api/' + path, {
    method,
    signal,
    headers: {
      Authorization: 'Bearer ' + service.accessToken,
      'Content-Type': 'application/json',
      ...(studio ? { 'X-Backseat-Client': 'studio' } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

test('decision endpoints require authentication and studio write permission; snapshots never include key or state', async (t) => {
  let bodies = [];
  const service = await startServer({
    port: 0,
    persist: false,
    localSpeech: false,
    provider,
    decisionFetchImpl: async (_url, init) => {
      bodies.push(init.body);
      return wire();
    },
  });
  t.after(() => service.close());
  assert.equal((await fetch(service.url + '/api/decision')).status, 401);
  assert.equal((await req(service, 'decision')).status, 200);
  assert.equal((await req(service, 'decision', 'PUT', defaultDecisionConfig, false)).status, 403);
  assert.equal(
    (await req(service, 'decision/key', 'POST', { apiKey: 'synthetic-key' }, false)).status,
    403,
  );
  assert.equal((await req(service, 'decision/probe', 'POST', {}, false)).status, 403);
  assert.equal(
    (await req(service, 'decision', 'PUT', { ...defaultDecisionConfig, unexpected: true })).status,
    400,
  );
  const config = { ...structuredClone(defaultDecisionConfig), acknowledgeTransfer: true };
  assert.equal((await req(service, 'decision', 'PUT', config)).status, 200);
  assert.equal(
    (await req(service, 'decision/key', 'POST', { apiKey: 'synthetic-key' })).status,
    200,
  );
  const before = await (await req(service, 'decision')).json();
  assert.equal(before.configured, true);
  assert.equal(before.mode, 'off');
  assert.equal(bodies.length, 0);
  const probed = await (await req(service, 'decision/probe', 'POST', {})).json();
  assert.equal(probed.counters.calls, 1);
  assert.equal(bodies.length, 1);
  for (const value of [before, probed, service.studio.state()]) {
    assert.equal(JSON.stringify(value).includes('synthetic-key'), false);
    assert.equal(JSON.stringify(value).includes('합성 연결 확인 문장입니다.'), false);
  }
  assert.equal((await req(service, 'decision/key', 'POST', { apiKey: '' })).status, 200);
  assert.equal((await (await req(service, 'decision')).json()).configured, false);
});

test('a stale TypeSafe key request cannot cross into the saved OpenRouter provider', async (t) => {
  const calls = [];
  const service = await startServer({
    port: 0,
    persist: false,
    localSpeech: false,
    provider,
    decisionFetchImpl: async (url, init) => {
      calls.push({ url, key: init.headers.Authorization });
      return wire();
    },
  });
  t.after(() => service.close());
  const old = {
    ...structuredClone(defaultDecisionConfig),
    mode: 'assist',
    acknowledgeTransfer: true,
  };
  assert.equal((await req(service, 'decision', 'PUT', old)).status, 200);
  assert.equal(
    (await req(service, 'decision/key', 'POST', { apiKey: 'typesafe-synthetic' })).status,
    200,
  );
  const switched = await (
    await req(service, 'decision', 'PUT', { ...old, provider: 'openrouter' })
  ).json();
  assert.equal(switched.provider, 'openrouter');
  assert.equal(switched.mode, 'off');
  assert.equal(switched.acknowledgeTransfer, false);
  assert.equal(switched.configured, false);
  assert.equal(
    (await req(service, 'decision/key', 'POST', { apiKey: 'stale-typesafe' })).status,
    409,
  );
  assert.equal((await req(service, 'decision/probe', 'POST', {})).status, 409);
  assert.equal(
    (
      await req(service, 'decision/key', 'POST', {
        apiKey: 'openrouter-synthetic',
        provider: 'openrouter',
      })
    ).status,
    200,
  );
  assert.equal(
    (await req(service, 'decision/probe', 'POST', { provider: 'openrouter' })).status,
    200,
  );
  assert.deepEqual(calls, []);
  const enabled = await (
    await req(service, 'decision', 'PUT', {
      ...old,
      provider: 'openrouter',
      mode: 'shadow',
      acknowledgeTransfer: true,
    })
  ).json();
  assert.equal(enabled.mode, 'shadow');
  assert.equal(
    (await req(service, 'decision/probe', 'POST', { provider: 'openrouter' })).status,
    200,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/systemone');
  assert.equal(calls[0].key, 'Bearer openrouter-synthetic');
});

test('configuration and key changes require idle; off switch can cancel an active decision', async (t) => {
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const service = await startServer({
    port: 0,
    persist: false,
    localSpeech: false,
    provider,
    decisionFetchImpl: async (_url, init) => {
      started();
      return new Promise((_, reject) =>
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }),
      );
    },
  });
  t.after(() => service.close());
  const config = {
    ...structuredClone(defaultDecisionConfig),
    mode: 'assist',
    acknowledgeTransfer: true,
  };
  await req(service, 'decision', 'PUT', config);
  await req(service, 'decision/key', 'POST', { apiKey: 'synthetic-key' });
  const pending = service.studio.decision.advise('reaction-check', {
    state: 'text',
    questions: { relevant: { type: 'noul', instructions: 'Relevant?' } },
  });
  await ready;
  service.studio.busy = true;
  assert.equal((await req(service, 'decision/key', 'POST', { apiKey: '' })).status, 409);
  assert.equal((await req(service, 'decision/probe', 'POST', {})).status, 409);
  assert.equal((await req(service, 'decision', 'PUT', config)).status, 409);
  const off = await req(service, 'decision', 'PUT', { ...config, mode: 'off' });
  assert.equal(off.status, 200);
  assert.equal((await pending).kind, 'abstain');
  assert.equal(service.studio.decision.snapshot().mode, 'off');
});

test('pure off while already off cancels a held synthetic probe without changing configuration', async (t) => {
  let began;
  const started = new Promise((resolve) => {
    began = resolve;
  });
  const service = await startServer({
    port: 0,
    persist: false,
    localSpeech: false,
    provider,
    decisionFetchImpl: async (_url, init) => {
      began();
      return new Promise((_, reject) =>
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }),
      );
    },
  });
  t.after(() => service.close());
  const config = { ...structuredClone(defaultDecisionConfig), acknowledgeTransfer: true };
  assert.equal((await req(service, 'decision', 'PUT', config)).status, 200);
  assert.equal(
    (await req(service, 'decision/key', 'POST', { apiKey: 'synthetic-key' })).status,
    200,
  );
  const pending = req(service, 'decision/probe', 'POST', {}).catch(() => null);
  await started;
  assert.equal(service.studio.busy, true);
  const off = await req(service, 'decision', 'PUT', config);
  assert.equal(off.status, 200);
  const response = await pending;
  assert.ok(response);
  assert.equal((await response.json()).mode, 'off');
  assert.equal(service.studio.decision.snapshot().probe, null);
  assert.deepEqual(service.studio.decision.config, config);
});

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
async function heldProbeFixture(t, requestSignal) {
  const probeStarted = deferred(),
    generatorStarted = deferred();
  const transport = deferred(),
    generation = deferred(),
    aborted = deferred();
  let probeSignal,
    probeCalls = 0,
    generatorCalls = 0,
    now = Date.now();
  const service = await startServer({
    port: 0,
    persist: false,
    localSpeech: false,
    provider: {
      ...provider,
      react: async (_args, signal) => {
        generatorCalls++;
        generatorStarted.resolve();
        await generation.promise;
        signal.throwIfAborted();
        return {
          observation: {
            game: '합성',
            scene: '함께 이야기',
            confidence: 0.8,
            excitement: 0.4,
            messages: [],
          },
        };
      },
    },
    decisionFetchImpl: async (_url, init) => {
      probeCalls++;
      probeSignal = init.signal;
      init.signal.addEventListener('abort', () => aborted.resolve(), { once: true });
      probeStarted.resolve();
      // Deliberately hold transport cleanup after abort to exercise draining admission.
      return transport.promise;
    },
  });
  t.after(async () => {
    transport.resolve(wire());
    generation.resolve();
    await service.close();
  });
  clearInterval(service.studio.timer);
  service.studio.now = () => now;
  await req(service, 'onboarding', 'POST', { skip: true });
  service.studio.configure({ ...service.studio.settings, mode: 'live', lurkRatio: 0 });
  const config = {
    ...structuredClone(defaultDecisionConfig),
    timeoutMs: 5000,
    acknowledgeTransfer: true,
  };
  await req(service, 'decision', 'PUT', config);
  await req(service, 'decision/key', 'POST', { apiKey: 'synthetic-key' });
  const pending = req(service, 'decision/probe', 'POST', {}, true, requestSignal);
  pending.catch(() => {});
  await probeStarted.promise;
  return {
    service,
    config,
    pending,
    transport,
    generation,
    generatorStarted,
    aborted,
    get signal() {
      return probeSignal;
    },
    get probeCalls() {
      return probeCalls;
    },
    get generatorCalls() {
      return generatorCalls;
    },
    advance: () => {
      now += 3000;
    },
  };
}
async function assertSingleLiveRequest(f) {
  const first = req(f.service, 'react', 'POST', { speech: '오늘은 함께 쉬어 가자' });
  first.catch(() => {});
  await f.generatorStarted.promise;
  f.advance();
  const second = await req(f.service, 'react', 'POST', { speech: '다음 이야기도 듣고 있어' });
  assert.deepEqual(await second.json(), { skipped: 'busy' });
  assert.equal(f.generatorCalls, 1);
  assert.equal(f.service.studio.busy, true);
  f.generation.resolve();
  assert.equal((await first).status, 200);
}

test('held JEV probe rejects broadcast start until settled, then preserves single live generation', async (t) => {
  const f = await heldProbeFixture(t);
  assert.equal((await req(f.service, 'start', 'POST', {})).status, 409);
  assert.equal(f.service.studio.running, false);
  assert.equal(f.service.studio.busy, true);
  f.transport.resolve(wire());
  assert.equal((await f.pending).status, 200);
  assert.equal((await req(f.service, 'start', 'POST', {})).status, 200);
  await assertSingleLiveRequest(f);
});

test('stop aborts JEV probe and repeated stop/probe/start cannot bypass draining ownership', async (t) => {
  const f = await heldProbeFixture(t);
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.equal((await req(f.service, 'stop', 'POST', {})).status, 200);
    assert.equal(f.signal.aborted, true);
    assert.equal((await req(f.service, 'decision/probe', 'POST', {})).status, 409);
    assert.equal((await req(f.service, 'start', 'POST', {})).status, 409);
    assert.equal((await req(f.service, 'connection/probe', 'POST', {})).status, 409);
    assert.equal((await req(f.service, 'decision/key', 'POST', { apiKey: '' })).status, 409);
  }
  assert.equal(f.probeCalls, 1);
  // Immediate off remains available even when already off and transport is draining.
  assert.equal((await req(f.service, 'decision', 'PUT', f.config)).status, 200);
  assert.equal((await req(f.service, 'start', 'POST', {})).status, 409);
  f.transport.reject(f.signal.reason);
  await f.pending;
  assert.equal((await req(f.service, 'start', 'POST', {})).status, 200);
  await assertSingleLiveRequest(f);
});

for (const completion of ['success', 'abort'])
  test(`late JEV probe ${completion} cannot clear busy after an internal Studio epoch change`, async (t) => {
    const f = await heldProbeFixture(t);
    // Studio has internal lifecycle callers as well as the guarded HTTP start route.
    f.service.studio.stop();
    f.service.studio.start();
    const live = req(f.service, 'react', 'POST', { speech: '오늘은 함께 쉬어 가자' });
    live.catch(() => {});
    await f.generatorStarted.promise;
    if (completion === 'success') f.transport.resolve(wire());
    else {
      await req(f.service, 'decision', 'PUT', f.config);
      assert.equal(f.signal.aborted, true);
      f.transport.reject(f.signal.reason);
    }
    await f.pending;
    assert.equal(f.service.studio.busy, true);
    assert.ok(f.service.studio.liveReaction);
    f.advance();
    const second = await req(f.service, 'react', 'POST', { speech: '다음 이야기도 듣고 있어' });
    assert.deepEqual(await second.json(), { skipped: 'busy' });
    assert.equal(f.generatorCalls, 1);
    f.generation.resolve();
    assert.equal((await live).status, 200);
  });

test(
  'disconnecting JEV probe aborts transport but keeps start blocked until cleanup settles',
  { timeout: 2000 },
  async (t) => {
    const client = new AbortController();
    const f = await heldProbeFixture(t, client.signal);
    client.abort();
    await assert.rejects(f.pending);
    await Promise.race([f.aborted.promise, new Promise((resolve) => setTimeout(resolve, 100))]);
    assert.equal(f.signal.aborted, true);
    assert.equal((await req(f.service, 'start', 'POST', {})).status, 409);
    assert.equal((await req(f.service, 'decision/probe', 'POST', {})).status, 409);
    f.transport.reject(f.signal.reason);
    // Observe server cleanup through its public state before retrying start.
    for (let attempt = 0; attempt < 100; attempt++) {
      if (!(await (await req(f.service, 'state')).json()).busy) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal((await req(f.service, 'start', 'POST', {})).status, 200);
    await assertSingleLiveRequest(f);
  },
);
