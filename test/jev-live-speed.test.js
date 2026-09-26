import test from 'node:test';
import assert from 'node:assert/strict';
import { Studio } from '../server/studio.js';
import { Audience } from '../server/audience.js';
import { defaults } from '../shared/defaults.js';
import { attachDecision } from './helpers/jev.js';
const image = 'data:image/png;base64,c3ludGhldGlj';
const observation = {
  game: '합성',
  scene: '화면 왼쪽에 새 문이 열렸다',
  confidence: 0.9,
  excitement: 0.4,
  messages: [
    { personaId: 'pop', text: '분위기가 달라졌네', kind: 'chat', spoiler: false },
    { personaId: 'momo', text: '왼쪽 문이 열렸어', kind: 'chat', spoiler: false },
  ],
};
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
function fixture(t, options = {}) {
  let now = 100000;
  const generated = [];
  const s = new Studio({
    settings: { ...defaults, mode: 'live', lurkRatio: 0, slowModeSeconds: 0 },
    audience: new Audience(
      undefined,
      () => {},
      () => 0.5,
    ),
    random: () => 0.5,
    now: () => now,
    provider: {
      status: () => ({ configured: true }),
      react: async (args) => {
        generated.push(args);
        return { observation: structuredClone(observation) };
      },
    },
  });
  clearInterval(s.timer);
  s.start();
  const d = attachDecision(s, options);
  t.after(async () => {
    s.stop();
    await d.decision.close();
    await s.close();
  });
  return { s, generated, ...d, advance: (ms) => (now += ms) };
}
async function drain(s) {
  await Promise.all([...s.liveDecisions].map((entry) => entry.promise));
}
for (const mode of ['assist', 'shadow'])
  test(`${mode} screen reaction queues without waiting for JEV`, async (t) => {
    const hold = deferred();
    t.after(() => hold.resolve({ first_reaction: 'm1' }));
    const f = fixture(t, { mode, judge: () => hold.promise });
    const pending = f.s.reactInput({ image });
    assert.equal(f.generated.length, 1, 'screen generator starts synchronously');
    const early = await Promise.race([
      pending.then(() => true),
      new Promise((r) => setTimeout(() => r(false), 80)),
    ]);
    assert.equal(early, true, 'JEV cannot block screen admission');
    assert.equal(f.s.queue.length, 2);
    hold.resolve({ first_reaction: 'm1' });
    await pending;
    await drain(f.s);
    assert.equal(f.s.queue[0].personaId, mode === 'assist' ? 'momo' : 'pop');
  });
test('screen priority uses admitted text only and preserves every original due slot', async (t) => {
  const hold = deferred();
  t.after(() => hold.resolve({}));
  const f = fixture(t, {
    tasks: { 'reaction-check': false, 'clip-relevance': false },
    judge: () => hold.promise,
  });
  await f.s.reactInput({ image });
  const due = f.s.queue.map((m) => m.due),
    texts = f.s.queue.map((m) => m.text).sort();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].state.scene, observation.scene);
  assert.ok(!JSON.stringify(f.calls).includes(image));
  hold.resolve({ first_reaction: 'm1' });
  await drain(f.s);
  assert.deepEqual(
    f.s.queue.map((m) => m.due),
    due,
  );
  assert.deepEqual(f.s.queue.map((m) => m.text).sort(), texts);
  assert.equal(f.s.queue[0].text, observation.messages[1].text);
});
for (const invalidation of [
  'delivered',
  'stop',
  'disabled',
  'visit',
  'journal',
  'expired',
  'new-speech',
  'off',
])
  test(`late screen decision is ignored after ${invalidation}`, async (t) => {
    const hold = deferred();
    t.after(() => hold.resolve({}));
    const f = fixture(t, { judge: () => hold.promise });
    await f.s.reactInput({ image });
    if (invalidation === 'delivered') {
      f.advance(1500);
      f.s.pump();
    }
    if (invalidation === 'stop') f.s.stop();
    if (invalidation === 'disabled')
      f.s.settings.personas.find((p) => p.id === 'momo').enabled = false;
    if (invalidation === 'visit') f.s.audience.data.members.momo.joinedAt++;
    if (invalidation === 'journal') f.s.journal.data.revision++;
    if (invalidation === 'expired') f.advance(46000);
    if (invalidation === 'new-speech')
      f.s.receiveSpeech({
        id: 'new-speech',
        sessionId: f.s.sessionId,
        text: '이번에는 내 얘기 들어줘',
      });
    if (invalidation === 'off') f.decision.configure({ ...f.decision.config, mode: 'off' });
    const before = f.s.queue.map((m) => ({ ...m }));
    hold.resolve({ first_reaction: 'm1' });
    await drain(f.s);
    assert.deepEqual(f.s.queue, before);
    assert.equal(f.s.liveDecisions.size, 0);
  });
test('shadow speech starts generator while its immutable JEV observation is still pending', async (t) => {
  const hold = deferred();
  t.after(() => hold.resolve({ target: 'v2', intent: 'acknowledge' }));
  const f = fixture(t, { mode: 'shadow', judge: () => hold.promise });
  await f.s.reactInput({ speech: '같이 쉬자' });
  assert.equal(f.generated.length, 1);
  const before = JSON.stringify(f.generated);
  hold.resolve({ target: 'v2', intent: 'acknowledge' });
  await drain(f.s);
  assert.equal(JSON.stringify(f.generated), before);
  assert.equal(f.s.reactions.snapshot(f.s.queue).requests[0].decisionWaitMs, 0);
});
test('screen hard admission rejects unsafe candidates before JEV can select them', async (t) => {
  const f = fixture(t, { judge: () => ({ first_reaction: 'm1' }) });
  f.s.settings.blockedWords = ['왼쪽'];
  await f.s.reactInput({ image });
  await drain(f.s);
  assert.deepEqual(
    f.s.queue.map((m) => m.personaId),
    ['pop'],
  );
  assert.equal(f.calls.length, 0);
});

test('priority cannot delay the first deliverable chat through a slow-mode speaker', async (t) => {
  const hold = deferred();
  t.after(() => hold.resolve({}));
  const f = fixture(t, { judge: () => hold.promise });
  f.s.settings.slowModeSeconds = 30;
  f.s.lastSpeaker.set('momo', f.s.now());
  await f.s.reactInput({ image });
  const firstDue = f.s.queue[0].due;
  hold.resolve({ first_reaction: 'm1' });
  await drain(f.s);
  f.advance(firstDue - f.s.now());
  f.s.pump();
  assert.equal(f.s.messages.at(-1)?.text, observation.messages[0].text);
});

test('source end cancels detached queue work even after liveReaction has cleared', async (t) => {
  const hold = deferred();
  t.after(() => hold.resolve({}));
  let signal;
  const f = fixture(t, {
    judge: (_r, s) => {
      signal = s;
      return hold.promise;
    },
  });
  const { randomUUID } = await import('node:crypto');
  const video = {
    sessionId: f.s.sessionId,
    sourceId: randomUUID(),
    frames: [{ image, at: f.s.now() }],
  };
  await f.s.reactInput({ video });
  assert.equal(f.s.liveReaction, null);
  assert.equal(signal.aborted, false);
  f.s.endVideo(video);
  await drain(f.s);
  assert.equal(signal.aborted, true);
  assert.equal(f.s.queue.length, 0);
  assert.equal(
    f.decision.service.status().inFlight,
    1,
    'abort-ignoring transport retains its slot',
  );
  hold.resolve({ first_reaction: 'm1' });
  await f.decision.close();
  assert.equal(f.decision.service.status().inFlight, 0);
});
test('speech preflight caps an existing 5000 ms timeout and cannot mutate the prompt late', async (t) => {
  const hold = deferred();
  t.after(() => hold.resolve({ target: 'v2', intent: 'acknowledge' }));
  const f = fixture(t, { judge: () => hold.promise });
  f.decision.configure({ ...f.decision.config, timeoutMs: 5000 });
  const keepAlive = setTimeout(() => hold.resolve({}), 3000);
  t.after(() => clearTimeout(keepAlive));
  const start = performance.now();
  await f.s.reactInput({ speech: '함께 쉬어 가자' });
  const elapsed = performance.now() - start;
  assert.ok(elapsed >= 900 && elapsed < 2000, `bounded preflight: ${elapsed} ms`);
  assert.equal(f.generated.length, 1);
  const prompt = JSON.stringify(f.generated);
  hold.resolve({ target: 'v2', intent: 'acknowledge' });
  await f.decision.close();
  assert.equal(JSON.stringify(f.generated), prompt);
});

for (const omit of [false, true])
  test(`pending same-speaker traffic cannot delay first batch delivery (omission=${omit})`, async (t) => {
    const hold = deferred();
    t.after(() => hold.resolve({}));
    const f = fixture(t, { judge: () => hold.promise });
    f.s.settings.slowModeSeconds = 30;
    f.s.addMessage('pop', '앞에서 나눴던 이야기', 'chat');
    f.s.accept({
      ...observation,
      messages: [
        { personaId: 'momo', text: '이전 응답의 대기 채팅', kind: 'chat', spoiler: false },
      ],
    });
    f.s.queue[0].due = f.s.now();
    await f.s.reactInput({ image });
    const firstDue = f.s.queue[1].due;
    hold.resolve({ first_reaction: 'm1', ...(omit ? { message_0: 'e0' } : {}) });
    await drain(f.s);
    f.advance(firstDue - f.s.now());
    f.s.pump();
    assert.equal(f.s.messages.at(-1).text, '이전 응답의 대기 채팅');
    f.advance(250);
    f.s.pump();
    assert.equal(f.s.messages.at(-1).text, observation.messages[0].text);
  });
