import test from 'node:test';
import assert from 'node:assert/strict';
import {
  publicStoredTrendFact,
  isCurrentStoredTrendFact,
} from '../server/culture/trend-fact-context.js';

const newsUrl = 'https://store.steampowered.com/news/app/123/view/456';
const playersUrl =
  'https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=123';
const fact = () => ({
  id: 'steam-news:123:456',
  evidenceKind: 'official-api',
  sourceUrl: newsUrl,
  headline: '합성 퍼즐 게임의 업데이트 소식',
  publishedAt: 900000,
  observedAt: 1000000,
  expiresAt: 1100000,
  tags: ['퍼즐', '업데이트'],
  metrics: [
    { kind: 'reactions', scope: 'topic', value: 7, sourceUrl: newsUrl, observedAt: 1000000 },
    {
      kind: 'concurrent-players',
      scope: 'game',
      value: 42,
      sourceUrl: playersUrl,
      observedAt: 1000000,
    },
  ],
});

test('stored fact projections retain official and synthetic evidence without requiring metrics', () => {
  for (const evidenceKind of ['official-api', 'synthetic']) {
    const value = { ...fact(), evidenceKind, metrics: [] };
    assert.deepEqual(publicStoredTrendFact(value), value);
    assert.equal(isCurrentStoredTrendFact(value, value.observedAt), true);
  }
});

test('stored fact projections accept canonical official API news URLs', () => {
  const value = fact();
  value.sourceUrl =
    'https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=123&count=2&maxlength=240&feeds=steam_community_announcements';
  assert.deepEqual(publicStoredTrendFact(value), value);
});

test('missing or invalid stored facts do not become public context', () => {
  for (const value of [undefined, null, {}, [], 'news', { ...fact(), evidenceKind: 'rumour' }]) {
    assert.equal(publicStoredTrendFact(value), undefined);
    assert.equal(isCurrentStoredTrendFact(value, 1000000), false);
  }
  const unreadable = Object.defineProperty(fact(), 'headline', {
    get() {
      throw Error('Synthetic unreadable field');
    },
  });
  assert.equal(publicStoredTrendFact(unreadable), undefined);
  assert.equal(isCurrentStoredTrendFact(unreadable, 1000000), false);
});

test('stored fact projections reject unsafe URLs and unknown schema fields', () => {
  for (const sourceUrl of [
    'http://store.steampowered.com/news/app/123/view/456',
    'https://user:password@store.steampowered.com/news/app/123/view/456',
    'https://store.steampowered.com:8443/news/app/123/view/456',
    newsUrl + '#instructions',
    newsUrl + '?tracking=1',
    'https://example.invalid/news/app/123/view/456',
    'https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?token=secret',
  ]) {
    assert.equal(publicStoredTrendFact({ ...fact(), sourceUrl }), undefined, sourceUrl);
    const value = fact();
    value.metrics[0].sourceUrl = sourceUrl;
    assert.equal(publicStoredTrendFact(value), undefined, sourceUrl);
  }
  assert.equal(publicStoredTrendFact({ ...fact(), privateInterest: 1 }), undefined);
  const value = fact();
  value.metrics[0].privateInterest = 1;
  assert.equal(publicStoredTrendFact(value), undefined);
});

test('stored fact projections retain canonical chronology and metric scope validation', () => {
  const invalid = [
    { ...fact(), publishedAt: 1000001 },
    { ...fact(), expiresAt: 1000000 },
    { ...fact(), expiresAt: 1000000 + 24 * 3600000 + 1 },
  ];
  for (const metric of [
    { ...fact().metrics[0], observedAt: 1000001 },
    { ...fact().metrics[0], observedAt: 0 },
    { ...fact().metrics[0], scope: 'game' },
    { ...fact().metrics[1], scope: 'topic' },
  ]) {
    // Put the older metric just outside the schema's one-hour window.
    const observedAt = metric.observedAt === 0 ? 3600001 : 1000000;
    invalid.push({ ...fact(), observedAt, expiresAt: observedAt + 1000, metrics: [metric] });
  }
  for (const value of invalid) {
    assert.equal(publicStoredTrendFact(value), undefined);
    assert.equal(isCurrentStoredTrendFact(value, value.observedAt), false);
  }
});

test('stored fact validity includes the observation instant and excludes the exact expiry', () => {
  const value = fact();
  assert.equal(isCurrentStoredTrendFact(value, value.observedAt - 1), false);
  assert.equal(isCurrentStoredTrendFact(value, value.observedAt), true);
  assert.equal(isCurrentStoredTrendFact(value, value.expiresAt - 1), true);
  assert.equal(isCurrentStoredTrendFact(value, value.expiresAt), false);
  assert.equal(isCurrentStoredTrendFact(value, value.expiresAt + 1), false);
});

test('stored fact validity rejects clocks outside the safe integer date range', () => {
  for (const now of [
    undefined,
    null,
    '1000000',
    NaN,
    Infinity,
    -Infinity,
    -1,
    1000000.5,
    8.64e15 + 1,
    Number.MAX_SAFE_INTEGER,
  ]) {
    assert.equal(isCurrentStoredTrendFact(fact(), now), false);
  }
  const edge = {
    ...fact(),
    publishedAt: 8.64e15 - 2,
    observedAt: 8.64e15 - 1,
    expiresAt: 8.64e15,
    metrics: [],
  };
  assert.equal(isCurrentStoredTrendFact(edge, 8.64e15 - 1), true);
  assert.equal(isCurrentStoredTrendFact(edge, 8.64e15), false);
  const zero = { ...fact(), publishedAt: 0, observedAt: 0, expiresAt: 1, metrics: [] };
  assert.equal(isCurrentStoredTrendFact(zero, 0), true);
});

test('old publication dates and empty metrics do not invalidate a current observation', () => {
  const value = {
    ...fact(),
    publishedAt: 0,
    observedAt: 30 * 24 * 3600000,
    expiresAt: 30 * 24 * 3600000 + 1000,
    metrics: [],
  };
  assert.equal(isCurrentStoredTrendFact(value, value.observedAt), true);
});

test('public projections do not alias input tags, metrics or independent projections', () => {
  const value = fact();
  const first = publicStoredTrendFact(value);
  const second = publicStoredTrendFact(value);
  const expected = structuredClone(value);
  assert.deepEqual(first, expected);
  assert.deepEqual(second, expected);
  assert.notStrictEqual(first, value);
  assert.notStrictEqual(first.tags, value.tags);
  assert.notStrictEqual(first.metrics, value.metrics);
  assert.notStrictEqual(first.metrics[0], value.metrics[0]);
  assert.notStrictEqual(first.tags, second.tags);
  assert.notStrictEqual(first.metrics[1], second.metrics[1]);
  value.tags[0] = '원본 변경';
  value.metrics[0].value = 999;
  first.tags.push('첫 복사본 변경');
  first.metrics[1].value = 100;
  assert.deepEqual(second, expected);
  assert.equal(first.tags[0], expected.tags[0]);
  assert.equal(first.metrics[0].value, expected.metrics[0].value);
  assert.equal(value.metrics[1].value, expected.metrics[1].value);
});

test('expired archived facts remain available as fresh public projections', () => {
  const value = fact();
  assert.equal(isCurrentStoredTrendFact(value, value.expiresAt), false);
  const archived = publicStoredTrendFact(value);
  assert.deepEqual(archived, value);
  archived.tags[0] = '보관 사본 변경';
  archived.metrics[0].value = 0;
  assert.equal(value.tags[0], '퍼즐');
  assert.equal(value.metrics[0].value, 7);
});
