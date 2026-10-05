import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ConversationJournal, JournalData } from '../server/conversation-journal.js';
import { recallContinuations } from '../server/recall-continuation.js';

function fixture() {
  const sessionId = randomUUID();
  const row = (text, personaId = 'streamer', at = 1000, extra = {}) => ({
    id: randomUUID(),
    sessionId,
    at,
    personaId,
    name: personaId,
    text,
    witnesses: ['momo', 'pop'],
    fictional: false,
    title: '합성 방송',
    pinned: false,
    ...extra,
  });
  const question = row('모모는 야식 뭐 먹을래');
  const answer = row('저는 떡볶이요', 'momo', 1001);
  const entries = [
    question,
    answer,
    ...Array.from({ length: 40 }, (_, i) => row('산책 이야기 ' + i, 'streamer', 1002 + i)),
  ];
  return { row, question, answer, entries };
}
const data = (entries) => ({ version: 1, revision: 7, entries });
const options = { legacyAudienceIds: ['momo', 'pop'] };
const ids = (quotes) => quotes.map((e) => e.id);

test('legacy question or answer kinds absent survive journal reload as original witnessed quotes', () => {
  for (const missing of ['question', 'answer', 'both']) {
    const { question, answer, entries } = fixture();
    if (missing === 'answer') question.kind = 'streamer';
    if (missing === 'question') answer.kind = 'chat';
    assert.equal(JournalData.safeParse(data(entries)).success, true);
    const saved = [];
    const journal = new ConversationJournal(
      structuredClone(data(entries)),
      (value) => saved.push(value),
      { legacyAudienceIds: () => ['momo', 'pop'] },
    );
    const before = structuredClone(journal.data);
    const quotes = journal.recall('pop', '모모 야식');
    assert.equal(quotes.find((e) => e.sourceId === question.id)?.text, question.text, missing);
    assert.equal(quotes.find((e) => e.sourceId === answer.id)?.text, answer.text, missing);
    for (const original of [question, answer]) {
      const quote = quotes.find((e) => e.sourceId === original.id);
      assert.equal(quote.kind, original.kind, 'do not publish an inferred source kind');
      assert.equal(quote.answered, undefined);
    }
    assert.deepEqual(journal.data, before);
    assert.deepEqual(saved, [], 'recall never writes historical entries');
    const reloaded = new ConversationJournal(structuredClone(journal.data), () => {}, {
      legacyAudienceIds: () => ['momo', 'pop'],
    });
    assert.ok(reloaded.recall('pop', '야식').some((e) => e.sourceId === answer.id));
  }
});

test('kind-absent answers need current known viewer metadata instead of witnesses or names', () => {
  const { question, answer, entries } = fixture();
  const journal = new ConversationJournal(data(entries));
  assert.ok(!journal.recall('pop', '야식').some((e) => e.sourceId === answer.id));
  assert.deepEqual(ids(recallContinuations([question], entries, entries)), [question.id]);
  assert.deepEqual(
    ids(recallContinuations([question], entries, entries, 8, { legacyAudienceIds: ['pop'] })),
    [question.id],
  );
  assert.deepEqual(
    ids(recallContinuations([question], entries, entries, 8, { legacyAudienceIds: 'momo' })),
    [question.id],
  );
});

test('journal reevaluates audience roles per recall and never persists callback metadata', () => {
  const { question, answer, entries } = fixture();
  let settings = {
    managerId: 'guide',
    personas: [
      { id: 'momo', role: 'viewer' },
      { id: 'guide', role: 'manager' },
    ],
  };
  let evaluations = 0;
  const journal = new ConversationJournal(
    data(entries),
    () => assert.fail('no save during recall'),
    {
      legacyAudienceIds: () => {
        evaluations++;
        return settings.personas
          .filter((p) => p.role === 'viewer' && p.id !== settings.managerId)
          .map((p) => p.id);
      },
    },
  );
  assert.ok(journal.recall('pop', '야식').some((e) => e.sourceId === answer.id));
  settings = { ...settings, personas: [{ id: 'momo', role: 'manager' }] };
  assert.ok(!journal.recall('pop', '야식').some((e) => e.sourceId === answer.id));
  settings = { managerId: 'momo', personas: [{ id: 'momo', role: 'viewer' }] };
  assert.ok(!journal.recall('pop', '야식').some((e) => e.sourceId === answer.id));
  settings = { managerId: 'guide', personas: [] };
  assert.ok(!journal.recall('pop', '야식').some((e) => e.sourceId === answer.id));
  assert.equal(evaluations, 4);
  assert.deepEqual(journal.data, data(entries));
  assert.equal(journal.data.entries.find((e) => e.id === question.id).kind, undefined);
});

test('explicit source kinds remain authoritative despite current audience metadata', () => {
  const { row, question, answer } = fixture();
  question.kind = 'streamer';
  answer.kind = 'chat';
  assert.deepEqual(ids(recallContinuations([question], [question, answer], [question, answer])), [
    question.id,
    answer.id,
  ]);
  for (const kind of ['notice', 'streamer']) {
    const other = { ...answer, kind };
    assert.deepEqual(
      ids(recallContinuations([question], [question, other], [question, other], 8, options)),
      [question.id],
    );
  }
  const noticeQuestion = { ...question, kind: 'notice' };
  assert.deepEqual(
    ids(
      recallContinuations(
        [noticeQuestion],
        [noticeQuestion, answer],
        [noticeQuestion, answer],
        8,
        options,
      ),
    ),
    [question.id],
  );
  const peerQuestion = row(question.text, 'momo', 1000);
  assert.deepEqual(
    ids(
      recallContinuations(
        [peerQuestion],
        [peerQuestion, answer],
        [peerQuestion, answer],
        8,
        options,
      ),
    ),
    [peerQuestion.id],
  );
});

test('anonymous, donation, custom manager and unknown actors do not become missing-kind audience answers', () => {
  const { row, question } = fixture();
  for (const [personaId, extra, audienceIds] of [
    ['anonymous', {}, ['anonymous']],
    ['momo', { kind: 'donation', donation: { amount: 20, anonymous: false } }, ['momo']],
    ['momo', { donation: { amount: 20, anonymous: false } }, ['momo']],
    ['guide_custom', {}, ['momo', 'pop']],
    ['unknown', {}, ['momo', 'pop']],
    ['momo', { kind: 'notice' }, ['momo']],
  ]) {
    const answer = row('저는 떡볶이요', personaId, 1001, extra);
    assert.deepEqual(
      ids(
        recallContinuations([question], [question, answer], [question, answer], 8, {
          legacyAudienceIds: audienceIds,
        }),
      ),
      [question.id],
      personaId,
    );
  }
  const donationQuestion = { ...question, donation: { amount: 20, anonymous: false } };
  const answer = row('저는 떡볶이요', 'momo', 1001);
  assert.deepEqual(
    ids(
      recallContinuations(
        [donationQuestion],
        [donationQuestion, answer],
        [donationQuestion, answer],
        8,
        options,
      ),
    ),
    [question.id],
  );
});

test('legacy answer continuation retains witness, session, fiction, time and full-order boundaries', () => {
  for (const boundary of [
    'unheard',
    'session',
    'fiction',
    'late',
    'backdated',
    'recent',
    'intervening',
  ]) {
    const { row, question, answer } = fixture();
    const entries = [question];
    if (boundary === 'intervening')
      entries.push(row('이제 산책 이야기하자', 'streamer', 1001, { witnesses: ['momo'] }));
    if (boundary === 'session') answer.sessionId = randomUUID();
    if (boundary === 'fiction') answer.fictional = true;
    if (boundary === 'late') answer.at = question.at + 90001;
    if (boundary === 'backdated') answer.at = question.at - 1;
    if (boundary === 'unheard') answer.witnesses = ['momo'];
    entries.push(answer);
    const candidates = entries.filter(
      (e) => e.witnesses.includes('pop') && !(boundary === 'recent' && e.id === answer.id),
    );
    assert.deepEqual(
      ids(recallContinuations([question], entries, candidates, 8, options)),
      [question.id],
      boundary,
    );
    const journal = new ConversationJournal(data(entries), () => {}, {
      legacyAudienceIds: () => ['momo', 'pop'],
    });
    assert.ok(
      !journal
        .recall('pop', '야식', boundary === 'recent' ? [answer.id] : [])
        .some((e) => e.sourceId === answer.id),
      boundary,
    );
  }
  const { question, answer } = fixture();
  answer.at = question.at + 90000;
  assert.deepEqual(
    ids(recallContinuations([question], [question, answer], [question, answer], 8, options)),
    [question.id, answer.id],
    'inclusive original answer window',
  );
});

test('legacy answer correction quotes preserve the chain and never skip an excluded retained turn', () => {
  const { row, question, answer } = fixture();
  const correction = row('아냐, 순대요. 제가 잘못 말했어요', 'momo', 1002);
  const entries = [question, answer, correction];
  assert.deepEqual(
    ids(recallContinuations([question], entries, entries, 8, options)),
    entries.map((e) => e.id),
  );
  const boundary = row('다른 이야기를 할게요', 'momo', 1002);
  const fullOrder = [question, answer, boundary, correction];
  assert.deepEqual(
    ids(recallContinuations([question], fullOrder, [question, answer, correction], 8, options)),
    [question.id, answer.id, correction.id],
  );
  // A correction cannot bridge this boundary even when the answer scan itself
  // may keep the later utterance as another adjacent audience quote.
  assert.deepEqual(
    ids(recallContinuations([answer], fullOrder, [answer, correction], 8, options)),
    [answer.id],
  );
  const lateCorrection = { ...correction, at: answer.at + 120001 };
  assert.deepEqual(
    ids(
      recallContinuations([answer], [answer, lateCorrection], [answer, lateCorrection], 8, options),
    ),
    [answer.id],
  );
});

test('legacy continuation respects three-answer and atomic quote-group budgets without changing originals', () => {
  const { row, question } = fixture();
  const answers = ['momo', 'pop', 'third', 'fourth'].map((id, i) =>
    row('선택지 ' + i, id, 1001 + i),
  );
  const entries = [question, ...answers];
  const metadata = { legacyAudienceIds: answers.map((e) => e.personaId) };
  const before = structuredClone(entries);
  assert.deepEqual(ids(recallContinuations([question], entries, entries, 8, metadata)), [
    question.id,
    ...answers.slice(0, 3).map((e) => e.id),
  ]);
  const correction = row('아냐, 다시 선택할게', 'momo', 1002);
  const chain = [question, answers[0], correction];
  assert.deepEqual(
    ids(recallContinuations([question], chain, chain, 2, metadata)),
    [question.id, correction.id],
    'the latest correction can survive alone, but never the unqualified old answer',
  );
  const typed = chain.map((e) => ({
    ...e,
    kind: e.personaId === 'streamer' ? 'streamer' : 'chat',
  }));
  assert.deepEqual(
    ids(recallContinuations([typed[0]], typed, typed, 2)),
    [question.id, correction.id],
    'keep the original typed budget behavior',
  );
  assert.deepEqual(entries, before);
});

test('journal deletion, retention and text bounds still constrain legacy recall', () => {
  const { row, question, answer, entries } = fixture();
  const journal = new ConversationJournal(data(entries), () => {}, {
    legacyAudienceIds: () => ['momo', 'pop'],
  });
  assert.deepEqual(journal.recall('newcomer', '야식'), []);
  journal.forget([answer.id]);
  assert.ok(!journal.recall('pop', '야식').some((e) => e.sourceId === answer.id));
  const retained = entries.filter((e) => e.id !== question.id);
  const restored = new ConversationJournal(data(retained), () => {}, {
    legacyAudienceIds: () => ['momo', 'pop'],
  });
  assert.ok(
    !restored.recall('pop', '야식').some((e) => e.sourceId === answer.id),
    'removed question cannot retrieve an unrelated old short answer',
  );
  const longAnswer = row('저는 '.repeat(1200), 'momo', 1001);
  const bounded = new ConversationJournal(data([question, longAnswer]), () => {}, {
    legacyAudienceIds: () => ['momo'],
  });
  const quotes = bounded.recall('pop', '야식');
  assert.ok(quotes.some((e) => e.sourceId === longAnswer.id));
  assert.ok(quotes.length <= 8);
  assert.ok(quotes.every((e) => e.text.length <= 600));
  assert.ok(quotes.reduce((sum, e) => sum + e.text.length, 0) <= 1800);
  assert.equal(quotes.find((e) => e.sourceId === longAnswer.id).excerpt, true);
});
