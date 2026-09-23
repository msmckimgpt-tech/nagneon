import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SpeechRecoveryStore, SPEECH_RAW_RETENTION_MS } from '../server/speech-recovery-store.js';

const sessionId = '11111111-1111-4111-8111-111111111111',
  inputEpoch = '22222222-2222-4222-8222-222222222222';
const pcm = (value) => {
  const data = Buffer.alloc(3200);
  data.fill(value);
  return data;
};

test('raw PCM is durable, idempotent, ordered and reconstructable after store restart', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'nagneon-speech-recovery-'));
  t.after(() => rm(root, { recursive: true }));
  let now = 1000000,
    store = new SpeechRecoveryStore(root, { now: () => now });
  const first = {
    sessionId,
    inputEpoch,
    sequence: 1,
    startFrame: 0,
    frameCount: 1600,
    data: pcm(1),
  };
  assert.equal((await store.append(first)).durableThrough, 1600);
  assert.equal((await store.append(first)).duplicate, true);
  await assert.rejects(store.append({ ...first, data: pcm(2) }), /내용이 달라/);
  await assert.rejects(store.append({ ...first, sequence: 3, startFrame: 1600 }), /연속되지/);
  store = new SpeechRecoveryStore(root, { now: () => now });
  assert.equal(
    (await store.append({ ...first, sequence: 2, startFrame: 1600, data: pcm(2) })).durableThrough,
    3200,
  );
  const wave = await store.readRange(sessionId, inputEpoch, 800, 2400);
  assert.equal(wave.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wave.length, 44 + 1600 * 2);
  assert.ok(wave.subarray(44, 44 + 800 * 2).every((byte) => byte === 1));
  assert.ok(wave.subarray(44 + 800 * 2).every((byte) => byte === 2));
  assert.equal((await store.list())[0].chunkCount, 2);
  const interrupted = join(store.folder(sessionId, inputEpoch),
    '00000003-000000003200-00001600.pcm.33333333-3333-4333-8333-333333333333.tmp');
  await writeFile(interrupted, pcm(3));
  now = Date.now() + SPEECH_RAW_RETENTION_MS + 1;
  assert.equal((await store.sweep()).length, 3);
  await assert.rejects(stat(interrupted), {code: 'ENOENT'});
  await assert.rejects(store.readRange(sessionId, inputEpoch, 0, 1600), /아직 보존되지|만료/);
  store = new SpeechRecoveryStore(root, { now: () => now });
  assert.equal(
    (await store.append({ ...first, sequence: 3, startFrame: 3200, data: pcm(3) })).durableThrough,
    4800,
  );
  const resumed = await store.readRange(sessionId, inputEpoch, 3200, 4800);
  assert.ok(resumed.subarray(44).every((byte) => byte === 3));
});
