import test from 'node:test';
import assert from 'node:assert/strict';
import { createTypeSafeClient, memoryChoiceRequest } from '../server/decision/typesafe-client.js';
import { runProbe } from '../scripts/verify-jev-live.mjs';

const input = {
  query: '다음 게임?',
  candidates: [
    { id: 'm1', text: '농장 게임' },
    { id: 'm2', text: '음식' },
  ],
};
const body = () => ({
  model: 'jev-1.13.0',
  answers: {
    memory: { type: 'choice', choice: 'm1', confidence: 0.95, probabilities: { m1: 0.9, m2: 0.1 } },
  },
  usage: { input_tokens: 99, output_tokens: 4 },
});
const response = (value) => new Response(JSON.stringify(value));

test('official host, bearer header, no redirect, and minimal bounded input projection', async () => {
  const calls = [];
  const client = createTypeSafeClient({
    apiKey: 'synthetic-key',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response(body());
    },
  });
  const result = await client.judge({
    task: 'memory-rerank',
    input: {
      ...input,
      privateTranscript: 'never-send',
      candidates: input.candidates.map((c) => ({ ...c, privateOwner: 'never-send' })),
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer synthetic-key');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.body.includes('never-send'), false);
  assert.deepEqual(result.value.order, ['m1', 'm2']);
  assert.deepEqual(result.usage, { inputTokens: 99, outputTokens: 4 });
});

test('unregistered tasks and invalid candidates are rejected before network access', async () => {
  let calls = 0;
  const client = createTypeSafeClient({
    apiKey: 'synthetic-key',
    fetchImpl: async () => {
      calls++;
      return response(body());
    },
  });
  await assert.rejects(client.judge({ task: 'route-hint', input }), { code: 'invalid_input' });
  for (const invalid of [
    null,
    { ...input, query: '' },
    { ...input, candidates: [] },
    { ...input, candidates: [input.candidates[0], input.candidates[0]] },
    { ...input, query: 'x'.repeat(2001) },
  ]) {
    await assert.rejects(client.judge({ task: 'memory-rerank', input: invalid }), {
      code: 'invalid_input',
    });
  }
  assert.equal(calls, 0);
  assert.throws(() => memoryChoiceRequest(input, 'other-provider'), { code: 'invalid_input' });
});

test('HTTP failures are sanitized, single-attempt, and discard upstream error bodies', async () => {
  for (const [status, code] of [
    [401, 'auth'],
    [403, 'auth'],
    [402, 'usage'],
    [429, 'usage'],
    [500, 'unavailable'],
    [400, 'invalid_response'],
    [302, 'invalid_response'],
  ]) {
    let calls = 0;
    const client = createTypeSafeClient({
      apiKey: 'synthetic-key',
      fetchImpl: async () => {
        calls++;
        return new Response('secret upstream message', { status });
      },
    });
    await assert.rejects(
      client.listModels(),
      (error) => error.code === code && !error.message.includes('secret'),
    );
    assert.equal(calls, 1);
  }
  const client = createTypeSafeClient({
    apiKey: 'synthetic-key',
    fetchImpl: async () => {
      throw Error('secret network detail');
    },
  });
  await assert.rejects(
    client.listModels(),
    (error) => error.code === 'network' && !error.message.includes('secret'),
  );
});

test('invalid provider answers cannot become a decision proposal', async () => {
  const corruptions = [
    (b) => {
      b.answers.memory.choice = 'unknown';
    },
    (b) => {
      b.answers.memory.confidence = 2;
    },
    (b) => {
      b.answers.memory.probabilities.m1 = -1;
    },
    (b) => {
      b.answers.memory.probabilities.m3 = 0;
    },
    (b) => {
      b.answers.memory.choice = 'm2';
    },
    (b) => {
      b.usage.input_tokens = -1;
    },
    (b) => {
      b.model = 'not a model / private data';
    },
  ];
  for (const corrupt of corruptions) {
    const b = body();
    corrupt(b);
    const client = createTypeSafeClient({
      apiKey: 'synthetic-key',
      fetchImpl: async () => response(b),
    });
    await assert.rejects(client.judge({ task: 'memory-rerank', input }), {
      code: 'invalid_response',
    });
  }
});

test('oversized and malformed bodies are rejected and their stream is cancelled', async () => {
  let cancelled = false;
  const client = createTypeSafeClient({
    apiKey: 'synthetic-key',
    fetchImpl: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(65537));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  });
  await assert.rejects(client.listModels(), { code: 'invalid_response' });
  assert.equal(cancelled, true);
  const malformed = createTypeSafeClient({
    apiKey: 'synthetic-key',
    fetchImpl: async () => new Response('not json'),
  });
  await assert.rejects(malformed.listModels(), { code: 'invalid_response' });
});

test('cancellation reaches transport and prevents a late successful answer', async () => {
  const controller = new AbortController();
  let receivedSignal;
  const client = createTypeSafeClient({
    apiKey: 'synthetic-key',
    fetchImpl: async (_url, init) => {
      receivedSignal = init.signal;
      controller.abort(new Error('caller stopped'));
      return response(body());
    },
  });
  await assert.rejects(
    client.judge({ task: 'memory-rerank', input, signal: controller.signal }),
    /caller stopped/,
  );
  assert.equal(receivedSignal.aborted, true);
});

test('live probe makes exactly one model lookup and one synthetic inference and never reports credentials', async () => {
  const urls = [];
  const report = await runProbe({
    apiKey: 'synthetic-credential-must-not-leak',
    fetchImpl: async (url, init) => {
      urls.push(url);
      if (url.endsWith('/models')) return response({ models: [{ name: 'jev-latest' }] });
      const payload = JSON.parse(init.body);
      assert.deepEqual(Object.keys(payload.questions.memory.criteria), ['m1', 'm2', 'm3']);
      const b = body();
      b.answers.memory.probabilities = { m1: 0.9, m2: 0.06, m3: 0.04 };
      return response(b);
    },
  });
  assert.equal(report.status, 'PASS');
  assert.equal(report.fixtureMatched, true);
  assert.equal(report.runtimeApplied, false);
  assert.equal(report.liveProvider, false);
  assert.equal(report.inferenceAttempts, 1);
  assert.equal(urls.length, 2);
  assert.equal(JSON.stringify(report).includes('synthetic-credential-must-not-leak'), false);
  assert.equal(report.usage.outputTokens, 4);
});

test('probe stops before inference on authentication failure or unavailable requested model', async () => {
  for (const reply of [
    new Response('secret', { status: 401 }),
    response({ models: [{ name: 'jev-preview' }] }),
  ]) {
    let calls = 0;
    const report = await runProbe({
      apiKey: 'synthetic-key',
      fetchImpl: async () => {
        calls++;
        return reply;
      },
    });
    assert.equal(report.status, 'FAIL');
    assert.equal(report.inferenceAttempts, 0);
    assert.equal(calls, 1);
  }
});
