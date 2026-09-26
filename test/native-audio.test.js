import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NativeAudio } from '../server/native-audio.js';
import { AiControl } from '../server/ai-control.js';
const tick = () => new Promise((r) => setTimeout(r, 0));
async function until(condition) {
  for (let i = 0; i < 100 && !condition(); i++) await tick();
  assert.ok(condition());
}
const listening = {
  state: 'speech',
  utterances: [
    {
      heard: '아니 오른쪽',
      meaning: '직전 선택을 오른쪽으로 정정',
      kind: 'correction',
      uncertain: false,
    },
  ],
};
function harness({ understand, receiveSpeech, ...options } = {}) {
  let now = 100000;
  const inputs = [],
    received = [],
    providers = [];
  const studio = {
    running: true,
    settings: { mode: 'live' },
    sessionId: randomUUID(),
    controller: new AbortController(),
    ai: new AiControl(),
    publish() {},
    receiveSpeech: receiveSpeech || ((value) => received.push(value)),
  };
  studio.ai.bind({ context: () => studio, onChange() {}, onPolicy() {} });
  const audio = new NativeAudio({
    studio,
    key: 'synthetic-key',
    config: { mode: 'remote', consent: true },
    now: () => now,
    ...options,
    providerFactory: () => {
      const p = {
        model: 'gpt-realtime-2.1',
        base: 'https://api.openai.com/v1',
        openedAt: now,
        status: () => ({ kind: 'openai' }),
        connect: async () => {},
        append: async (bytes) => {
          inputs.push(Buffer.from(bytes));
        },
        commitInput: async () => 'item-' + randomUUID(),
        forget() {},
        close() {
          this.closed = true;
        },
        understand:
          understand ||
          (async () => ({
            listening,
            providerSessionEpoch: randomUUID(),
            providerItemId: 'item-test',
            usage: { input_tokens: 40, output_tokens: 20, total_tokens: 60 },
          })),
      };
      providers.push(p);
      return p;
    },
  });
  return {
    studio,
    audio,
    inputs,
    received,
    providers,
    advance: (ms) => {
      now += ms;
    },
    start: () =>
      audio.start({ sessionId: studio.sessionId, inputEpoch: randomUUID(), startedAt: now }),
    capture(startFrame, count = 4000) {
      const s = audio.session;
      const entry = {
        sessionId: studio.sessionId,
        inputEpoch: s.inputEpoch,
        startFrame,
        frameCount: count,
        data: Buffer.alloc(count * 2, 1),
      };
      audio.capture(entry);
      audio.stored(entry, { durableThrough: startFrame + count });
      return entry;
    },
  };
}

test('four chunks per second preserve all samples and native interpretations have host-owned source time', async (t) => {
  const h = harness();
  t.after(() => h.audio.close());
  await h.start();
  for (let frame = 0; frame < 64000; frame += 4000) h.capture(frame);
  await until(() => h.received.length === 2);
  assert.equal(Buffer.concat(h.inputs).length, 128000);
  assert.equal(h.received[0].capture.startedAt, 100000);
  assert.equal(h.received[1].capture.startedAt, 102000);
  assert.equal(h.received[1].capture.endedAt, 104000);
  assert.equal(h.received[1].capture.listening.frameStart, 32000);
  assert.equal(h.received[0].interpretation, true);
  assert.match(h.received[0].text, /전사문 아님/);
  assert.equal(h.audio.snapshot().pending, 0);
  assert.equal(h.audio.snapshot().memoryBytes, 0);
  assert.equal(h.studio.ai.data.recent.length, 2);
  assert.equal(h.studio.ai.data.recent[0].model, 'gpt-realtime-2.1');
});

test('microphone restart recovers unresolved ranges of the same broadcast without blocking the new epoch', async (t) => {
  let calls = 0;
  const h = harness({
    understand: async () => {
      if (++calls === 1) return new Promise(() => {});
      return { listening };
    },
  });
  t.after(() => h.audio.close());
  await h.start();
  h.capture(0, 16000);
  h.capture(16000, 16000);
  await until(() => calls === 1);
  const oldEpoch = h.audio.session.inputEpoch;
  h.audio.stop();
  await until(() => !h.audio.processing);
  assert.equal(h.audio.snapshot().pending, 1);
  assert.equal(h.audio.snapshot().active, false);
  h.advance(3000);
  await h.start();
  h.capture(0, 16000);
  h.capture(16000, 16000);
  await until(() => h.received.length === 2);
  assert.ok(h.received.some((r) => r.capture.listening.inputEpoch === oldEpoch));
  assert.equal(h.audio.snapshot().pending, 0);
});

test('a noncooperating adapter is bounded and its unknown usage is retained', async (t) => {
  const h = harness({ understand: () => new Promise(() => {}), operationTimeoutMs: 15 });
  t.after(() => h.audio.close());
  await h.start();
  h.capture(0, 16000);
  h.capture(16000, 16000);
  await until(() => h.audio.session.jobs.get(1)?.status === 'failed');
  assert.equal(h.studio.ai.data.recent[0].status, 'failed');
  assert.equal(h.studio.ai.data.recent[0].usage, null);
  assert.equal(h.audio.snapshot().pending, 1);
  assert.equal(h.received.length, 0);
});

test('screen evidence and captured witnesses survive delayed interpretation', async (t) => {
  const h = harness();
  t.after(() => h.audio.close());
  await h.start();
  h.studio.presentWitnesses = () => ['old', 'late'];
  h.studio.audience = {
    data: { members: { old: { joinedAt: 90000 }, late: { joinedAt: 101000 } } },
  };
  const epoch = h.audio.session.inputEpoch,
    sourceId = randomUUID();
  for (let i = 0; i < 2; i++) {
    const entry = {
      sessionId: h.studio.sessionId,
      inputEpoch: epoch,
      startFrame: i * 16000,
      frameCount: 16000,
      data: Buffer.alloc(32000),
      capture: {
        screen: {
          sessionId: h.studio.sessionId,
          sourceId,
          frames: [{ at: 100000 + i * 1000, image: 'data:image/png;base64,YQ==' }],
        },
      },
    };
    h.audio.capture(entry);
    h.audio.stored(entry, { durableThrough: (i + 1) * 16000 });
  }
  await until(() => h.received.length === 1);
  assert.deepEqual(h.received[0].capturedHearers, ['old']);
  assert.equal(h.received[0].capture.screen.sourceId, sourceId);
  assert.deepEqual(
    h.received[0].capture.screen.frames.map((f) => f.at),
    [100000, 101000],
  );
});

test('provider session rotation keeps source positions and does not reuse old provider items', async (t) => {
  const h = harness();
  t.after(() => h.audio.close());
  await h.start();
  h.capture(0, 16000);
  h.capture(16000, 16000);
  await until(() => h.received.length === 1);
  h.advance(55 * 60000 + 1);
  h.capture(32000, 16000);
  h.capture(48000, 16000);
  await until(() => h.received.length === 2);
  assert.equal(h.providers.length, 2);
  assert.equal(h.providers[0].closed, true);
  assert.equal(h.received[1].capture.startedAt, 102000);
});

test('final raw storage after microphone stop remains unresolved and never transmits', async (t) => {
  const h = harness();
  t.after(() => h.audio.close());
  await h.start();
  h.audio.stop();
  h.capture(0, 800);
  await tick();
  assert.equal(h.audio.snapshot().pending, 1);
  assert.equal(h.audio.snapshot().durable, 800);
  assert.equal(h.inputs.length, 0);
  assert.equal(h.received.length, 0);
});

test('an unresolved first interval does not prevent later processing, and the gap is explicit', async (t) => {
  let calls = 0;
  const h = harness({
    understand: async () => {
      if (++calls === 1) throw new Error('synthetic-first-failure');
      return { listening, providerSessionEpoch: randomUUID(), providerItemId: 'later' };
    },
  });
  t.after(() => h.audio.close());
  await h.start();
  for (let frame = 0; frame < 64000; frame += 4000) h.capture(frame);
  await until(() => h.audio.session.jobs.get(1)?.status === 'failed');
  h.advance(1100);
  await h.audio.pump(h.audio.session);
  assert.equal(h.received.length, 1);
  assert.equal(h.received[0].capture.listening.sequence, 2);
  assert.equal(h.received[0].capture.listening.unresolvedBefore, true);
  assert.equal(h.audio.snapshot().pending, 1);
  assert.equal(h.audio.session.jobs.get(1).frameStart, 0);
});

test('raw duplicate retries do not duplicate remote consumption and microphone stop blocks late acceptance', async (t) => {
  let complete;
  const h = harness({
    understand: () =>
      new Promise((r) => {
        complete = r;
      }),
  });
  t.after(() => h.audio.close());
  await h.start();
  const first = h.capture(0, 16000);
  h.audio.capture(first);
  h.capture(16000, 16000);
  await until(() => !!complete);
  h.audio.stop();
  complete({ listening, providerSessionEpoch: randomUUID(), providerItemId: 'late' });
  await tick();
  await tick();
  assert.equal(h.received.length, 0);
  assert.ok(h.providers.every((p) => p.closed));
  assert.equal(h.studio.ai.data.recent[0].status, 'cancelled');
});

test('consent and AI policy block connection and input without a local inference fallback', async (t) => {
  const h = harness();
  t.after(() => h.audio.close());
  h.audio.config.consent = false;
  await assert.rejects(h.start(), /전송 안내/);
  assert.equal(h.providers.length, 0);
  h.audio.config.consent = true;
  h.studio.ai.update({ paused: true });
  await assert.rejects(h.start(), /모두 차단/);
  assert.equal(h.providers.length, 0);
});

test('uncertain speech is unresolved, not converted to silence or a fabricated streamer quote', async (t) => {
  const h = harness({
    understand: async () => ({ listening: { state: 'uncertain', utterances: [] } }),
  });
  t.after(() => h.audio.close());
  await h.start();
  h.capture(0, 16000);
  h.capture(16000, 16000);
  await until(() => h.audio.snapshot().uncertain === 1);
  assert.equal(h.received.length, 0);
  assert.equal(h.audio.snapshot().nonSpeech, 0);
  assert.equal(h.audio.snapshot().pending, 1);
  h.advance(86400001);
  h.audio.expire(h.audio.session);
  assert.equal(h.audio.snapshot().expired, 1);
  assert.equal(h.audio.snapshot().applied, 0);
});

test('long interpretations resume partial publication without another model call or duplicate delivery', async (t) => {
  const utterances = Array.from({ length: 24 }, (_, i) => ({
    heard: `이름${i}`,
    meaning: '해석'.repeat(80),
    kind: 'statement',
    uncertain: false,
  }));
  let calls = 0,
    rejectSecond = true;
  const received = [];
  const h = harness({
    understand: async () => {
      calls++;
      return { listening: { state: 'speech', utterances } };
    },
    receiveSpeech: (value) => {
      if (value.capture.listening.partIndex === 1 && rejectSecond) {
        rejectSecond = false;
        throw Error('synthetic inbox full');
      }
      received.push(value);
    },
  });
  t.after(() => h.audio.close());
  await h.start();
  h.capture(0, 16000);
  h.capture(16000, 16000);
  await until(() => h.audio.session.jobs.get(1)?.status === 'failed');
  assert.equal(calls, 1);
  assert.equal(received.length, 1);
  const firstId = received[0].id;
  h.advance(10001);
  await h.audio.pump();
  assert.equal(calls, 1);
  assert.equal(h.audio.snapshot().pending, 0);
  assert.ok(received.length > 1);
  assert.equal(received.filter((value) => value.id === firstId).length, 1);
  assert.equal(new Set(received.map((value) => value.id)).size, received.length);
  assert.ok(received.every((value) => value.text.length <= 3000));
  for (let i = 0; i < 24; i++)
    assert.equal(
      received
        .map((value) => value.text)
        .join('\n')
        .split(`청취 문구 후보: 이름${i};`).length - 1,
      1,
    );
  assert.equal(h.studio.ai.data.recent[0].application, 'accepted');
});
