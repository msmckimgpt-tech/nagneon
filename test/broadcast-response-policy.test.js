import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Studio } from '../server/studio.js';
import { Audience } from '../server/audience.js';
import { defaults } from '../shared/defaults.js';
import { replySource, repeatsDonation } from '../server/live-response-policy.js';

const chat = (text, extra = {}) => ({
  personaId: 'pop',
  text,
  kind: 'chat',
  spoiler: false,
  intent: 'reaction',
  ...extra,
});
const observation = (messages, extra = {}) => ({
  game: '합성 퍼즐',
  scene: '문이 열렸다',
  confidence: 0.9,
  excitement: 0.9,
  messages,
  ...extra,
});
const gift = (anonymous = false, text = '문 열렸다 와') => ({
  positiveMoment: {
    positive: true,
    impact: 1,
    signature: 'synthetic-door-open',
    reason: '퍼즐을 풀었다',
    supporters: ['pop'],
    donations: [{ personaId: 'pop', message: text, anonymous }],
  },
});
function fixture(t, react) {
  let at = 1_000_000;
  const s = new Studio({
    settings: {
      ...defaults,
      mode: 'live',
      intervalSeconds: 5,
      lurkRatio: 0,
      slowModeSeconds: 0,
      chatPace: 8,
    },
    audience: new Audience(
      undefined,
      () => {},
      () => 0.5,
    ),
    random: () => 0.5,
    now: () => at,
    provider: { status: () => ({ configured: true }), react },
  });
  clearInterval(s.timer);
  s.start();
  s.audience.data.members.pop.seconds = 1200;
  t.after(() => s.close());
  return { s, advance: (ms) => (at += ms) };
}

for (const anonymous of [false, true])
  test(`same-request paraphrased gift and chat publish once; anonymous=${anonymous}`, async (t) => {
    const f = fixture(t, async () => ({
      observation: observation([chat('마침내 저 입구 뚫었네!')], gift(anonymous)),
    }));
    await f.s.react({ speech: '이제 다음 방으로 갈 수 있겠네.' });
    f.advance(2000);
    f.s.pump();
    const gifts = f.s.messages.filter((m) => m.kind === 'donation');
    assert.equal(gifts.length, 1);
    assert.equal(f.s.messages.filter((m) => m.kind === 'chat').length, 0);
    assert.equal(f.s.reactions.snapshot(f.s.queue).summary.rejected.duplicate, 1);
    if (anonymous) {
      assert.equal(gifts[0].personaId, 'anonymous');
      assert.ok(!JSON.stringify(gifts).includes('pop'));
    }
  });

test('an additional detail survives a gift; failed and silent gifts do not consume chat', async (t) => {
  for (const mode of ['followup', 'disabled', 'silent']) {
    const f = fixture(t, async () => ({
      observation: observation(
        [chat('왼쪽 스위치는 그대로 켜져 있네', { donationFollowup: mode === 'followup' })],
        gift(false, mode === 'silent' ? '' : '열렸다!'),
      ),
    }));
    if (mode === 'disabled') f.s.settings.pointsEnabled = false;
    await f.s.react({ speech: '다음 방이다' });
    f.advance(2000);
    f.s.pump();
    assert.ok(
      f.s.messages.some((m) => m.kind === 'chat'),
      mode,
    );
  }
  assert.equal(
    repeatsDonation(
      chat('열렸다!', { donationFollowup: true }),
      { personaId: 'pop', text: '열렸다!' },
      100,
    ),
    true,
  );
});

test('late mixed input drops moment commentary but delivers a witnessed anchored answer', async (t) => {
  let finish, args;
  const f = fixture(t, (value) => {
    args = value;
    return new Promise((r) => (finish = r));
  });
  const pending = f.s.react({ image: 'synthetic-image', speech: '팝콘, 어느 문이 더 좋아?' });
  const source = args.viewerContext.pop.chatHistory.findLast((m) => m.kind === 'streamer');
  f.advance(74000);
  finish({
    observation: observation(
      [chat('지금 불빛 켜진다'), chat('난 파란 문', { intent: 'reply', replyTo: source.id })],
      gift(),
    ),
  });
  await pending;
  f.advance(2000);
  f.s.pump();
  assert.ok(f.s.messages.some((m) => m.text === '난 파란 문'));
  assert.ok(!f.s.messages.some((m) => m.text === '지금 불빛 켜진다' || m.kind === 'donation'));
  assert.equal(f.s.reactions.snapshot(f.s.queue).summary.rejected.expired, 1);
});

test('a pending anchored answer survives an ordinary followup but an explicit cancellation clears it', async (t) => {
  const f = fixture(t, async (args) => ({
    observation: observation([
      chat('왼쪽으로 갈래', {
        intent: 'reply',
        replyTo: args.viewerContext.pop.chatHistory.findLast((m) => m.kind === 'streamer').id,
      }),
    ]),
  }));
  await f.s.react({ speech: '팝콘 어느 쪽 갈래?' });
  assert.equal(f.s.queue.length, 1);
  f.s.receiveSpeech({
    id: randomUUID(),
    sessionId: f.s.sessionId,
    text: '난 오른쪽도 궁금하긴 해',
  });
  assert.equal(f.s.queue.length, 1);
  f.s.receiveSpeech({ id: randomUUID(), sessionId: f.s.sessionId, text: '이제 됐어 그만 해' });
  assert.equal(f.s.queue.length, 0);
});

test('unwitnessed or invented reply anchors do not bypass a deadline', () => {
  const id = randomUUID(),
    m = chat('알겠어', { intent: 'reply', replyTo: id });
  assert.equal(replySource(m, { chatHistory: [] }), null);
  assert.equal(
    replySource(m, { chatHistory: [{ id, kind: 'streamer', text: '대답해 줘', fictional: true }] }),
    null,
  );
  assert.equal(
    replySource(
      chat('빛난다'),
      { chatHistory: [{ id, kind: 'streamer', text: '어떤 문?' }] },
      '어떤 문?',
    ),
    null,
  );
  assert.equal(
    replySource(m, { chatHistory: [{ id, kind: 'streamer', text: '문이 날 밀었네ㅋㅋ' }] }),
    null,
  );
});

test('deleting the source while an answer is generating prevents later delivery', async (t) => {
  let finish, source;
  const f = fixture(t, (args) => {
    source = args.viewerContext.pop.chatHistory.findLast((m) => m.kind === 'streamer');
    return new Promise((resolve) => (finish = resolve));
  });
  const pending = f.s.react({ speech: '팝콘, 어떤 문이 더 좋아?' });
  f.s.moderate('delete', source.id);
  finish({ observation: observation([chat('파란 문', { intent: 'reply', replyTo: source.id })]) });
  await pending;
  f.advance(2000);
  f.s.pump();
  assert.ok(!f.s.messages.some((m) => m.text === '파란 문'));
  assert.equal(f.s.reactions.snapshot(f.s.queue).summary.rejected.cleared, 1);
});

test('manager stays quiet without a role and answers a directly addressed witnessed question', async (t) => {
  let addressed = false;
  const f = fixture(t, async (args) => ({
    observation: observation([
      chat(addressed ? '규칙은 스포일러 금지예요.' : '문이 멋지네요', {
        personaId: 'luna',
        intent: addressed ? 'reply' : 'reaction',
        replyTo: addressed
          ? args.viewerContext.luna.chatHistory.findLast((m) => m.kind === 'streamer').id
          : null,
      }),
    ]),
  }));
  await f.s.react({ speech: '다음 방이네' });
  f.advance(2000);
  f.s.pump();
  assert.ok(!f.s.messages.some((m) => m.personaId === 'luna' && m.kind === 'chat'));
  assert.equal(f.s.reactions.snapshot(f.s.queue).summary.rejected['manager-role'], 1);
  addressed = true;
  f.advance(6000);
  await f.s.react({ speech: '루나, 채팅 규칙 알려줘?' });
  f.advance(2000);
  f.s.pump();
  assert.ok(f.s.messages.some((m) => m.text === '규칙은 스포일러 금지예요.'));
});
