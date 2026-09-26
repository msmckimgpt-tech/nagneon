import test from 'node:test';
import assert from 'node:assert/strict';
import { runEvaluation } from '../scripts/evaluate-jev.mjs';

test('offline JEV scenarios validate synthetic responses and never use transport', async () => {
  let calls = 0;
  const result = await runEvaluation({
    fetchImpl: () => {
      calls++;
      throw Error('network forbidden');
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.mode, 'offline');
  assert.ok(result.cases >= 8);
  assert.equal(result.invalid, 0);
  assert.equal(result.qualityMeasured, false);
  assert.equal(result.agreement, null);
  assert.ok(result.results.every((row) => 'fixtureSelected' in row && !('selected' in row)));
});

test('live evaluation requires an explicit key before any transport call', async () => {
  let calls = 0;
  await assert.rejects(
    runEvaluation({
      live: true,
      fetchImpl: () => {
        calls++;
      },
    }),
    /JEV_API_KEY/,
  );
  assert.equal(calls, 0);
});

test('opt-in live runner can use synthetic transport and reports usage without credentials', async () => {
  let calls = 0;
  const key = 'synthetic-private-key';
  const result = await runEvaluation({
    live: true,
    key,
    fetchImpl: async (_url, init) => {
      calls++;
      assert.equal(init.headers.Authorization, 'Bearer ' + key);
      const body = JSON.parse(init.body),
        question = body.questions.judgment;
      const answer =
        question.type === 'noul'
          ? { type: 'noul', noul: 0.5 }
          : (() => {
              const ids = Object.keys(question.criteria);
              return {
                type: 'choice',
                choice: 'keep-existing',
                confidence: 0.96,
                probabilities: Object.fromEntries(
                  ids.map((id) => [id, id === 'keep-existing' ? 0.96 : 0.04 / (ids.length - 1)]),
                ),
              };
            })();
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: 'jev-1.13.0',
          answers: { judgment: answer },
          usage: { input_tokens: 10, output_tokens: 1 },
        }),
      };
    },
  });
  assert.equal(result.mode, 'live');
  assert.equal(calls, result.cases);
  assert.equal(result.invalid, 0);
  assert.equal(result.inputTokens, 10 * calls);
  assert.equal(JSON.stringify(result).includes(key), false);
});

test('live evaluator retains reported tokens and attempt latency when answers are invalid', async () => {
  const result = await runEvaluation({
    live: true,
    key: 'synthetic-key',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'jev-1.13.0',
        answers: { foreign: { type: 'noul', noul: 0.99 } },
        usage: { input_tokens: 10, output_tokens: 1 },
      }),
    }),
  });
  assert.equal(result.invalid, result.cases);
  assert.equal(result.abstained, 0);
  assert.equal(result.inputTokens, result.cases * 10);
  assert.equal(result.estimatedInputUsd, Number(((result.cases * 10 * 0.042) / 1e6).toFixed(9)));
  assert.equal(result.latencyMs.length, result.cases);
  assert.ok(
    result.results.every(
      (row) =>
        row.error === 'invalid_response' &&
        row.inputTokens === 10 &&
        Number.isFinite(row.latencyMs),
    ),
  );
});

test('live evaluator records attempted network latency without inventing token usage or abstention', async () => {
  const result = await runEvaluation({
    live: true,
    key: 'synthetic-key',
    fetchImpl: async () => {
      throw new Error('synthetic network failure');
    },
  });
  assert.equal(result.invalid, result.cases);
  assert.equal(result.abstained, 0);
  assert.equal(result.inputTokens, 0);
  assert.equal(result.latencyMs.length, result.cases);
  assert.ok(
    result.results.every(
      (row) => row.error === 'network' && Number.isFinite(row.latencyMs) && !('inputTokens' in row),
    ),
  );
});
