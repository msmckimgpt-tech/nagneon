import test from 'node:test';
import assert from 'node:assert/strict';
import { JevHttpClient } from '../server/decision/http-client.js';

const questions = {
  keep: {
    type: 'choice',
    instructions: 'Which eligible action best fits this text?',
    criteria: { a: 'Use a', none: 'Keep existing' },
  },
  relevant: { type: 'noul', instructions: 'Is the text relevant?' },
  strength: { type: 'score', instructions: 'How strong?', criteria: ['Weak', 'Strong'] },
};
const answers = {
  keep: { type: 'choice', choice: 'a', probabilities: { a: 0.8, none: 0.2 }, confidence: 0.62 },
  relevant: { type: 'noul', noul: 0.9 },
  strength: {
    type: 'score',
    score: 0.75,
    legend: { 0: 'Weak', 1: 'Strong' },
    probabilities: { 0: 0.25, 1: 0.75 },
    confidence: 0.5,
  },
};
const response = (body) => ({ ok: true, status: 200, json: async () => body });
const valid = (patch = {}) => ({
  model: 'jev-1.13.0',
  answers: structuredClone(answers),
  usage: { input_tokens: 123, output_tokens: 9 },
  ...patch,
});

test('official wire request maps all question IDs and preserves usage', async () => {
  let captured;
  const client = new JevHttpClient({
    apiKey: 'synthetic-key',
    fetchImpl: async (...args) => {
      captured = args;
      return response(valid());
    },
  });
  const usages = [];
  const result = await client.evaluate({
    state: { text: 'hello' },
    questions,
    onUsage: (u) => usages.push(u),
  });
  assert.equal(captured[0], 'https://api.typesafe.ai/v1/systemone');
  assert.equal(captured[1].method, 'POST');
  assert.equal(captured[1].redirect, 'error');
  assert.equal(captured[1].headers.Authorization, 'Bearer synthetic-key');
  assert.equal(captured[1].headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(captured[1].body), {
    model: 'jev-1.13.0',
    state: { text: 'hello' },
    questions,
  });
  assert.deepEqual(result, {
    answers,
    model: 'jev-1.13.0',
    usage: { input_tokens: 123, output_tokens: 9 },
  });
  assert.deepEqual(usages, [{ input_tokens: 123, output_tokens: 9 }]);
  assert.equal(JSON.stringify(result).includes('synthetic-key'), false);
});

test('OpenRouter System One uses only its fixed endpoint and mapped JEV model IDs', async () => {
  for (const [model, wireModel] of [
    ['jev-1.13.0', 'jev-1.13'],
    ['jev-latest', 'jev-latest'],
  ]) {
    let captured;
    const client = new JevHttpClient({
      provider: 'openrouter',
      model,
      apiKey: 'openrouter-synthetic',
      fetchImpl: async (...args) => {
        captured = args;
        return response(
          valid({
            id: 'synthetic-id',
            provider: 'TypeSafe',
            model: 'typesafe/jev-1.13-20260917',
            usage: { input_tokens: 123, output_tokens: 9, cost: 0.00003 },
          }),
        );
      },
    });
    const result = await client.evaluate({ state: 'text', questions });
    assert.equal(captured[0], 'https://openrouter.ai/api/v1/systemone');
    assert.equal(captured[1].redirect, 'error');
    assert.equal(captured[1].credentials, 'omit');
    assert.equal(captured[1].headers.Authorization, 'Bearer openrouter-synthetic');
    assert.equal(JSON.parse(captured[1].body).model, wireModel);
    assert.equal(result.model, 'typesafe/jev-1.13-20260917');
    assert.deepEqual(result.usage, { input_tokens: 123, output_tokens: 9 });
  }
  assert.throws(() => new JevHttpClient({ provider: 'other', apiKey: 'x' }));
  assert.throws(
    () => new JevHttpClient({ provider: 'openrouter', model: 'openai/gpt-4o', apiKey: 'x' }),
  );
});

test('HTTP 402 reports sanitized credit balance failure without reading upstream text', async () => {
  let readBody = false;
  const client = new JevHttpClient({
    provider: 'openrouter',
    apiKey: 'synthetic-key',
    fetchImpl: async () => ({
      ok: false,
      status: 402,
      json: async () => {
        readBody = true;
        throw new Error('upstream-secret');
      },
    }),
  });
  await assert.rejects(client.evaluate({ state: 'text', questions }), (error) => {
    assert.equal(error.code, 'credits');
    assert.equal(error.status, 402);
    assert.equal(String(error).includes('upstream-secret'), false);
    return true;
  });
  assert.equal(readBody, false);
});

test('malformed answer IDs, types, candidate enums, probabilities and score range fail after trustworthy usage is reported', async () => {
  const invalidAnswers = [
    { ...answers, relevant: undefined },
    { ...answers, extra: { type: 'noul', noul: 0.5 } },
    { ...answers, keep: { ...answers.keep, type: 'noul' } },
    { ...answers, keep: { ...answers.keep, choice: 'unlisted' } },
    { ...answers, keep: { ...answers.keep, probabilities: { a: 1 } } },
    { ...answers, keep: { ...answers.keep, probabilities: { a: NaN, none: 0.2 } } },
    { ...answers, keep: { ...answers.keep, confidence: 1.1 } },
    { ...answers, relevant: { type: 'noul', noul: -0.01 } },
    { ...answers, strength: { ...answers.strength, score: 2 } },
    { ...answers, strength: { ...answers.strength, legend: { 0: 'Weak', 1: 2 } } },
  ];
  for (const malformed of invalidAnswers) {
    const usages = [];
    const client = new JevHttpClient({
      apiKey: 'synthetic-key',
      fetchImpl: async () => response(valid({ answers: malformed })),
    });
    await assert.rejects(
      client.evaluate({ state: 'text', questions, onUsage: (u) => usages.push(u) }),
      { code: 'invalid_response' },
    );
    assert.deepEqual(usages, [{ input_tokens: 123, output_tokens: 9 }]);
  }
});

test('missing or malformed usage is never reported', async () => {
  for (const usage of [
    undefined,
    { input_tokens: -1, output_tokens: 0 },
    { input_tokens: NaN, output_tokens: 0 },
  ]) {
    let called = false;
    const client = new JevHttpClient({
      apiKey: 'synthetic-key',
      fetchImpl: async () => response(valid({ usage })),
    });
    await assert.rejects(
      client.evaluate({
        state: 'text',
        questions,
        onUsage: () => {
          called = true;
        },
      }),
      { code: 'invalid_response' },
    );
    assert.equal(called, false);
  }
});

test('request bounds and invalid question shapes fail before fetch', async () => {
  let calls = 0;
  const client = new JevHttpClient({
    apiKey: 'synthetic-key',
    fetchImpl: async () => {
      calls++;
      return response(valid());
    },
  });
  for (const input of [
    { state: 'x'.repeat(24001), questions },
    {
      state: 'x',
      questions: { bad: { type: 'choice', instructions: 'Pick', criteria: { a: 'A' } } },
    },
    { state: 'x', questions: { bad: { type: 'noul', instructions: '' } } },
    { state: 'x', questions: {} },
  ])
    await assert.rejects(client.evaluate(input));
  assert.equal(calls, 0);
});

test('state serialization rejects hidden toJSON hooks and sparse arrays before sending', async () => {
  let calls = 0;
  const client = new JevHttpClient({
    apiKey: 'synthetic-key',
    fetchImpl: async () => {
      calls++;
      return response(valid());
    },
  });
  const disguised = { text: 'safe' };
  Object.defineProperty(disguised, 'toJSON', { value: () => ({ text: 'replaced' }) });
  for (const state of [disguised, Array(2)]) {
    await assert.rejects(client.evaluate({ state, questions }), { code: 'usage' });
  }
  assert.equal(calls, 0);
});

test('structured score criteria accept an official string legend with matching level IDs', async () => {
  const structured = {
    level: {
      type: 'score',
      instructions: { question: 'How useful is the item?' },
      criteria: [
        { label: 'Weak', example: 'No fit' },
        { label: 'Strong', example: 'Good fit' },
      ],
    },
  };
  const client = new JevHttpClient({
    apiKey: 'synthetic-key',
    fetchImpl: async () =>
      response({
        model: 'jev-1.13.0',
        usage: { input_tokens: 5, output_tokens: 1 },
        answers: {
          level: {
            type: 'score',
            score: 0.75,
            legend: { 0: 'Weak', 1: 'Strong' },
            probabilities: { 0: 0.25, 1: 0.75 },
            confidence: 0.5,
          },
        },
      }),
  });
  assert.equal(
    (await client.evaluate({ state: 'text', questions: structured })).answers.level.score,
    0.75,
  );
});

test('HTTP errors and redirects never echo key or response body', async () => {
  for (const status of [301, 401, 422, 429, 529]) {
    const client = new JevHttpClient({
      apiKey: 'synthetic-key',
      fetchImpl: async () => ({
        ok: false,
        status,
        json: async () => ({ private: 'remote-secret' }),
      }),
    });
    await assert.rejects(client.evaluate({ state: 'text', questions }), (error) => {
      assert.equal(String(error).includes('synthetic-key'), false);
      assert.equal(String(error).includes('remote-secret'), false);
      assert.equal(error.status, status);
      return true;
    });
  }
});

test('caller abort cancels the actual fetch', async () => {
  const controller = new AbortController();
  let fetchSignal;
  const client = new JevHttpClient({
    apiKey: 'synthetic-key',
    fetchImpl: async (_url, init) => {
      fetchSignal = init.signal;
      return new Promise((_, reject) =>
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }),
      );
    },
  });
  const pending = client.evaluate({ state: 'text', questions, signal: controller.signal });
  controller.abort(new Error('stopped'));
  await assert.rejects(pending, /stopped/);
  assert.equal(fetchSignal.aborted, true);
});
