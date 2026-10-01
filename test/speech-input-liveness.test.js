import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { SpeechInbox } from '../server/speech-inbox.js';
import { Studio } from '../server/studio.js';
import { Audience } from '../server/audience.js';
import { SpeechCapture } from '../server/speech-screen.js';
import { SubscriptionInputEvent, SubscriptionTranscript } from '../shared/subscription-voice.js';
import { defaults } from '../shared/defaults.js';
import { transcriptAnomaly } from '../server/transcript-correction.js';
import { ConversationJournal } from '../server/conversation-journal.js';
import { JournalStore } from '../server/journal-store.js';
import { PROFILE_READER, readProfileFormat } from '../server/profile-capabilities.js';
import { startServer } from '../server/index.js';

function utterance(length) {
  const ending = ' 마지막 부탁은 취소합니다. 그건 제가 하겠다는 말이 아니에요.';
  const body = Array.from({ length: 256 }, (_, i) => `합성 장면 ${i}번에서 본 내용을 기록합니다. `).join('');
  return body.slice(0, length - ending.length) + ending;
}
function capture(at, sessionId) {
  return SpeechCapture.parse({
    startedAt: at - 12000,
    endedAt: at,
    voice: {
      provider: 'chatgpt-subscription',
      kind: 'transcript',
      runId: randomUUID(),
      fragmentCount: 1,
      sourceInputEpoch: randomUUID(),
      sourceFrameStart: 0,
      sourceFrameEnd: 192000,
      timing: 'approximate-provider-interval',
      receivedAt: at,
      sourceEndedAt: at,
      recovered: false,
    },
    screen: {
      sessionId,
      sourceId: randomUUID(),
      frames: [{ at: at - 4000, image: 'data:image/jpeg;base64,c3ludGhldGlj' }],
    },
  });
}
function add(inbox, id, text, extra = {}) {
  return inbox.receive(id, text, () => ({ id: randomUUID() }), extra.source || 'keyboard', extra.capture, extra.hearers || ['viewer']);
}
const observation = { game: 'Just Chatting', scene: '합성 대화', confidence: 0.9, excitement: 0.2, messages: [] };
function fixture(t, react = async () => ({ observation })) {
  let at = 1000000;
  const calls = [];
  const studio = new Studio({
    settings: { ...structuredClone(defaults), mode: 'live', lurkRatio: 0, slowModeSeconds: 0, intervalSeconds: 5 },
    audience: new Audience(undefined, () => {}, () => 0.5),
    random: () => 0.5,
    now: () => at,
    provider: { status: () => ({ configured: true }), async react(args, signal) { calls.push(args); return react(args, signal); } },
  });
  clearInterval(studio.timer);
  studio.start();
  t.after(() => studio.close());
  return { studio, calls, advance: ms => at += ms, now: () => at };
}

for (const length of [3001, 4000])
  test(`a valid ${length}-character subscription fragment leaves the head of the queue intact and consumable`, () => {
    const text = utterance(length);
    const transcript = new SubscriptionTranscript({ now: () => 100000 });
    const event = SubscriptionInputEvent.parse({ type: 'input_transcript.added', start_ms: 0, end_ms: 12000, item: { id: 'synthetic-fragment', type: 'input_transcript', text } });
    transcript.accept(event, 100000);
    const group = transcript.ready(103000);
    assert.equal(group.text, text);
    const inbox = new SpeechInbox();
    const sourceCapture = capture(112000, randomUUID());
    const original = structuredClone(sourceCapture);
    const receipt = add(inbox, 'long-source', group.text, { source: 'microphone', capture: sourceCapture });
    add(inbox, 'next-source', '다음 질문은 따로 전달해주세요?');
    sourceCapture.voice.sourceFrameEnd += 1;
    const batch = inbox.batch();
    assert.deepEqual(batch.ids, ['long-source']);
    assert.equal(batch.text, text);
    assert.deepEqual(inbox.sources(batch.ids)[0].capture, original);
    assert.equal(inbox.sources(batch.ids)[0].messageId, receipt.messageId);
    inbox.acknowledge(batch.ids);
    assert.deepEqual(inbox.batch().ids, ['next-source']);
    assert.equal(inbox.batch().text, '다음 질문은 따로 전달해주세요?');
  });

test('unsupported oversized input is refused before publication or receipt insertion', () => {
  const inbox = new SpeechInbox();
  let publications = 0;
  assert.throws(() => inbox.receive('too-large', utterance(4001), () => { publications++; return { id: randomUUID() }; }, 'microphone'), /4,000|4000/);
  assert.equal(publications, 0);
  assert.equal(inbox.pending.length, 0);
  assert.equal(inbox.receipts.size, 0);
  assert.equal(add(inbox, 'too-large', '다시 전달한 짧은 발언').duplicate, false);
});

test('ordinary batches retain the 3000-character and four-source limits', () => {
  const inbox = new SpeechInbox();
  add(inbox, 'one', '가'.repeat(1500));
  add(inbox, 'two', '나'.repeat(1499));
  add(inbox, 'three', '세 번째 발언');
  const first = inbox.batch();
  assert.equal(first.text.length, 3000);
  assert.deepEqual(first.ids, ['one', 'two']);
  inbox.acknowledge(first.ids);
  assert.deepEqual(inbox.batch().ids, ['three']);
  inbox.clear();
  for (let i = 0; i < 5; i++) add(inbox, 'short-' + i, '짧은 발언 ' + i);
  assert.deepEqual(inbox.batch().ids, ['short-0', 'short-1', 'short-2', 'short-3']);
});

test('a completed long fragment remains idempotent and a conflicting retry cannot rewrite it', () => {
  const inbox = new SpeechInbox(), text = utterance(4000), source = capture(112000, randomUUID());
  const receipt = add(inbox, 'original', text, { source: 'microphone', capture: source });
  inbox.acknowledge(inbox.batch().ids);
  const retry = add(inbox, 'original', text, { source: 'microphone', capture: source });
  assert.deepEqual(retry, { messageId: receipt.messageId, duplicate: true });
  assert.equal(inbox.pending.length, 0);
  assert.throws(() => add(inbox, 'original', '반대로 바꾼 말', { source: 'microphone', capture: source }), /같은 발언 ID/);
});

test('queue backpressure still accepts exact retries and refuses a new 41st source', () => {
  const inbox = new SpeechInbox();
  for (let i = 0; i < 40; i++) add(inbox, 'queued-' + i, '대기 발언 ' + i);
  assert.equal(add(inbox, 'queued-0', '대기 발언 0').duplicate, true);
  assert.throws(() => add(inbox, 'queued-40', '새로 들어온 말'), /많이 밀렸/);
  assert.equal(inbox.pending.length, 40);
});

test('Studio sends long native speech and later keyboard speech in order without cutting the refusal', async t => {
  const f = fixture(t), s = f.studio;
  f.advance(12000);
  const text = utterance(4000), id = randomUUID(), source = capture(f.now(), s.sessionId);
  assert.equal(transcriptAnomaly(text), null);
  const first = s.receiveSpeech({ id, sessionId: s.sessionId, text, source: 'microphone', capture: source });
  const nextId = randomUUID();
  s.receiveSpeech({ id: nextId, sessionId: s.sessionId, text: '그 다음 질문은 이쪽이에요?' });
  await s.react({});
  assert.equal(f.calls[0]?.speech, text);
  assert.equal(f.calls[0].liveSpeech[0].text, text);
  assert.deepEqual(f.calls[0].liveSpeech[0].capture.voice, source.voice);
  assert.ok(s.messages.some(m => m.id === first.messageId && m.text === text));
  assert.ok(s.journal.data.entries.some(m => m.id === first.messageId && m.text === text));
  assert.deepEqual(s.speechInbox.pending.map(m => m.id), [nextId]);
  f.advance(2000);
  await s.react({});
  assert.equal(f.calls[1]?.speech, '그 다음 질문은 이쪽이에요?');
  assert.equal(s.speechInbox.pending.length, 0);
});

test('starting an already active broadcast does not discard duplicate receipts', t => {
  const s = fixture(t).studio, id = randomUUID(), sessionId = s.sessionId;
  const first = s.receiveSpeech({ id, sessionId, text: '같은 방송의 발언' });
  s.start();
  const retry = s.receiveSpeech({ id, sessionId, text: '같은 방송의 발언' });
  assert.equal(s.sessionId, sessionId);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.messageId, first.messageId);
});

test('a new broadcast owns new receipts while rejecting delayed requests from the old session', t => {
  const f = fixture(t), s = f.studio, id = randomUUID(), oldSession = s.sessionId;
  const first = s.receiveSpeech({ id, sessionId: oldSession, text: '지난 방송 발언' });
  s.stop();
  f.advance(1000);
  s.start();
  assert.notEqual(s.sessionId, oldSession);
  assert.throws(() => s.receiveSpeech({ id, sessionId: oldSession, text: '지난 방송 발언' }), /끝난 방송/);
  const current = s.receiveSpeech({ id, sessionId: s.sessionId, text: '이번 방송에서 새로 한 말' });
  assert.equal(current.duplicate, false);
  assert.notEqual(current.messageId, first.messageId);
  assert.deepEqual(s.speechInbox.pending.map(m => m.text), ['이번 방송에서 새로 한 말']);
});

test('the existing 20000-receipt safety bound applies to one broadcast instead of the app lifetime', t => {
  const s = fixture(t).studio;
  for (let i = 0; i < 20000; i++) {
    add(s.speechInbox, 'bounded-' + i, '합성 짧은 발언');
    s.speechInbox.acknowledge(['bounded-' + i]);
  }
  assert.equal(add(s.speechInbox, 'bounded-0', '합성 짧은 발언').duplicate, true);
  assert.throws(() => add(s.speechInbox, 'overflow', '같은 방송의 새 말'), /이번 방송/);
  s.stop();
  s.start();
  assert.doesNotThrow(() => s.receiveSpeech({ id: randomUUID(), sessionId: s.sessionId, text: '새 방송의 첫 발언' }));
  assert.equal(s.speechInbox.pending.length, 1);
});

for (const code of ['ai_cancelled', 'ai_blocked'])
  test(`a delayed ${code} from an old broadcast cannot acknowledge a same-ID new utterance`, { timeout: 5000 }, async t => {
    let rejectOld, enter;
    const entered = new Promise(resolve => enter = resolve);
    const f = fixture(t, () => new Promise((_resolve, reject) => { rejectOld = reject; enter(); }));
    const s = f.studio, id = randomUUID(), text = '다음 방송에서 다시 말한 질문이에요?';
    s.receiveSpeech({ id, sessionId: s.sessionId, text });
    const previous = s.react({});
    previous.catch(() => {});
    t.after(() => rejectOld?.(Object.assign(new Error('synthetic cancellation'), { code })));
    await entered;
    s.stop();
    f.advance(1000);
    s.start();
    const current = s.receiveSpeech({ id, sessionId: s.sessionId, text });
    assert.equal(current.duplicate, false);
    rejectOld(Object.assign(new Error('synthetic old request denial'), { code }));
    const result = await previous;
    assert.deepEqual(s.speechInbox.pending.map(m => m.id), [id]);
    assert.equal(s.speechInbox.batch().text, text);
    assert.deepEqual(result, { skipped: 'stopped' });
  });

test('a current-broadcast AI denial still acknowledges that current input', async t => {
  const f = fixture(t, async () => { throw Object.assign(new Error('synthetic current denial'), { code: 'ai_blocked' }); });
  const s = f.studio;
  s.receiveSpeech({ id: randomUUID(), sessionId: s.sessionId, text: '지금 방송의 질문이에요?' });
  assert.deepEqual(await s.react({}), { skipped: 'ai-blocked' });
  assert.equal(s.speechInbox.pending.length, 0);
});

async function journalFixture() {
  const parent = resolve('artifacts');
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, 'speech-liveness-journal-'));
  assert.equal(dirname(dir), parent);
  const store = new JournalStore(dir);
  const journal = new ConversationJournal(store.load(), value => store.save(value));
  return { dir, journal };
}
function remember(journal, text) {
  const message = { id: randomUUID(), time: 1000000, personaId: 'streamer', name: '합성 스트리머', kind: 'streamer', text, transcription: { source: 'microphone' } };
  journal.record(message, { sessionId: randomUUID(), witnesses: ['momo'], title: '합성 방송' });
  return message;
}

test('a 4000-character original survives journal restart with its final refusal and existing records intact', async () => {
  const { dir, journal } = await journalFixture();
  const previous = remember(journal, utterance(3000));
  journal.pin(previous.id, true);
  const current = remember(journal, utterance(4000));
  assert.deepEqual(readProfileFormat(dir), { minReader: 4, minAppVersion: '0.1.18' });
  const loaded = new JournalStore(dir).load();
  assert.deepEqual(loaded, journal.data);
  const original = loaded.entries.find(e => e.id === current.id);
  assert.equal(original.text, current.text);
  assert.deepEqual(original.witnesses, ['momo']);
  assert.deepEqual(original.transcription, { source: 'microphone' });
  assert.equal(loaded.entries.find(e => e.id === previous.id).pinned, true);
  assert.equal(loaded.entries.find(e => e.id === previous.id).text, previous.text);
  const reloaded = new ConversationJournal(loaded), revision = reloaded.data.revision;
  reloaded.record(current, { sessionId: original.sessionId, witnesses: ['momo'], title: '합성 방송' });
  assert.equal(reloaded.data.revision, revision);
  assert.throws(() => reloaded.record({ ...current, text: '다르게 바꾼 말' }, { sessionId: original.sessionId, witnesses: ['momo'] }), /원문이 다릅니다/);
});

test('journal overlength sources and corrections cannot partially overwrite the previous stored record', async () => {
  const { dir, journal } = await journalFixture();
  const previous = remember(journal, utterance(3000)), before = structuredClone(journal.data);
  assert.throws(() => remember(journal, utterance(4001)));
  assert.throws(() => journal.annotateTranscription(previous.id, { text: utterance(3001), confidence: 0.95, reason: '합성 교정', at: 1000001 }));
  assert.deepEqual(journal.data, before);
  assert.deepEqual(new JournalStore(dir).load(), before);
  assert.equal(readProfileFormat(dir), null);
});

test('a failed profile floor write cannot commit a long original over the previous journal index', async () => {
  const { dir, journal } = await journalFixture();
  remember(journal, utterance(3000));
  const before = structuredClone(journal.data), index = await readFile(join(dir, 'conversation-journal-index.json'));
  await mkdir(join(dir, 'profile-format.json'));
  assert.throws(() => remember(journal, utterance(4000)));
  assert.deepEqual(journal.data, before);
  assert.deepEqual(await readFile(join(dir, 'conversation-journal-index.json')), index);
});

test('an unsupported future profile floor refuses journal loading without restoring an older index', async () => {
  const { dir, journal } = await journalFixture();
  remember(journal, utterance(3000));
  const index = await readFile(join(dir, 'conversation-journal-index.json'));
  await writeFile(join(dir, 'profile-format.json'), JSON.stringify({ minReader: PROFILE_READER + 1, minAppVersion: '0.1.18' }));
  assert.throws(() => new JournalStore(dir).load(), /다른 버전/);
  const before = structuredClone(journal.data);
  assert.throws(() => remember(journal, utterance(3000)), /다른 버전/);
  assert.deepEqual(journal.data, before);
  assert.deepEqual(await readFile(join(dir, 'conversation-journal-index.json')), index);
});

test('the profile floor remains monotone after the last long original is forgotten', async () => {
  const { dir, journal } = await journalFixture();
  const previous = remember(journal, utterance(3000)), current = remember(journal, utterance(4000));
  assert.deepEqual(readProfileFormat(dir), { minReader: 4, minAppVersion: '0.1.18' });
  journal.forget([current.id]);
  assert.deepEqual(readProfileFormat(dir), { minReader: 4, minAppVersion: '0.1.18' });
  const loaded = new JournalStore(dir).load();
  assert.deepEqual(loaded, journal.data);
  assert.deepEqual(loaded.entries.map(e => e.id), [previous.id]);
});

test('a fresh service materializes its required empty clip store before a long journal profile restarts', async () => {
  const parent = resolve('artifacts');
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, 'speech-liveness-service-'));
  assert.equal(dirname(dir), parent);
  const options = { port: 0, dataDir: dir, localSpeech: false, provider: { status: () => ({ configured: false }), react: async () => assert.fail('No model call expected') } };
  let service;
  try {
    service = await startServer(options);
    assert.equal(existsSync(join(dir, 'clips.json')), false);
    const source = remember(service.studio.journal, utterance(4000));
    const expected = structuredClone(service.studio.journal.data);
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'clips.json'), 'utf8')), []);
    assert.deepEqual(readProfileFormat(dir), { minReader: 4, minAppVersion: '0.1.18' });
    await service.close(); service = null;
    service = await startServer(options);
    assert.deepEqual(service.studio.journal.data, expected);
    assert.equal(service.studio.journal.data.entries.find(e => e.id === source.id).text, source.text);
  } finally { await service?.close(); }
});
