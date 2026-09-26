import test from 'node:test';
import assert from 'node:assert/strict';
import { AiControl } from '../server/ai-control.js';
import {
  DecisionAssistant,
  DecisionAssistantConfig,
  defaultDecisionConfig,
} from '../server/decision/assistant.js';

const question = { relevant: { type: 'noul', instructions: 'Is this relevant?' } };
const reply = () => ({
  ok: true,
  status: 200,
  json: async () => ({
    model: 'jev-1.13.0',
    answers: { relevant: { type: 'noul', noul: 0.8 } },
    usage: { input_tokens: 100, output_tokens: 3 },
  }),
});
const enabledConfig = (mode = 'assist') => ({
  ...structuredClone(defaultDecisionConfig),
  mode,
  acknowledgeTransfer: true,
});
const make = (fetchImpl, config = enabledConfig(), now = Date.now) => {
  const aiControl = new AiControl({ now });
  const saved = [];
  const assistant = new DecisionAssistant({
    aiControl,
    config,
    save: (value) => saved.push(value),
    fetchImpl,
    now,
  });
  return { assistant, aiControl, saved };
};

test('legacy persisted JEV config defaults to TypeSafe', () => {
  const { provider, ...oldConfig } = structuredClone(defaultDecisionConfig);
  assert.equal(DecisionAssistantConfig.parse(oldConfig).provider, 'typesafe');
  const { assistant } = make(async () => reply(), oldConfig);
  assert.equal(assistant.snapshot().provider, 'typesafe');
  return assistant.close();
});

test('provider change clears key and acknowledgement, turns off, and rejects stale key submission', async () => {
  const calls = [];
  const { assistant, saved } = make(async (url, init) => {
    calls.push({ url, authorization: init.headers.Authorization });
    return reply();
  });
  assistant.setKey('typesafe-synthetic');
  await assistant.advise('reaction-check', { state: 'text', questions: question });
  const result = assistant.configure({ ...enabledConfig(), provider: 'openrouter' });
  assert.equal(result.provider, 'openrouter');
  assert.equal(result.mode, 'off');
  assert.equal(result.acknowledgeTransfer, false);
  assert.equal(result.configured, false);
  assert.equal(result.probe, null);
  assert.equal(result.last, null);
  assert.equal(saved.at(-1).mode, 'off');
  assert.equal(saved.at(-1).acknowledgeTransfer, false);
  assert.throws(() => assistant.setKey('stale-typesafe', 'typesafe'));
  assert.equal((await assistant.probe()).counters.calls, 1);
  assert.equal(calls.length, 1);
  assistant.setKey('openrouter-synthetic', 'openrouter');
  assert.equal((await assistant.probe()).counters.calls, 1);
  assistant.configure({ ...enabledConfig('assist'), provider: 'openrouter' });
  assert.equal((await assistant.probe()).counters.calls, 2);
  assert.equal(calls[1].url, 'https://openrouter.ai/api/v1/systemone');
  assert.equal(calls[1].authorization, 'Bearer openrouter-synthetic');
  await assistant.close();
});

test('provider change aborts an in-flight probe and late success cannot mark new provider connected', async () => {
  let release, started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  let requestSignal;
  const { assistant } = make(async (_url, init) => {
    requestSignal = init.signal;
    started();
    return new Promise((resolve) => {
      release = resolve;
    });
  }, enabledConfig('off'));
  assistant.setKey('typesafe-synthetic');
  const pending = assistant.probe();
  await ready;
  assistant.configure({ ...enabledConfig('assist'), provider: 'openrouter' });
  assert.equal(requestSignal.aborted, true);
  release(reply());
  const stale = await pending;
  assert.equal(stale.provider, 'openrouter');
  assert.equal(stale.probe, null);
  assert.equal(stale.configured, false);
  await assistant.close();
});

for (const mode of ['shadow', 'assist']) {
  test(`${mode} HTTP 402 after a successful probe keeps credits distinct without retry or upstream text`, async () => {
    let calls = 0;
    let bodyReads = 0;
    const { assistant } = make(
      async () => {
        calls++;
        if (calls === 1) return reply();
        return {
          ok: false,
          status: 402,
          json: async () => {
            bodyReads++;
            return { detail: 'private upstream detail' };
          },
        };
      },
      { ...enabledConfig(mode), provider: 'openrouter' },
    );
    assistant.setKey('synthetic-openrouter', 'openrouter');
    assert.equal((await assistant.probe()).probe.outcome, 'connected');
    const result = await assistant.advise('reaction-check', {
      state: 'synthetic text',
      questions: question,
    });
    assert.equal(result.kind, 'abstain');
    assert.equal(result.reason, 'credits');
    const snapshot = assistant.snapshot();
    assert.equal(snapshot.errorCode, 'credits');
    assert.equal(snapshot.probe.outcome, 'connected');
    assert.equal(calls, 2);
    assert.equal(bodyReads, 0);
    assert.equal(JSON.stringify({ result, snapshot }).includes('private upstream detail'), false);
    await assistant.close();
  });
}

test('off, no key, no transfer consent and disabled task are zero-op paths', async () => {
  let fetches = 0;
  const { assistant, aiControl } = make(async () => {
    fetches++;
    return reply();
  }, defaultDecisionConfig);
  const input = { state: 'private text', questions: question };
  assert.equal(assistant.enabled('reaction-check'), false);
  assert.equal((await assistant.advise('reaction-check', input)).kind, 'abstain');
  assistant.configure(enabledConfig());
  assert.equal((await assistant.advise('reaction-check', input)).kind, 'abstain');
  assistant.setKey('synthetic-key');
  const unacknowledged = { ...enabledConfig(), acknowledgeTransfer: false };
  assistant.configure(unacknowledged);
  assert.equal((await assistant.advise('reaction-check', input)).kind, 'abstain');
  assistant.configure({
    ...enabledConfig(),
    tasks: { ...enabledConfig().tasks, 'reaction-check': false },
  });
  assert.equal((await assistant.advise('reaction-check', input)).kind, 'abstain');
  assert.equal(fetches, 0);
  assert.equal(aiControl.data.recent.length, 0);
  assert.equal(assistant.snapshot().counters.calls, 0);
  await assistant.close();
});

test('a verified probe becomes untested after key or model replacement while usage remains', async () => {
  const { assistant } = make(async () => reply(), enabledConfig('off'));
  assert.equal(assistant.snapshot().last, null);
  assistant.setKey('synthetic-first');
  assert.equal((await assistant.probe()).last.outcome, 'connected');
  assert.equal(assistant.snapshot().probe.outcome, 'connected');
  const calls = assistant.snapshot().counters.calls;
  assistant.setKey('synthetic-second');
  assert.equal(assistant.snapshot().last, null);
  assert.equal(assistant.snapshot().probe, null);
  assert.equal(assistant.snapshot().counters.calls, calls);
  assert.equal((await assistant.probe()).last.outcome, 'connected');
  assistant.configure({ ...enabledConfig('off'), model: 'jev-latest' });
  assert.equal(assistant.snapshot().last, null);
  assert.equal(assistant.snapshot().probe, null);
  assert.equal(assistant.snapshot().counters.calls, calls + 1);
  await assistant.close();
});

test('assist and shadow preserve DecisionService output, AiControl usage and accepted receipt', async () => {
  let fetches = 0;
  const { assistant, aiControl } = make(async () => {
    fetches++;
    return reply();
  });
  assistant.setKey('synthetic-key');
  const input = { state: { text: 'hello' }, questions: question };
  const result = await assistant.advise('reaction-check', input, {
    scopeToken: 'turn-1',
    questionVersion: 2,
  });
  assert.equal(result.kind, 'proposal');
  assert.equal(result.apply, false);
  assert.equal(result.scopeToken, 'turn-1');
  assert.equal(result.questionVersion, 2);
  assert.deepEqual(result.value, { answers: { relevant: { type: 'noul', noul: 0.8 } } });
  assert.equal(aiControl.data.recent[0].provider, 'jev');
  assert.equal(aiControl.data.recent[0].usage.input, 100);
  assert.equal(aiControl.data.recent[0].estimatedUsd, (100 * 0.042) / 1e6);
  assistant.assertCurrent(result);
  assistant.accepted(result);
  assert.equal(aiControl.data.recent[0].application, 'accepted');
  assert.equal(assistant.snapshot().counters.applied, 1);
  assistant.configure(enabledConfig('shadow'));
  const shadow = await assistant.advise('reaction-check', input);
  assert.equal(shadow.kind, 'observation');
  assert.equal(fetches, 2);
  await assistant.close();
});

test('cache keys include scope/version/revision, cache hits respect parent policy and key clearing', async () => {
  let fetches = 0;
  const { assistant, aiControl } = make(async () => {
    fetches++;
    return reply();
  });
  assistant.setKey('synthetic-key');
  const input = { state: 'text', questions: question };
  await assistant.advise('reaction-check', input, { scopeToken: 'viewer-a', questionVersion: 1 });
  const cached = await assistant.advise('reaction-check', input, {
    scopeToken: 'viewer-a',
    questionVersion: 1,
  });
  assert.equal(cached.kind, 'proposal');
  assert.equal(fetches, 1);
  assert.equal(assistant.snapshot().counters.cacheHits, 1);
  assert.equal(aiControl.data.recent.length, 1);
  await assistant.advise('reaction-check', input, { scopeToken: 'viewer-b', questionVersion: 1 });
  await assistant.advise('reaction-check', input, { scopeToken: 'viewer-b', questionVersion: 2 });
  assert.equal(fetches, 3);
  aiControl.update({ paused: true });
  assert.equal(
    (
      await assistant.advise('reaction-check', input, {
        scopeToken: 'viewer-a',
        questionVersion: 1,
      })
    ).kind,
    'abstain',
  );
  assert.throws(() => assistant.assertCurrent(cached));
  aiControl.update({ paused: false });
  assistant.setKey('');
  assert.equal(assistant.snapshot().configured, false);
  assert.equal((await assistant.advise('reaction-check', input)).kind, 'abstain');
  assert.equal(fetches, 3);
  await assistant.close();
});

test('cached proposal becomes stale if parent policy pauses and resumes before acceptance', async () => {
  const { assistant, aiControl } = make(async () => reply());
  assistant.setKey('synthetic-key');
  const input = { state: 'text', questions: question };
  await assistant.advise('reaction-check', input);
  const cached = await assistant.advise('reaction-check', input);
  aiControl.update({ paused: true });
  aiControl.update({ paused: false });
  assert.throws(() => assistant.assertCurrent(cached), { code: 'ai_cancelled' });
  assert.throws(() => assistant.accepted(cached), { code: 'ai_cancelled' });
  assert.equal(assistant.snapshot().counters.applied, 0);
  await assistant.close();
});

test('request and cache identity use the same snapshot when caller mutates state and questions', async () => {
  const bodies = [];
  const { assistant } = make(async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return reply();
  });
  assistant.setKey('synthetic-key');
  const state = { text: 'original' };
  const questions = { relevant: { type: 'noul', instructions: 'Original instruction?' } };
  const pending = assistant.advise('reaction-check', { state, questions });
  state.text = 'mutated';
  questions.relevant.instructions = 'Mutated instruction?';
  const first = await pending;
  assert.equal(first.kind, 'proposal');
  assert.deepEqual(bodies[0], {
    model: 'jev-1.13.0',
    state: { text: 'original' },
    questions: { relevant: { type: 'noul', instructions: 'Original instruction?' } },
  });
  const second = await assistant.advise('reaction-check', {
    state: { text: 'original' },
    questions: { relevant: { type: 'noul', instructions: 'Original instruction?' } },
  });
  assert.equal(second.kind, 'proposal');
  assert.equal(bodies.length, 1);
  assert.equal(assistant.snapshot().counters.cacheHits, 1);
  await assistant.close();
});

test('accepting only a cached proposal marks its original AiControl attempt once', async () => {
  let fetches = 0;
  const { assistant, aiControl } = make(async () => {
    fetches++;
    return reply();
  });
  assistant.setKey('synthetic-key');
  const input = { state: 'text', questions: question };
  const first = await assistant.advise('reaction-check', input);
  assert.equal(first.kind, 'proposal');
  assert.equal(aiControl.data.recent[0].application, 'unconfirmed');
  const cached = await assistant.advise('reaction-check', input);
  assistant.assertCurrent(cached);
  assistant.accepted(cached);
  assert.equal(aiControl.data.recent[0].application, 'accepted');
  assert.equal(fetches, 1);
  assert.equal(aiControl.data.recent.length, 1);
  assert.equal(aiControl.data.recent[0].usage.input, 100);
  assert.equal(aiControl.data.recent[0].estimatedUsd, (100 * 0.042) / 1e6);
  assert.equal(assistant.snapshot().counters.applied, 1);
  await assistant.close();
});

test('global pause cancels in-flight fetch and stale configuration cannot apply a late result', async () => {
  let started;
  const pendingStart = new Promise((resolve) => {
    started = resolve;
  });
  let signal;
  const { assistant, aiControl } = make(async (_url, options) => {
    signal = options.signal;
    started();
    return new Promise((_, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
    );
  });
  assistant.setKey('synthetic-key');
  const pending = assistant.advise('reaction-check', { state: 'text', questions: question });
  await pendingStart;
  aiControl.update({ paused: true });
  assert.equal(signal.aborted, true);
  const result = await pending;
  assert.equal(result.kind, 'abstain');
  assert.equal(aiControl.data.recent[0].status, 'cancelled');
  await assistant.close();
});

test('oversized input abstains locally and probe uses only synthetic text even while mode is off', async () => {
  const bodies = [];
  const { assistant, aiControl } = make(async (_url, options) => {
    bodies.push(options.body);
    return reply();
  }, enabledConfig());
  assistant.setKey('synthetic-key');
  const oversized = await assistant.advise('reaction-check', {
    state: 'x'.repeat(24001),
    questions: question,
  });
  assert.equal(oversized.kind, 'abstain');
  assert.equal(oversized.reason, 'usage');
  assert.equal(bodies.length, 0);
  assert.equal(aiControl.data.recent.length, 0);
  assistant.configure({ ...enabledConfig(), mode: 'off' });
  const snapshot = await assistant.probe();
  assert.equal(bodies.length, 1);
  assert.equal(JSON.stringify(bodies).includes('private'), false);
  assert.equal(snapshot.counters.calls, 1);
  assert.equal(aiControl.data.recent[0].featureId, 'probe');
  assert.equal(JSON.stringify(snapshot).includes('synthetic-key'), false);
  await assistant.close();
});

test('key change aborts an in-flight probe and cannot publish stale connection success', async () => {
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  let requestSignal;
  const { assistant } = make(
    async (_url, options) => {
      requestSignal = options.signal;
      started();
      return new Promise((_, reject) =>
        options.signal.addEventListener('abort', () => reject(options.signal.reason), {
          once: true,
        }),
      );
    },
    { ...enabledConfig(), mode: 'off' },
  );
  assistant.setKey('synthetic-key');
  const pending = assistant.probe();
  await ready;
  assistant.setKey('');
  assert.equal(requestSignal.aborted, true);
  const result = await pending;
  assert.equal(result.configured, false);
  assert.notEqual(result.last?.outcome, 'connected');
  await assistant.close();
});
