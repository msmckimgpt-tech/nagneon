import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Studio } from '../server/studio.js';
import { Audience } from '../server/audience.js';
import { Clips } from '../server/clips.js';
import { AudienceData, ClipsData } from '../server/data-schema.js';
import { COMMUNITY_COOLDOWN } from '../server/community-activity.js';
import { startServer } from '../server/index.js';
import { defaults } from '../shared/defaults.js';

const member = () => ({
  sessions: 1,
  seconds: 60,
  recognized: 0,
  affinity: 0.3,
  peers: {},
  memories: [],
});
const viewer = () => ({ ...defaults.personas.find((p) => p.id === 'momo'), enabled: true });
const manager = () => ({
  ...defaults.personas.find((p) => p.id === defaults.managerId),
  enabled: true,
});
const message = (extra = {}) => ({
  personaId: 'momo',
  text: '새로 쓸 감상',
  kind: 'chat',
  spoiler: false,
  replyTo: null,
  ...extra,
});
const output = (messages = [], recommended = true) => ({
  observation: { messages, communityVotes: [{ personaId: 'momo', recommended }] },
  usage: { total_tokens: 1 },
});

function seed(s, kind, count = 150) {
  const item =
    kind === 'clip'
      ? s.clips.create({
          title: '합성 퍼즐',
          game: '퍼즐',
          scene: '마지막 문이 열렸다',
          participants: [],
          messages: [
            {
              id: 'known-chat',
              personaId: 'streamer',
              name: '방장',
              text: '드디어 열었다',
              kind: 'streamer',
              time: s.now(),
            },
          ],
          sessionId: 'synthetic-session',
          source: 'spectator',
        })
      : s.community.post({ title: '합성 방송 이야기', text: '다음에도 퍼즐을 해보자' });
  const rows = Array.from({ length: count }, (_, i) => ({
    text: '공개 합성 댓글 ' + i,
    name: '방장',
    personaId: 'streamer',
    parentId: null,
    kind: 'streamer',
  }));
  if (kind === 'clip') s.clips.commentBatch(item.id, rows);
  else s.community.addComments(item.id, rows);
  return item.id;
}

function fixture(t, kind, react = async () => output(), count = 150) {
  let now = Date.UTC(2026, 9, 1),
    memeUses = 0;
  const inputs = [];
  const audience = new Audience({ members: { momo: member() }, posts: [], lore: [] }, (data) =>
    AudienceData.parse(data),
  );
  const clips = new Clips({ now: () => now, save: (data) => ClipsData.parse(data) });
  const s = new Studio({
    audience,
    clips,
    settings: {
      ...defaults,
      mode: 'live',
      communityActivityEnabled: true,
      personas: [viewer(), manager()],
    },
    now: () => now,
    random: () => 0,
    provider: {
      status: () => ({ configured: true }),
      react: (input, signal) => {
        inputs.push(input);
        return react(input, signal);
      },
    },
  });
  clearInterval(s.timer);
  t.after(() => s.close());
  s.ai.update({ background: true });
  s.culture.canUse = () => true;
  s.culture.recordUse = () => {
    memeUses++;
  };
  assert.equal(s.social.enabled(), false);
  const id = seed(s, kind, count);
  const raw = () =>
    kind === 'clip'
      ? clips.data.find((c) => c.id === id)
      : audience.data.posts.find((p) => p.id === id);
  const visit = async (ms = 60001) => {
    now += ms;
    s.pump();
    await s.communityActivity.active?.promise;
  };
  const recommend = (value) =>
    kind === 'clip'
      ? clips.commentBatch(id, [], { votes: [{ personaId: 'momo', recommended: value }] })
      : s.community.addComments(id, [], undefined, [{ personaId: 'momo', recommended: value }]);
  return {
    s,
    id,
    inputs,
    raw,
    visit,
    recommend,
    get calls() {
      return inputs.length;
    },
    get now() {
      return now;
    },
    get memeUses() {
      return memeUses;
    },
  };
}

for (const kind of ['clip', 'gallery']) {
  for (const triesComment of [false, true])
    test(`a full ${kind} permits autonomous reading and a vote even when the provider ${triesComment ? 'tries a forbidden comment' : 'stays silent'}`, async (t) => {
      const f = fixture(t, kind, async () => output(triesComment ? [message({ meme: true })] : []));
      const comments = structuredClone(f.raw().comments);
      await f.visit();
      assert.equal(f.calls, 1, 'full threads still give a visitor a real model request');
      assert.equal(f.s.communityActivity.lastError, '');
      assert.equal(f.inputs[0].special.commentingAllowed, false);
      assert.match(f.inputs[0].special.instruction, /messages=\[\]/);
      assert.deepEqual(f.raw().comments, comments);
      assert.deepEqual(f.raw().votes, ['momo']);
      assert.equal(f.raw().activityReads.length, 1);
      assert.equal(f.raw().activityReads[0].viewerId, 'momo');
      assert.equal(f.s.ai.snapshot().recent[0].activityResult, 'read-only');
      assert.equal(f.memeUses, 0, 'a suppressed comment does not consume a published meme use');
      if (kind === 'clip') {
        assert.equal(f.inputs[0].special.clip.comments.length, 30);
        assert.equal(f.raw().readings[0].comments.length, 30);
        assert.ok(
          f.s.clips
            .recall('momo', '드디어')
            .flatMap((c) => c.items)
            .some((m) => m.id === 'known-chat'),
        );
        assert.equal(
          f.s.clips
            .recall('momo', '공개 합성 댓글 0')
            .flatMap((c) => c.items)
            .some((m) => m.text === '공개 합성 댓글 0'),
          false,
        );
        assert.equal(f.s.clips.recall('never-read', '드디어').length, 0);
      }
      const visible = kind === 'clip' ? f.s.clips.get(f.id) : f.s.community.get(f.id);
      assert.equal(Object.hasOwn(visible, 'activityReads'), false);
      assert.equal(Object.hasOwn(visible, 'readings'), false);
      assert.equal(JSON.stringify(f.s.state()).includes('activityReads'), false);
      await f.visit(COMMUNITY_COOLDOWN + 1);
      assert.equal(f.calls, 1, 'the vote and silent read do not manufacture rediscovery');
      ClipsData.parse(f.s.clips.data);
      AudienceData.parse(f.s.audience.data);
    });

  test(`the last ${kind} comment slot works but deleting a comment does not invent another slot`, async (t) => {
    const f = fixture(t, kind, async () => output([message()]), 149);
    await f.visit();
    assert.equal(f.calls, 1);
    assert.equal(f.inputs[0].special.commentingAllowed, true);
    assert.equal(f.raw().comments.length, 150);
    assert.equal(f.raw().comments.at(-1).personaId, 'momo');
    assert.equal(f.s.ai.snapshot().recent[0].activityResult, 'comment-created');
    const old = f.raw().comments[0];
    if (kind === 'clip') f.s.clips.removeComment(f.id, old.id);
    else f.s.community.removeComment(f.id, old.id);
    await f.visit(COMMUNITY_COOLDOWN + 1);
    assert.equal(f.calls, 2);
    assert.equal(f.inputs[1].special.commentingAllowed, false);
    assert.equal(f.raw().comments.length, 150);
    assert.equal(f.raw().comments.filter((c) => c.personaId === 'momo').length, 1);
    assert.equal(f.s.ai.snapshot().recent[0].activityResult, 'read-only');
    assert.throws(
      () =>
        kind === 'clip'
          ? f.s.clips.comment(f.id, { text: '151번째 댓글', name: '방장' })
          : f.s.community.comment(f.id, { text: '151번째 댓글' }),
      /150/,
    );
  });

  test(`a full ${kind} reader can withdraw a recommendation without being forced to comment`, async (t) => {
    const f = fixture(t, kind, async () => output([message()], false));
    f.recommend(true);
    await f.visit();
    assert.equal(f.calls, 1);
    assert.equal(f.s.communityActivity.lastError, '');
    assert.deepEqual(f.raw().votes, []);
    assert.equal(f.raw().activityReads.length, 1);
    assert.equal(f.raw().comments.length, 150);
  });

  test(`a full ${kind} failed durable save grants neither a vote nor a private reading`, async (t) => {
    let f;
    f = fixture(t, kind, async () => {
      if (kind === 'clip')
        f.s.clips.save = () => {
          throw Error('synthetic full-thread save failure');
        };
      else
        f.s.audience.save = () => {
          throw Error('synthetic full-thread save failure');
        };
      return output([message()]);
    });
    const before = structuredClone(f.raw());
    await f.visit();
    assert.equal(f.calls, 1);
    assert.match(f.s.communityActivity.lastError, /synthetic full-thread save failure/);
    assert.deepEqual(f.raw(), before);
    assert.equal(f.s.audience.data.communityActivity.attempts.length, 1);
    assert.equal(f.s.busy, false);
    await f.visit();
    assert.equal(f.calls, 1, 'the persisted attempt still throttles retry');
  });

  test(`live cancellation discards a full ${kind} late vote and read`, async (t) => {
    let finish, signal;
    t.after(() => finish?.(output()));
    const f = fixture(t, kind, (_input, currentSignal) => {
      signal = currentSignal;
      return new Promise((r) => {
        finish = r;
      });
    });
    const before = structuredClone(f.raw());
    const pending = f.visit();
    assert.equal(f.calls, 1);
    f.s.communityActivity.interrupt();
    assert.equal(signal.aborted, true);
    finish(output([message()]));
    await pending;
    assert.deepEqual(f.raw(), before);
    assert.equal(f.s.audience.data.communityActivity.attempts.length, 1);
    assert.equal(f.s.busy, false);
  });

  test(`a full ${kind} production server persists its read and vote, keeps them private and does not rediscover after restart`, async (t) => {
    mkdirSync('artifacts', { recursive: true });
    const dir = mkdtempSync(resolve('artifacts/full-thread-profile-'));
    let calls = 0,
      now = Date.now();
    const open = async () => {
      const service = await startServer({
        port: 0,
        dataDir: dir,
        localSpeech: false,
        provider: {
          status: () => ({ configured: true }),
          react: async () => {
            calls++;
            return output([message()]);
          },
        },
      });
      clearInterval(service.studio.timer);
      now = Math.max(now, service.studio.now());
      service.studio.now = () => now;
      service.studio.clips.now = () => now;
      service.studio.random = () => 0;
      t.after(() => service.close());
      return service;
    };
    const first = await open(),
      s = first.studio;
    s.world.change((world) => {
      world.settings.mode = 'live';
      world.settings.communityActivityEnabled = true;
      world.settings.personas = [viewer(), manager()];
      world.audience.members = { momo: member() };
    });
    s.social.preferences({ enabled: false });
    assert.equal(s.social.enabled(), false, 'this profile isolates local clip/gallery activity');
    s.ai.update({ background: true });
    const id = seed(s, kind);
    now += 60001;
    s.pump();
    await s.communityActivity.active?.promise;
    assert.equal(calls, 1, 'the ready server dispatches after its startup delay');
    assert.equal(s.communityActivity.lastError, '');
    const stored = JSON.parse(
      readFileSync(join(dir, kind === 'clip' ? 'clips.json' : 'world.json'), 'utf8'),
    );
    const raw = kind === 'clip' ? stored[0] : stored.audience.posts[0];
    assert.equal(raw.comments.length, 150);
    assert.deepEqual(raw.votes, ['momo']);
    assert.equal(raw.activityReads[0].viewerId, 'momo');
    if (kind === 'clip') assert.equal(raw.readings[0].comments.length, 30);
    const response = await fetch(
      first.url + '/api/' + (kind === 'clip' ? 'clips/' : 'community/posts/') + id,
      { headers: { Authorization: 'Bearer ' + first.accessToken, 'X-Backseat-Client': 'studio' } },
    );
    assert.equal(response.status, 200);
    const visible = await response.json();
    assert.equal(Object.hasOwn(visible, 'activityReads'), false);
    assert.equal(Object.hasOwn(visible, 'readings'), false);
    const balance = s.economy.data.balance;
    await first.close();
    now += COMMUNITY_COOLDOWN + 1;
    const restarted = await open();
    restarted.studio.pump();
    await restarted.studio.communityActivity.active?.promise;
    assert.equal(calls, 1);
    assert.equal(restarted.studio.communityActivity.candidates(now).length, 0);
    assert.equal(restarted.studio.economy.data.balance, balance);
    const persisted =
      kind === 'clip' ? restarted.studio.clips.data[0] : restarted.studio.audience.data.posts[0];
    assert.equal(persisted.comments.length, 150);
    assert.deepEqual(persisted.votes, ['momo']);
    assert.equal(persisted.activityReads.length, 1);
  });
}

test('a clip filled during the request suppresses the late comment but remembers only the actual delivered snapshot', async (t) => {
  let finish;
  t.after(() => finish?.(output()));
  const f = fixture(
    t,
    'clip',
    () =>
      new Promise((r) => {
        finish = r;
      }),
    149,
  );
  const pending = f.visit();
  assert.equal(f.calls, 1);
  assert.equal(f.inputs[0].special.commentingAllowed, true);
  const unseen = f.s.clips.comment(f.id, { text: '요청 뒤에 추가된 새 내용', name: '방장' });
  finish(output([message({ meme: true })]));
  await pending;
  assert.equal(f.s.communityActivity.lastError, '');
  assert.equal(f.raw().comments.length, 150);
  assert.equal(
    f.raw().comments.some((c) => c.personaId === 'momo'),
    false,
  );
  assert.deepEqual(f.raw().votes, ['momo']);
  assert.equal(f.raw().readings[0].comments.length, 30);
  assert.equal(
    f.raw().readings[0].comments.some((c) => c.id === unseen.id),
    false,
  );
  assert.equal(
    f.s.clips
      .recall('momo', '요청 뒤')
      .flatMap((c) => c.items)
      .some((m) => m.id === unseen.id),
    false,
  );
  assert.equal(f.memeUses, 0);
  assert.equal(
    f.s.communityActivity.candidates(f.now + COMMUNITY_COOLDOWN + 1).length,
    1,
    'a real unseen peer comment remains a reason to return later',
  );
});

test('a gallery filled during the request keeps its strict snapshot fence and discards every late effect', async (t) => {
  let finish;
  t.after(() => finish?.(output()));
  const f = fixture(
    t,
    'gallery',
    () =>
      new Promise((r) => {
        finish = r;
      }),
    149,
  );
  const pending = f.visit();
  assert.equal(f.calls, 1);
  assert.equal(f.inputs[0].special.commentingAllowed, true);
  f.s.community.comment(f.id, { text: '요청 뒤에 추가된 새 내용' });
  const before = structuredClone(f.raw());
  finish(output([message({ meme: true })]));
  await pending;
  assert.match(f.s.communityActivity.lastError, /게시글이 바뀌었습니다/);
  assert.deepEqual(f.raw(), before);
  assert.equal(f.raw().activityReads, undefined);
  assert.equal(f.memeUses, 0);
});
