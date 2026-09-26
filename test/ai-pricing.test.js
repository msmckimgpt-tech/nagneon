import test from 'node:test';
import assert from 'node:assert/strict';
import { AiControl, AiControlData, normalizeUsage } from '../server/ai-control.js';
import { PRICING_CATALOG, priceUsage, pricingVendor } from '../server/ai-pricing.js';

const at = Date.parse('2026-09-24T06:00:00Z');
const usage = {
  input_tokens: 100000,
  output_tokens: 10000,
  input_tokens_details: { cached_tokens: 20000, cache_write_tokens: 30000 },
};
const row = (patch = {}) => ({
  provider: 'openai',
  pricingVendor: 'openai',
  model: 'gpt-6-sol',
  connection: '',
  featureId: 'probe',
  status: 'completed',
  usage: normalizeUsage(usage),
  ...patch,
});
const backend = (patch = {}, fn) => ({
  model: 'gpt-6-sol',
  base: 'https://api.openai.com/v1',
  status: () => ({ kind: 'openai' }),
  react: fn || (async () => ({ usage })),
  ...patch,
});
const call = (ai, provider = backend(), connection = '') =>
  ai.wrap(provider, connection).react({ aiFeature: 'probe' });
const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
const sum = (ai, period = 'today') => ai.snapshot().usage[period].probe;

test('pruning the 501st receipt preserves full period costs through restart', async () => {
  const ai = new AiControl({ now: () => at });
  await call(ai);
  const data = structuredClone(ai.data);
  const receipt = data.recent[0];
  data.recent = Array.from({ length: 500 }, (_, i) => ({
    ...structuredClone(receipt),
    id: `${i.toString(16).padStart(8, '0')}-0000-4000-8000-000000000001`,
  }));
  for (const key of Object.keys(data.days[0].features.probe))
    data.days[0].features.probe[key] *= 500;
  const restored = new AiControl({ data, now: () => at });
  await call(restored);
  assert.equal(restored.data.recent.length, 500);
  assert.equal(sum(restored).calls, 501);
  assert.equal(sum(restored).priced, 501);
  near(sum(restored).estimatedUsd, 501 * 0.279);
  const restarted = new AiControl({ data: restored.data, now: () => at });
  assert.deepEqual(sum(restarted), sum(restored));
});

test('cancelled requests with reported usage retain their API estimate', async () => {
  const ai = new AiControl({ now: () => at });
  let finish;
  const pending = call(
    ai,
    backend({}, (args) => {
      args.onAiUsage(usage);
      return new Promise((resolve) => {
        finish = resolve;
      });
    }),
  );
  ai.update({ paused: true });
  finish({ usage });
  await assert.rejects(pending);
  assert.equal(sum(ai).cancelled, 1);
  assert.equal(sum(ai).priced, 1);
  assert.equal(ai.data.recent[0].status, 'cancelled');
  near(sum(ai).estimatedUsd, 0.279);
});

test('official catalog contains exact current Astra/Sol/Luna Standard rates and provenance', () => {
  assert.equal(PRICING_CATALOG.checkedAt, '2026-09-24');
  for (const [model, input, cached, write, output] of [
    ['gpt-6-astra', 10, 1, 12.5, 50],
    ['gpt-6-sol', 2, 0.2, 2.5, 10],
    ['gpt-6-luna', 0.1, 0.01, 0.125, 0.5],
    ['gpt-5.4-mini', 0.75, 0.075, 0.75, 4.5],
    ['gpt-5.6-luna', 0.2, 0.02, 0.25, 1.2],
    ['gpt-5.3-codex', 1.75, 0.175, 1.75, 14],
  ]) {
    const price = priceUsage(row({ model }));
    near(price.usd, (50000 * input + 20000 * cached + 30000 * write + 10000 * output) / 1e6);
    assert.equal(price.uncertaintyUsd, 0);
    assert.equal(price.source, 'official');
  }
});

test('only the exact official API origin and path can use automatic API rates', () => {
  assert.equal(pricingVendor('https://api.openai.com/v1/'), 'openai');
  for (const base of [
    undefined,
    'http://api.openai.com/v1',
    'https://api.openai.com.evil.test/v1',
    'https://custom.test/v1',
    'https://api.openai.com/v1/proxy',
    'https://secret@api.openai.com/v1',
    'https://api.openai.com/v1?key=secret',
  ])
    assert.equal(pricingVendor(base), 'custom');
  assert.equal(priceUsage(row({ pricingVendor: 'custom' })).reason, 'missing-rate');
  assert.equal(priceUsage(row({ pricingVendor: undefined })).reason, 'missing-rate');
  assert.equal(priceUsage(row({ model: 'gpt-6-sol-unknown-snapshot' })).reason, 'missing-rate');
});

test('cache reads and writes are disjoint from ordinary input, not added twice', () => {
  assert.deepEqual(normalizeUsage(usage), {
    input: 100000,
    output: 10000,
    total: 110000,
    cached: 20000,
    cacheWrite: 30000,
  });
  near(priceUsage(row()).usd, 0.279);
  assert.equal(
    priceUsage(row({ usage: { input: 10, output: 1, cached: 8, cacheWrite: 3 } })).reason,
    'invalid-usage',
  );
});

test('missing cache details produce bounds rather than silently becoming zero', () => {
  const p = priceUsage(
    row({ usage: normalizeUsage({ input_tokens: 100000, output_tokens: 10000 }) }),
  );
  near(p.usd, 0.35);
  near(p.usd - p.uncertaintyUsd, 0.12);
  const withRead = priceUsage(
    row({
      usage: normalizeUsage({
        input_tokens: 100000,
        output_tokens: 10000,
        cached_input_tokens: 20000,
      }),
    }),
  );
  near(withRead.usd, 0.304);
  near(withRead.usd - withRead.uncertaintyUsd, 0.264);
  assert.equal(normalizeUsage({ input_tokens: 100, output_tokens: 10 }).cached, null);
});

test('API long-context threshold is strict and affects the complete request', () => {
  const a = priceUsage(row({ usage: { input: 272000, cached: 0, cacheWrite: 0, output: 100 } }));
  const b = priceUsage(row({ usage: { input: 272001, cached: 0, cacheWrite: 0, output: 100 } }));
  assert.equal(a.longContext, false);
  assert.equal(b.longContext, true);
  near(a.usd, (272000 * 2 + 100 * 10) / 1e6);
  near(b.usd, (272001 * 4 + 100 * 15) / 1e6);
});

test('Codex is a separate Standard-token reference and never a billed API sum', async () => {
  const ai = new AiControl({ now: () => at });
  await call(ai, backend({ status: () => ({ kind: 'codex' }) }));
  assert.equal(sum(ai).priced, 0);
  assert.equal(sum(ai).estimatedUsd, 0);
  assert.equal(sum(ai).referencePriced, 1);
  near(sum(ai).referenceUsd, 0.279);
  assert.equal(ai.data.recent[0].estimatedUsd, null);
  const price = priceUsage(
    row({ provider: 'codex', usage: { input: 900000, cached: 0, cacheWrite: 0, output: 100 } }),
  );
  assert.equal(price.longContext, false);
  near(price.usd, 1.801);
});

test('JEV aliases price reported input as API usage with free or unreported output', () => {
  for (const model of ['jev-1.13.0', 'jev-latest']) {
    for (const reported of [
      { input: 1000000, output: 100000, cached: 200000, cacheWrite: 300000 },
      normalizeUsage({ input_tokens: 1000000 }),
    ]) {
      const price = priceUsage(
        row({ provider: 'jev', pricingVendor: 'custom', model, usage: reported }),
        [{ connection: '', model, input: 10, cached: 1, output: 50 }],
      );
      assert.equal(price.kind, 'api');
      assert.equal(price.reason, 'calculated');
      near(price.usd, 0.042);
      assert.equal(price.uncertaintyUsd, 0);
      assert.equal(price.source, 'official');
      assert.equal(price.longContext, false);
    }
  }
  assert.equal(
    priceUsage(row({ provider: 'jev', model: 'jev-latest', usage: { input: 0 } })).usd,
    0,
  );
});

test('JEV pricing rejects unknown models and missing or invalid input without borrowing rates', () => {
  const jev = row({ provider: 'jev', model: 'jev-1.13.0' });
  for (const model of ['jev-1.13', 'jev-2', 'gpt-6-sol']) {
    const price = priceUsage({ ...jev, model }, [
      { connection: '', model, input: 1, cached: 1, output: 1 },
    ]);
    assert.equal(price.reason, 'missing-rate');
    assert.equal(price.usd, null);
  }
  for (const reported of [null, { input: null, output: 3 }, { total: 100 }]) {
    const price = priceUsage({ ...jev, usage: reported });
    assert.equal(price.reason, 'missing-usage');
    assert.equal(price.usd, null);
  }
  for (const input of [-1, Infinity, NaN]) {
    const price = priceUsage({ ...jev, usage: { input, output: 0 } });
    assert.equal(price.reason, 'invalid-usage');
    assert.equal(price.usd, null);
  }
  assert.equal(priceUsage({ ...jev, status: 'running' }).reason, 'running');
  assert.equal(priceUsage({ ...jev, featureId: 'remote-stt' }).reason, 'unsupported');
  assert.equal(priceUsage(row({ model: 'jev-1.13.0' })).reason, 'missing-rate');
});

test('JEV API receipts and day/session aggregates survive restart without repricing', async () => {
  const ai = new AiControl({ now: () => at });
  const binding = {
    context: () => ({ sessionId: 'jev-session' }),
    onChange: () => {},
    onPolicy: () => {},
  };
  ai.bind(binding);
  ai.startSession('jev-session');
  for (const model of ['jev-1.13.0', 'jev-latest'])
    await call(ai, backend({ model, base: undefined, status: () => ({ kind: 'jev' }) }));
  assert.equal(sum(ai).priced, 2);
  near(sum(ai).estimatedUsd, 0.0084);
  assert.equal(sum(ai).apiUncertaintyUsd, 0);
  assert.equal(sum(ai).referencePriced, 0);
  assert.deepEqual(sum(ai, 'session'), sum(ai));
  for (const receipt of ai.data.recent) {
    assert.equal(receipt.pricing.kind, 'api');
    near(receipt.estimatedUsd, 0.0042);
  }
  const restored = new AiControl({ data: JSON.parse(JSON.stringify(ai.data)), now: () => at });
  restored.bind(binding);
  assert.deepEqual(restored.data.recent, ai.data.recent);
  assert.deepEqual(sum(restored), sum(ai));
  assert.deepEqual(sum(restored, 'session'), sum(ai, 'session'));
});

test('unpriced JEV history backfills retained costs once while preserving aggregate history', async () => {
  const ai = new AiControl({ now: () => at });
  ai.bind({
    context: () => ({ sessionId: 'jev-session' }),
    onChange: () => {},
    onPolicy: () => {},
  });
  ai.startSession('jev-session');
  await call(ai, backend({ model: 'jev-latest', status: () => ({ kind: 'jev' }) }));
  const old = structuredClone(ai.data);
  delete old.recent[0].pricing;
  old.recent[0].estimatedUsd = null;
  for (const bucket of [...old.days, ...old.sessions])
    Object.assign(bucket.features.probe, {
      calls: 8,
      estimatedUsd: 8,
      priced: 7,
      apiUncertaintyUsd: 0.5,
    });
  const before = JSON.stringify(old);
  const restored = new AiControl({ data: old, now: () => at });
  assert.equal(restored.data.recent[0].pricing.backfilled, true);
  assert.equal(restored.data.recent[0].pricing.kind, 'api');
  for (const bucket of [...restored.data.days, ...restored.data.sessions]) {
    assert.equal(bucket.features.probe.calls, 8);
    assert.equal(bucket.features.probe.priced, 8);
    near(bucket.features.probe.estimatedUsd, 8.0042);
    assert.equal(bucket.features.probe.apiUncertaintyUsd, 0.5);
  }
  assert.equal(JSON.stringify(old), before);
  assert.deepEqual(new AiControl({ data: restored.data, now: () => at }).data, restored.data);
  old.days = [];
  old.sessions = [];
  const expired = new AiControl({ data: old, now: () => at });
  assert.deepEqual(expired.data.days, []);
  assert.deepEqual(expired.data.sessions, []);
});

test('unknown total-only usage, unsupported audio, and local execution remain distinct', () => {
  assert.equal(
    priceUsage(row({ usage: normalizeUsage({ total_tokens: 1000 }) })).reason,
    'missing-usage',
  );
  assert.equal(priceUsage(row({ usage: null })).reason, 'missing-usage');
  assert.equal(priceUsage(row({ featureId: 'remote-stt' })).reason, 'unsupported');
  assert.equal(priceUsage(row({ provider: 'ollama' })).kind, 'local');
  assert.equal(priceUsage(row({ status: 'running' })).reason, 'running');
});

test('manual rates take exact connection/model precedence, including genuine zero cost', async () => {
  const ai = new AiControl({ now: () => at });
  ai.update({
    rates: [{ connection: ' paid ', model: ' gpt-6-sol ', input: 0, cached: 0, output: 0 }],
  });
  await call(ai, backend({ base: 'https://custom.test/v1' }), 'paid');
  assert.equal(sum(ai).priced, 1);
  assert.equal(sum(ai).estimatedUsd, 0);
  assert.equal(ai.data.recent[0].pricing.source, 'manual');
  await call(ai, backend({ base: 'https://custom.test/v1' }), 'other');
  assert.equal(sum(ai).priced, 1);
  assert.equal(ai.data.recent[1].pricing.reason, 'missing-rate');
});

test('rate save backfills existing missing costs once and preserves already priced receipts', async () => {
  const ai = new AiControl({ now: () => at });
  const p = backend({ model: 'custom', base: 'https://custom.test/v1' });
  await call(ai, p, 'c');
  assert.equal(sum(ai).priced, 0);
  const rate = {
    connection: 'c',
    model: 'custom',
    input: 1,
    cached: 0.1,
    output: 5,
  };
  ai.update({ rates: [rate] });
  assert.equal(sum(ai).priced, 1);
  near(sum(ai).estimatedUsd, 0.132);
  ai.update({ rates: [{ ...rate, input: 100 }] });
  assert.equal(sum(ai).priced, 1);
  near(sum(ai).estimatedUsd, 0.132);
  const restored = new AiControl({ data: ai.data, now: () => at });
  assert.deepEqual(sum(restored), sum(ai));
});

test('legacy Codex history is backfilled without writes during construction/snapshot', async () => {
  const ai = new AiControl({ now: () => at });
  await call(ai, backend({ status: () => ({ kind: 'codex' }) }));
  const legacy = structuredClone(ai.data);
  delete legacy.recent[0].pricing;
  delete legacy.recent[0].pricingVendor;
  for (const bucket of legacy.days)
    for (const s of Object.values(bucket.features))
      for (const key of [
        'referenceUsd',
        'referenceUncertaintyUsd',
        'referencePriced',
        'apiUncertaintyUsd',
        'localCalls',
      ])
        delete s[key];
  const before = JSON.stringify(legacy);
  let writes = 0;
  const restored = new AiControl({
    data: legacy,
    now: () => at,
    save: () => {
      writes++;
    },
  });
  assert.equal(sum(restored).referencePriced, 1);
  near(sum(restored).referenceUsd, 0.279);
  assert.equal(JSON.stringify(legacy), before);
  assert.equal(writes, 0);
  assert.deepEqual(sum(new AiControl({ data: restored.data, now: () => at })), sum(restored));
});

test('legacy API amounts are retained even at zero and are never counted twice', async () => {
  const ai = new AiControl({ now: () => at });
  await call(ai);
  const old = structuredClone(ai.data);
  delete old.recent[0].pricing;
  const restored = new AiControl({ data: old, now: () => at });
  near(sum(restored).estimatedUsd, sum(ai).estimatedUsd);
  assert.equal(sum(restored).priced, 1);
  assert.equal(restored.data.recent[0].pricing.source, 'legacy');
});

test('backfill preserves aggregates outside retained metadata and never recreates expired buckets', async () => {
  const ai = new AiControl({ now: () => at });
  await call(ai, backend({ status: () => ({ kind: 'codex' }) }));
  const old = structuredClone(ai.data);
  delete old.recent[0].pricing;
  Object.assign(old.days[0].features.probe, {
    calls: 600,
    referenceUsd: 0,
    referencePriced: 0,
    referenceUncertaintyUsd: 0,
    total: 9999999,
  });
  const restored = new AiControl({ data: old, now: () => at });
  assert.equal(sum(restored).calls, 600);
  assert.equal(sum(restored).total, 9999999);
  assert.equal(sum(restored).referencePriced, 1);
  old.days = [];
  old.sessions = [];
  const expired = new AiControl({ data: old, now: () => at });
  assert.deepEqual(expired.data.days, []);
  assert.deepEqual(expired.data.sessions, []);
});

test('today/week/session sums and restart preserve separate API and reference totals', async () => {
  let now = at,
    sessionId = 'cost-session';
  const ai = new AiControl({ now: () => now });
  ai.bind({ context: () => ({ sessionId }), onChange: () => {}, onPolicy: () => {} });
  ai.startSession(sessionId);
  await call(ai);
  await call(ai, backend({ status: () => ({ kind: 'codex' }) }));
  assert.deepEqual(sum(ai, 'today'), sum(ai, 'session'));
  now += 86400000;
  assert.equal(sum(ai, 'today'), undefined);
  assert.equal(sum(ai, 'week').priced, 1);
  const restored = new AiControl({ data: JSON.parse(JSON.stringify(ai.data)), now: () => now });
  assert.deepEqual(sum(restored, 'week'), sum(ai, 'week'));
  assert.doesNotThrow(() => AiControlData.parse(restored.data));
});

test('a rate edit during a running request does not replace its captured price', async () => {
  const ai = new AiControl({ now: () => at });
  let finish;
  ai.update({ rates: [{ connection: '', model: 'gpt-6-sol', input: 1, cached: 1, output: 1 }] });
  const pending = call(
    ai,
    backend(
      {},
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    ),
  );
  ai.update({
    rates: [{ connection: '', model: 'gpt-6-sol', input: 100, cached: 100, output: 100 }],
  });
  finish({ usage });
  await pending;
  near(sum(ai).estimatedUsd, 0.11);
  assert.equal(sum(ai).priced, 1);
});

test('reported usage on failed/cancelled responses remains priced without exposing content or endpoint', async () => {
  const ai = new AiControl({ now: () => at });
  await assert.rejects(
    call(
      ai,
      backend({}, async (args) => {
        args.onAiUsage(usage);
        throw Error('synthetic parse failure');
      }),
    ),
  );
  assert.equal(sum(ai).failed, 1);
  assert.equal(sum(ai).priced, 1);
  assert.equal(ai.data.recent[0].status, 'failed');
  const serialized = JSON.stringify(ai.data);
  assert.ok(!serialized.includes('api.openai.com'));
  assert.ok(!serialized.includes('synthetic parse failure'));
});
