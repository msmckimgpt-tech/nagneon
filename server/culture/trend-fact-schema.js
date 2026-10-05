import { z } from 'zod';

const time = z.number().int().nonnegative().max(8.64e15);
const publicUrl = z
  .string()
  .max(2000)
  .refine((value) => {
    try {
      const u = new URL(value);
      if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash) return false;
      if (u.hostname === 'store.steampowered.com')
        return /^\/news\/app\/\d+\/view\/\d+\/?$/.test(u.pathname) && !u.search;
      return (
        u.hostname === 'api.steampowered.com' &&
        /^\/(?:ISteamNews\/GetNewsForApp\/v2|ISteamUserStats\/GetNumberOfCurrentPlayers\/v1)\/$/.test(
          u.pathname,
        ) &&
        [...u.searchParams].every(
          ([k, v]) =>
            ['appid', 'count', 'maxlength', 'feeds'].includes(k) && /^[a-zA-Z0-9_]{1,60}$/.test(v),
        )
      );
    } catch {
      return false;
    }
  }, '허용된 공식 공개 출처 URL이 필요합니다.');

// Durable provenance from the sourced-community format. Validation preserves
// it across world writes; importing this schema performs no source collection.
export const TrendFact = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9:_-]{1,100}$/),
    evidenceKind: z.enum(['official-api', 'synthetic']),
    sourceUrl: publicUrl,
    headline: z.string().trim().min(1).max(200),
    publishedAt: time,
    observedAt: time,
    expiresAt: time,
    tags: z.array(z.string().trim().min(2).max(60)).min(1).max(8),
    metrics: z
      .array(
        z
          .object({
            kind: z.enum(['views', 'comments', 'reactions', 'concurrent-players']),
            scope: z.enum(['topic', 'game']),
            value: z.number().int().nonnegative().max(1e12),
            sourceUrl: publicUrl,
            observedAt: time,
          })
          .strict(),
      )
      .max(4),
  })
  .strict()
  .superRefine((f, ctx) => {
    if (
      f.publishedAt > f.observedAt ||
      f.expiresAt <= f.observedAt ||
      f.expiresAt > f.observedAt + 24 * 3600000 ||
      f.metrics.some(
        (m) =>
          m.observedAt > f.observedAt ||
          f.observedAt - m.observedAt > 3600000 ||
          (m.kind === 'concurrent-players') !== (m.scope === 'game'),
      )
    )
      ctx.addIssue({
        code: 'custom',
        message: '사실의 게시·관측·만료 시각 또는 지표 범위가 잘못되었습니다.',
      });
  });
