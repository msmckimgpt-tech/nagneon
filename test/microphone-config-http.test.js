import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer } from '../server/index.js';

test('saved microphone is authenticated, validates fixed IDs and survives a server restart without capture', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'nagneon-mic-config-'));
  const services = [];
  t.after(async () => {
    for (const service of services) await service.close();
    await rm(dataDir, { recursive: true });
  });
  const open = async () => {
    const service = await startServer({
      port: 0,
      dataDir,
      persist: true,
      localSpeech: false,
      provider: { status: () => ({ configured: true }) },
    });
    clearInterval(service.studio.timer);
    services.push(service);
    return service;
  };
  let s = await open();
  const post = (body) =>
    fetch(s.url + '/api/microphone/config', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + s.accessToken,
        'X-Backseat-Client': 'studio',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  assert.equal((await fetch(s.url + '/api/microphone/config')).status, 401);
  for (const deviceId of ['default', 'communications', ''])
    assert.notEqual((await post({ deviceId, label: 'alias' })).status, 200);
  const selected = { deviceId: 'fixed-usb-test', label: 'USB microphone' };
  assert.equal((await post(selected)).status, 200);
  assert.equal(s.studio.running, false);
  assert.equal(s.nativeAudio.snapshot().active, false);
  assert.deepEqual(s.studio.state().microphone, selected);
  assert.deepEqual(JSON.parse(await readFile(join(dataDir, 'microphone.json'), 'utf8')), selected);
  await s.close();
  s = await open();
  assert.deepEqual(s.studio.state().microphone, selected);
});
