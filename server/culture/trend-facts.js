import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getPublic } from './source.js';

import { TrendFact } from './trend-fact-schema.js';
import { isCurrentStoredTrendFact } from './trend-fact-context.js';

export { TrendFact };
export const factHash = (f) =>
  createHash('sha256')
    .update(JSON.stringify(TrendFact.parse(f)))
    .digest('hex');
export const activeFact = (f, now) =>
  isCurrentStoredTrendFact(f, now) && now - f.publishedAt < 7 * 86400000;

// An absolute game audience is only a game-interest proxy, never issue popularity.
export function factHeat(f, now) {
  if (!activeFact(f, now)) return 0;
  const scales = { views: 10000, comments: 100, reactions: 1000, 'concurrent-players': 100000 };
  const magnitude = Math.max(
    0,
    ...f.metrics.map((m) => {
      if (m.observedAt > now || (m.kind === 'concurrent-players' && now - m.observedAt >= 3600000))
        return 0;
      const score = Math.min(1, Math.log1p(m.value) / Math.log1p(scales[m.kind]));
      return score * (m.scope === 'game' ? 0.35 : 1);
    }),
  );
  const observationHalfLife = f.metrics.some((m) => m.scope === 'topic') ? 6 * 3600000 : 3600000;
  return (
    magnitude *
    2 ** (-(now - f.publishedAt) / (12 * 3600000)) *
    2 ** (-(now - f.observedAt) / observationHalfLife)
  );
}

export class TrendFactInput {
  constructor({ onChange = () => {} } = {}) {
    this.facts = [];
    this.connection = 'disconnected';
    this.generation = 0;
    this.nextReadAt = 0;
    this.onChange = onChange;
  }
  snapshot(now) {
    const active = this.facts.filter((f) => activeFact(f, now));
    return {
      connection: this.connection,
      activeFacts: active.length,
      ...(active.length
        ? {
            validUntil: Math.max(
              ...active.map((f) => Math.min(f.expiresAt, f.publishedAt + 7 * 86400000)),
            ),
          }
        : {}),
    };
  }
  // Atomic replacement; synthetic mode stays visibly separate from live observation.
  ingest(facts, { now, connection = 'synthetic' } = {}) {
    if (!['synthetic', 'connected'].includes(connection))
      throw Error('입력 연결 상태가 잘못되었습니다.');
    const rows = z.array(TrendFact).max(12).parse(facts);
    if (
      !Number.isFinite(now) ||
      rows.some((f) => f.observedAt > now) ||
      rows.some(
        (f) => f.evidenceKind !== (connection === 'connected' ? 'official-api' : 'synthetic'),
      ) ||
      new Set(rows.map((f) => f.id)).size !== rows.length
    )
      throw Error('사실 입력의 시각 또는 ID가 잘못되었습니다.');
    this.facts = structuredClone(rows);
    this.connection = connection;
    this.generation++;
    this.onChange();
  }
  disconnect() {
    this.facts = [];
    this.connection = 'disconnected';
    this.generation++;
    this.onChange();
  }
  resolve(id, hash, now) {
    return this.facts.find((f) => f.id === id && factHash(f) === hash && activeFact(f, now));
  }
  async readSteam(options = {}) {
    options = { now: Date.now, ...options };
    const startedAt = options.now();
    if (!Number.isFinite(startedAt)) throw Error('관측 시각이 잘못되었습니다.');
    if (startedAt < this.nextReadAt) return false;
    this.nextReadAt = startedAt + 3600000;
    const generation = ++this.generation;
    try {
      const facts = await readSteamFacts(options);
      if (generation !== this.generation || options.signal?.aborted) return false;
      this.ingest(facts, { now: options.now(), connection: 'connected' });
      return true;
    } catch (error) {
      if (generation === this.generation) this.disconnect();
      throw error;
    }
  }
}

// Explicit invocation only. Two fixed public GETs, no credentials/body/private context.
// Official API docs: https://partner.steamgames.com/doc/webapi/ISteamNews
// https://partner.steamgames.com/doc/webapi/ISteamUserStats
export async function readSteamFacts({ appId, game, signal, now = Date.now, request = getPublic }) {
  if (
    !Number.isSafeInteger(appId) ||
    appId <= 0 ||
    appId > 1e9 ||
    typeof game !== 'string' ||
    game.trim().length < 2 ||
    game.length > 60
  )
    throw Error('Steam 게임 ID와 게임 이름이 필요합니다.');
  const root = 'https://api.steampowered.com';
  const newsUrl = `${root}/ISteamNews/GetNewsForApp/v2/?appid=${appId}&count=3&maxlength=200&feeds=steam_community_announcements`;
  const playersUrl = `${root}/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appId}`;
  const read = async (url) => {
    const r = await request(url, { signal });
    if (
      r.status !== 200 ||
      r.truncated ||
      !/application\/json/.test(r.headers['content-type'] || '') ||
      /noai|noindex|noarchive|nosnippet/i.test(r.headers['x-robots-tag'] || '')
    )
      throw Error('공식 공개 API를 읽지 못했습니다. 사실 입력은 미연결입니다.');
    return JSON.parse(r.body);
  };
  const news = await read(newsUrl);
  const players = await read(playersUrl);
  signal?.throwIfAborted();
  const observedAt = now();
  if (
    news.appnews?.appid !== appId ||
    !Array.isArray(news.appnews.newsitems) ||
    news.appnews.newsitems.length > 3 ||
    players.response?.result !== 1 ||
    !Number.isSafeInteger(players.response.player_count) ||
    players.response.player_count < 0
  )
    throw Error('공식 공개 API 응답 계약이 맞지 않습니다.');
  return news.appnews.newsitems
    .filter(
      (item) =>
        item.is_external_url === false &&
        item.feedname === 'steam_community_announcements' &&
        /^\d{1,30}$/.test(item.gid) &&
        Number.isSafeInteger(item.date) &&
        item.date * 1000 <= observedAt &&
        observedAt - item.date * 1000 < 7 * 86400000 &&
        typeof item.title === 'string' &&
        item.title.trim() &&
        typeof item.url === 'string' &&
        item.url.startsWith(`https://store.steampowered.com/news/app/${appId}/view/`),
    )
    .map((item) =>
      TrendFact.parse({
        id: `steam:${appId}:${item.gid}`,
        evidenceKind: 'official-api',
        sourceUrl: item.url,
        headline: String(item.title)
          .replace(/<[^>]*>/g, '')
          .slice(0, 200),
        publishedAt: item.date * 1000,
        observedAt,
        expiresAt: observedAt + 3600000,
        tags: [game.trim()],
        metrics: [
          {
            kind: 'concurrent-players',
            scope: 'game',
            value: players.response.player_count,
            sourceUrl: playersUrl,
            observedAt,
          },
        ],
      }),
    );
}
