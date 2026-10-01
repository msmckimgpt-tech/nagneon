import test from 'node:test';
import assert from 'node:assert/strict';
import { Studio } from '../server/studio.js';
import { Audience } from '../server/audience.js';
import { defaults } from '../shared/defaults.js';
import { OpenAIProvider } from '../server/provider.js';

function fixture(t) {
  let at = 100000;
  const calls = [];
  const settings = {
    ...structuredClone(defaults),
    mode: 'live',
    category: 'just-chatting',
    intervalSeconds: 5,
    lurkRatio: 0,
    slowModeSeconds: 0,
    chatPace: 4,
    autoHighlights: false,
    communityActivityEnabled: false,
    personas: structuredClone(
      defaults.personas.filter((p) => ['momo', 'pop', 'luna', 'new'].includes(p.id)),
    ),
  };
  const s = new Studio({
    settings,
    now: () => at,
    random: () => 0.5,
    audience: new Audience(
      undefined,
      () => {},
      () => 0.5,
    ),
    provider: {
      status: () => ({ configured: true, kind: 'fixture' }),
      react: async (args) => {
        calls.push(args);
        return {
          observation: {
            game: 'Synthetic',
            scene: '움직이지 않는 합성 화면',
            confidence: 0.9,
            excitement: 0.1,
            messages: [],
          },
        };
      },
    },
  });
  clearInterval(s.timer);
  s.start();
  t.after(() => s.close());
  const image = 'data:image/png;base64,' + Buffer.from('synthetic-still-frame').toString('base64');
  return {
    s,
    calls,
    image,
    now: () => at,
    advance: (ms = 5000) => (at += ms),
    prime: () => s.react({ image }),
    persona: (id) => s.settings.personas.find((p) => p.id === id),
    rename(id, name, previous = []) {
      this.persona(id).name = name;
      s.audience.data.members[id].aliases = previous.map((name) => ({ name, at }));
    },
    publish(text, fields = {}, speaker = 'pop') {
      return s.publishMessage({ ...s.prepareMessage(speaker, text), ...fields });
    },
  };
}

test('a witnessed former-name peer address reaches the same quiet viewer on unchanged imagery once', async (t) => {
  const f = fixture(t);
  f.rename('momo', '구름산책', ['모모']);
  f.s.audience.data.members.momo.note = 'fixture-private-note-do-not-send';
  await f.prime();
  f.s.audience.setPresence('momo', 'lurking', f.now());
  f.advance();
  const chat = f.publish('모모님은 이 퍼즐 어떻게 푸셨나요');
  const before = structuredClone(f.s.audience.data.members.momo);
  const result = await f.s.react({ image: f.image });
  assert.equal(result.ok, true);
  assert.equal(f.calls.length, 2);
  const request = f.calls[1];
  assert.equal(request.speech, '');
  assert.equal(request.image, f.image);
  assert.ok(request.settings.personas.some((p) => p.id === 'momo' && p.name === '구름산책'));
  assert.ok(
    request.viewerContext.momo.chatAttention.items.some(
      (m) => m.messageId === chat.id && m.attention === 'addressed',
    ),
  );
  assert.equal(request.viewerContext.momo.watchTiming.sameImageAsPreviousSample, true);
  assert.equal(f.s.audience.presence.momo, 'lurking');
  assert.deepEqual(f.s.audience.data.members.momo.aliases, before.aliases);
  assert.equal(f.s.audience.data.members.momo.note, before.note);
  assert.equal(f.s.audience.data.members.momo.recognized, before.recognized);
  assert.equal(f.s.queue.length, 0, 'a speaking opportunity must not invent a reply');
  assert.ok(f.s.viewing.discussed.has(chat.id));
  const payload = new OpenAIProvider({ apiKey: '', model: 'synthetic-fixture' }).payload(request);
  assert.ok(!JSON.stringify(payload).includes('fixture-private-note-do-not-send'));
  f.advance();
  assert.equal((await f.s.react({ image: f.image })).skipped, 'unchanged-input');
  assert.equal(f.calls.length, 2);
});

for (const [name, text] of [
  ['Cat', 'ＣＡＴ님은 어떻게 생각해요'],
  ['구름산책', '구름산책님 여기 답 아시나요'],
]) {
  test(`normalized current-name peer input wakes on the still stream: ${name}`, async (t) => {
    const f = fixture(t);
    f.rename('momo', name);
    await f.prime();
    f.advance();
    const chat = f.publish(text);
    assert.equal((await f.s.react({ image: f.image })).ok, true);
    assert.equal(f.calls.length, 2);
    assert.ok(f.s.viewing.discussed.has(chat.id));
  });
}

for (const text of ['Catalog 열어봤는데', 'bobcat 얘기였음', 'cat2가 다음 장면이네']) {
  test(`an ASCII word fragment does not become peer input: ${text}`, async (t) => {
    const f = fixture(t);
    f.rename('momo', 'Cat');
    await f.prime();
    f.advance();
    const chat = f.publish(text);
    assert.equal((await f.s.react({ image: f.image })).skipped, 'unchanged-input');
    assert.equal(f.calls.length, 1);
    assert.ok(!f.s.viewing.discussed.has(chat.id));
  });
}

for (const state of ['away', 'disabled']) {
  test(`a longer current name reserves its span even when its owner is ${state}`, async (t) => {
    const f = fixture(t);
    f.rename('momo', '모모');
    f.rename('new', '모모친구');
    if (state === 'away') f.s.audience.setPresence('new', 'away', f.now());
    else f.persona('new').enabled = false;
    await f.prime();
    f.advance();
    const chat = f.publish('모모친구님 반가워요');
    assert.equal((await f.s.react({ image: f.image })).skipped, 'unchanged-input');
    assert.equal(f.calls.length, 1);
    assert.ok(!f.s.viewing.discussed.has(chat.id));
  });
}

test('ambiguous longer aliases reserve their span without waking a shorter present name', async (t) => {
  const f = fixture(t);
  f.rename('momo', '모모');
  f.rename('new', '달산책', ['모모친구']);
  f.rename('pop', '팝콘', ['모모친구']);
  await f.prime();
  f.advance();
  const chat = f.publish('모모친구님 오늘도 왔네');
  assert.equal((await f.s.react({ image: f.image })).skipped, 'unchanged-input');
  assert.equal(f.calls.length, 1);
  assert.ok(!f.s.viewing.discussed.has(chat.id));
});

test('a separate shorter mention remains valid alongside a longer reserved name', async (t) => {
  const f = fixture(t);
  f.rename('momo', '모모');
  f.rename('new', '모모친구');
  f.s.audience.setPresence('new', 'away', f.now());
  await f.prime();
  f.advance();
  const chat = f.publish('모모친구님 반가워요, 모모님은 어때요');
  assert.equal((await f.s.react({ image: f.image })).ok, true);
  assert.equal(f.calls.length, 2);
  assert.ok(f.s.viewing.discussed.has(chat.id));
});

for (const boundary of [
  'current-owner-away',
  'current-owner-disabled',
  'ambiguous-alias',
  'future-alias',
]) {
  test(`a former name cannot bypass public ownership: ${boundary}`, async (t) => {
    const f = fixture(t);
    f.rename('momo', '구름산책', ['모모']);
    if (boundary.startsWith('current-owner')) {
      f.rename('new', '모모');
      if (boundary.endsWith('away')) f.s.audience.setPresence('new', 'away', f.now());
      else f.persona('new').enabled = false;
    } else if (boundary === 'ambiguous-alias') {
      f.rename('new', '달산책', ['모모']);
    } else {
      f.s.audience.data.members.momo.aliases[0].at = f.now() + 60000;
    }
    await f.prime();
    f.advance();
    const chat = f.publish('모모님 계세요');
    assert.equal((await f.s.react({ image: f.image })).skipped, 'unchanged-input');
    assert.equal(f.calls.length, 1);
    assert.ok(!f.s.viewing.discussed.has(chat.id));
  });
}

for (const addressedName of ['모모', '구름산책']) {
  for (const boundary of [
    'speaker-away',
    'listener-away',
    'listener-disabled',
    'listener-removed',
    'listener-rejoined',
    'self',
    'fictional',
    'chat-driven',
    'future-message',
    'stale-message',
  ]) {
    test(`peer wake preserves the original broadcast boundary: ${boundary} (${addressedName})`, async (t) => {
      const f = fixture(t);
      f.rename('momo', '구름산책', ['모모']);
      await f.prime();
      f.advance();
      const fields =
        boundary === 'fictional'
          ? { fictional: true }
          : boundary === 'chat-driven'
            ? { chatDriven: true }
            : boundary === 'future-message'
              ? { time: f.now() + 1 }
              : boundary === 'stale-message'
                ? { time: f.now() - 60000 }
                : {};
      const chat = f.publish(
        `${addressedName}님 계세요`,
        fields,
        boundary === 'self' ? 'momo' : 'pop',
      );
      if (boundary === 'speaker-away') f.s.audience.setPresence('pop', 'away', f.now());
      if (boundary === 'listener-away') f.s.audience.setPresence('momo', 'away', f.now());
      if (boundary === 'listener-disabled') f.persona('momo').enabled = false;
      if (boundary === 'listener-removed')
        f.s.settings.personas = f.s.settings.personas.filter((p) => p.id !== 'momo');
      if (boundary === 'listener-rejoined') {
        f.s.audience.setPresence('momo', 'away', f.now());
        f.advance(1);
        f.s.audience.setPresence('momo', 'active', f.now());
      }
      await f.s.react({ image: f.image });
      assert.ok(!f.s.viewing.discussed.has(chat.id));
      if (boundary === 'listener-rejoined') {
        const packet = f.calls.at(-1).viewerContext.momo;
        assert.ok(packet);
        assert.ok(!packet.chatAttention.items.some((m) => m.messageId === chat.id));
      }
    });
  }
}

for (const addressedName of ['루나', '달빛매니저']) {
  test(`a present system manager retains ordinary peer attention: ${addressedName}`, async (t) => {
    const f = fixture(t);
    f.rename('luna', '달빛매니저', ['루나']);
    f.persona('luna').system = true;
    await f.prime();
    f.advance();
    const chat = f.publish(`${addressedName}님 규칙 확인 부탁해요`);
    assert.equal((await f.s.react({ image: f.image })).ok, true);
    assert.equal(f.calls.length, 2);
    assert.ok(f.s.viewing.discussed.has(chat.id));
    assert.ok(
      f.calls[1].viewerContext.luna.chatAttention.items.some(
        (m) => m.messageId === chat.id && m.attention === 'addressed',
      ),
    );
    assert.equal(f.s.queue.length, 0);
  });
}

test('normal donation attention remains independent of nickname resolving', async (t) => {
  const f = fixture(t);
  await f.prime();
  f.advance();
  const chat = f.publish('좋아서 보냈어요', { kind: 'donation', points: 10, anonymous: true });
  assert.equal((await f.s.react({ image: f.image })).ok, true);
  assert.equal(f.calls.length, 2);
  assert.ok(f.s.viewing.discussed.has(chat.id));
});
