import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContinuousListening } from '../src/continuous-listening.ts';
import { SpeechRecoveryStore } from '../server/speech-recovery-store.js';

const sessionId = '11111111-1111-4111-8111-111111111111';
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

test('continuous frames are stored before recognition, retried from raw audio and delivered in source order', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'nagneon-continuous-listening-'));
  t.after(() => rm(root, { recursive: true }));
  const originalFetch = globalThis.fetch,
    store = new SpeechRecoveryStore(root),
    heard = [],
    errors = [];
  let attempts = 0,
    rawWrites = 0,
    rawReads = 0,
    prepareCalls = 0;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input), 'http://local');
    if (url.pathname === '/api/audio/raw' && options.method === 'POST') {
      rawWrites++;
      const bytes = Buffer.from(options.body);
      const result = await store.append({
        sessionId: options.headers['X-Speech-Session'],
        inputEpoch: options.headers['X-Speech-Epoch'],
        sequence: Number(options.headers['X-Speech-Sequence']),
        startFrame: Number(options.headers['X-Speech-Frame']),
        frameCount: Number(options.headers['X-Speech-Count']),
        data: bytes,
      });
      return Response.json(result);
    }
    if (url.pathname.startsWith('/api/audio/raw/')) {
      rawReads++;
      const [, , , , storedSession, epoch] = url.pathname.split('/');
      const wave = await store.readRange(
        storedSession,
        epoch,
        Number(url.searchParams.get('start')),
        Number(url.searchParams.get('end')),
      );
      return new Response(wave, { headers: { 'Content-Type': 'audio/wav' } });
    }
    if (url.pathname === '/api/audio/prepare') {
      prepareCalls++;
      return Response.json({ ok: true });
    }
    if (url.pathname === '/api/audio') {
      attempts++;
      if (attempts === 1)
        return Response.json({ error: '인식기 재시작', needsPreparation: true }, { status: 409 });
      return Response.json({
        text: attempts === 2 ? '첫 발언' : '둘째 발언',
        cues: { delivery: '보통' },
      });
    }
    throw Error(`unexpected ${url.pathname}`);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const listener = new ContinuousListening({
    sessionId,
    track: {},
    onLevel: () => {},
    onTranscript: (text, capture) => heard.push({ text, capture }),
    onError: (message) => errors.push(message),
  });
  t.after(() => listener.close());
  let frame = 0;
  const add = (value) => {
    listener.acceptFrames({
      startFrame: frame,
      samples: Int16Array.from({ length: 1600 }, () => value),
    });
    frame += 1600;
  };
  for (let i = 0; i < 10; i++) add(5000);
  for (let i = 0; i < 5; i++) add(0);
  for (let i = 0; i < 10; i++) add(5000);
  for (let i = 0; i < 5; i++) add(0);
  listener.flushRaw();
  for (let i = 0; i < 300 && heard.length < 2; i++) await tick();
  assert.deepEqual(
    heard.map((item) => item.text),
    ['첫 발언', '둘째 발언'],
  );
  assert.equal(rawWrites, 3);
  assert.equal(rawReads, 3);
  assert.equal(prepareCalls, 1);
  assert.ok(heard[0].capture.startedAt <= heard[1].capture.startedAt);
  assert.equal(listener.status().durable, frame);
  assert.deepEqual(errors, []);
  listener.stopCapture();
  await Promise.race([
    listener.drained,
    new Promise((_, reject) => setTimeout(() => reject(new Error('listener did not drain')), 2000)),
  ]);
  assert.equal(listener.closed, true);
});
