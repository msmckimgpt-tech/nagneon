import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/index.js';

test('authenticated local HTTP saves PCM before serving its exact WAV range', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'nagneon-speech-http-'));
  t.after(() => rm(dataDir, { recursive: true }));
  const service = await startServer({
    port: 0,
    dataDir,
    localSpeech: false,
    provider: { status: () => ({ configured: false }) },
  });
  t.after(() => service.close());
  const sessionId = '11111111-1111-4111-8111-111111111111',
    inputEpoch = '22222222-2222-4222-8222-222222222222',
    bytes = Buffer.alloc(3200, 4);
  const upload = () =>
    fetch(service.url + '/api/audio/raw', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + service.accessToken,
        'X-Backseat-Client': 'studio',
        'Content-Type': 'application/octet-stream',
        'X-Speech-Session': sessionId,
        'X-Speech-Epoch': inputEpoch,
        'X-Speech-Sequence': '1',
        'X-Speech-Frame': '0',
        'X-Speech-Count': '1600',
      },
      body: bytes,
    });
  assert.equal(
    (await fetch(service.url + '/api/audio/raw', { method: 'POST', body: bytes })).status,
    403,
  );
  let response = await upload();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).durableThrough, 1600);
  response = await upload();
  assert.equal((await response.json()).duplicate, true);
  response = await fetch(
    service.url + `/api/audio/raw/${sessionId}/${inputEpoch}?start=0&end=1600`,
    { headers: { Authorization: 'Bearer ' + service.accessToken } },
  );
  assert.equal(response.status, 200);
  const wave = Buffer.from(await response.arrayBuffer());
  assert.equal(wave.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wave.length, 3244);
  assert.ok(wave.subarray(44).equals(bytes));
});
