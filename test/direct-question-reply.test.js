import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Studio } from '../server/studio.js';
import { Audience } from '../server/audience.js';
import { defaults } from '../shared/defaults.js';
import { AudienceAutonomy } from '../server/audience-autonomy.js';
import { captureDirectQuestion, replySource } from '../server/live-response-policy.js';

// Non-sensitive projection of the owned synthetic subscription response.
// IDs and game labels are synthetic; no user conversations or media are copied.
const rawReply = {
  personaId: 'pop',
  text: '오른쪽으로 이동했어요.',
  kind: 'chat',
  spoiler: false,
  intent: 'reply',
  replyTo: null,
};
const response = (messages = [rawReply]) => ({
  observation: {
    game: 'Synthetic',
    scene: '흰 네모가 오른쪽으로 이동했다.',
    confidence: 0.99,
    excitement: 0.1,
    messages,
  },
});
const question =
  '팝콘님, 흰 네모가 방금 어느 쪽으로 이동했나요? 화면에서 보인 이동을 짧게 말해 줄래요?';
const image = (text) => 'data:image/png;base64,' + Buffer.from(text).toString('base64');

function fixture(t) {
  let at = 1_000_000;
  const calls = [];
  const s = new Studio({
    settings: {
      ...defaults,
      personas: defaults.personas.map((p) => (p.id === 'pop' ? { ...p, name: '팝콘' } : p)),
      mode: 'live',
      lurkRatio: 0,
      slowModeSeconds: 0,
      chatPace: 8,
      discovery: { ...defaults.discovery, enabled: false },
    },
    audience: new Audience(
      undefined,
      () => {},
      () => 0.5,
    ),
    random: () => 0.5,
    now: () => at,
    provider: {
      status: () => ({ configured: true }),
      react: (args, signal) => new Promise((resolve) => calls.push({ args, signal, resolve })),
    },
  });
  clearInterval(s.timer);
  s.start();
  t.after(() => s.close());
  const sourceId = randomUUID();
  return {
    s,
    calls,
    now: () => at,
    advance: (ms) => (at += ms),
    input: (speech = question) => ({
      speech,
      video: {
        sessionId: s.sessionId,
        sourceId,
        frames: [
          { image: image('left'), at },
          { image: image('middle'), at: at + 1 },
          { image: image('right'), at: at + 2 },
        ],
      },
    }),
    finish: async (pending, messages = [rawReply]) => {
      calls.at(-1).resolve(response(messages));
      return pending;
    },
    chats: () => s.messages.filter((m) => m.kind === 'chat'),
  };
}

test('frame time precedes published question: captured direct reply survives 20.84 seconds with its real source', async (t) => {
  const f = fixture(t);
  f.advance(1000);
  const input = f.input();
  f.advance(100);
  const pending = f.s.react(input);
  const packet = f.calls[0].args.viewerContext.pop;
  const source = f.s.messages.at(-1);
  assert.equal(packet.chatHistory.at(-1).id, source.id);
  assert.equal(packet.directQuestion.id, source.id);
  assert.ok(source.time > input.video.frames.at(-1).at);
  assert.equal(f.calls[0].args.screenTimeline.through, input.video.frames.at(-1).at);
  f.advance(20844);
  assert.deepEqual(await f.finish(pending), { ok: true });
  assert.equal(f.s.queue[0].replySourceId, source.id);
  assert.equal(f.s.queue[0].expiresAt, source.time + 90000);
  f.s.pump();
  assert.deepEqual(
    f.chats().map((m) => m.text),
    [rawReply.text],
  );
  assert.equal(f.s.reactions.snapshot(f.s.queue).summary.delivered, 1);
});

test('fast missing-anchor answer keeps ordinary pacing and appears once', async (t) => {
  const f = fixture(t);
  f.advance(100);
  const input = f.input();
  f.advance(5);
  const pending = f.s.react(input);
  f.advance(300);
  await f.finish(pending);
  f.s.pump();
  assert.equal(f.chats().length, 0);
  f.advance(1100);
  f.s.pump();
  assert.equal(f.chats().length, 1);
  f.s.pump();
  assert.equal(f.chats().length, 1);
});

test('an omitted replyTo and a correct explicit anchor both answer the current question after 20.84 seconds', async (t) => {
  for (const explicit of [false, true]) {
    const f = fixture(t);
    f.advance(100);
    const input = f.input();
    f.advance(5);
    const pending = f.s.react(input);
    const m = { ...rawReply };
    if (explicit) m.replyTo = f.s.messages.at(-1).id;
    else delete m.replyTo;
    f.advance(20844);
    await f.finish(pending, [m]);
    f.s.pump();
    assert.equal(f.chats().length, 1);
  }
});

test('an explicit ID of another retained question cannot replace the captured current question', async (t) => {
  const f = fixture(t);
  const older = f.s.addMessage('streamer', '팝콘, 어느 문이 좋아요?', 'streamer');
  f.advance(100);
  const input = f.input();
  f.advance(5);
  const pending = f.s.react(input);
  assert.notEqual(f.calls[0].args.viewerContext.pop.directQuestion.id, older.id);
  f.advance(20844);
  await f.finish(pending, [{ ...rawReply, replyTo: older.id }]);
  f.s.pump();
  assert.equal(f.chats().length, 0);
  assert.equal(f.s.reactions.snapshot(f.s.queue).summary.rejected.expired, 1);
});

for (const mode of ['reaction', 'wrong-anchor', 'not-addressed', 'old-question', 'no-question'])
  test(`a ${mode} cannot use the missing-anchor exception after ordinary video TTL`, async (t) => {
    const f = fixture(t);
    f.advance(100);
    const input = f.input(
      mode === 'not-addressed'
        ? '어느 쪽으로 이동했나요?'
        : mode === 'no-question'
          ? '다음 장면입니다.'
          : question,
    );
    f.advance(5);
    if (mode === 'old-question') {
      f.s.addMessage('streamer', question, 'streamer');
      f.advance(21000);
      input.video = f.input().video;
      f.advance(5);
    }
    const pending = f.s.react(input);
    f.advance(20844);
    const m = {
      ...rawReply,
      ...(mode === 'reaction' ? { intent: 'reaction' } : {}),
      ...(mode === 'wrong-anchor' ? { replyTo: randomUUID() } : {}),
    };
    await f.finish(pending, [m]);
    f.s.pump();
    assert.equal(f.chats().length, 0);
    assert.equal(f.s.reactions.snapshot(f.s.queue).summary.rejected.expired, 1);
  });

for (const action of [
  'new-question',
  'cancel',
  'delete-source',
  'clear',
  'end-screen',
  'stop',
  'new-session',
  'away',
  'return',
  'ban',
  'remove-viewer',
])
  test(`in-flight missing-anchor answer stays blocked at ${action} boundary`, async (t) => {
    const f = fixture(t);
    f.advance(100);
    const input = f.input();
    f.advance(5);
    const pending = f.s.react(input);
    const source = f.s.messages.at(-1);
    f.advance(20844);
    if (action === 'new-question' || action === 'cancel')
      f.s.receiveSpeech({
        id: randomUUID(),
        sessionId: f.s.sessionId,
        text: action === 'new-question' ? '팝콘, 지금은 어느 문을 고를까요?' : '이제 됐어 그만 해',
        source: 'keyboard',
      });
    if (action === 'delete-source') f.s.moderate('delete', source.id);
    if (action === 'clear') f.s.moderate('clear');
    if (action === 'end-screen')
      f.s.endVideo({ sessionId: f.s.sessionId, sourceId: input.video.sourceId });
    if (action === 'stop' || action === 'new-session') {
      f.s.stop();
      if (action === 'new-session') f.s.start();
    }
    if (action === 'away' || action === 'return') {
      f.s.audience.setPresence('pop', 'away', f.now());
      if (action === 'return') f.s.audience.setPresence('pop', 'active', f.now() + 1);
    }
    if (action === 'ban') f.s.moderate('ban', 'pop');
    if (action === 'remove-viewer') {
      const world = {
        data: { settings: f.s.settings, autonomy: { retired: {}, broadcastSeconds: 0 } },
        change(fn) {
          fn(this.data);
          f.s.settings = this.data.settings;
        },
      };
      new AudienceAutonomy(f.s, world).remove('pop');
    }
    await f.finish(pending);
    f.advance(2000);
    f.s.pump();
    assert.equal(f.chats().length, 0);
    assert.equal(f.s.queue.length, 0);
  });

for (const action of [
  'new-question',
  'cancel',
  'delete-source',
  'clear',
  'end-screen',
  'stop',
  'away',
  'ban',
])
  test(`queued inferred answer stays blocked at ${action} boundary`, async (t) => {
    const f = fixture(t);
    f.advance(100);
    const input = f.input();
    f.advance(5);
    const pending = f.s.react(input);
    const source = f.s.messages.at(-1);
    await f.finish(pending);
    assert.equal(f.s.queue.length, 1);
    if (action === 'new-question' || action === 'cancel')
      f.s.receiveSpeech({
        id: randomUUID(),
        sessionId: f.s.sessionId,
        text: action === 'new-question' ? '팝콘, 어느 문으로 갈까요?' : '이제 됐어 그만 해',
        source: 'keyboard',
      });
    if (action === 'delete-source') f.s.moderate('delete', source.id);
    if (action === 'clear') f.s.moderate('clear');
    if (action === 'end-screen')
      f.s.endVideo({ sessionId: f.s.sessionId, sourceId: input.video.sourceId });
    if (action === 'stop') f.s.stop();
    if (action === 'away') f.s.audience.setPresence('pop', 'away', f.now());
    if (action === 'ban') f.s.moderate('ban', 'pop');
    f.advance(2000);
    f.s.pump();
    assert.equal(f.chats().length, 0);
    assert.equal(f.s.queue.length, 0);
  });

test('inferred answer deadline remains bounded and queued slow-mode wait cannot resurrect it', async (t) => {
  for (const queued of [false, true]) {
    const f = fixture(t);
    f.advance(100);
    const input = f.input();
    f.advance(5);
    const pending = f.s.react(input);
    if (queued) {
      f.s.settings.slowModeSeconds = 120;
      f.s.lastSpeaker.set('pop', f.now());
      await f.finish(pending);
      f.advance(90001);
    } else {
      f.advance(90001);
      await f.finish(pending);
    }
    f.s.pump();
    assert.equal(f.chats().length, 0);
    assert.equal(f.s.queue.length, 0);
  }
});

test('two responses from one viewer for a captured question reserve only one answer', async (t) => {
  const f = fixture(t);
  f.advance(100);
  const input = f.input();
  f.advance(5);
  const pending = f.s.react(input);
  f.advance(20844);
  await f.finish(pending, [rawReply, { ...rawReply, text: '흰 네모는 오른쪽으로 갔네요.' }]);
  assert.equal(f.s.queue.length, 1);
  f.s.pump();
  assert.equal(f.chats().length, 1);
  f.s.accept(
    response([{ ...rawReply, text: '방금 오른쪽으로 갔어요.' }]).observation,
    f.now(),
    false,
    'live',
    { viewerContext: f.calls[0].args.viewerContext, speech: question },
  );
  f.advance(2000);
  f.s.pump();
  assert.equal(f.chats().length, 1);
});

test('fallback requires a captured single source; stale, future, fictional and unwitnessed sources do not qualify', () => {
  const id = randomUUID();
  const m = { id, time: 1000, kind: 'streamer', text: question };
  const packet = { chatHistory: [m], conversationRhythm: { addressed: true } };
  assert.equal(captureDirectQuestion(packet, question, [id], 1001).id, id);
  for (const input of [
    { ...packet, chatHistory: [] },
    { ...packet, conversationRhythm: { addressed: false } },
    { ...packet, chatHistory: [{ ...m, fictional: true }] },
  ])
    assert.equal(captureDirectQuestion(input, question, [id], 1001), undefined);
  assert.equal(captureDirectQuestion(packet, question, [id], 22000), undefined);
  assert.equal(captureDirectQuestion(packet, question, [id], 999), undefined);
  assert.equal(replySource(rawReply, packet, question), null);
  assert.equal(
    replySource(
      { ...rawReply, replyTo: randomUUID() },
      { ...packet, directQuestion: { id, expiresAt: 91000 } },
      question,
    ),
    null,
  );
});
