import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Persona } from './schema.js';
import definitions from '../shared/external-communities.json' with { type: 'json' };

export const communities = definitions;
export const SOCIAL_LIMITS = Object.freeze({
  residents: 128,
  threads: 2000,
  comments: 24,
  readings: 8000,
  bytes: 12 * 1024 * 1024,
});
export const socialHash = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const socialTime = z.number().finite().nonnegative().max(8.64e15);
const uuid = z.string().uuid();
const actor = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,40}$/)
  .refine((v) => !['__proto__', 'constructor', 'prototype'].includes(v));
export const communityId = z.enum(definitions.map((d) => d.id));
const topicId = z.enum(definitions.flatMap((d) => d.topics.map((t) => t.id)));
const unique = (values) => new Set(values).size === values.length;
const ids = (max) => z.array(uuid).max(max).refine(unique, '중복된 기록 ID입니다.');
export const SocialPreferences = z
  .object({
    enabled: z.boolean().default(true),
    arrivalsEnabled: z.boolean().default(true),
    notifications: z.boolean().default(false),
    mutedCommunities: z.array(communityId).max(4).refine(unique).default([]),
    mutedTopics: z.array(topicId).max(8).refine(unique).default([]),
    hiddenThreads: ids(SOCIAL_LIMITS.threads).default([]),
    bookmarks: ids(SOCIAL_LIMITS.threads).default([]),
  })
  .strict();
// 기본값이 있는 저장 스키마를 partial()로 만들면 생략한 설정까지 초기화된다.
export const SocialPreferencePatch = z
  .object({
    enabled: z.boolean().optional(),
    arrivalsEnabled: z.boolean().optional(),
    notifications: z.boolean().optional(),
    mutedCommunities: z.array(communityId).max(4).refine(unique).optional(),
    mutedTopics: z.array(topicId).max(8).refine(unique).optional(),
    hiddenThreads: ids(SOCIAL_LIMITS.threads).optional(),
    bookmarks: ids(SOCIAL_LIMITS.threads).optional(),
  })
  .strict();
export const PublicBroadcastQuote = z
  .object({
    kind: z.literal('streamer-quote'),
    sourceId: uuid,
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    sessionId: uuid,
    at: socialTime,
    speaker: z.string().min(1).max(100),
    text: z.string().min(1).max(600),
    game: z.string().max(80),
    witnessId: actor,
  })
  .strict();
export const SocialResident = z
  .object({
    id: uuid,
    communityId,
    persona: Persona,
    joinedAt: socialTime,
    viewerId: actor.optional(),
    arrivalReceiptId: uuid.optional(),
  })
  .strict();
export const SocialThread = z
  .object({
    id: uuid,
    communityId,
    topicId,
    authorId: uuid,
    kind: z.enum(['daily', 'mention']),
    title: z.string().trim().min(1).max(100),
    text: z.string().trim().min(1).max(1000),
    game: z.string().max(80).default(''),
    time: socialTime,
    evidence: PublicBroadcastQuote.nullable(),
    comments: z
      .array(
        z
          .object({
            id: uuid,
            authorId: uuid,
            text: z.string().trim().min(1).max(240),
            time: socialTime,
          })
          .strict(),
      )
      .max(SOCIAL_LIMITS.comments),
    recommendedBy: ids(SOCIAL_LIMITS.residents),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.kind === 'mention') !== !!v.evidence)
      ctx.addIssue({ code: 'custom', message: '방송 언급과 공개 근거가 일치하지 않습니다.' });
  });
export const SocialReading = z
  .object({
    id: uuid,
    residentId: uuid,
    threadId: uuid,
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    readAt: socialTime,
    interested: z.boolean(),
  })
  .strict();
export const SocialWorldData = z
  .object({
    version: z.literal(1),
    worldId: uuid,
    streamerId: uuid,
    createdAt: socialTime,
    revision: z.number().int().nonnegative(),
    preferences: SocialPreferences,
    residents: z.array(SocialResident).max(SOCIAL_LIMITS.residents),
    threads: z.array(SocialThread).max(SOCIAL_LIMITS.threads),
    readings: z.array(SocialReading).max(SOCIAL_LIMITS.readings),
    forgottenSources: z.array(z.object({ sourceId: uuid, at: socialTime }).strict()).max(4000),
  })
  .strict()
  .superRefine((v, ctx) => {
    const bad = (message) => ctx.addIssue({ code: 'custom', message });
    for (const rows of [v.residents, v.threads, v.readings])
      if (!unique(rows.map((r) => r.id))) bad('사회 기록 ID가 중복됩니다.');
    if (!unique(v.residents.filter((r) => r.viewerId).map((r) => r.viewerId)))
      bad('한 관객이 중복 주민으로 연결되었습니다.');
    if (!unique(v.residents.map((r) => r.persona.id))) bad('주민 인물 ID가 중복됩니다.');
    for (const resident of v.residents) {
      if (!actor.safeParse(resident.persona.id).success) bad('주민 인물 ID가 유효하지 않습니다.');
      if (resident.viewerId && resident.viewerId !== resident.persona.id)
        bad('주민 인물과 연결 관객이 일치하지 않습니다.');
      if (resident.arrivalReceiptId && !resident.viewerId) bad('관객 연결 없는 유입 영수증입니다.');
    }
    if (!unique(v.forgottenSources.map((r) => r.sourceId))) bad('삭제 출처가 중복됩니다.');
    const residents = new Map(v.residents.map((r) => [r.id, r])),
      threads = new Map(v.threads.map((r) => [r.id, r]));
    for (const t of v.threads) {
      const author = residents.get(t.authorId);
      if (!definitions.find((d) => d.id === t.communityId)?.topics.some((p) => p.id === t.topicId))
        bad('공동체의 주제가 아닙니다.');
      if (author?.communityId !== t.communityId) bad('작성자와 공동체가 일치하지 않습니다.');
      if (author && t.time < author.joinedAt) bad('입주 전에 게시글을 작성할 수 없습니다.');
      if (!unique(t.comments.map((c) => c.id))) bad('댓글 ID가 중복됩니다.');
      for (const id of [...t.comments.map((c) => c.authorId), ...t.recommendedBy])
        if (residents.get(id)?.communityId !== t.communityId) bad('공동체 참여자가 아닙니다.');
      for (const comment of t.comments) {
        const commentAuthor = residents.get(comment.authorId);
        if (comment.time < t.time || (commentAuthor && comment.time < commentAuthor.joinedAt))
          bad('댓글 시각이 작성 가능한 범위가 아닙니다.');
      }
      if (t.evidence) {
        if (author?.viewerId !== t.evidence.witnessId) bad('작성자의 직접 목격 기록이 아닙니다.');
        if (t.evidence.at > t.time) bad('게시글보다 미래의 방송 근거를 사용할 수 없습니다.');
      }
    }
    if (!unique(v.readings.map((r) => r.residentId + ':' + r.threadId)))
      bad('같은 글의 열람을 중복 집계할 수 없습니다.');
    for (const r of v.readings) {
      const thread = threads.get(r.threadId);
      if (
        !thread ||
        residents.get(r.residentId)?.communityId !== thread.communityId ||
        r.readAt < thread.time ||
        r.hash !== socialThreadHash(thread) ||
        (r.interested && thread.kind !== 'mention')
      )
        bad('열람 출처 또는 시각이 일치하지 않습니다.');
    }
    for (const id of [...v.preferences.hiddenThreads, ...v.preferences.bookmarks])
      if (!threads.has(id)) bad('존재하지 않는 게시글 설정입니다.');
    if (Buffer.byteLength(JSON.stringify(v), 'utf8') > SOCIAL_LIMITS.bytes)
      bad('바깥 이야기 보관 용량에 도달했습니다. 기존 기록은 보존됩니다.');
  });
export function emptySocialWorld(now) {
  return SocialWorldData.parse({
    version: 1,
    worldId: randomUUID(),
    streamerId: randomUUID(),
    createdAt: now,
    revision: 0,
    preferences: {},
    residents: [],
    threads: [],
    readings: [],
    forgottenSources: [],
  });
}
// 댓글과 추천은 처음 접한 본문의 기억을 소급 변경하지 않는다.
export function socialThreadHash(t) {
  return socialHash({
    id: t.id,
    communityId: t.communityId,
    authorId: t.authorId,
    kind: t.kind,
    title: t.title,
    text: t.text,
    game: t.game,
    time: t.time,
    evidence: t.evidence,
  });
}
