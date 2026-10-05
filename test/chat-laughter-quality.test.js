import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repeatedChat } from '../server/chat-quality.js';
import { createViewerAddressResolver } from '../server/viewer-addressing.js';

test('long normalized laughter is a shared reaction across distinct viewers', () => {
  const prior = { personaId: 'pop', text: 'ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ', kind: 'chat', time: 10000 };
  for (const text of [
    'ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ',
    'ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ',
    'ㅎㅎㅎㅎㅎㅎㅎㅎㅎㅎ',
    'ᄏᄏᄏᄏᄏᄏᄏᄏᄏᄏ!!',
  ]) {
    assert.equal(repeatedChat({ personaId: 'momo', text }, [prior], 11000), false, text);
    assert.equal(repeatedChat({ personaId: 'pop', text }, [prior], 11000), true, text);
  }
});
test('laughter spacing keeps the eight-second same-viewer guard without suppressing later reactions', () => {
  const prior = { personaId: 'pop', text: 'ㅋㅋㅋㅋㅋㅋㅋㅋ', kind: 'chat', time: 10000 };
  assert.equal(
    repeatedChat({ personaId: 'pop', text: 'ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ' }, [prior], 18000),
    true,
  );
  assert.equal(
    repeatedChat({ personaId: 'pop', text: 'ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ' }, [prior], 18001),
    false,
  );
});
test('ordinary repeated prose and identical punctuation remain protected', () => {
  const text = '처음에 장비를 고르면 전투가 편해지겠네요';
  assert.equal(
    repeatedChat(
      { personaId: 'momo', text },
      [{ personaId: 'pop', text, kind: 'chat', time: 10000 }],
      20000,
    ),
    true,
  );
  assert.equal(
    repeatedChat(
      { personaId: 'pop', text: '?' },
      [{ personaId: 'pop', text: '?', kind: 'chat', time: 10000 }],
      11000,
    ),
    true,
  );
  assert.equal(
    repeatedChat(
      { personaId: 'momo', text: '?' },
      [{ personaId: 'pop', text: '?', kind: 'chat', time: 10000 }],
      11000,
    ),
    false,
  );
});

test('laughter suffix does not weaken repeated prose protection', () => {
  const text = '처음부터 다시 순서대로 진행해야겠네요';
  const prior = {
    personaId: 'pop',
    text: text + ' ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ',
    kind: 'chat',
    time: 10000,
  };
  assert.equal(repeatedChat({ personaId: 'momo', text: prior.text }, [prior], 11000), true);
  assert.equal(repeatedChat({ personaId: 'pop', text: prior.text }, [prior], 11000), true);
});

test('shared laughter keeps timestamp and streamer-history boundaries', () => {
  const candidate = { personaId: 'pop', text: 'ㅎ ㅎ ㅋ ㅋ？！' };
  const prior = { personaId: 'pop', text: 'ㅋㅋㅋㅋㅋㅋㅋㅋ', kind: 'chat', time: 10000 };
  assert.equal(repeatedChat(candidate, [prior], 9999), false);
  assert.equal(repeatedChat(candidate, [prior], 10000), true);
  assert.equal(repeatedChat(candidate, [prior], 18000), true);
  assert.equal(repeatedChat(candidate, [prior], 18001), false);
  assert.equal(repeatedChat(candidate, [prior], 55001), false);
  assert.equal(repeatedChat(candidate, [{ ...prior, kind: 'streamer' }], 11000), false);
  const { time, ...undated } = prior;
  assert.equal(repeatedChat(candidate, [{ ...undated, createdAt: 10000 }], 18001), false);
});

test('laughter mixed with prose retains question, negation and addressed-viewer distinctions', () => {
  const addressViewers = createViewerAddressResolver(
    [
      { id: 'pop', name: '팝콘' },
      { id: 'momo', name: '모모' },
    ],
    {},
    11000,
  );
  for (const personaId of ['pop', 'momo']) {
    for (const [before, after, duplicate] of [
      ['그 어려운 퍼즐을 드디어 해결한 거야?', '그 어려운 퍼즐을 드디어 해결한 거야!', false],
      ['이 게임은 정말 싫지는 않아요', '이 게임은 정말 싫어요', false],
      [
        '팝콘님 요즘 즐겨 하는 게임은 어떤 거예요?',
        '모모님 요즘 즐겨 하는 게임은 어떤 거예요?',
        false,
      ],
      [
        '팝콘님 요즘 즐겨 하는 게임은 어떤 거예요?',
        '팝콘님 요즘 즐겨 하는 게임은 어떤 거예요??',
        true,
      ],
    ]) {
      const text = after + ' ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ';
      const prior = {
        personaId: 'pop',
        text: before + ' ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ',
        kind: 'chat',
        time: 10000,
      };
      assert.equal(
        repeatedChat({ personaId, text }, [prior], 11000, { addressViewers }),
        duplicate,
        text,
      );
    }
  }
});
