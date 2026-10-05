import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { startServer } from '../server/index.js';
import { socialContentHash, socialDiscussionHash } from '../server/social-content.js';
import { communities, digest } from '../server/social-runtime-state.js';
import { TrendFact } from '../server/culture/trend-fact-schema.js';

// All data and observations below are synthetic protocol fixtures, not fetched news.
const clock = 1800000000000;
const person = (id, name) => ({
  id,
  name,
  color: '#8bcdd2',
  role: 'viewer',
  enabled: true,
  system: false,
  personality: 'PRIVATE_RESIDENT_PERSONALITY',
  values: 'PRIVATE_RESIDENT_VALUES',
  expertise: 0.4,
  sociability: 0.6,
});
const fact = (patch = {}) => ({
  id: 'steam-news:123:456',
  evidenceKind: 'official-api',
  sourceUrl: 'https://store.steampowered.com/news/app/123/view/456',
  headline: '합성 프로토콜 fixture의 퍼즐 업데이트',
  publishedAt: clock - 10000,
  observedAt: clock - 2000,
  expiresAt: clock + 600000,
  tags: ['퍼즐', '업데이트'],
  metrics: [
    {
      kind: 'concurrent-players',
      scope: 'game',
      value: 42,
      sourceUrl:
        'https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=123',
      observedAt: clock - 2000,
    },
  ],
  ...patch,
});
const response = (id = 'trend-reader', patch = {}) => ({
  observation: {
    game: '가상 공동체',
    scene: '',
    confidence: 0.7,
    excitement: 0.2,
    messages: [
      { personaId: id, text: '이번 길은 스페이스로 넘겨봐', kind: 'chat', spoiler: false },
    ],
    communityVotes: [{ personaId: id, recommended: true }],
    ...patch,
  },
  usage: { total_tokens: 3 },
});

async function fixture(t, { persist = false, dataDir, react } = {}) {
  let now = clock;
  const calls = [];
  const service = await startServer({
    port: 0,
    persist,
    dataDir,
    localSpeech: false,
    provider: {
      status: () => ({ configured: true }),
      check: async () => {},
      react: async (request, signal) => {
        calls.push(request);
        return react ? react(request, signal) : response(request.settings.personas[0].id);
      },
    },
  });
  const s = service.studio;
  clearInterval(s.timer);
  s.now = () => now;
  s.settings.mode = 'live';
  s.ai.update({ background: true });
  if (t) t.after(() => service.close());
  const author = {
    id: randomUUID(),
    communityId: 'guide',
    persona: person('trend-author', '합성 원글 주민'),
    joinedAt: clock - 100000,
    admitted: false,
  };
  const reader = {
    id: randomUUID(),
    communityId: 'guide',
    persona: person('trend-reader', '합성 읽는 주민'),
    joinedAt: clock - 100000,
    admitted: false,
  };
  const add = (trendFact, { comments = 0, text = '합성 게시글의 퍼즐 길을 살펴봤다' } = {}) => {
    const at = Math.max(clock - 1000, trendFact?.observedAt || 0);
    const thread = {
      id: randomUUID(),
      communityId: 'guide',
      topicId: 'practice',
      residentId: author.id,
      kind: 'daily',
      title: text,
      text,
      at,
      source: null,
      votes: [],
      activityReads: [],
      comments: Array.from({ length: comments }, (_, i) => ({
        id: randomUUID(),
        residentId: null,
        name: '합성 댓글 작성자',
        text: `조작 설정에 관한 합성 의논 ${i}`,
        parentId: null,
        at,
      })),
      ...(trendFact ? { trendFact: structuredClone(trendFact) } : {}),
    };
    s.world.change((w) => {
      if (!w.socialWorld.residents.length) w.socialWorld.residents.push(author, reader);
      w.socialWorld.threads.push(thread);
    });
    return thread.id;
  };
  const current = (id) => s.social.data().threads.find((thread) => thread.id === id);
  const target = (id) => {
    const thread = current(id);
    return {
      kind: 'social-discuss',
      id,
      viewer: structuredClone(reader.persona),
      raw: {
        residentId: reader.id,
        communityId: 'guide',
        topicId: 'practice',
        threadId: id,
        threadHash: socialContentHash(thread),
        discussionHash: socialDiscussionHash(thread, reader.id),
      },
      revision: socialDiscussionHash(thread, reader.id),
      weight: 1,
    };
  };
  const run = async (selected) => {
    const operation = { controller: new AbortController(), epoch: s.epoch, social: true };
    s.communityActivity.active = operation;
    operation.promise = s.communityActivity.run(selected, operation);
    try {
      await operation.promise;
    } finally {
      if (s.communityActivity.active === operation) s.communityActivity.active = null;
      s.busy = false;
    }
  };
  return {
    ...service,
    s,
    calls,
    author,
    reader,
    add,
    current,
    target,
    run,
    setNow: (value) => {
      now = value;
    },
  };
}
const get = (f, path) =>
  fetch(f.url + '/api/' + path, {
    headers: {
      Authorization: 'Bearer ' + f.accessToken,
      'X-Backseat-Client': 'studio',
    },
  });
const assertNoEffects = (f, id, before) => {
  assert.deepEqual(f.current(id), before);
  assert.equal(f.s.social.data().receipts.length, 0);
};

test('stored provenance is additive, canonical, independently cloned and read-only on list/detail/API', async (t) => {
  const f = await fixture(t),
    official = fact(),
    synthetic = fact({ id: 'synthetic:456', evidenceKind: 'synthetic' });
  const officialId = f.add(official),
    syntheticId = f.add(synthetic),
    plainId = f.add();
  const before = structuredClone(f.s.world.data);
  for (const [id, expected, status] of [
    [officialId, official, 'observed'],
    [syntheticId, synthetic, 'synthetic'],
  ]) {
    const detail = f.s.social.detail(id),
      list = f.s.social.list().posts.find((p) => p.id === id);
    for (const dto of [detail, list]) {
      assert.deepEqual(dto.externalFact, expected);
      assert.equal(dto.externalFactStatus, status);
      assert.equal(dto.reactionKind, 'fictional-personal-reaction');
      assert.equal(dto.sourceStatus, 'daily');
      assert.ok(!JSON.stringify(dto).includes('PRIVATE_RESIDENT'));
      for (const key of ['trendFact', 'residentId', 'source', 'receipts', 'activityReads'])
        assert.ok(!Object.hasOwn(dto, key), key);
    }
    detail.externalFact.tags[0] = 'client mutation';
    detail.externalFact.metrics[0].value = 999;
    assert.deepEqual(list.externalFact, expected);
    for (let i = 0; i < 3; i++) {
      const api = await get(f, 'social/threads/' + id);
      assert.equal(api.status, 200);
      assert.deepEqual((await api.json()).externalFact, expected);
    }
  }
  for (const key of ['externalFact', 'externalFactStatus', 'reactionKind'])
    assert.ok(!Object.hasOwn(f.s.social.detail(plainId), key));
  const listApi = await get(f, 'social/search');
  assert.equal(listApi.status, 200);
  assert.equal((await listApi.json()).posts.length, 3);
  assert.equal((await fetch(f.url + '/api/social/threads/' + officialId)).status, 401);
  assert.deepEqual(f.s.world.data, before);
  assert.equal(f.calls.length, 0);
});

test('expired and future facts stay public archives but never become automatic discussion candidates', async (t) => {
  const f = await fixture(t);
  const expired = f.add(fact({ expiresAt: clock - 1 }));
  const future = f.add(
    fact({ publishedAt: clock, observedAt: clock + 1000, expiresAt: clock + 2000, metrics: [] }),
  );
  for (const id of [expired, future]) {
    const before = structuredClone(f.current(id));
    assert.equal(f.s.social.detail(id).externalFactStatus, 'expired');
    assert.ok(
      !f.s.social.candidates(clock).some((c) => c.kind === 'social-discuss' && c.id === id),
    );
    assert.deepEqual(f.current(id), before);
  }
  const active = f.add(fact()),
    plain = f.add();
  assert.ok(
    f.s.social.candidates(clock).some((c) => c.kind === 'social-discuss' && c.id === plain),
  );
  f.s.world.change((w) => {
    w.socialWorld.threads = w.socialWorld.threads.filter((thread) => thread.id !== plain);
  });
  assert.ok(
    f.s.social.candidates(clock).some((c) => c.kind === 'social-discuss' && c.id === active),
  );
  assert.equal(f.calls.length, 0);
});

test('an old publication freshly observed now is eligible without an invented publication-age cutoff', async (t) => {
  const f = await fixture(t),
    old = fact({ publishedAt: clock - 30 * 86400000 }),
    id = f.add(old);
  const selected = f.s.social
    .candidates(clock)
    .find((c) => c.kind === 'social-discuss' && c.id === id && c.viewer.id === f.reader.persona.id);
  assert.ok(selected);
  await f.run(selected);
  assert.deepEqual(f.calls[0].special.externalFact, old);
  assert.equal(f.s.social.detail(id).externalFactStatus, 'observed');
  assert.equal(f.current(id).comments.length, 1);
});

test('a 1999-thread sweep uses its supplied clock for 128 residents and preserves the 2000-thread cap', async (t) => {
  const f = await fixture(t),
    currentId = f.add(fact()),
    template = structuredClone(f.current(currentId));
  f.s.world.change((w) => {
    for (let i = 2; i < 128; i++)
      w.socialWorld.residents.push({
        ...structuredClone(f.reader),
        id: randomUUID(),
        persona: person('reader-' + i, '합성 주민 ' + i),
      });
    for (let i = 1; i < 1999; i++)
      w.socialWorld.threads.push({
        ...structuredClone(template),
        id: randomUUID(),
        trendFact: fact({ expiresAt: clock - 1 }),
      });
  });
  const now = f.s.now;
  f.s.now = () => {
    throw Error('candidate sweep must use the supplied instant');
  };
  const selected = f.s.social.candidates(clock).filter((c) => c.kind === 'social-discuss');
  assert.equal(selected.length, 127);
  assert.ok(selected.every((c) => c.id === currentId));
  f.s.world.change((w) =>
    w.socialWorld.threads.push({ ...structuredClone(template), id: randomUUID() }),
  );
  assert.deepEqual(f.s.social.candidates(clock), []);
  f.s.now = now;
  assert.equal(f.calls.length, 0);
});

test('present but malformed stored provenance is never treated as an unsourced discussion', async (t) => {
  const f = await fixture(t),
    id = f.add(fact()),
    original = structuredClone(f.current(id).trendFact);
  // Valid WorldData rejects these values; direct corruption exercises consumer defense only.
  for (const malformed of [null, 0, '']) {
    f.current(id).trendFact = malformed;
    const before = structuredClone(f.current(id)),
      selected = f.target(id);
    for (const key of ['externalFact', 'externalFactStatus', 'reactionKind'])
      assert.ok(!Object.hasOwn(f.s.social.detail(id), key));
    assert.ok(
      !f.s.social.candidates(clock).some((c) => c.kind === 'social-discuss' && c.id === id),
    );
    await f.s.social.run(selected, { controller: new AbortController(), epoch: f.s.epoch });
    assertNoEffects(f, id, before);
  }
  f.current(id).trendFact = original;
  assert.equal(f.calls.length, 0);
});

test('expiry during request preparation prevents the provider call and retains the saved attempt', async (t) => {
  const f = await fixture(t),
    id = f.add(fact()),
    selected = f.target(id),
    before = structuredClone(f.current(id));
  const name = selected.viewer.name;
  Object.defineProperty(selected.viewer, 'name', {
    enumerable: true,
    get() {
      f.setNow(clock + 600000);
      return name;
    },
  });
  await f.run(selected);
  assert.equal(f.calls.length, 0);
  assert.equal(f.s.communityActivity.data().attempts.length, 1);
  assertNoEffects(f, id, before);
});

test('the expiry fence and accepted comment/read timestamps use one captured save-boundary instant', async (t) => {
  const f = await fixture(t),
    id = f.add(fact()),
    acceptedAt = clock + 599999;
  const change = f.s.social.change.bind(f.s.social);
  f.s.social.change = (edit) => {
    const previousNow = f.s.now;
    let instant = acceptedAt;
    f.s.now = () => {
      const result = instant;
      instant = clock + 600000;
      return result;
    };
    try {
      return change(edit);
    } finally {
      f.s.now = previousNow;
      f.setNow(clock + 600000);
    }
  };
  await f.run(f.target(id));
  assert.equal(f.current(id).comments.length, 1);
  assert.equal(f.current(id).activityReads.length, 1);
  assert.equal(f.current(id).comments[0].at, acceptedAt);
  assert.equal(f.current(id).activityReads[0].at, acceptedAt);
  assert.equal(f.s.social.detail(id).externalFactStatus, 'expired');
  assert.deepEqual(f.current(id).trendFact, fact());
});

for (const boundary of ['before-call', 'after-response', 'before-save'])
  test(
    'expiry at ' + boundary + ' keeps the prepaid attempt and publishes no discussion effects',
    async (t) => {
      let f;
      f = await fixture(t, {
        react: async (request) => {
          if (boundary === 'after-response') f.setNow(clock + 600000);
          return response(request.settings.personas[0].id);
        },
      });
      const id = f.add(fact()),
        selected = f.target(id),
        before = structuredClone(f.current(id));
      if (boundary === 'before-call') f.setNow(clock + 600000);
      if (boundary === 'before-save') {
        const change = f.s.social.change.bind(f.s.social);
        f.s.social.change = (edit) => {
          f.setNow(clock + 600000);
          return change(edit);
        };
      }
      if (boundary === 'before-save') await assert.rejects(f.run(selected), /커뮤니티|상태/);
      else await f.run(selected);
      assert.equal(f.calls.length, boundary === 'before-call' ? 0 : 1);
      assert.equal(f.s.communityActivity.data().attempts.length, 1);
      assertNoEffects(f, id, before);
    },
  );

test('provider receives complete evidence while mutating its fact/topic/persona cannot mutate records or the fence', async (t) => {
  let f;
  f = await fixture(t, {
    react: async (request) => {
      assert.deepEqual(request.special.externalFact, fact());
      assert.match(request.special.instruction, /출처|관측/);
      request.special.externalFact.metrics[0].value = 999;
      request.special.externalFact.tags.push('provider mutation');
      request.special.externalFact.expiresAt = clock - 1;
      request.special.topic.label = 'provider topic mutation';
      request.settings.personas[0].name = 'provider persona mutation';
      return response('trend-reader');
    },
  });
  const topicBefore = structuredClone(communities.find((c) => c.id === 'guide').topics);
  const id = f.add(fact());
  const selected = f.s.social
    .candidates(clock)
    .find((c) => c.kind === 'social-discuss' && c.id === id && c.viewer.id === f.reader.persona.id);
  assert.ok(selected);
  await f.run(selected);
  assert.deepEqual(f.current(id).trendFact, fact());
  assert.deepEqual(communities.find((c) => c.id === 'guide').topics, topicBefore);
  assert.equal(
    f.s.social.data().residents.find((r) => r.id === f.reader.id).persona.name,
    f.reader.persona.name,
  );
  assert.equal(f.current(id).comments[0].name, f.reader.persona.name);
  assert.equal(f.current(id).activityReads.length, 1);
  assert.equal(f.current(id).votes.length, 1);
});

test('a provider cannot extend DTO expiry to authorize effects after the stored observation expires', async (t) => {
  let f;
  f = await fixture(t, {
    react: async (request) => {
      const originalExpiry = clock + 600000;
      request.special.externalFact.expiresAt += 600000;
      assert.equal(TrendFact.safeParse(request.special.externalFact).success, true);
      assert.ok(request.special.externalFact.observedAt <= originalExpiry);
      assert.ok(originalExpiry < request.special.externalFact.expiresAt);
      f.setNow(originalExpiry);
      return response(request.settings.personas[0].id);
    },
  });
  const id = f.add(fact()),
    before = structuredClone(f.current(id));
  await f.run(f.target(id));
  assert.equal(f.calls.length, 1);
  assert.equal(f.s.communityActivity.data().attempts.length, 1);
  assertNoEffects(f, id, before);
});

test('synthetic provenance is delivered as synthetic and never rewritten as a live official observation', async (t) => {
  const f = await fixture(t),
    synthetic = fact({ evidenceKind: 'synthetic' }),
    id = f.add(synthetic);
  await f.run(f.target(id));
  assert.deepEqual(f.calls[0].special.externalFact, synthetic);
  assert.match(f.calls[0].special.instruction, /합성/);
  assert.equal(f.current(id).trendFact.evidenceKind, 'synthetic');
  assert.equal(f.s.social.detail(id).externalFactStatus, 'synthetic');
  assert.equal(f.s.social.data().receipts.length, 0);
});

test('fact changes during an awaited model result invalidate existing content/discussion hashes', async (t) => {
  let finish;
  const f = await fixture(t, {
    react: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const id = f.add(fact()),
    selected = f.target(id),
    pending = f.run(selected);
  assert.equal(typeof finish, 'function');
  f.s.world.change((w) => {
    w.socialWorld.threads.find((thread) => thread.id === id).trendFact.headline =
      '수정된 합성 출처 제목';
  });
  const revised = structuredClone(f.current(id));
  assert.notEqual(socialContentHash(revised), selected.raw.threadHash);
  finish(response());
  await pending;
  assertNoEffects(f, id, revised);
  assert.equal(f.s.communityActivity.data().attempts.length, 1);
});

for (const interruption of ['muted-topic', 'epoch'])
  test(
    'a fact-backed pending discussion respects the existing ' + interruption + ' fence',
    async (t) => {
      let finish;
      const f = await fixture(t, {
        react: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      });
      const id = f.add(fact()),
        before = structuredClone(f.current(id)),
        pending = f.run(f.target(id));
      assert.equal(typeof finish, 'function');
      if (interruption === 'muted-topic') f.s.social.preferences({ mutedTopics: ['practice'] });
      else f.s.epoch++;
      finish(response());
      await pending.catch((error) => {
        assert.match(error.message, /abort|취소/i);
      });
      assertNoEffects(f, id, before);
      assert.equal(f.s.communityActivity.data().attempts.length, 1);
    },
  );

for (const inject of [false, true])
  test(
    'unseen old parent is rejected' +
      (inject ? ' even when inserted into the provider DTO' : '') +
      ' while read/vote remain independent',
    async (t) => {
      let hidden;
      const f = await fixture(t, {
        react: async (request) => {
          assert.equal(request.special.delivered.comments.length, 30);
          assert.ok(!request.special.delivered.comments.some((c) => c.id === hidden));
          if (inject)
            request.special.delivered.comments.push({
              id: hidden,
              name: 'injected',
              text: 'not delivered',
              parentId: null,
            });
          return response('trend-reader', {
            messages: [
              {
                personaId: 'trend-reader',
                text: '이번 길은 스페이스로 넘겨봐',
                kind: 'chat',
                spoiler: false,
                replyTo: hidden,
              },
            ],
          });
        },
      });
      const id = f.add(undefined, { comments: 35 });
      hidden = f.current(id).comments[0].id;
      await f.run(f.target(id));
      assert.equal(f.current(id).comments.length, 35);
      assert.deepEqual(f.current(id).votes, [f.reader.id]);
      assert.equal(f.current(id).activityReads.length, 1);
      assert.equal(f.s.social.data().receipts.length, 0);
    },
  );

test('a genuinely delivered parent accepts one reply without letting a 150-comment thread become a candidate', async (t) => {
  const f = await fixture(t, {
    react: async (request) =>
      response('trend-reader', {
        messages: [
          {
            personaId: 'trend-reader',
            text: '이번 길은 스페이스로 넘겨봐',
            kind: 'chat',
            spoiler: false,
            replyTo: request.special.delivered.comments.at(-1).id,
          },
        ],
      }),
  });
  const id = f.add(fact(), { comments: 35 }),
    parent = f.current(id).comments.at(-1).id;
  await f.run(f.target(id));
  assert.equal(f.current(id).comments.length, 36);
  assert.equal(f.current(id).comments.at(-1).parentId, parent);
  const full = f.add(fact(), { comments: 150 });
  assert.ok(
    !f.s.social.candidates(clock).some((c) => c.kind === 'social-discuss' && c.id === full),
  );
});

test('all sourced daily posts are excluded from fictional recentPosts, including expired and synthetic evidence', async (t) => {
  const f = await fixture(t),
    plainText = '무근거 합성 일상에서 조작 키를 바꾸다';
  f.add(fact(), { text: 'SOURCE_OFFICIAL_TEXT' });
  f.add(fact({ evidenceKind: 'synthetic' }), { text: 'SOURCE_SYNTHETIC_TEXT' });
  f.add(fact({ expiresAt: clock - 1 }), { text: 'SOURCE_EXPIRED_TEXT' });
  f.add(undefined, { text: plainText });
  await f.run({
    kind: 'social-daily',
    id: f.reader.id,
    viewer: structuredClone(f.reader.persona),
    raw: { residentId: f.reader.id, communityId: 'guide', topicId: 'practice' },
    revision: digest('daily'),
    weight: 1,
  });
  assert.deepEqual(f.calls[0].special.recentPosts, [
    { communityId: 'guide', topicId: 'practice', text: plainText },
  ]);
});

test('saved attempts precede calls and a failed result commit has no partial comment/vote/read or accepted result', async (t) => {
  const f = await fixture(t),
    id = f.add(fact()),
    before = structuredClone(f.current(id));
  f.s.world.save = () => {
    throw Error('attempt save failed');
  };
  await assert.rejects(f.run(f.target(id)), /attempt save failed/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.s.communityActivity.data().attempts.length, 0);
  let writes = 0;
  f.s.world.save = () => {
    if (++writes === 2) throw Error('result save failed');
  };
  await assert.rejects(f.run(f.target(id)), /result save failed/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.s.communityActivity.data().attempts.length, 1);
  assertNoEffects(f, id, before);
  const activity = f.s.ai.snapshot().recent[0];
  assert.equal(activity.application, 'unconfirmed');
  assert.equal(activity.activityResult, undefined);
});

test('canonical fact archives, comments, votes, reads and attempts survive restart without another model call', async (t) => {
  mkdirSync('artifacts/social-trend-tests', { recursive: true });
  const dataDir = mkdtempSync(resolve('artifacts/social-trend-tests/profile-'));
  let f = await fixture(null, { persist: true, dataDir });
  t.after(() => f.close());
  const active = f.add(fact(), { comments: 1 }),
    expired = f.add(fact({ expiresAt: clock - 1 }));
  await f.run(f.target(active));
  const before = structuredClone(f.s.social.data()),
    attempts = structuredClone(f.s.communityActivity.data());
  const savedWorld = readFileSync(join(dataDir, 'world.json'));
  await f.close();
  f = await fixture(null, { persist: true, dataDir });
  assert.deepEqual(f.s.social.data(), before);
  assert.deepEqual(f.s.communityActivity.data(), attempts);
  assert.deepEqual(readFileSync(join(dataDir, 'world.json')), savedWorld);
  assert.equal(f.s.social.detail(active).externalFactStatus, 'observed');
  assert.equal(f.s.social.detail(expired).externalFactStatus, 'expired');
  assert.equal(f.calls.length, 0);
});
