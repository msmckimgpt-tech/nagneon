import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Clips } from '../server/clips.js';
import { clipTextSnapshot } from '../server/clip-memory.js';
import { ClipsData, AudienceData } from '../server/data-schema.js';
import { ActivityReads, recordActivityRead } from '../server/community-activity-state.js';
import { Audience } from '../server/audience.js';
import { Community } from '../server/community.js';
import { JsonStore } from '../server/storage.js';
import { startServer } from '../server/index.js';
import { communityRevision } from '../server/community-activity.js';
import { defaults } from '../shared/defaults.js';

const readers = Array.from({ length: 300 }, (_, i) => 'reader_' + i);
const revision = 'a'.repeat(64);
const read = (viewerId, at = 1000) => ({ viewerId, revision, at });
function directory() {
  mkdirSync('artifacts', { recursive: true });
  return mkdtempSync(resolve('artifacts/unlimited-readers-'));
}
function clipStore() {
  const file = join(directory(), 'clips.json');
  const store = new JsonStore(file, { validate: (v) => ClipsData.parse(v), initial: () => [] });
  const clips = new Clips({ data: store.load(), save: (v) => store.save(v), now: () => 1000 });
  const clip = clips.create({
    title: '함께 본 순간',
    game: '퍼즐',
    scene: '문 앞에서 대화',
    participants: [],
    messages: [],
    sessionId: 'session',
    source: 'spectator',
  });
  return { file, clips, clip };
}

test('300 silent clip readers and recommendations survive a real store restart without evicting earlier identities', () => {
  const { file, clips, clip } = clipStore();
  const snapshot = clipTextSnapshot(clips.get(clip.id));
  for (const viewerId of readers)
    clips.commentBatch(clip.id, [], {
      reading: snapshot,
      readers: [viewerId],
      activityRead: read(viewerId),
      votes: [{ personaId: viewerId, recommended: true }],
    });
  const restarted = new Clips({
    data: new JsonStore(file, { validate: (v) => ClipsData.parse(v) }).load(),
  });
  const stored = restarted.data[0];
  assert.deepEqual(
    stored.readings.map((r) => r.viewerId),
    readers,
  );
  assert.deepEqual(
    stored.activityReads.map((r) => r.viewerId),
    readers,
  );
  assert.deepEqual(stored.votes, readers);
  assert.equal(stored.comments.length, 0);
  assert.equal(Object.hasOwn(restarted.get(clip.id), 'readings'), false);
  assert.equal(Object.hasOwn(restarted.get(clip.id), 'activityReads'), false);
});

test('a returning viewer updates one bookmark while all other viewers remain recorded', () => {
  const target = {};
  for (const viewerId of readers) recordActivityRead(target, read(viewerId));
  recordActivityRead(target, { viewerId: readers[0], revision: 'b'.repeat(64), at: 2000 });
  assert.equal(target.activityReads.length, readers.length);
  assert.deepEqual(target.activityReads.at(-1), {
    viewerId: readers[0],
    revision: 'b'.repeat(64),
    at: 2000,
  });
  assert.deepEqual(new Set(target.activityReads.map((r) => r.viewerId)), new Set(readers));
  assert.equal(ActivityReads.safeParse(target.activityReads).success, true);
});

test('invalid activity receipts cannot delete a viewer bookmark before validation', () => {
  const target = { activityReads: [read('reader_0')] },
    before = structuredClone(target);
  for (const invalid of [
    read('__proto__'),
    { ...read('reader_0'), revision: 'wrong' },
    read('reader_0', -1),
  ]) {
    assert.throws(() => recordActivityRead(target, invalid));
    assert.deepEqual(target, before);
  }
});

test('300 gallery readers and votes persist through the audience store with private bookmarks', () => {
  const file = join(directory(), 'audience.json');
  const store = new JsonStore(file, {
    validate: (v) => AudienceData.parse(v),
    initial: () => new Audience().data,
  });
  const audience = new Audience(store.load(), (v) => store.save(v));
  const community = new Community({
    audience,
    settings: { streamer: '방장' },
    now: () => 1000,
    publish() {},
  });
  const post = community.post({ title: '방송 후기', text: '오늘 퍼즐 이야기' });
  for (const viewerId of readers)
    community.addComments(
      post.id,
      [],
      undefined,
      [{ personaId: viewerId, recommended: true }],
      read(viewerId),
    );
  const restarted = store.load().posts.find((p) => p.id === post.id);
  assert.deepEqual(
    restarted.activityReads.map((r) => r.viewerId),
    readers,
  );
  assert.deepEqual(restarted.votes, readers);
  assert.equal(restarted.comments.length, 0);
  assert.equal(Object.hasOwn(community.get(post.id), 'activityReads'), false);
});

test('larger rosters retain ID uniqueness, timestamp, hash, source-link and comment-window validation', () => {
  const { clips, clip } = clipStore(),
    snapshot = clipTextSnapshot(clips.get(clip.id));
  clips.commentBatch(clip.id, [], {
    reading: snapshot,
    readers,
    votes: readers.map((personaId) => ({ personaId, recommended: true })),
  });
  const valid = structuredClone(clips.data);
  for (const corrupt of [
    (data) => data[0].votes.push(readers[0]),
    (data) => data[0].readings.push(structuredClone(data[0].readings[0])),
    (data) => (data[0].readings[0].readAt = -1),
    (data) => (data[0].readings[0].metadataHash = 'wrong'),
    (data) => data[0].readings[0].comments.push({ id: 'not-shown', hash: revision }),
  ]) {
    const data = structuredClone(valid);
    corrupt(data);
    assert.equal(ClipsData.safeParse(data).success, false);
  }
  const duplicate = readers.map((viewerId) => read(viewerId));
  duplicate.push(read(readers[0]));
  assert.equal(ActivityReads.safeParse(duplicate).success, false);
  assert.throws(
    () =>
      clips.commentBatch(
        clip.id,
        Array.from({ length: 151 }, () => ({
          text: '짧은 댓글',
          name: '관객',
          personaId: 'reader_0',
        })),
      ),
    /150/,
  );
  assert.deepEqual(clips.data, valid);
});

test('the 151st autonomous reader gets one real bounded prompt, private durable memory and no rediscovery after restart', async (t) => {
  const dir = directory();
  let received = [],
    calls = 0;
  const open = async () => {
    const instance = await startServer({
      port: 0,
      dataDir: dir,
      localSpeech: false,
      provider: {
        status: () => ({ configured: true }),
        react: async (input) => {
          received.push(input);
          calls++;
          return {
            observation: {
              messages: [],
              communityVotes: [{ personaId: input.settings.personas[0].id, recommended: true }],
            },
            usage: { total_tokens: 1 },
          };
        },
      },
    });
    clearInterval(instance.studio.timer);
    t.after(() => instance.close());
    return instance;
  };
  const f = await open(),
    s = f.studio,
    active = readers.slice(0, 151);
  const now = s.now();
  s.world.change((world) => {
    world.settings.mode = 'live';
    for (const id of active) {
      world.settings.personas.push({
        ...defaults.personas.find((p) => p.id === 'momo'),
        id,
        name: '관객' + id,
      });
      world.audience.members[id] = {
        sessions: 1,
        seconds: 1,
        recognized: 0,
        affinity: 0.3,
        peers: {},
        memories: [],
      };
    }
  });
  const clip = s.clips.create({
    title: '함께 연 문',
    game: '퍼즐',
    scene: '마침내 문이 열렸다',
    participants: [],
    messages: [
      {
        id: 'known-message',
        name: '방장',
        personaId: 'streamer',
        text: '드디어 열었다',
        kind: 'streamer',
        time: now - 1,
      },
    ],
    sessionId: 'synthetic-session',
    source: 'spectator',
  });
  for (let i = 0; i < 35; i++) s.clips.comment(clip.id, { text: '보이는 댓글 ' + i, name: '방장' });
  const raw = s.clips.data[0],
    snapshot = clipTextSnapshot(raw);
  s.clips.commentBatch(clip.id, [], { reading: snapshot, readers: active.slice(0, 150) });
  s.clips.change(
    (data) =>
      (data[0].activityReads = active.slice(0, 150).map((viewerId) => ({
        viewerId,
        revision: communityRevision('clip', raw, viewerId),
        at: now,
      }))),
  );
  const target = s.communityActivity
    .candidates(s.now())
    .find((c) => c.kind === 'clip' && c.viewer.id === active[150]);
  assert.ok(target);
  const operation = { controller: new AbortController(), epoch: s.epoch };
  s.communityActivity.active = operation;
  operation.promise = s.communityActivity.run(target, operation);
  try {
    await operation.promise;
  } finally {
    s.communityActivity.active = null;
    s.busy = false;
  }
  assert.equal(calls, 1);
  assert.equal(received[0].special.clip.comments.length, 30);
  assert.equal(
    received[0].special.clip.comments.some((c) => c.text === '보이는 댓글 0'),
    false,
  );
  assert.equal(s.clips.data[0].readings.length, 151);
  assert.deepEqual(s.clips.data[0].votes, [active[150]]);
  assert.equal(s.clips.recall('never_read', '드디어').length, 0);
  assert.ok(
    s.clips
      .recall(active[0], '드디어')
      .flatMap((c) => c.items)
      .some((m) => m.text === '드디어 열었다'),
  );
  assert.equal(
    s.clips
      .recall(active[150], '보이는 댓글 0')
      .flatMap((c) => c.items)
      .some((m) => m.text === '보이는 댓글 0'),
    false,
  );
  const response = await fetch(f.url + '/api/clips/' + clip.id, {
    headers: { Authorization: 'Bearer ' + f.accessToken, 'X-Backseat-Client': 'studio' },
  });
  assert.equal(response.status, 200);
  const publicClip = await response.json();
  assert.equal(Object.hasOwn(publicClip, 'readings'), false);
  assert.equal(Object.hasOwn(publicClip, 'activityReads'), false);
  await f.close();
  const restarted = await open();
  assert.equal(restarted.studio.clips.data[0].readings.length, 151);
  assert.equal(
    restarted.studio.communityActivity
      .candidates(restarted.studio.now())
      .some((c) => c.kind === 'clip' && active.includes(c.viewer.id)),
    false,
  );
  assert.equal(calls, 1);
});
