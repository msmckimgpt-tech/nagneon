import test from 'node:test';
import assert from 'node:assert/strict';
import { Studio } from '../server/studio.js';
import { Audience } from '../server/audience.js';
import { defaults } from '../shared/defaults.js';
import { repeatedChat } from '../server/chat-quality.js';
import { createViewerAddressResolver } from '../server/viewer-addressing.js';

const chat = (text, personaId = 'momo') => ({ personaId, text, kind: 'chat', spoiler: false });
const observation = (messages = []) => ({
  game: 'Synthetic',
  scene: '함께 게임 취향을 이야기하는 합성 방송',
  confidence: 0.9,
  excitement: 0.2,
  messages,
});
const now = 100000;
const compare = (before, after, { sameSpeaker = true, addressViewers } = {}) =>
  repeatedChat(
    chat(after),
    [{ ...chat(before, sameSpeaker ? 'momo' : 'pop'), time: now - 1000 }],
    now,
    { addressViewers },
  );

for (const sameSpeaker of [true, false]) {
  test(`a real question and its confirmation remain distinct; sameSpeaker=${sameSpeaker}`, () => {
    assert.equal(
      compare('그 어려운 퍼즐을 드디어 해결한 거야?', '그 어려운 퍼즐을 드디어 해결한 거야!', {
        sameSpeaker,
      }),
      false,
    );
    assert.equal(
      compare('그 어려운 퍼즐을 드디어 해결한 거야！', '그 어려운 퍼즐을 드디어 해결한 거야？', {
        sameSpeaker,
      }),
      false,
    );
  });
}
test('question cues survive short chat and punctuation-free Korean endings', () => {
  assert.equal(compare('성공했어?', '성공했어!'), false);
  assert.equal(
    compare(
      '오늘도 함께 좋아하는 퍼즐 게임이 나오나요',
      '오늘도 함께 좋아하는 퍼즐 게임이 나오네요',
    ),
    false,
  );
});

for (const [before, after] of [
  ['이 게임은 정말 싫지는 않아요', '이 게임은 정말 싫어요'],
  ['이번 선택은 재미없지는 않아요', '이번 선택은 재미없어요'],
  ['아직 어려운 퍼즐을 못 찾은 것은 아니에요', '아직 어려운 퍼즐을 못 찾은 것이에요'],
  ["I don't dislike this very difficult puzzle game", 'I dislike this very difficult puzzle game'],
]) {
  test(`an explicit negation change is not erased: ${before}`, () => {
    assert.equal(compare(before, after), false);
    assert.equal(compare(after, before), false);
  });
}

function resolver({ people, members = {} } = {}) {
  return createViewerAddressResolver(
    people || [
      { id: 'pop', name: '팝콘' },
      { id: 'momo', name: '모모' },
      { id: 'cat', name: 'Cat' },
      { id: 'catalog', name: 'Catalog' },
    ],
    members,
    now,
  );
}
for (const sameSpeaker of [true, false]) {
  test(`the same question for different public viewers is not a duplicate; sameSpeaker=${sameSpeaker}`, () => {
    assert.equal(
      compare(
        '팝콘님 요즘 즐겨 하는 게임은 어떤 거예요?',
        '모모님 요즘 즐겨 하는 게임은 어떤 거예요?',
        { sameSpeaker, addressViewers: resolver() },
      ),
      false,
    );
  });
}
test('a separate named target differs from an unaddressed general question', () => {
  assert.equal(
    compare('팝콘님 요즘 즐겨 하는 게임은 어떤 거예요?', '요즘 즐겨 하는 게임은 어떤 거예요?', {
      addressViewers: resolver(),
    }),
    false,
  );
});
test('full-roster current owners and the longest ASCII name reserve their target', () => {
  const addressViewers = resolver({
    people: [
      { id: 'cat', name: 'Cat' },
      { id: 'catalog', name: 'Catalog', enabled: false },
      { id: 'momo', name: '구름산책' },
      { id: 'new', name: '모모', enabled: false },
    ],
    members: { momo: { aliases: [{ name: '모모', at: now - 1 }] } },
  });
  assert.deepEqual([...addressViewers('모모님')], ['new']);
  assert.deepEqual([...addressViewers('Catalog님')], ['catalog']);
  assert.equal(
    compare(
      'Catalog님 요즘 즐겨 하는 게임은 어떤 거예요?',
      'Cat님 요즘 즐겨 하는 게임은 어떤 거예요?',
      { addressViewers },
    ),
    false,
  );
  assert.equal(
    compare(
      '모모님 요즘 즐겨 하는 게임은 어떤 거예요?',
      '구름산책님 요즘 즐겨 하는 게임은 어떤 거예요?',
      { addressViewers },
    ),
    false,
  );
});
test('an ambiguous former name cannot be silently assigned to a current target', () => {
  const addressViewers = resolver({
    people: [
      { id: 'a', name: '봄길' },
      { id: 'b', name: '숲길' },
    ],
    members: {
      a: { aliases: [{ name: '별빛', at: now - 1 }] },
      b: { aliases: [{ name: '별빛', at: now - 1 }] },
    },
  });
  assert.deepEqual([...addressViewers('별빛님')], []);
  assert.equal(
    compare(
      '별빛님 요즘 즐겨 하는 게임은 어떤 거예요?',
      '봄길님 요즘 즐겨 하는 게임은 어떤 거예요?',
      { addressViewers },
    ),
    false,
  );
});
test('unchanged target sets, alias identity and normalization retain duplicate protection', () => {
  const addressViewers = resolver({
    people: [
      { id: 'momo', name: '새모모' },
      { id: 'cat', name: 'Cat' },
    ],
    members: { momo: { aliases: [{ name: '모모', at: now - 1 }] } },
  });
  for (const [before, after] of [
    ['모모님 요즘 즐겨 하는 게임은 어떤 거예요?', '새모모님 요즘 즐겨 하는 게임은 어떤 거예요?'],
    ['CAT님 요즘 즐겨 하는 게임은 어떤 거예요?', 'Ｃａｔ님 요즘 즐겨 하는 게임은 어떤 거예요??'],
    [
      'Cat님 모모님 요즘 즐겨 하는 게임은 어떤 거예요?',
      '모모님 Cat님 요즘 즐겨 하는 게임은 어떤 거예요?',
    ],
  ])
    assert.equal(compare(before, after, { addressViewers }), true, after);
});
test('ordinary punctuation, repeated questions, numeric and polarity guards keep their original behavior', () => {
  assert.equal(
    compare('그 어려운 퍼즐을 드디어 해결한 거야?', '그 어려운 퍼즐을 드디어 해결한 거야??'),
    true,
  );
  assert.equal(compare('눈이 정말 많이 쌓였네요 ㅋㅋ', '눈이 정말 많이 쌓였네요!'), true);
  assert.equal(compare('저는 퍼즐 푸는 얘기는 자신 있죠', '저는 퍼즐 푸는 얘기는 진심이죠'), true);
  assert.equal(compare('보스 체력이 30까지 내려갔네요', '보스 체력이 20까지 내려갔네요'), false);
  assert.equal(compare('저는 이 퍼즐 게임이 좋아요', '저는 이 퍼즐 게임이 싫어요'), false);
  assert.equal(compare('안 보이는 것 같아요', '안 보이는 것 같네요'), true);
});
test('short crowd reactions and age boundaries retain the spam policy', () => {
  assert.equal(compare('ㅋㅋㅋ', 'ㅋㅋㅋ'), true);
  assert.equal(compare('ㅋㅋㅋ', 'ㅋㅋㅋ', { sameSpeaker: false }), false);
  assert.equal(compare('축하해요!', '축하해요!', { sameSpeaker: false }), false);
  const prior = { ...chat('눈이 정말 많이 쌓였네요'), time: now };
  assert.equal(repeatedChat(chat(prior.text), [prior], now + 45000), true);
  assert.equal(repeatedChat(chat(prior.text), [prior], now + 45001), false);
  assert.equal(repeatedChat(chat(prior.text), [prior], now - 1), false);
  assert.equal(repeatedChat(chat(prior.text), [{ ...prior, kind: 'streamer' }], now + 1), false);
});

test('question punctuation on pure laughter or symbols cannot bypass the existing short spam guard', () => {
  for (const [before, after] of [
    ['ㅋㅋㅋ?', 'ㅋㅋㅋ!'],
    ['ㅎㅎㅎ？', 'ㅎㅎㅎ！'],
    ['?!', '?!'],
  ]) {
    assert.equal(compare(before, after), true);
    assert.equal(compare(before, after, { sameSpeaker: false }), false);
  }
});

function fixture(t, response = observation()) {
  let at = now;
  const calls = [];
  const s = new Studio({
    settings: {
      ...structuredClone(defaults),
      mode: 'live',
      category: 'just-chatting',
      lurkRatio: 0,
      chatPace: 8,
      slowModeSeconds: 0,
      intervalSeconds: 5,
      autoHighlights: false,
      communityActivityEnabled: false,
    },
    audience: new Audience(
      undefined,
      () => {},
      () => 0.5,
    ),
    random: () => 0.5,
    now: () => at,
    provider: {
      status: () => ({ configured: true, kind: 'fixture' }),
      react: async (args) => {
        calls.push(args);
        return { observation: response };
      },
    },
  });
  clearInterval(s.timer);
  s.start();
  t.after(() => s.close());
  assert.equal(s.audience.presence.momo, 'active');
  assert.equal(s.audience.presence.pop, 'active');
  return {
    s,
    calls,
    advance: (ms = 3000) => (at += ms),
    publish: (text, personaId = 'pop') => s.publishMessage(s.prepareMessage(personaId, text)),
  };
}
test('actual live preparation, admission and publication retain different targets without changing text', async (t) => {
  const first = '팝콘님 요즘 즐겨 하는 게임은 어떤 거예요?';
  const second = '모모님 요즘 즐겨 하는 게임은 어떤 거예요?';
  const f = fixture(t, observation([chat(first), chat(second, 'gg')]));
  f.s.audience.data.members.momo.note = 'synthetic-private-note-not-a-chat-input';
  await f.s.react({ speech: '다들 요즘 어떤 게임을 좋아해요?' });
  assert.equal(f.calls.length, 1);
  assert.equal(
    JSON.stringify(f.calls[0]).includes('synthetic-private-note-not-a-chat-input'),
    false,
  );
  assert.deepEqual(
    f.s.queue.map((m) => m.text),
    [first, second],
  );
  f.advance();
  f.s.pump();
  f.advance();
  f.s.pump();
  assert.deepEqual(
    f.s.messages.filter((m) => m.kind === 'chat').map((m) => m.text),
    [first, second],
  );
  assert.deepEqual(
    f.s.journal.data.entries.filter((e) => e.kind === 'chat').map((e) => e.text),
    [first, second],
  );
});
test('a question followed by a confirming message in the same result is not suppressed', (t) => {
  const f = fixture(t),
    question = '그 어려운 퍼즐을 드디어 해결한 거야?';
  f.s.accept(
    observation([chat(question), chat(question.replace('?', '!'), 'pop')]),
    now,
    false,
    'live',
  );
  assert.equal(f.s.queue.length, 2);
  f.advance();
  f.s.pump();
  f.advance();
  f.s.pump();
  assert.deepEqual(
    f.s.messages.filter((m) => m.kind === 'chat').map((m) => m.text),
    [question, question.replace('?', '!')],
  );
});
for (const [before, after] of [
  ['팝콘님 요즘 즐겨 하는 게임은 어떤 거예요?', '모모님 요즘 즐겨 하는 게임은 어떤 거예요?'],
  ['그 어려운 퍼즐을 드디어 해결한 거야?', '그 어려운 퍼즐을 드디어 해결한 거야!'],
  ['이 게임은 정말 싫지는 않아요', '이 게임은 정말 싫어요'],
]) {
  test(`pump rechecks against newly published history without losing a distinct reply: ${after}`, (t) => {
    const f = fixture(t);
    f.s.accept(observation([chat(after)]), now, false, 'live');
    assert.equal(f.s.queue.length, 1);
    f.publish(before, 'momo');
    f.advance();
    f.s.pump();
    assert.equal(f.s.queue.length, 0);
    assert.deepEqual(
      f.s.messages.filter((m) => m.kind === 'chat').map((m) => m.text),
      [before, after],
    );
  });
}
test('both admission and pump still reject genuinely repeated prose and same-target questions', (t) => {
  const f = fixture(t);
  const question = '모모님 요즘 즐겨 하는 게임은 어떤 거예요?';
  f.publish(question);
  f.s.accept(observation([chat(question + '?')]), now, false, 'live');
  assert.equal(f.s.queue.length, 0);
  const fresh = '눈이 정말 많이 쌓였네요!';
  f.s.accept(observation([chat(fresh)]), now, false, 'live');
  assert.equal(f.s.queue.length, 1);
  f.publish('눈이 정말 많이 쌓였네요 ㅋㅋ');
  f.advance();
  f.s.pump();
  assert.equal(f.s.queue.length, 0);
  assert.equal(
    f.s.messages.some((m) => m.text === fresh),
    false,
  );
});
test('new meaning never bypasses blocking, disabled speakers or original queue expiry', (t) => {
  const f = fixture(t),
    question = '그 어려운 퍼즐을 드디어 해결한 거야?';
  f.s.settings.blockedWords = ['어려운'];
  f.s.accept(observation([chat(question)]), now, false, 'live');
  assert.equal(f.s.queue.length, 0);
  f.s.settings.blockedWords = [];
  f.s.accept(observation([chat(question)]), now, false, 'live', { expiresAt: now + 1000 });
  assert.equal(f.s.queue.length, 1);
  f.advance();
  f.s.pump();
  assert.equal(f.s.queue.length, 0);
  f.s.accept(observation([chat(question)]), now, false, 'live');
  assert.equal(f.s.queue.length, 1);
  f.s.settings.personas.find((p) => p.id === 'momo').enabled = false;
  f.advance();
  f.s.pump();
  assert.equal(f.s.messages.filter((m) => m.kind === 'chat').length, 0);
});
