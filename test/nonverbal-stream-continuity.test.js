import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Studio } from '../server/studio.js';
import { Audience } from '../server/audience.js';
import { defaults } from '../shared/defaults.js';

const img = (label) => 'data:image/png;base64,' + Buffer.from(label).toString('base64');
const observation = {
  game: 'Synthetic',
  scene: '합성 화면 전환',
  confidence: 0.9,
  excitement: 0.3,
  messages: [{ personaId: 'momo', text: '오 넘어갔다', kind: 'chat', spoiler: false }],
};
function fixture(t, respond) {
  let at = 100000,
    sequence = 0;
  const calls = [],
    runId = randomUUID(),
    inputEpoch = randomUUID(),
    sourceId = randomUUID();
  const s = new Studio({
    now: () => at,
    random: () => 0.5,
    audience: new Audience(
      undefined,
      () => {},
      () => 0.5,
    ),
    settings: {
      ...defaults,
      mode: 'live',
      intervalSeconds: 5,
      lurkRatio: 0,
      slowModeSeconds: 0,
      chatPace: 8,
      autoHighlights: false,
      communityActivityEnabled: false,
    },
    provider: {
      status: () => ({ configured: true, kind: 'fixture' }),
      react: async (args, signal) => {
        calls.push({ args, signal });
        return respond ? respond(args, signal) : { observation };
      },
    },
  });
  clearInterval(s.timer);
  s.start();
  at += 10000;
  t.after(() => s.close());
  return {
    s,
    calls,
    now: () => at,
    advance: (ms) => (at += ms),
    video: (labels = ['before', 'after']) => ({
      sessionId: s.sessionId,
      sourceId,
      frames: labels.map((label, i) => ({
        image: img(label),
        at: at - (labels.length - 1 - i) * 500,
      })),
    }),
    receive(text = '[laughs]', source = 'microphone') {
      const id = randomUUID(),
        n = sequence++;
      const input = {
        id,
        sessionId: s.sessionId,
        text,
        source,
        ...(source === 'microphone'
          ? {
              capture: {
                startedAt: at - 400,
                endedAt: at - 100,
                voice: {
                  provider: 'chatgpt-subscription',
                  kind: 'transcript',
                  runId,
                  sourceInputEpoch: inputEpoch,
                  fragmentCount: 1,
                  sourceFrameStart: n * 16000,
                  sourceFrameEnd: (n + 1) * 16000,
                  timing: 'approximate-provider-interval',
                  receivedAt: at,
                  recovered: false,
                },
              },
            }
          : {}),
      };
      return { input, result: s.receiveSpeech(input) };
    },
  };
}

test('annotation-only input without external stream context completes without inference or a visual cursor', async (t) => {
  const f = fixture(t);
  const receipt = f.receive();
  assert.deepEqual(await f.s.react({}), { ok: true, nonSpeech: true });
  assert.equal(f.calls.length, 0);
  assert.equal(f.s.speechInbox.pending.length, 0);
  assert.equal(f.s.viewing.last, null);
  assert.equal(f.s.viewing.checkedAt, 0);
  assert.equal(f.s.messages.find((m) => m.id === receipt.result.messageId).text, '[laughs]');
  assert.equal(f.s.receiveSpeech(receipt.input).duplicate, true);
});

test('repeated annotations never swallow a fresh temporal screen window', async (t) => {
  const f = fixture(t);
  for (const [index, text] of ['[laughs]', '[clear throat'].entries()) {
    f.receive(text);
    const video = f.video(['before-' + index, 'after-' + index]);
    assert.equal((await f.s.react({ video })).ok, true);
    assert.equal(f.calls.length, index + 1);
    assert.deepEqual(f.calls[index].args.frames, video.frames);
    assert.equal(f.calls[index].args.speech, '');
    assert.deepEqual(f.calls[index].args.liveSpeech, []);
    assert.equal(f.s.viewing.last.video.through, video.frames.at(-1).at);
    assert.equal(f.s.speechInbox.pending.length, 0);
    f.advance(6000);
  }
});

test('several annotation receipts cannot create a phantom spoken turn or block real speech', async (t) => {
  let release;
  const f = fixture(
    t,
    () =>
      new Promise((resolve) => {
        release = () => resolve({ observation });
      }),
  );
  f.receive('[laughs]');
  f.receive('[coughs]');
  assert.equal(f.s.speechInbox.batch().ids.length, 2);
  assert.equal(f.s.speechInbox.batch().text.trim(), '');
  const pending = f.s.react({ video: f.video() });
  await new Promise((resolve) => setImmediate(resolve));
  const projectedSpeech = f.calls[0].args.speech;
  f.receive('새 얘기야');
  const aborted = f.calls[0].signal.aborted;
  release();
  await pending;
  assert.equal(projectedSpeech, '');
  assert.equal(aborted, true);
  assert.equal(f.s.speechInbox.batch().text, '새 얘기야');
});

test('annotation-only receipts preserve queued visual replies', async (t) => {
  const f = fixture(t);
  await f.s.react({ video: f.video() });
  const queued = [...f.s.queue];
  assert.ok(queued.length);
  f.receive();
  assert.deepEqual(f.s.queue, queued);
  f.advance(queued[0].due - f.now());
  f.s.pump();
  assert.ok(
    f.s.messages.some(
      (m) => m.kind === 'chat' && m.text === queued[0].text && m.personaId === queued[0].personaId,
    ),
  );
  assert.equal(f.s.queue.length, 0);
  assert.equal(f.s.reactions.snapshot(f.s.queue).requests[0].delivered, 1);
});

test('annotations do not force another analysis of an unchanged screen', async (t) => {
  const f = fixture(t);
  await f.s.react({ video: f.video(['same', 'same']) });
  f.advance(6000);
  f.receive();
  assert.deepEqual(await f.s.react({ video: f.video(['same', 'same']) }), {
    skipped: 'unchanged-input',
  });
  assert.equal(f.calls.length, 1);
  assert.equal(f.s.speechInbox.pending.length, 0);
});

test('annotations received during visual inference do not cancel the active screen request', async (t) => {
  let release;
  const f = fixture(
    t,
    () =>
      new Promise((resolve) => {
        release = () => resolve({ observation });
      }),
  );
  const pending = f.s.react({ video: f.video() });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls.length, 1);
  f.receive();
  const aborted = f.calls[0].signal.aborted;
  release();
  const result = await pending;
  assert.equal(aborted, false);
  assert.equal(result.ok, true);
  assert.ok(f.s.queue.length);
  assert.equal(f.s.speechInbox.pending.length, 1);
});

test('real spoken words and keyboard annotation text keep their normal interruption behavior', async (t) => {
  for (const [text, source] of [
    ['[laughs] 아니요', 'microphone'],
    ['음', 'microphone'],
    ['[laughs]', 'keyboard'],
  ]) {
    let release;
    const f = fixture(
      t,
      () =>
        new Promise((resolve) => {
          release = () => resolve({ observation });
        }),
    );
    const pending = f.s.react({ video: f.video() });
    await new Promise((resolve) => setImmediate(resolve));
    f.receive(text, source);
    const aborted = f.calls[0].signal.aborted;
    release();
    await pending;
    assert.equal(aborted, true, text + '/' + source);
    assert.ok(f.s.speechInbox.batch().text.trim(), 'Actual words remain pending');
  }
});

test('a later viewer sees current imagery without inheriting the old annotation hearer filter', async (t) => {
  const f = fixture(t);
  f.s.audience.setPresence('pop', 'away', f.now());
  f.receive();
  f.advance(1000);
  f.s.audience.setPresence('pop', 'active', f.now());
  const joinedAt = f.s.audience.data.members.pop.joinedAt;
  assert.equal((await f.s.react({ video: f.video() })).ok, true);
  assert.equal(f.calls.length, 1);
  const args = f.calls[0].args;
  assert.ok(args.settings.personas.some((p) => p.id === 'pop'));
  assert.ok(args.frames.length);
  assert.ok(args.frames.every((frame) => frame.at >= joinedAt));
  assert.deepEqual(args.liveSpeech, []);
  assert.equal(JSON.stringify(args.viewerContext.pop).includes('[laughs]'), false);
});

test('fresh witnessed system sound and donation context survive annotation-only receipts', async (t) => {
  for (const input of ['sound', 'donation']) {
    const f = fixture(t);
    if (input === 'sound') {
      const id = randomUUID(),
        startedAt = f.now();
      f.s.sound.start(id);
      f.advance(500);
      const ticket = f.s.sound.begin({ id, segmentId: randomUUID(), startedAt, endedAt: f.now() });
      f.s.sound.finish(ticket, {
        durationSeconds: 0.5,
        volumeDb: -20,
        balance: 0,
        silent: false,
        classes: [
          { id: 'effect', label: '합성 효과음', score: 0.9, peak: 0.9, offsetSeconds: 0.1 },
        ],
        systemSpeech: '',
        language: 'unknown',
        source: 'system-output',
        caveat: '합성 검사',
      });
    } else f.s.addMessage('momo', '합성 응원 포인트', 'donation');
    f.receive();
    assert.equal((await f.s.react({})).ok, true);
    assert.equal(f.calls.length, 1, input);
    assert.equal(f.calls[0].args.speech, '');
    assert.deepEqual(f.calls[0].args.liveSpeech, []);
    assert.equal(f.s.speechInbox.pending.length, 0);
    assert.ok(
      JSON.stringify(f.calls[0].args.viewerContext).includes(
        input === 'sound' ? '합성 효과음' : '합성 응원 포인트',
      ),
    );
  }
});

test('a failed visual request consumes only annotation receipts, retaining visual retry and backoff', async (t) => {
  let attempts = 0;
  const f = fixture(t, async () => {
    if (++attempts === 1) throw Error('synthetic unavailable');
    return { observation };
  });
  f.receive();
  await assert.rejects(f.s.react({ video: f.video() }), /synthetic unavailable/);
  assert.equal(f.s.speechInbox.pending.length, 0);
  assert.equal(f.s.viewing.last, null);
  assert.deepEqual(await f.s.react({ video: f.video() }), { skipped: 'backoff' });
  assert.equal(f.calls.length, 1);
  f.advance(f.s.retryAt - f.now() + 1);
  assert.equal((await f.s.react({ video: f.video() })).ok, true);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[1].args.liveSpeech, []);
});
