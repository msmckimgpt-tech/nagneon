import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { admitTranscriptCorrection } from '../server/transcript-correction.js';
import { ConversationJournal, emptyJournal } from '../server/conversation-journal.js';
import { JournalStore } from '../server/journal-store.js';
import { Studio } from '../server/studio.js';
import { Audience } from '../server/audience.js';
import { defaults } from '../shared/defaults.js';
import { adviceIntent, liveAdvicePolicy, requestsAdvice } from '../server/advice-intent.js';
import { OpenAIProvider } from '../server/provider.js';

const proposal = (text) => ({
  text,
  confidence: 0.99,
  reason: '합성 문장의 가까운 오인식 후보',
});

test('separated Korean negation cannot become an affirmative close-sounding word', () => {
  for (const [negative, affirmative] of [
    ['안 갈래요.', '난 갈래요.'],
    ['오늘 안 갈게요.', '오늘 다 갈게요.'],
    ['안 할래.', '난 할래.'],
    ['안.', '난.'],
  ]) {
    assert.equal(admitTranscriptCorrection(negative, proposal(affirmative)), false, negative);
    assert.equal(admitTranscriptCorrection(affirmative, proposal(negative)), false, affirmative);
  }
});

test('English negative contractions survive correction in both directions and quote styles', () => {
  for (const [negative, affirmative] of [
    ["I can't win this game.", 'I can win this game.'],
    ["I didn't select that card.", 'I did select that card.'],
    ["That isn't my plan.", 'That is my plan.'],
    ["That wasn't my choice.", 'That was my choice.'],
    ["You shouldn't tell me the answer.", 'You should tell me the answer.'],
    ["You couldn't hear that.", 'You could hear that.'],
    ["I wouldn't go there.", 'I would go there.'],
    ["We aren't going there.", 'We are going there.'],
    ["It doesn't work.", 'It does work.'],
  ]) {
    for (const quote of ["'", '’', '‘', 'ʼ', '＇']) {
      const text = negative.replaceAll("'", quote);
      assert.equal(admitTranscriptCorrection(text, proposal(affirmative)), false, text);
      assert.equal(admitTranscriptCorrection(affirmative, proposal(text)), false, affirmative);
    }
  }
});

test('spacing around Korean negation can be repaired without changing the decision or register', () => {
  for (const [separated, joined] of [
    ['오늘은 안 갈래요.', '오늘은 안갈래요.'],
    ['안 할 거예요.', '안할 거예요.'],
    ['안 갈래요?', '안갈래요?'],
    ['아직 안 먹었어요.', '아직 안먹었어요.'],
  ]) {
    assert.equal(admitTranscriptCorrection(separated, proposal(joined)), true, separated);
    assert.equal(admitTranscriptCorrection(joined, proposal(separated)), true, joined);
  }
  assert.equal(admitTranscriptCorrection('안 할 거예요.', proposal('안 할 거에요.')), true);
});

test('apostrophe typography can be repaired while the negative contraction stays intact', () => {
  for (const before of [
    'I can’t win this game.',
    'I didn‘t select that card.',
    'It doesnʼt work.',
    'We aren＇t going there.',
  ]) {
    const after = before.replace(/[‘’ʼ＇]/g, "'");
    assert.equal(admitTranscriptCorrection(before, proposal(after)), true, before);
    assert.equal(admitTranscriptCorrection(after, proposal(before)), true, after);
  }
});

test('a rejected polarity rewrite cannot publish its dependent reply or enter durable memory; a safe next correction works', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'nagneon-transcript-polarity-'));
  assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
  t.after(() => rm(dir, { recursive: true }));
  const store = new JournalStore(dir);
  const journal = new ConversationJournal(emptyJournal(), (value) => store.save(value));
  const dangerous = '안 갈래요.',
    safe = '오늘은 안 갈래요.',
    repaired = '오늘은 안갈래요.';
  const calls = [];
  let at = 100000;
  const s = new Studio({
    audience: new Audience(
      undefined,
      () => {},
      () => 0.5,
    ),
    journal,
    now: () => at,
    random: () => 0.5,
    settings: {
      ...defaults,
      mode: 'live',
      lurkRatio: 0,
      chatPace: 8,
      contextualTranscription: true,
    },
    provider: {
      status: () => ({ configured: true, kind: 'fixture' }),
      react: async (args) => {
        calls.push(args);
        const candidate = args.transcriptCandidates[0];
        return {
          observation: {
            game: 'Synthetic',
            scene: '합성 발언 교정',
            confidence: 0.8,
            excitement: 0.2,
            transcriptCorrections: [
              {
                messageId: candidate.messageId,
                ...proposal(candidate.text === dangerous ? '난 갈래요.' : repaired),
              },
            ],
            messages: [
              {
                personaId: 'momo',
                text: candidate.text === dangerous ? '그럼 가는 걸로 ㅇㅋ' : '안 가는 걸로 ㅇㅋ',
                kind: 'chat',
                spoiler: false,
              },
            ],
          },
        };
      },
    },
  });
  clearInterval(s.timer);
  s.start();
  t.after(() => s.close());
  const receive = (text) =>
    s.receiveSpeech({ id: randomUUID(), sessionId: s.sessionId, text, source: 'microphone' });
  const bad = receive(dangerous);
  assert.equal((await s.react({})).transcriptionNeedsReview, true);
  assert.equal(s.queue.length, 0);
  assert.equal(
    s.messages.some((m) => m.kind === 'chat'),
    false,
  );
  assert.equal(s.messages.find((m) => m.id === bad.messageId).text, dangerous);
  assert.equal(s.messages.find((m) => m.id === bad.messageId).transcription.correction, undefined);
  const restoredBad = new ConversationJournal(new JournalStore(dir).load());
  assert.equal(restoredBad.data.entries.find((e) => e.id === bad.messageId).text, dangerous);
  assert.equal(
    restoredBad.data.entries.find((e) => e.id === bad.messageId).transcription.correction,
    undefined,
  );
  assert.equal(
    restoredBad.data.entries.some(
      (e) => e.text === '난 갈래요.' || e.text === '그럼 가는 걸로 ㅇㅋ',
    ),
    false,
  );

  // A second utterance observes the existing two-second request cadence.
  at += 2100;
  const good = receive(safe);
  assert.equal((await s.react({})).ok, true);
  assert.equal(calls.length, 2, 'no retry or additional correction model is started');
  assert.equal(calls[1].transcriptCandidates[0].text, safe);
  assert.equal(s.messages.find((m) => m.id === good.messageId).text, safe);
  assert.equal(
    s.messages.find((m) => m.id === good.messageId).transcription.correction.text,
    repaired,
  );
  assert.ok(s.queue.length > 0, 'the next safe response is not stranded by the rejection');
  assert.equal(s.speechInbox.pending.length, 0);
  const restored = new ConversationJournal(new JournalStore(dir).load());
  assert.equal(
    restored.data.entries.find((e) => e.id === bad.messageId).transcription.correction,
    undefined,
  );
  assert.equal(restored.data.entries.find((e) => e.id === good.messageId).text, safe);
  assert.equal(
    restored.data.entries.find((e) => e.id === good.messageId).transcription.correction.text,
    repaired,
  );
  const remembered = restored.recall('momo', '갈래요').find((e) => e.sourceId === bad.messageId);
  assert.equal(remembered?.text, dangerous);
  assert.equal(remembered.transcriptionCorrection, undefined);
});

test('typographic contractions preserve refusal and permit only a harmless quote correction', () => {
  const canonical = "Don't give me a hint.";
  for (const quote of ["'", '’', '‘', 'ʼ', '＇']) {
    const text = canonical.replace("'", quote);
    assert.equal(adviceIntent(text).refused, true, text);
    assert.equal(requestsAdvice(text), false, text);
    if (text !== canonical)
      assert.equal(admitTranscriptCorrection(text, proposal(canonical)), true, text);
  }
});

test('directly refused help stays closed while inability and positive questions can request help', () => {
  for (const text of [
    'You shouldn’t give me a hint.',
    'You should not give me a hint.',
    'You mustn’t tell me the answer.',
    'You must not help me.',
    'Can you not give me a hint?',
    'Could you not help me?',
    'Would you not show me the answer?',
    'Will you not backseat?',
  ]) {
    assert.equal(adviceIntent(text).refused, true, text);
    assert.equal(requestsAdvice(text), false, text);
    assert.equal(liveAdvicePolicy(text, 'always').allowed, false, text);
  }
  for (const text of [
    'I can’t solve this game, can you help me?',
    'I shouldn’t need hints. Can you help me?',
    'Why not give me a hint?',
    'Can you give me a hint?',
  ]) {
    assert.equal(requestsAdvice(text), true, text);
    assert.equal(adviceIntent(text).refused, false, text);
  }
});

test('contraction normalization preserves quoted text and the final actual request', () => {
  for (const text of [
    '‘Give me a hint’ was a message in chat.',
    '‘Don’t give me a hint’ was a message in chat.',
    '“Don’t give me a hint” was a message in chat.',
  ]) {
    assert.equal(requestsAdvice(text), false, text);
    assert.equal(adviceIntent(text).refused, false, 'quoted words are not the streamer refusal');
  }
  assert.equal(adviceIntent('Don‘t give me a hint. I can’t solve this puzzle.').refused, true);
  const final = adviceIntent('Don’t give me a hint. Can you help me?');
  assert.equal(final.requested, true);
  assert.equal(final.refused, false);
});

function adviceStudio(t, react) {
  let at = 100000;
  const s = new Studio({
    audience: new Audience(
      undefined,
      () => {},
      () => 0.5,
    ),
    now: () => at,
    random: () => 0.5,
    settings: {
      ...defaults,
      mode: 'live',
      lurkRatio: 0,
      slowModeSeconds: 0,
      chatPace: 8,
      adviceMode: 'on-request',
      webSearch: true,
    },
    provider: { status: () => ({ configured: true }), react },
  });
  clearInterval(s.timer);
  s.start();
  t.after(() => s.close());
  return {
    s,
    advance: () => (at += 2100),
    send: (text) => s.receiveSpeech({ id: randomUUID(), sessionId: s.sessionId, text }),
  };
}
const hintObservation = (text) => ({
  observation: {
    game: 'Synthetic',
    scene: '합성 훈수 판단',
    confidence: 0.8,
    excitement: 0,
    messages: [{ personaId: 'momo', text, advice: true, kind: 'chat', spoiler: false }],
  },
});

test('live refusal closes the search gate and pending hints; a fresh request reopens it', async (t) => {
  const payloadProvider = new OpenAIProvider({ key: '' });
  const calls = [];
  const { s, send, advance } = adviceStudio(t, async (args) => {
    const payload = payloadProvider.payload(args);
    calls.push({
      requested: args.adviceRequested,
      allowed: args.advicePolicy.allowed,
      search: (payload.tools || []).some((tool) => tool.type === 'web_search'),
    });
    return hintObservation(
      ['통로 왼쪽부터 살펴봐요.', '정답은 파란 문이에요.', '다음 방의 표지판을 봐요.'][
        calls.length - 1
      ],
    );
  });
  send('Give me a hint.');
  await s.react({});
  assert.ok(s.queue.some((m) => m.advice));
  advance();
  send('Don’t give me a hint.');
  assert.equal(s.queue.length, 0, 'a refusal cancels the earlier undelivered hint');
  await s.react({});
  assert.equal(s.queue.length, 0, 'an unsolicited provider hint stays out of chat');
  assert.equal(
    s.messages.some((m) => m.advice),
    false,
  );
  advance();
  send('Why not give me a hint?');
  await s.react({});
  assert.ok(s.queue.some((m) => m.advice));
  assert.deepEqual(calls, [
    { requested: true, allowed: true, search: true },
    { requested: false, allowed: false, search: false },
    { requested: true, allowed: true, search: true },
  ]);
});

test('a direct English refusal aborts a pending hint and ignores a late provider reply', async (t) => {
  let resolveReply, signal;
  const { s, send } = adviceStudio(t, (_args, requestSignal) => {
    signal = requestSignal;
    return new Promise((resolve) => (resolveReply = resolve));
  });
  send('Give me a hint.');
  const pending = s.react({});
  assert.ok(resolveReply, 'the first hint request reached the synthetic provider');
  send('You shouldn’t give me a hint.');
  assert.equal(signal.aborted, true);
  resolveReply(hintObservation('늦게 도착한 힌트예요.'));
  assert.deepEqual(await pending, { skipped: 'superseded' });
  assert.equal(s.queue.length, 0);
  assert.equal(
    s.messages.some((m) => m.advice),
    false,
  );
});
