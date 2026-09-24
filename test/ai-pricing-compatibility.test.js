import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { AiControl, AiPolicyPatch } from '../server/ai-control.js';

// 기존 배포본의 엄격한 수동 단가 저장 형식. 전용 캐시 쓰기 단가는 여기에 없었다.
const finite = z.number().finite().nonnegative();
const legacyRateSchema = z.object({
  connection: z.string().max(64), model: z.string().min(1).max(200),
  input: finite.max(100000), cached: finite.max(100000), output: finite.max(100000),
}).strict();
const rate = { connection: 'custom-api', model: 'custom-model', input: 1, cached: 0.1, output: 5 };
const usage = { input_tokens: 100000, output_tokens: 10000,
  input_tokens_details: { cached_tokens: 20000, cache_write_tokens: 30000 } };

test('manual rate updates keep the legacy strict schema rather than expanding persisted settings', () => {
  const ai = new AiControl();
  ai.update({ rates: [rate] });
  assert.deepEqual(legacyRateSchema.parse(ai.data.policy.rates[0]), rate);
  assert.equal(AiPolicyPatch.safeParse({ rates: [{ ...rate, cacheWrite: 1.25 }] }).success, false);
  assert.equal(AiPolicyPatch.safeParse({ rates: [{ ...rate, futureField: 1 }] }).success, false);
  assert.deepEqual(ai.data.policy.rates, [rate]);
});

test('manual input rate covers cache writes without changing official cache-write accounting', async () => {
  const ai = new AiControl();
  ai.update({ rates: [rate] });
  const custom = { model: 'custom-model', base: 'https://example.invalid/v1',
    status: () => ({ kind: 'openai' }), react: async () => ({ usage }) };
  await ai.wrap(custom, 'custom-api').react({ aiFeature: 'probe' });
  const row = ai.data.recent[0];
  assert.ok(Math.abs(row.estimatedUsd - 0.132) < 1e-12);
  assert.equal(row.pricing.rates.cacheWrite, 1);
  assert.equal(row.usage.cacheWrite, 30000);
  assert.deepEqual(legacyRateSchema.parse(ai.data.policy.rates[0]), rate);
  const restored = new AiControl({ data: JSON.parse(JSON.stringify(ai.data)) });
  assert.deepEqual(restored.data.policy.rates, [rate]);
  assert.equal(restored.data.recent[0].estimatedUsd, row.estimatedUsd);
  const official = { ...custom, model: 'gpt-6-sol', base: 'https://api.openai.com/v1' };
  await restored.wrap(official).react({ aiFeature: 'probe' });
  assert.equal(restored.data.recent[1].pricing.rates.cacheWrite, 2.5);
  assert.ok(Math.abs(restored.data.recent[1].estimatedUsd - 0.279) < 1e-12);
});
