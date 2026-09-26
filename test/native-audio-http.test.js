import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startServer } from '../server/index.js';

test('native microphone consent is authenticated, key stays in memory, and no local preparation runs', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'nagneon-native-http-'));
  let localPreparation = 0,
    released = 0,
    appended = 0;
  const service = await startServer({
    port: 0,
    dataDir: dir,
    speechWorker: {
      ready: false,
      prepare: async () => {
        localPreparation++;
        throw Error('unexpected local preparation');
      },
      stopWorker: async () => {
        released++;
      },
      close: async () => {},
    },
    provider: {
      status: () => ({ configured: true, kind: 'codex', model: 'synthetic' }),
      react: async () => {
        throw Error('not requested');
      },
    },
    nativeAudioProviderFactory: () => ({
      model: 'gpt-realtime-2.1',
      base: 'https://api.openai.com/v1',
      openedAt: Date.now(),
      status: () => ({ kind: 'openai' }),
      connect: async () => {},
      append: async () => {
        appended++;
      },
      commitInput: async () => randomUUID(),
      forget() {},
      close() {
        this.closed = true;
      },
      understand: async () => ({
        listening: {
          state: 'speech',
          utterances: [{ heard: '아니', meaning: '거절', kind: 'refusal', uncertain: false }],
        },
      }),
    }),
  });
  t.after(async () => {
    await service.close();
    await rm(dir, { recursive: true });
  });
  service.studio.ai.update({ background: false });
  const post = (path, body) =>
    fetch(service.url + '/api/' + path, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + service.accessToken,
        'X-Backseat-Client': 'studio',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  assert.equal(
    (
      await fetch(service.url + '/api/native-audio/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'remote', consent: true, apiKey: 'synthetic-key' }),
      })
    ).status,
    403,
  );
  assert.equal(
    (await post('native-audio/config', { mode: 'remote', consent: true, apiKey: 'synthetic-key' }))
      .status,
    200,
  );
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'native-audio.json'), 'utf8')), {
    mode: 'remote',
    consent: true,
  });
  assert.equal(JSON.stringify(service.studio.state()).includes('synthetic-key'), false);
  assert.equal((await post('runtime/prepare', { feature: 'microphone' })).status, 200);
  service.studio.settings.mode = 'live';
  service.studio.start();
  assert.equal((await post('audio/prepare', {})).status, 200);
  assert.equal(localPreparation, 0);
  const epoch = randomUUID();
  const started = await post('native-audio/start', {
    sessionId: service.studio.sessionId,
    inputEpoch: epoch,
    startedAt: Date.now(),
  });
  assert.equal(started.status, 200);
  assert.ok(released >= 2);
  for (let i = 0; i < 2; i++)
    await service.appendSpeechRaw({
      sessionId: service.studio.sessionId,
      inputEpoch: epoch,
      sequence: i + 1,
      startFrame: i * 16000,
      frameCount: 16000,
      data: Buffer.alloc(32000),
    });
  for (let i = 0; i < 100 && !service.nativeAudio.snapshot().applied; i++)
    await new Promise((r) => setTimeout(r, 5));
  assert.equal(service.nativeAudio.snapshot().applied, 1);
  assert.ok(appended > 0);
  const native = service.studio.speechInbox.pending[0];
  assert.ok(native.capture.listening);
  assert.equal(
    service.studio.messages.find((m) => m.id === native.messageId).transcription,
    undefined,
  );
  assert.deepEqual(service.studio.speechInbox.candidates([native.id]), []);
  assert.equal((await post('native-audio/stop', { inputEpoch: epoch })).status, 200);
  assert.equal(service.nativeAudio.snapshot().active, false);
  assert.equal(localPreparation, 0);
});
