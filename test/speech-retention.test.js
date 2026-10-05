import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { SpeechRecoveryStore } from '../server/speech-recovery-store.js';
import { SpeechRetentionConfig, defaultSpeechRetention } from '../shared/speech-retention.js';

const sessionId = '11111111-1111-4111-8111-111111111111';
const inputEpoch = '22222222-2222-4222-8222-222222222222';
const otherEpoch = '33333333-3333-4333-8333-333333333333';
const entry = (epoch = inputEpoch) => ({
  sessionId,
  inputEpoch: epoch,
  sequence: 1,
  startFrame: 0,
  frameCount: 1600,
  data: Buffer.alloc(3200, 7),
});
async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'nagneon-retention-'));
  t.after(() => rm(root, { recursive: true }));
  return { root, store: new SpeechRecoveryStore(root, options) };
}

test('global capacity bounds concurrent epochs and survives a restart without evicting recordings', async (t) => {
  const policy = () => ({ retentionHours: 24, maxBytes: 3200 });
  const { root, store } = await fixture(t, { policy });
  const results = await Promise.allSettled([
    store.append(entry()),
    store.append(entry(otherEpoch)),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    ['fulfilled', 'rejected'],
  );
  assert.equal(results[1].reason.code, 'SPEECH_STORAGE_FULL');
  assert.equal((await store.status()).usedBytes, 3200);
  const restarted = new SpeechRecoveryStore(root, { policy });
  await assert.rejects(restarted.append(entry(otherEpoch)), { code: 'SPEECH_STORAGE_FULL' });
  assert.ok(
    (await restarted.readRange(sessionId, inputEpoch, 0, 1600)).subarray(44).equals(entry().data),
  );
  assert.equal((await restarted.append(entry())).duplicate, true);
});

test('active broadcasts retain old chunks; capacity failure and stop never silently delete them', async (t) => {
  let now = Date.now(),
    active = true;
  const { store } = await fixture(t, {
    now: () => now,
    isActive: (id) => active && id === sessionId,
    policy: () => ({ retentionHours: 1, maxBytes: 3200 }),
  });
  await store.append(entry());
  now += 2 * 3600000;
  assert.deepEqual(await store.sweep(), []);
  assert.equal((await store.list())[0].active, true);
  await assert.rejects(store.remove(sessionId, inputEpoch), /방송 중/);
  await assert.rejects(store.append({ ...entry(), sequence: 2, startFrame: 1600 }), {
    code: 'SPEECH_STORAGE_FULL',
  });
  assert.equal((await store.readRange(sessionId, inputEpoch, 0, 1600)).length, 3244);
  active = false;
  assert.equal((await store.sweep()).length, 1);
  assert.equal((await store.status()).usedBytes, 0);
});

test('manual deletion preserves unrelated records and rejects late replay across restart', async (t) => {
  const { root, store } = await fixture(t);
  await store.append(entry());
  await store.append(entry(otherEpoch));
  const before = await store.readRange(sessionId, otherEpoch, 0, 1600);
  assert.equal((await store.remove(sessionId, inputEpoch)).deleted, 3200);
  assert.equal((await store.status()).records.length, 1);
  assert.deepEqual(await store.readRange(sessionId, otherEpoch, 0, 1600), before);
  await assert.rejects(store.append(entry()), /삭제한 원음/);
  const restarted = new SpeechRecoveryStore(root);
  await assert.rejects(restarted.append(entry()), /삭제한 원음/);
  await assert.rejects(store.remove('../outside', inputEpoch), /식별자/);
});

test('an in-flight download prevents deletion and releases protection when destroyed', async (t) => {
  const { store } = await fixture(t);
  await store.append(entry());
  const download = await store.download(sessionId, inputEpoch);
  await assert.rejects(store.remove(sessionId, inputEpoch), /사용 중/);
  const closed = once(download.stream, 'close');
  download.stream.destroy();
  await closed;
  assert.equal((await store.remove(sessionId, inputEpoch)).deleted, 3200);
});

test('directory junctions cannot redirect manual deletion or capture outside the archive', async (t) => {
  const { root } = await fixture(t);
  const archive = join(root, 'archive'),
    protectedDir = join(root, 'preserve');
  await mkdir(archive);
  await mkdir(protectedDir);
  await writeFile(join(protectedDir, 'keep.txt'), 'preserve');
  await symlink(
    protectedDir,
    join(archive, sessionId),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const store = new SpeechRecoveryStore(archive);
  await assert.rejects(store.remove(sessionId, inputEpoch), /보관 경로/);
  await assert.rejects(store.append(entry()), /보관 경로/);
  assert.equal(await readFile(join(protectedDir, 'keep.txt'), 'utf8'), 'preserve');
  assert.deepEqual(await readdir(protectedDir), ['keep.txt']);
});

test('retention settings accept bounded choices only', () => {
  assert.deepEqual(SpeechRetentionConfig.parse(defaultSpeechRetention()), {
    retentionHours: 24,
    maxBytes: 2 * 1024 ** 3,
  });
  assert.throws(() => SpeechRetentionConfig.parse({ retentionHours: 0, maxBytes: Infinity }));
  assert.throws(() =>
    SpeechRetentionConfig.parse({ ...defaultSpeechRetention(), path: '../elsewhere' }),
  );
});
