import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { startServer } from '../server/index.js';
import { Clips } from '../server/clips.js';
import { clipTextSnapshot } from '../server/clip-memory.js';
import { JsonStore } from '../server/storage.js';
import { markWorldFormat, inspectWorldFormat } from '../server/profile-writer.js';
import {
  readProfileFormat,
  mergeProfileFormat,
  requiredProfileFormat,
  WORLD_PROFILE_FORMAT,
  UNLIMITED_READERS_FORMAT,
} from '../server/profile-capabilities.js';

const ids = Array.from({ length: 151 }, (_, i) => 'reader_' + i);
const reads = (count) =>
  ids.slice(0, count).map((viewerId) => ({ viewerId, revision: 'a'.repeat(64), at: 1000 }));
function directory() {
  mkdirSync('artifacts', { recursive: true });
  return mkdtempSync(resolve('artifacts/profile-readers-'));
}
const bytes = (dir, name) => readFileSync(join(dir, name + '.json'), 'utf8');
const json = (dir, name) => JSON.parse(bytes(dir, name));
const write = (dir, name, value) => writeFileSync(join(dir, name + '.json'), JSON.stringify(value));
async function service(t, dir = directory(), check = () => {}) {
  const instance = await startServer({
    port: 0,
    dataDir: dir,
    localSpeech: false,
    provider: {
      check,
      status: () => ({ configured: true }),
      react: async () => {
        throw Error('Unexpected model call');
      },
    },
  });
  clearInterval(instance.studio.timer);
  t.after(() => instance.close());
  return { ...instance, dir };
}
function seedClip(s, count = 150) {
  const clip = s.clips.create({
    title: '관객들이 본 순간',
    game: '퍼즐',
    scene: '함께 문을 열었다',
    participants: [],
    messages: [],
    sessionId: 'synthetic-session',
    source: 'spectator',
  });
  const reading = clipTextSnapshot(s.clips.get(clip.id));
  s.clips.commentBatch(clip.id, [], { reading, readers: ids.slice(0, count) });
  return { clip, reading };
}
function failSave(file, failure, action) {
  const original = JsonStore.prototype.save;
  JsonStore.prototype.save = function (value) {
    if (this.file === file) throw Error(failure);
    return original.call(this, value);
  };
  try {
    return action();
  } finally {
    JsonStore.prototype.save = original;
  }
}

test('reader and application floors merge monotonically and preserve marker metadata', () => {
  const original = { ...UNLIMITED_READERS_FORMAT, purpose: 'durable-viewer-history' };
  assert.deepEqual(mergeProfileFormat(original, WORLD_PROFILE_FORMAT), original);
  assert.deepEqual(
    mergeProfileFormat({ minReader: 2, minAppVersion: '0.2.0' }, UNLIMITED_READERS_FORMAT),
    { minReader: 3, minAppVersion: '0.2.0' },
  );
  const dir = directory();
  write(dir, 'world', { version: 2 });
  write(dir, 'profile-format', original);
  const before = bytes(dir, 'profile-format');
  assert.deepEqual(markWorldFormat(dir), original);
  assert.equal(bytes(dir, 'profile-format'), before);
  assert.deepEqual(inspectWorldFormat(dir), { protected: true, migrate: false });
});

test('only expanded viewer representations require reader3; request-window and gallery-vote counts do not', () => {
  assert.equal(
    requiredProfileFormat('clips', [
      { readings: reads(150), votes: ids.slice(0, 150), activityReads: reads(150) },
    ]),
    null,
  );
  for (const field of ['readings', 'votes', 'activityReads'])
    assert.deepEqual(
      requiredProfileFormat('clips', [{ [field]: field === 'votes' ? ids : reads(151) }]),
      UNLIMITED_READERS_FORMAT,
    );
  assert.equal(requiredProfileFormat('world', { audience: { posts: [{ votes: ids }] } }), null);
  assert.deepEqual(
    requiredProfileFormat('world', { audience: { posts: [{ activityReads: reads(151) }] } }),
    UNLIMITED_READERS_FORMAT,
  );
  assert.equal(requiredProfileFormat('episodes', []), null);
});

test('ordinary and reader2 profiles preserve their existing floor until an incompatible durable write', async (t) => {
  const f = await service(t),
    s = f.studio;
  assert.deepEqual(readProfileFormat(f.dir), WORLD_PROFILE_FORMAT);
  const { clip, reading } = seedClip(s);
  assert.deepEqual(readProfileFormat(f.dir), WORLD_PROFILE_FORMAT);
  s.clips.commentBatch(
    clip.id,
    [{ text: '나도 방금 봤다 ㅋㅋ', name: '새 관객', personaId: ids[150], kind: 'ai' }],
    {
      reading,
      readers: [ids[150]],
      activityRead: reads(151).at(-1),
      votes: [{ personaId: ids[150], recommended: true }],
    },
  );
  assert.deepEqual(readProfileFormat(f.dir), UNLIMITED_READERS_FORMAT);
  assert.equal(json(f.dir, 'world').version, 2);
  assert.equal(json(f.dir, 'clips')[0].readings.length, 151);
  const saved = bytes(f.dir, 'profile-format'),
    balance = s.economy.data.balance;
  await f.close();
  const restarted = await service(t, f.dir);
  assert.equal(restarted.studio.clips.data[0].readings.length, 151);
  assert.equal(restarted.studio.economy.data.balance, balance);
  assert.equal(bytes(f.dir, 'profile-format'), saved);
});

test('marker write failure blocks the whole clip comment, vote, read and bookmark transaction', async (t) => {
  const f = await service(t),
    { clip, reading } = seedClip(f.studio);
  const before = bytes(f.dir, 'clips'),
    memory = structuredClone(f.studio.clips.data);
  failSave(join(f.dir, 'profile-format.json'), 'marker write failed', () =>
    assert.throws(
      () =>
        f.studio.clips.commentBatch(
          clip.id,
          [{ text: '함께 봤어', name: '관객', personaId: ids[150], kind: 'ai' }],
          {
            reading,
            readers: [ids[150]],
            activityRead: reads(151).at(-1),
            votes: [{ personaId: ids[150], recommended: true }],
          },
        ),
      /marker write failed/,
    ),
  );
  assert.equal(bytes(f.dir, 'clips'), before);
  assert.deepEqual(f.studio.clips.data, memory);
  assert.deepEqual(readProfileFormat(f.dir), WORLD_PROFILE_FORMAT);
});

test('data write failure retains the old complete transaction and a conservative reader3 marker across restart', async (t) => {
  const f = await service(t),
    { clip, reading } = seedClip(f.studio);
  const before = bytes(f.dir, 'clips'),
    memory = structuredClone(f.studio.clips.data);
  failSave(join(f.dir, 'clips.json'), 'clip write failed', () =>
    assert.throws(
      () =>
        f.studio.clips.commentBatch(
          clip.id,
          [{ text: '마지막 한 명', name: '관객', personaId: ids[150], kind: 'ai' }],
          {
            reading,
            readers: [ids[150]],
            activityRead: reads(151).at(-1),
            votes: [{ personaId: ids[150], recommended: true }],
          },
        ),
      /clip write failed/,
    ),
  );
  assert.equal(bytes(f.dir, 'clips'), before);
  assert.deepEqual(f.studio.clips.data, memory);
  assert.deepEqual(readProfileFormat(f.dir), UNLIMITED_READERS_FORMAT);
  await f.close();
  const restarted = await service(t, f.dir);
  assert.equal(restarted.studio.clips.data[0].readings.length, 150);
  assert.equal(restarted.studio.clips.data[0].comments.length, 0);
  assert.deepEqual(readProfileFormat(f.dir), UNLIMITED_READERS_FORMAT);
});

test('a gallery-only upgrade materializes an empty clip primary and survives restart with all bookmarks', async (t) => {
  const f = await service(t),
    s = f.studio;
  assert.equal(existsSync(join(f.dir, 'clips.json')), false);
  const post = s.community.post({ title: '오늘 방송', text: '함께 본 이야기' });
  s.world.change(
    (world) => (world.audience.posts.find((p) => p.id === post.id).activityReads = reads(151)),
  );
  assert.deepEqual(json(f.dir, 'clips'), []);
  assert.deepEqual(readProfileFormat(f.dir), UNLIMITED_READERS_FORMAT);
  await f.close();
  const restarted = await service(t, f.dir);
  assert.deepEqual(
    restarted.studio.audience.data.posts.find((p) => p.id === post.id).activityReads,
    reads(151),
  );
  assert.deepEqual(restarted.studio.clips.data, []);
});

test('failure to materialize the clip primary blocks a gallery upgrade before the marker or world can change', async (t) => {
  const f = await service(t),
    s = f.studio;
  const post = s.community.post({ title: '오늘 방송', text: '함께 본 이야기' });
  const before = bytes(f.dir, 'world'),
    memory = structuredClone(s.world.data);
  failSave(join(f.dir, 'clips.json'), 'empty clip write failed', () =>
    assert.throws(
      () =>
        s.world.change(
          (world) =>
            (world.audience.posts.find((p) => p.id === post.id).activityReads = reads(151)),
        ),
      /empty clip write failed/,
    ),
  );
  assert.equal(bytes(f.dir, 'world'), before);
  assert.deepEqual(s.world.data, memory);
  assert.deepEqual(readProfileFormat(f.dir), WORLD_PROFILE_FORMAT);
  assert.equal(existsSync(join(f.dir, 'clips.json')), false);
});

test('a failed gallery transaction preserves its comments, votes, bookmarks and world while keeping the raised floor', async (t) => {
  const f = await service(t),
    s = f.studio;
  const post = s.community.post({ title: '오늘 방송', text: '함께 본 이야기' });
  s.world.change(
    (world) => (world.audience.posts.find((p) => p.id === post.id).activityReads = reads(150)),
  );
  const before = bytes(f.dir, 'world'),
    memory = structuredClone(s.audience.data);
  failSave(join(f.dir, 'world.json'), 'gallery write failed', () =>
    assert.throws(
      () =>
        s.community.addComments(
          post.id,
          [{ text: '나도 읽었다', name: '관객', personaId: ids[150], kind: 'ai', parentId: null }],
          undefined,
          [{ personaId: ids[150], recommended: true }],
          reads(151).at(-1),
        ),
      /gallery write failed/,
    ),
  );
  assert.equal(bytes(f.dir, 'world'), before);
  assert.deepEqual(s.audience.data, memory);
  assert.deepEqual(readProfileFormat(f.dir), UNLIMITED_READERS_FORMAT);
  assert.deepEqual(json(f.dir, 'clips'), []);
  await f.close();
  const restarted = await service(t, f.dir),
    restored = restarted.studio.audience.data.posts.find((p) => p.id === post.id);
  assert.equal(restored.activityReads.length, 150);
  assert.deepEqual(restored.comments, []);
  assert.deepEqual(restored.votes, []);
  assert.deepEqual(readProfileFormat(f.dir), UNLIMITED_READERS_FORMAT);
});

test('invalid expanded data cannot raise the marker or alter the primary', async (t) => {
  const f = await service(t),
    { clip } = seedClip(f.studio);
  const before = bytes(f.dir, 'clips');
  assert.throws(() => f.studio.clips.change((data) => (data[0].votes = [...ids, ids[0]])));
  assert.equal(bytes(f.dir, 'clips'), before);
  assert.deepEqual(readProfileFormat(f.dir), WORLD_PROFILE_FORMAT);
  assert.equal(f.studio.clips.get(clip.id).votes, undefined);
});

test('reader3 clip damage rejects an older valid backup without overwriting any primary or marker', async (t) => {
  const f = await service(t),
    { clip, reading } = seedClip(f.studio);
  const old = bytes(f.dir, 'clips');
  f.studio.clips.commentBatch(clip.id, [], { reading, readers: [ids[150]] });
  await f.close();
  writeFileSync(join(f.dir, 'clips.json.bak.1'), old);
  writeFileSync(join(f.dir, 'clips.json'), '{damaged');
  const world = bytes(f.dir, 'world'),
    marker = bytes(f.dir, 'profile-format');
  await assert.rejects(service(t, f.dir), /기본 저장 파일을 자동 복구할 수 없습니다/);
  assert.equal(bytes(f.dir, 'clips'), '{damaged');
  assert.equal(bytes(f.dir, 'world'), world);
  assert.equal(bytes(f.dir, 'profile-format'), marker);
  assert.equal(readFileSync(join(f.dir, 'clips.json.bak.1'), 'utf8'), old);
  assert.equal(existsSync(join(f.dir, '.nagneon-writer')), false);
});

test('reader3 never restores a missing clip primary from the older backup', async (t) => {
  const f = await service(t),
    { clip, reading } = seedClip(f.studio);
  const old = bytes(f.dir, 'clips');
  f.studio.clips.commentBatch(clip.id, [], { reading, readers: [ids[150]] });
  await f.close();
  writeFileSync(join(f.dir, 'clips.json.bak.1'), old);
  unlinkSync(join(f.dir, 'clips.json'));
  const marker = bytes(f.dir, 'profile-format');
  await assert.rejects(service(t, f.dir), /기본 저장 파일을 자동 복구할 수 없습니다/);
  assert.equal(existsSync(join(f.dir, 'clips.json')), false);
  assert.equal(readFileSync(join(f.dir, 'clips.json.bak.1'), 'utf8'), old);
  assert.equal(bytes(f.dir, 'profile-format'), marker);
});

test('all stores, including native audio, validate before a high-count profile marker or startup record is written', async (t) => {
  const f = await service(t),
    { clip } = seedClip(f.studio, 0);
  const expanded = structuredClone(f.studio.clips.data);
  const temporary = new Clips({ data: expanded });
  temporary.commentBatch(clip.id, [], {
    reading: clipTextSnapshot(temporary.get(clip.id)),
    readers: ids,
  });
  await f.close();
  write(f.dir, 'clips', temporary.data);
  write(f.dir, 'native-audio', { mode: 'invalid' });
  const marker = bytes(f.dir, 'profile-format'),
    world = bytes(f.dir, 'world'),
    clips = bytes(f.dir, 'clips');
  await assert.rejects(service(t, f.dir));
  assert.equal(bytes(f.dir, 'profile-format'), marker);
  assert.equal(bytes(f.dir, 'world'), world);
  assert.equal(bytes(f.dir, 'clips'), clips);
  assert.equal(existsSync(join(f.dir, '.nagneon-writer')), false);
});

test('unsupported, malformed or incomplete profile markers fail before provider checks and preserve original bytes', async (t) => {
  for (const marker of [
    { minReader: 4, minAppVersion: '0.1.17' },
    { minReader: 3, minAppVersion: '99.0.0' },
    { minReader: 2 },
    null,
    [],
    { minReader: 2, minAppVersion: 'unknown' },
  ]) {
    const dir = directory();
    write(dir, 'world', { version: 2 });
    write(dir, 'profile-format', marker);
    const before = bytes(dir, 'profile-format');
    let checked = 0;
    await assert.rejects(service(t, dir, () => checked++));
    assert.equal(checked, 0);
    assert.equal(bytes(dir, 'profile-format'), before);
    assert.equal(existsSync(join(dir, '.nagneon-writer')), false);
  }
  const missing = directory();
  write(missing, 'profile-format', UNLIMITED_READERS_FORMAT);
  let checked = 0;
  await assert.rejects(
    service(t, missing, () => checked++),
    /기본 저장 파일/,
  );
  assert.equal(checked, 0);
  assert.equal(existsSync(join(missing, 'world.json')), false);
});

test('a corrupt marker never adopts its older backup or allows a provider check', async (t) => {
  const dir = directory();
  write(dir, 'world', { version: 2 });
  writeFileSync(join(dir, 'profile-format.json'), '{broken');
  writeFileSync(join(dir, 'profile-format.json.bak.1'), JSON.stringify(WORLD_PROFILE_FORMAT));
  let checked = 0;
  await assert.rejects(
    service(t, dir, () => checked++),
    /프로필 형식 표시를 읽을 수 없습니다/,
  );
  assert.equal(checked, 0);
  assert.equal(bytes(dir, 'profile-format'), '{broken');
  assert.deepEqual(
    JSON.parse(readFileSync(join(dir, 'profile-format.json.bak.1'), 'utf8')),
    WORLD_PROFILE_FORMAT,
  );
  assert.equal(existsSync(join(dir, '.nagneon-writer')), false);
});
