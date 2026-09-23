import { z } from 'zod';
import { randomUUID, createHash } from 'node:crypto';
import { Persona } from './schema.js';
import {
  SocialPreferences,
  SocialPreferencePatch,
  SocialWorldData,
  communities,
} from './social-world-state.js';
export { communities, SocialPreferencePatch };
export const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const time = z.number().finite().nonnegative();
const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const cid = z.enum(communities.map((c) => c.id));
export const Source = z
  .object({ id: uuid, hash, at: time, witnessId: z.string().min(1).max(40) })
  .strict();
const resident = z
  .object({
    id: uuid,
    communityId: cid,
    persona: Persona,
    joinedAt: time,
    admitted: z.boolean(),
    arrivalReceiptId: uuid.optional(),
  })
  .strict();
const thread = z
  .object({
    id: uuid,
    communityId: cid,
    topicId: z.string().max(40),
    residentId: uuid,
    kind: z.enum(['daily', 'mention']),
    title: z.string().min(1).max(100),
    text: z.string().min(1).max(600),
    at: time,
    source: Source.nullable(),
  })
  .strict();
const receipt = z
  .object({
    id: uuid,
    residentId: uuid,
    threadId: uuid,
    threadHash: hash,
    deliveredHash: hash,
    operationId: uuid,
    receivedAt: time,
    receivedLiveSequence: time.int(),
    eligibleFromLiveSequence: time.int(),
    interested: z.boolean(),
    source: Source,
  })
  .strict();
export const SocialRuntimeData = z
  .object({
    version: z.literal(2),
    profileGeneration: uuid,
    revision: time.int(),
    liveSequence: time.int(),
    quarantined: z.boolean(),
    preferences: SocialPreferences,
    residents: z.array(resident).max(128),
    threads: z.array(thread).max(2000),
    receipts: z.array(receipt).max(8000),
    tombstones: z.array(z.string().min(1).max(100)).max(4000),
    legacy: SocialWorldData.nullable(),
  })
  .strict()
  .superRefine((d, ctx) => {
    for (const rows of [d.residents, d.threads, d.receipts])
      if (new Set(rows.map((r) => r.id)).size !== rows.length)
        ctx.addIssue({ code: 'custom', message: '사회 기록 ID가 중복됩니다.' });
    if (new Set(d.residents.map((r) => r.persona.id)).size !== d.residents.length)
      ctx.addIssue({ code: 'custom', message: '주민 연결이 중복됩니다.' });
    const residents = new Map(d.residents.map((r) => [r.id, r]));
    const threads = new Map(d.threads.map((t) => [t.id, t]));
    for (const t of d.threads) {
      const r = residents.get(t.residentId);
      if (
        !r ||
        r.communityId !== t.communityId ||
        r.joinedAt > t.at ||
        (t.kind === 'mention') !== !!t.source ||
        (t.source && (t.source.at > t.at || t.source.witnessId !== r.persona.id))
      )
        ctx.addIssue({ code: 'custom', message: '게시글의 작성자와 근거가 맞지 않습니다.' });
    }
    for (const r of d.receipts) {
      const t = threads.get(r.threadId);
      if (
        !residents.has(r.residentId) ||
        !t ||
        t.at > r.receivedAt ||
        r.eligibleFromLiveSequence !== r.receivedLiveSequence + 1
      )
        ctx.addIssue({ code: 'custom', message: '열람 기록의 연결과 방송 순서가 맞지 않습니다.' });
    }
    if (Buffer.byteLength(JSON.stringify(d)) > 12 * 1024 * 1024)
      ctx.addIssue({ code: 'custom', message: '커뮤니티 보관 공간이 가득 찼습니다.' });
  });
export const emptySocialRuntime = () => ({
  version: 2,
  profileGeneration: randomUUID(),
  revision: 0,
  liveSequence: 0,
  quarantined: false,
  preferences: SocialPreferences.parse({}),
  residents: [],
  threads: [],
  receipts: [],
  tombstones: [],
  legacy: null,
});
export function migrateSocial(value) {
  if (!value) return emptySocialRuntime();
  if (value.version === 2) return SocialRuntimeData.parse(value);
  const legacy = SocialWorldData.parse(value);
  return { ...emptySocialRuntime(), preferences: legacy.preferences, legacy };
}
