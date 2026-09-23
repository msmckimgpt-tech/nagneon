import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { JsonStore } from '../server/storage.js';
import discovery from '../shared/discovery.json' with { type: 'json' };
import {
  communities,
  SOCIAL_LIMITS,
  SocialWorldData,
  SocialPreferencePatch,
  emptySocialWorld,
  socialThreadHash,
} from '../server/social-world-state.js';

const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
function resident(n, viewerId) {
  return {
    id: id(n),
    communityId: 'guide',
    joinedAt: 1000,
    persona: {
      id: viewerId || id(n),
      name: '주민' + n,
      color: '#ffffff',
      role: 'viewer',
      personality: '서로 다른 의견을 듣고 생각하는 사람',
      values: '배우는 과정',
      enabled: true,
      system: false,
      sociability: 0.4,
      expertise: 0.5,
    },
    ...(viewerId ? { viewerId } : {}),
  };
}
function fixture(mention = false) {
  const s = emptySocialWorld(1000);
  s.residents = [resident(1, 'viewer-one'), resident(2)];
  s.threads.push({
    id: id(100),
    communityId: 'guide',
    topicId: 'practice',
    authorId: id(1),
    kind: mention ? 'mention' : 'daily',
    title: '연습 방식',
    text: '실패 원인을 기록하는 편인가요?',
    game: mention ? '합성 게임' : '',
    time: 2000,
    comments: [],
    recommendedBy: [],
    evidence: mention
      ? {
          kind: 'streamer-quote',
          sourceId: id(200),
          sourceHash: 'a'.repeat(64),
          sessionId: id(201),
          at: 1500,
          speaker: '합성 방송자',
          text: '이번에는 순서를 바꿔 보겠습니다.',
          game: '합성 게임',
          witnessId: 'viewer-one',
        }
      : null,
  });
  return s;
}
function reading(s) {
  return {
    id: id(300),
    residentId: id(2),
    threadId: id(100),
    hash: socialThreadHash(s.threads[0]),
    readAt: 2500,
    interested: false,
  };
}
test('공동체 네 곳과 주제 ID는 독립적이며 기존 유입 분류에 연결된다', () => {
  assert.equal(communities.length, 4);
  assert.equal(new Set(communities.map((c) => c.id)).size, 4);
  const topics = communities.flatMap((c) => c.topics.map((t) => t.id));
  assert.equal(new Set(topics).size, topics.length);
  for (const c of communities) {
    assert.ok(discovery[c.discoveryKey]);
    assert.ok(c.norms && c.topics.length);
  }
});
test('새 세계는 비활성·빈 상태이며 인물이나 글을 미리 생성하지 않는다', () => {
  const a = emptySocialWorld(1000),
    b = emptySocialWorld(1000);
  assert.equal(a.preferences.enabled, true);
  assert.equal(a.preferences.notifications, false);
  assert.deepEqual([a.residents, a.threads, a.readings], [[], [], []]);
  assert.notEqual(a.worldId, b.worldId);
  assert.notEqual(a.streamerId, b.streamerId);
});
test('부분 설정 갱신은 요청하지 않은 북마크·숨김·활성 값을 덮어쓰지 않는다', () => {
  assert.deepEqual(SocialPreferencePatch.parse({}), {});
  assert.deepEqual(SocialPreferencePatch.parse({ enabled: true }), { enabled: true });
  assert.equal(SocialPreferencePatch.safeParse({ unrelated: true }).success, false);
});
test('저장 스키마의 JSON 왕복과 실패 검증은 입력을 변경하지 않는다', () => {
  const s = fixture(true),
    before = JSON.stringify(s);
  assert.deepEqual(SocialWorldData.parse(JSON.parse(before)), s);
  assert.equal(JSON.stringify(s), before);
  const bad = { ...s, version: 99 };
  const original = JSON.stringify(bad);
  assert.equal(SocialWorldData.safeParse(bad).success, false);
  assert.equal(JSON.stringify(bad), original);
  assert.equal(SocialWorldData.safeParse({ ...s, unexpected: 'x' }).success, false);
});
const invalid = [
  ['중복 주민', (s) => s.residents.push(structuredClone(s.residents[0]))],
  ['중복 인물', (s) => (s.residents[1].persona.id = s.residents[0].persona.id)],
  ['중복 관객 연결', (s) => (s.residents[1].viewerId = s.residents[0].viewerId)],
  ['다른 인물 연결', (s) => (s.residents[0].viewerId = 'someone-else')],
  ['관객 없는 유입 영수증', (s) => (s.residents[1].arrivalReceiptId = id(400))],
  ['중복 게시글', (s) => s.threads.push(structuredClone(s.threads[0]))],
  ['없는 작성자', (s) => (s.threads[0].authorId = id(999))],
  ['다른 공동체의 주제', (s) => (s.threads[0].topicId = 'routine')],
  [
    '다른 공동체의 추천',
    (s) => {
      s.residents[1].communityId = 'lounge';
      s.threads[0].recommendedBy.push(id(2));
    },
  ],
  [
    '없는 댓글 작성자',
    (s) => s.threads[0].comments.push({ id: id(500), authorId: id(999), text: '댓글', time: 2500 }),
  ],
  ['입주 전 게시글', (s) => (s.threads[0].time = 900)],
  [
    '원글 이전 댓글',
    (s) => s.threads[0].comments.push({ id: id(500), authorId: id(2), text: '댓글', time: 1900 }),
  ],
  ['근거 없는 언급', (s) => (s.threads[0].kind = 'mention')],
  [
    '일상 글의 방문 관심',
    (s) => {
      const r = reading(s);
      r.interested = true;
      s.readings.push(r);
    },
  ],
  [
    '원문 이전 열람',
    (s) => {
      const r = reading(s);
      r.readAt = 1900;
      s.readings.push(r);
    },
  ],
  [
    '다른 본문의 열람 해시',
    (s) => {
      const r = reading(s);
      r.hash = 'b'.repeat(64);
      s.readings.push(r);
    },
  ],
  ['없는 글 북마크', (s) => s.preferences.bookmarks.push(id(999))],
  ['중복 북마크', (s) => s.preferences.bookmarks.push(id(100), id(100))],
  ['잘못된 인물 ID', (s) => (s.residents[0].persona.id = '__proto__')],
  ['음수 시간', (s) => (s.createdAt = -1)],
  ['유한하지 않은 시간', (s) => (s.createdAt = Infinity)],
];
for (const [name, mutate] of invalid)
  test('잘못된 사회 기록 거절: ' + name, () => {
    const s = fixture();
    mutate(s);
    const before = JSON.stringify(s);
    assert.equal(SocialWorldData.safeParse(s).success, false);
    assert.equal(JSON.stringify(s), before);
  });
test('방송 언급은 작성자의 목격 ID와 과거 발언 시각을 요구한다', () => {
  const s = fixture(true);
  assert.equal(SocialWorldData.safeParse(s).success, true);
  const wrong = structuredClone(s);
  wrong.threads[0].evidence.witnessId = 'someone-else';
  assert.equal(SocialWorldData.safeParse(wrong).success, false);
  const future = structuredClone(s);
  future.threads[0].evidence.at = 3000;
  assert.equal(SocialWorldData.safeParse(future).success, false);
});
test('추천과 댓글은 열람한 원문 해시를 바꾸지 않고 본문 수정은 바꾼다', () => {
  const s = fixture(true),
    t = s.threads[0],
    hash = socialThreadHash(t);
  s.readings.push({ ...reading(s), interested: true });
  t.recommendedBy.push(id(2));
  t.comments.push({ id: id(500), authorId: id(2), text: '다른 시각도 있네요.', time: 2500 });
  assert.equal(socialThreadHash(t), hash);
  assert.equal(SocialWorldData.safeParse(s).success, true);
  t.text += '수정';
  assert.notEqual(socialThreadHash(t), hash);
  assert.equal(SocialWorldData.safeParse(s).success, false);
});
test('같은 주민의 같은 글 열람은 한 번만 저장한다', () => {
  const s = fixture();
  s.readings.push(reading(s), { ...reading(s), id: id(301) });
  assert.equal(SocialWorldData.safeParse(s).success, false);
});
test('삭제 출처 표식은 글·관객을 자동 삭제하지 않고 보존한다', () => {
  const s = fixture(true);
  s.forgottenSources.push({ sourceId: id(200), at: 3000 });
  const parsed = SocialWorldData.parse(s);
  assert.equal(parsed.threads.length, 1);
  assert.equal(parsed.residents.length, 2);
  assert.equal(parsed.forgottenSources.length, 1);
});
for (const [field, mutate] of [
  [
    'residents',
    (s) =>
      (s.residents = Array.from({ length: SOCIAL_LIMITS.residents + 1 }, (_, i) =>
        resident(i + 1),
      )),
  ],
  [
    'threads',
    (s) =>
      (s.threads = Array.from({ length: SOCIAL_LIMITS.threads + 1 }, (_, i) => ({
        ...s.threads[0],
        id: id(10000 + i),
      }))),
  ],
  [
    'comments',
    (s) =>
      (s.threads[0].comments = Array.from({ length: SOCIAL_LIMITS.comments + 1 }, (_, i) => ({
        id: id(20000 + i),
        authorId: id(2),
        text: '합성 댓글',
        time: 2500,
      }))),
  ],
  [
    'readings',
    (s) =>
      (s.readings = Array.from({ length: SOCIAL_LIMITS.readings + 1 }, (_, i) => ({
        ...reading(s),
        id: id(30000 + i),
      }))),
  ],
])
  test('보관 개수 상한은 잘라내지 않고 거절한다: ' + field, () => {
    const s = fixture();
    mutate(s);
    const result = SocialWorldData.safeParse(s);
    assert.equal(result.success, false);
    assert.ok(result.error.issues.some((i) => i.code === 'too_big' && i.path.includes(field)));
  });
test('UTF-8 전체 용량 상한을 검사한다', () => {
  const s = fixture(),
    base = s.threads[0];
  s.threads = Array.from({ length: 700 }, (_, i) => ({
    ...base,
    id: id(10000 + i),
    text: '가'.repeat(1000),
    comments: Array.from({ length: 24 }, (_, n) => ({
      id: id(50000 + n),
      authorId: id(2),
      text: '나'.repeat(240),
      time: 2500,
    })),
  }));
  assert.ok(Buffer.byteLength(JSON.stringify(s), 'utf8') > SOCIAL_LIMITS.bytes);
  const result = SocialWorldData.safeParse(s);
  assert.equal(result.success, false);
  assert.ok(result.error.issues.some((i) => i.message.includes('보관 용량')));
});
test('격리 JSON 저장은 재시작 후 보존되며 실패 시 원본을 유지한다', (t) => {
  mkdirSync(resolve('artifacts'), { recursive: true });
  const dir = mkdtempSync(resolve('artifacts', 'social-contract-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = resolve(dir, 'state.json'),
    data = fixture(true);
  const options = {
    validate: (v) => SocialWorldData.parse(v),
    initial: () => emptySocialWorld(1000),
  };
  const store = new JsonStore(file, options);
  store.save(data);
  const before = readFileSync(file);
  assert.deepEqual(new JsonStore(file, options).load(), data);
  assert.throws(() => store.save({ ...data, version: 99 }));
  assert.deepEqual(readFileSync(file), before);
  const failed = new JsonStore(file, {
    ...options,
    fs: {
      renameSync: () => {
        throw Error('합성 저장 실패');
      },
    },
  });
  assert.throws(() => failed.save({ ...data, revision: 1 }), /합성 저장 실패/);
  assert.deepEqual(readFileSync(file), before);
  assert.deepEqual(new JsonStore(file, options).load(), data);
});
