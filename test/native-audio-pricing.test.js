import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUsage, AiControlData, emptyAiControl } from '../server/ai-control.js';
import { priceUsage } from '../server/ai-pricing.js';
const usage = () =>
  normalizeUsage({
    input_tokens: 132,
    output_tokens: 30,
    total_tokens: 162,
    input_token_details: {
      text_tokens: 119,
      audio_tokens: 13,
      image_tokens: 0,
      cached_tokens: 64,
      cached_tokens_details: { text_tokens: 60, audio_tokens: 4, image_tokens: 0 },
    },
    output_token_details: { text_tokens: 30, audio_tokens: 0 },
  });
const row = (u) => ({
  provider: 'openai',
  pricingVendor: 'openai',
  featureId: 'native-audio',
  model: 'gpt-realtime-2.1',
  status: 'completed',
  usage: u,
});
test('realtime usage retains audio/text/cache categories and applies their own official rates', () => {
  const u = usage();
  assert.equal(u.cached, 64);
  assert.equal(u.modalities.audioInput, 13);
  assert.equal(u.modalities.audioCached, 4);
  const price = priceUsage(row(u));
  assert.equal(price.kind, 'api');
  assert.equal(price.uncertaintyUsd, 0);
  assert.ok(Math.abs(price.usd - (59 * 4 + 60 * 0.4 + 9 * 32 + 4 * 0.4 + 30 * 24) / 1e6) < 1e-12);
  assert.equal(price.audioRates.input, 32);
  assert.equal(AiControlData.safeParse(emptyAiControl()).success, true);
});
test('missing audio details remain unpriced even with a manual text-only rate', () => {
  const price = priceUsage(row({ input: 100, output: 10, cached: 0, total: 110 }), [
    { connection: '', model: 'gpt-realtime-2.1', input: 1, cached: 0, output: 1 },
  ]);
  assert.equal(price.kind, 'unavailable');
  assert.equal(price.usd, null);
});
test('missing cache categories remain explicit and bound uncertainty instead of guessing zero', () => {
  const u = usage();
  u.modalities.textCached = null;
  u.modalities.audioCached = null;
  const price = priceUsage(row(u));
  assert.equal(price.kind, 'api');
  assert.ok(price.uncertaintyUsd > 0);
  u.modalities.audioInput = -1;
  assert.equal(priceUsage(row(u)).kind, 'unavailable');
});
