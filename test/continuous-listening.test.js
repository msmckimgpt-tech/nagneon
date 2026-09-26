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


test('confirmed non-speech completes so later speech is delivered without retries', async (t) => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  const heard = [], errors = [];
  globalThis.fetch = async (input) => {
    if (String(input).startsWith('/api/audio/raw/')) return new Response(new Uint8Array(44));
    requests++;
    return Response.json(requests === 1 ? {text: '', noSpeech: true} : {text: '다음 발언'});
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const listener = new ContinuousListening({sessionId, track: {}, onLevel() {}, onTranscript: text => heard.push(text), onError: message => errors.push(message)});
  t.after(() => listener.close());
  listener.durableThrough = 32000;
  for (let i = 0; i < 2; i++) listener.acceptSegment({startFrame:i*16000,endFrame:(i+1)*16000,capture:{startedAt: i*1000,endedAt:(i+1)*1000}});
  await listener.controller.whenIdle();
  assert.deepEqual(heard, ['다음 발언']);
  assert.equal(requests, 2);
  assert.deepEqual(errors, []);
  assert.equal(listener.controller.retryFailed(), 0);
});

test('reconnected microphone preserves new speech while previous recognition drains', async (t) => {
  const originalFetch = globalThis.fetch;
  const requests = [], heard = [];
  let finishPrevious;
  const previousDrained = new Promise(resolve => { finishPrevious = resolve; });
  globalThis.fetch = async input => {
    requests.push(String(input));
    return String(input).startsWith('/api/audio/raw/')
      ? new Response(new Uint8Array(44)) : Response.json({text:'재연결 뒤 발언'});
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const listener = new ContinuousListening({sessionId, track:{}, recognizeAfter:previousDrained,
    onLevel(){}, onTranscript:text=>heard.push(text), onError:message=>assert.fail(message)});
  t.after(() => listener.close());
  listener.durableThrough = 16000;
  listener.acceptSegment({startFrame:0,endFrame:16000,capture:{startedAt:1000,endedAt:2000}});
  await tick();
  assert.deepEqual(requests, [], 'new capture must not compete with the old decoder');
  assert.equal(listener.captures.size, 1, 'new speech remains queued');
  finishPrevious();
  await listener.controller.whenIdle();
  assert.deepEqual(heard, ['재연결 뒤 발언']);
  assert.equal(requests.length, 2);
});
