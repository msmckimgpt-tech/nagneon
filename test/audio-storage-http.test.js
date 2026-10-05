import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { startServer } from '../server/index.js';

test('storage settings and source deletion are authenticated, persistent and isolated from active broadcasts', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'nagneon-storage-http-'));
  const services = [];
  t.after(async () => {
    for (const service of services) await service.close();
    await rm(dir, { recursive: true });
  });
  const open = async () => {
    const service = await startServer({
      port: 0,
      dataDir: dir,
      persist: true,
      localSpeech: false,
      provider: { status: () => ({ configured: true }) },
    });
    services.push(service);
    clearInterval(service.studio.timer);
    return service;
  };
  let s = await open();
  const request = async (path, body, method = body ? 'POST' : 'GET') => {
    const response = await fetch(s.url + '/api/' + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + s.accessToken,
        'X-Backseat-Client': 'studio',
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await fetch(s.url + '/api/audio/storage')).status, 401);
  const config = { retentionHours: 72, maxBytes: 1024 ** 3 };
  assert.equal((await request('audio/storage/config', config)).status, 200);
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'speech-retention.json'), 'utf8')), config);
  const sessionId = randomUUID(),
    inputEpoch = randomUUID();
  await s.appendSpeechRaw({
    sessionId,
    inputEpoch,
    sequence: 1,
    startFrame: 0,
    frameCount: 1600,
    data: Buffer.alloc(3200, 3),
  });
  assert.equal((await request('audio/storage')).body.records.length, 1);
  s.studio.running = true;
  s.studio.sessionId = sessionId;
  const denied = await request('audio/storage/delete', { sessionId, inputEpoch, confirm: true });
  assert.notEqual(denied.status, 200);
  assert.match(denied.body.error, /방송 중/);
  assert.notEqual((await request('audio/storage/config', config)).status, 200);
  s.studio.running = false;
  await s.close();
  s = await open();
  const restored = await request('audio/storage');
  assert.equal(restored.body.retentionHours, 72);
  assert.equal(restored.body.usedBytes, 3200);
  assert.notEqual((await request('audio/storage/delete', { sessionId, inputEpoch })).status, 200);
  assert.equal(
    (await request('audio/storage/delete', { sessionId, inputEpoch, confirm: true })).body
      .usedBytes,
    0,
  );
});
