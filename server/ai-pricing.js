import { z } from 'zod';

// Checked against official Standard API prices, not account billing or Codex credits.
// Exact IDs only: never borrow another model's price or trust a compatible API's name.
export const PRICING_CATALOG = Object.freeze({
  checkedAt: '2026-09-24',
  source: 'https://developers.openai.com/api/docs/pricing',
  models: [
    {
      model: 'gpt-6-astra',
      input: 10,
      cached: 1,
      cacheWrite: 12.5,
      output: 50,
      longThreshold: 272000,
    },
    {
      model: 'gpt-6-sol',
      input: 2,
      cached: 0.2,
      cacheWrite: 2.5,
      output: 10,
      longThreshold: 272000,
    },
    {
      model: 'gpt-6-luna',
      input: 0.1,
      cached: 0.01,
      cacheWrite: 0.125,
      output: 0.5,
      longThreshold: 272000,
    },
    // https://developers.openai.com/api/docs/models/gpt-5.4-mini
    { model: 'gpt-5.4-mini', input: 0.75, cached: 0.075, cacheWrite: 0.75, output: 4.5 },
    // https://developers.openai.com/api/docs/models/gpt-5.6-luna
    {
      model: 'gpt-5.6-luna',
      input: 0.2,
      cached: 0.02,
      cacheWrite: 0.25,
      output: 1.2,
      longThreshold: 272000,
    },
    { model: 'gpt-5.3-codex', input: 1.75, cached: 0.175, cacheWrite: 1.75, output: 14 },
  ].map(Object.freeze),
});
const finite = z.number().finite().nonnegative();
export const costStatsShape = {
  apiUncertaintyUsd: finite.default(0),
  referenceUsd: finite.default(0),
  referenceUncertaintyUsd: finite.default(0),
  referencePriced: finite.default(0),
  localCalls: finite.default(0),
};
export const zeroCostStats = () =>
  Object.fromEntries(Object.keys(costStatsShape).map((key) => [key, 0]));
export const pricingSchema = z.object({
  kind: z.enum(['api', 'reference', 'local', 'unavailable']),
  reason: z.enum([
    'calculated',
    'missing-rate',
    'missing-usage',
    'invalid-usage',
    'unsupported',
    'running',
    'local',
  ]),
  usd: finite.nullable(),
  uncertaintyUsd: finite,
  source: z.enum(['official', 'manual', 'legacy', 'none']),
  checkedAt: z.string().max(32),
  longContext: z.boolean(),
  backfilled: z.boolean().optional(),
  rates: z.object({ input: finite, cached: finite, cacheWrite: finite, output: finite }).optional(),
});
const unavailable = (reason) => ({
  kind: 'unavailable',
  reason,
  usd: null,
  uncertaintyUsd: 0,
  source: 'none',
  checkedAt: '',
  longContext: false,
});

// Persist only the classification, never an endpoint URL, key, or authentication data.
export function pricingVendor(base) {
  try {
    const url = new URL(base);
    return url.origin === 'https://api.openai.com' &&
      url.pathname.replace(/\/$/, '') === '/v1' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
      ? 'openai'
      : 'custom';
  } catch {
    return 'custom';
  }
}

export function priceUsage(row, customRates = []) {
  if (row.status === 'running') return unavailable('running');
  if (row.provider === 'ollama') return { ...unavailable('local'), kind: 'local' };
  if (!['openai', 'codex'].includes(row.provider) || row.featureId === 'remote-stt')
    return unavailable('unsupported');
  const usage = row.usage;
  if (usage?.input == null || usage?.output == null) return unavailable('missing-usage');
  const valid = (n) => Number.isFinite(n) && n >= 0;
  if (
    !valid(usage.input) ||
    !valid(usage.output) ||
    (usage.cached != null && !valid(usage.cached)) ||
    (usage.cacheWrite != null && !valid(usage.cacheWrite)) ||
    (usage.cached ?? 0) + (usage.cacheWrite ?? 0) > usage.input
  )
    return unavailable('invalid-usage');
  const manual = customRates.find((r) => r.connection === row.connection && r.model === row.model);
  const official =
    row.provider === 'codex' || row.pricingVendor === 'openai'
      ? PRICING_CATALOG.models.find((r) => r.model === row.model)
      : undefined;
  const rate = manual || official;
  if (!rate) return unavailable('missing-rate');
  const kind = row.provider === 'codex' ? 'reference' : 'api';
  // Codex usage is turn-aggregated, not a single API prompt: do not apply a
  // per-request long-context multiplier to its aggregate input count.
  const longContext =
    kind === 'api' && !manual && !!rate.longThreshold && usage.input > rate.longThreshold;
  const inputMultiplier = longContext ? 2 : 1;
  const rates = {
    input: rate.input * inputMultiplier,
    cached: rate.cached * inputMultiplier,
    cacheWrite: (rate.cacheWrite ?? rate.input) * inputMultiplier,
    output: rate.output * (longContext ? 1.5 : 1),
  };
  // Missing cache fields stay missing in the ledger. Bound their contribution
  // over all feasible read/write/ordinary-input allocations instead of using 0.
  const knownRead = usage.cached ?? 0;
  const knownWrite = usage.cacheWrite ?? 0;
  const remaining = usage.input - knownRead - knownWrite;
  const possible = [rates.input];
  if (usage.cached == null) possible.push(rates.cached);
  if (usage.cacheWrite == null) possible.push(rates.cacheWrite);
  const fixed =
    knownRead * rates.cached + knownWrite * rates.cacheWrite + usage.output * rates.output;
  const minimum = (fixed + remaining * Math.min(...possible)) / 1e6;
  const maximum = (fixed + remaining * Math.max(...possible)) / 1e6;
  if (!Number.isFinite(maximum)) return unavailable('invalid-usage');
  return {
    kind,
    reason: 'calculated',
    usd: maximum,
    uncertaintyUsd: Math.max(0, maximum - minimum),
    source: manual ? 'manual' : 'official',
    checkedAt: manual ? '' : PRICING_CATALOG.checkedAt,
    longContext,
    rates,
  };
}

export function addPriceToStats(stats, price) {
  if (price.kind === 'api' && price.usd !== null) {
    stats.estimatedUsd += price.usd;
    stats.apiUncertaintyUsd += price.uncertaintyUsd;
    stats.priced++;
  } else if (price.kind === 'reference' && price.usd !== null) {
    stats.referenceUsd += price.usd;
    stats.referenceUncertaintyUsd += price.uncertaintyUsd;
    stats.referencePriced++;
  } else if (price.kind === 'local') stats.localCalls++;
}

// Backfill only retained, previously unpriced metadata; never rebuild long-term
// aggregates from the 40 UI rows, recreate an expired bucket, or reprice a receipt.
export function backfillPrices(data) {
  for (const row of data.recent) {
    if (row.status === 'running' || row.pricing?.kind === 'local' || row.pricing?.usd != null)
      continue;
    if (row.estimatedUsd !== null) {
      row.pricing = {
        ...unavailable('calculated'),
        kind: 'api',
        source: 'legacy',
        usd: row.estimatedUsd,
      };
      continue; // This amount is already in the legacy day/session sums.
    }
    const price = { ...priceUsage(row, data.policy.rates), backfilled: true };
    row.pricing = price;
    if (price.kind === 'api') row.estimatedUsd = price.usd;
    const buckets = [
      data.days.find((d) => d.day === row.day),
      data.sessions.find((s) => s.id === row.sessionId),
    ];
    for (const bucket of buckets) {
      const stats = bucket?.features[row.featureId];
      if (stats) addPriceToStats(stats, price);
    }
  }
}
