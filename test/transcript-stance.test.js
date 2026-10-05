import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { admitTranscriptCorrection } from '../server/transcript-correction.js';
import { ConversationJournal, emptyJournal } from '../server/conversation-journal.js';
import { JournalStore } from '../server/journal-store.js';
import { Studio } from '../server/studio.js';
import { Audience } from '../server/audience.js';
import { defaults } from '../shared/defaults.js';

const proposal = (text) => ({ text, confidence: 0.99, reason: '합성 발언의 가까운 오인식 후보' });
const emotions = [
  ['이거 좀 답답하네.', '이거 좀 담담하네.'],
  ['계속 지루하네.', '계속 지랄하네.'],
  ['진짜 실망했어.', '진짜 실명했어.'],
  ['지금 신나네.', '지금 신라네.'],
  ['정말 행복하네.', '정말 항복하네.'],
];
const selfAddress = [
  ['난 이 게임 좋아.', '전 이 게임 좋아.'],
  ['나는 이 게임을 할거야.', '저는 이 게임을 할거야.'],
  ['내가 몬스터 잡았어.', '제가 몬스터 잡았어.'],
  ['그게 내 생각이야.', '그게 제 생각이야.'],
  ['나를 믿어.', '저를 믿어.'],
  ['나한테 말해.', '저한테 말해.'],
  ['나에게 보내.', '저에게 보내.'],
  ['이건 내게 맡겨.', '이건 제게 맡겨.'],
];

test('close syllables and high confidence cannot rewrite expressed emotion in either direction', () => {
  for (const [before, after] of emotions) {
    assert.equal(admitTranscriptCorrection(before, proposal(after)), false, before);
    assert.equal(admitTranscriptCorrection(after, proposal(before)), false, after);
    assert.equal(
      admitTranscriptCorrection(
        '오늘 게임하면서 ' + before + ' 이런 기분이었어.',
        proposal('오늘 게임하면서 ' + after + ' 이런 기분이었어.'),
      ),
      false,
      before,
    );
  }
});

test('self-address words cannot become polite substitutes or change their grammatical role', () => {
  for (const [before, after] of [...selfAddress, ['내가 맡았어.', '내게 맡았어.']]) {
    assert.equal(admitTranscriptCorrection(before, proposal(after)), false, before);
    assert.equal(admitTranscriptCorrection(after, proposal(before)), false, after);
  }
});

test('emotion and self-address preservation still permits spacing and nearby spelling repairs', () => {
  for (const [before, after] of [
    ['좀 답답하네.', '좀 답답 하네.'],
    ['정말 행복하네.', '정말 행복 하네.'],
    ['나는 몬스터를 자바서 갈게.', '나는 몬스터를 잡아서 갈게.'],
    ['난 몬스터를 자바서 갈게.', '난 몬스터를 잡아서 갈게.'],
    ['저는 몬스터를 자바서 갈게요.', '저는 몬스터를 잡아서 갈게요.'],
    ['나 는 몬스터를 잡았어.', '나는 몬스터를 잡았어.'],
    ['저 는 몬스터를 잡았어요.', '저는 몬스터를 잡았어요.'],
    ['나 한테 말해.', '나한테 말해.'],
    ['내 가 잡았어.', '내가 잡았어.'],
    ['게임 전 몬스터 자바주세요.', '게임 전 몬스터 잡아주세요.'],
    ['미나가 몬스터 자바주세요.', '미나가 몬스터 잡아주세요.'],
    ['저 몬스터 자바주세요.', '저 몬스터 잡아주세요.'],
  ]) {
    assert.equal(admitTranscriptCorrection(before, proposal(after)), true, before);
    assert.equal(admitTranscriptCorrection(after, proposal(before)), true, after);
  }
});

test('rejected emotion and register rewrites cannot publish dependent replies or replace durable speech', async (t) => {
  const artifactRoot = resolve('artifacts/transcript-stance-tests');
  await mkdir(artifactRoot, { recursive: true });
  const dir = await mkdtemp(join(artifactRoot, 'profile-'));
  assert.ok(resolve(dir).startsWith(artifactRoot + sep));
  const store = new JournalStore(dir);
  const journal = new ConversationJournal(emptyJournal(), (value) => store.save(value));
  const bad = [...emotions.slice(0, 2), ...selfAddress.slice(0, 2)];
  const replacements = new Map(bad);
  const safe = '난 몬스터를 자바서 지나갈게.';
  const repaired = '난 몬스터를 잡아서 지나갈게.';
  let at = 100000,
    calls = 0,
    s;
  t.after(async () => {
    await s?.close();
    assert.ok(resolve(dir).startsWith(artifactRoot + sep));
    await rm(dir, { recursive: true });
  });
  s = new Studio({
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
        calls++;
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
                ...proposal(replacements.get(candidate.text) || repaired),
              },
            ],
            messages: [
              {
                personaId: 'momo',
                text:
                  candidate.text === safe
                    ? '잡고 넘어가면 되겠다'
                    : '전이라고 하셨으니 존댓말로 바꿔요',
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
  const receive = (text) =>
    s.receiveSpeech({ id: randomUUID(), sessionId: s.sessionId, text, source: 'microphone' });
  const rejectedIds = [];
  for (const [raw] of bad) {
    const input = receive(raw);
    rejectedIds.push(input.messageId);
    assert.equal((await s.react({})).transcriptionNeedsReview, true, raw);
    assert.equal(s.queue.length, 0, raw);
    assert.equal(s.messages.find((m) => m.id === input.messageId).text, raw);
    assert.equal(
      s.messages.find((m) => m.id === input.messageId).transcription.correction,
      undefined,
    );
    assert.equal(
      s.messages.some((m) => m.kind === 'chat'),
      false,
    );
    at += 2100;
  }
  const good = receive(safe);
  assert.equal((await s.react({})).ok, true);
  assert.equal(calls, bad.length + 1, 'no additional model or retry is used');
  assert.ok(s.queue.length > 0, 'safe corrections still produce a reply after rejection');
  assert.equal(s.speechInbox.pending.length, 0);
  assert.equal(s.messages.find((m) => m.id === good.messageId).text, safe);
  assert.equal(
    s.messages.find((m) => m.id === good.messageId).transcription.correction.text,
    repaired,
  );
  const restored = new ConversationJournal(new JournalStore(dir).load());
  for (const id of rejectedIds) {
    const stored = restored.data.entries.find((e) => e.id === id);
    assert.equal(stored.transcription.correction, undefined);
    assert.equal(stored.text, s.messages.find((m) => m.id === id).text);
  }
  assert.equal(restored.data.entries.find((e) => e.id === good.messageId).text, safe);
  assert.equal(
    restored.data.entries.find((e) => e.id === good.messageId).transcription.correction.text,
    repaired,
  );
  assert.equal(
    restored.data.entries.some((e) => e.text === '전이라고 하셨으니 존댓말로 바꿔요'),
    false,
  );
});
