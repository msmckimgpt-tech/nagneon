import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Studio } from '../server/studio.js';
import { Audience } from '../server/audience.js';
import { startServer } from '../server/index.js';
import { defaults } from '../shared/defaults.js';
import { seedMetAudience } from './helpers/met-audience.js';

const observation = (text = '방금 농담 너무 웃겼다ㅋㅋ') => ({
  game: 'Synthetic',
  scene: '삭제된 대화를 참고한 합성 장면',
  confidence: 0.9,
  excitement: 0.9,
  messages: [{ personaId: 'momo', text, kind: 'chat', spoiler: false, intent: 'reaction' }],
  positiveMoment: {
    positive: true,
    impact: 1,
    reason: '농담',
    signature: 'removed-joke',
    supporters: ['momo'],
    donations: [{ personaId: 'momo', amount: 10, message: '농담 좋다ㅋㅋ', anonymous: true }],
  },
});

function fixture(t, { abortAware = false } = {}) {
  let now = 1000000;
  const calls = [];
  const s = new Studio({
    settings: {
      ...defaults,
      mode: 'live',
      lurkRatio: 0,
      chatPace: 8,
      slowModeSeconds: 0,
      contextualTranscription: false,
      discovery: { ...defaults.discovery, enabled: false },
    },
    audience: new Audience(
      undefined,
      () => {},
      () => 0.5,
    ),
    random: () => 0.5,
    now: () => now,
    provider: {
      status: () => ({ configured: true }),
      react: (args, signal) =>
        new Promise((resolve, reject) => {
          calls.push({ args, signal, resolve });
          if (abortAware)
            signal.addEventListener(
              'abort',
              () => reject(Error('synthetic provider cancellation')),
              { once: true },
            );
        }),
    },
  });
  clearInterval(s.timer);
  s.start();
  t.after(() => s.close());
  return {
    s,
    calls,
    advance: () => {
      now += 20000;
    },
    send: (text, source = 'keyboard') => {
      const body = { id: randomUUID(), sessionId: s.sessionId, text, source };
      return { body, receipt: s.receiveSpeech(body) };
    },
    finish: async (pending, value = observation()) => {
      calls.at(-1).resolve({ observation: value });
      return pending;
    },
  };
}

test('removed microphone speech invalidates an unlabelled reaction and all experience side effects', async (t) => {
  const f = fixture(t),
    { receipt, body } = f.send('제가 이렇게 말한 건 아니었어요', 'microphone');
  f.s.audience.data.members.momo.seconds = 600;
  const before = structuredClone(f.s.economy.data);
  const pending = f.s.react({ image: 'synthetic-frame' });
  assert.equal(f.calls[0].args.liveSpeech[0].messageId, receipt.messageId);
  f.s.moderate('delete', receipt.messageId);
  const result = await f.finish(pending);
  t.diagnostic(
    JSON.stringify({
      aborted: f.calls[0].signal.aborted,
      result,
      queued: f.s.queue.length,
      observation: f.s.observation?.scene,
      gifts: f.s.messages.filter((m) => m.kind === 'donation').length,
    }),
  );
  assert.equal(f.calls[0].signal.aborted, true);
  assert.deepEqual(result, { skipped: 'superseded' });
  assert.equal(f.s.queue.length, 0);
  assert.equal(f.s.observation, null);
  assert.equal(f.s.knowledge.get('Synthetic').observations.length, 0);
  assert.deepEqual(f.s.economy.data, before);
  assert.equal(f.s.journal.summary().count, 0);
  assert.equal(f.s.clips.list().length, 0);
  assert.equal(f.s.failures, 0);
  assert.equal(f.s.retryAt, 0);
  assert.equal(f.s.receiveSpeech(body).duplicate, true);
  assert.equal(f.s.speechInbox.pending.length, 0);
  assert.equal(f.s.messages.length, 0);
});

test('removing one member of a speech batch preserves the other utterance for a fresh response', async (t) => {
  const f = fixture(t),
    first = f.send('잘못 들어간 첫 이야기'),
    second = f.send('보존할 다음 이야기');
  const pending = f.s.react({});
  assert.equal(f.calls[0].args.liveSpeech.length, 2);
  f.s.moderate('delete', first.receipt.messageId);
  const result = await f.finish(pending);
  assert.deepEqual(result, { skipped: 'superseded' });
  assert.deepEqual(
    f.s.speechInbox.pending.map((e) => e.id),
    [second.body.id],
  );
  f.advance();
  const next = f.s.react({});
  assert.equal(f.calls[1].args.speech, second.body.text);
  assert.ok(!JSON.stringify(f.calls[1].args).includes(first.body.text));
  assert.equal((await f.finish(next, observation('다음 이야기는 잘 들었어요'))).ok, true);
  assert.equal(f.s.speechInbox.pending.length, 0);
  assert.equal(f.s.calls, 2);
});

test('an abort-aware provider stops promptly without backoff or consuming surviving speech', async (t) => {
  const f = fixture(t, { abortAware: true }),
    first = f.send('제거할 첫 발언'),
    second = f.send('아직 답할 다음 발언');
  const pending = f.s.react({});
  f.s.moderate('delete', first.receipt.messageId);
  assert.deepEqual(await pending, { skipped: 'superseded' });
  assert.equal(f.s.busy, false);
  assert.equal(f.s.failures, 0);
  assert.equal(f.s.retryAt, 0);
  assert.deepEqual(
    f.s.speechInbox.pending.map((e) => e.id),
    [second.body.id],
  );
  assert.equal(f.s.calls, 1);
  assert.equal(f.s.running, true);
});

test('chat clear invalidates the old response while new speech and its receipt survive', async (t) => {
  const f = fixture(t),
    first = f.send('비운 채팅의 합성 발언');
  const pending = f.s.react({});
  f.s.moderate('clear');
  assert.equal(f.s.controller.signal.aborted, false, 'chat moderation must not stop the broadcast');
  const nextSpeech = f.send('이제 새 이야기할게요');
  assert.equal(f.s.receiveSpeech(first.body).duplicate, true);
  assert.deepEqual(await f.finish(pending), { skipped: 'superseded' });
  assert.deepEqual(
    f.s.speechInbox.pending.map((e) => e.id),
    [nextSpeech.body.id],
  );
  assert.deepEqual(
    f.s.journal.data.entries.map((e) => e.text),
    [nextSpeech.body.text],
  );
  assert.deepEqual(
    f.s.messages.map((e) => e.text),
    [nextSpeech.body.text],
  );
  f.advance();
  const next = f.s.react({});
  assert.equal(f.calls[1].args.speech, nextSpeech.body.text);
  assert.equal((await f.finish(next, observation('새 이야기를 듣는 반응'))).ok, true);
  assert.equal(f.s.running, true);
  assert.equal(f.s.failures, 0);
});

test('deleting witnessed peer chat also invalidates its captured conversation context', async (t) => {
  const f = fixture(t),
    message = f.s.addMessage('pop', '그 장면 보고 웃었어요');
  const pending = f.s.react({ image: 'synthetic-peer-context' });
  assert.ok(f.calls[0].args.viewerContext.momo.chatHistory.some((e) => e.id === message.id));
  f.s.moderate('delete', message.id);
  assert.deepEqual(await f.finish(pending), { skipped: 'superseded' });
  assert.equal(f.calls[0].signal.aborted, true);
  assert.equal(f.s.queue.length, 0);
});

test('deleting a recalled public source invalidates the response even outside the current chat window', async (t) => {
  const f = fixture(t),
    id = randomUUID();
  f.s.journal.record(
    {
      id,
      personaId: 'momo',
      name: '모모',
      time: 80000,
      text: '비 오는 밤 산책을 좋아해요',
      kind: 'chat',
    },
    { sessionId: randomUUID(), witnesses: ['momo', 'pop'], title: '지난 합성 방송' },
  );
  const pending = f.s.react({ speech: '모모, 비 오는 밤 산책 좋아했지?' });
  assert.ok(f.calls[0].args.viewerContext.momo.recollections.some((e) => e.sourceId === id));
  assert.ok(!f.s.messages.some((e) => e.id === id));
  f.s.moderate('delete', id);
  assert.deepEqual(await f.finish(pending), { skipped: 'superseded' });
  assert.equal(f.calls[0].signal.aborted, true);
  assert.equal(f.s.queue.length, 0);
});

test('deleting a message published after capture preserves an unrelated in-flight answer', async (t) => {
  const f = fixture(t);
  f.send('먼저 보낸 합성 이야기');
  const pending = f.s.react({});
  const later = f.s.addMessage('pop', '나중에 올라온 무관한 채팅');
  assert.ok(!JSON.stringify(f.calls[0].args).includes(later.id));
  f.s.moderate('delete', later.id);
  assert.equal((await f.finish(pending)).ok, true);
  assert.equal(f.calls[0].signal.aborted, false);
  assert.ok(f.s.queue.some((e) => e.text === observation().messages[0].text));
  assert.equal(f.s.calls, 1);
});

for (const action of ['delete', 'clear'])
  test(`failed ${action} storage preserves valid sources and their in-flight response`, async (t) => {
    const f = fixture(t),
      { receipt } = f.send('저장 실패 때 보존할 이야기');
    const pending = f.s.react({});
    const save = f.s.journal.save;
    f.s.journal.save = () => {
      throw Error('synthetic removal storage failure');
    };
    assert.throws(() => f.s.moderate(action, receipt.messageId), /removal storage failure/);
    f.s.journal.save = save;
    assert.equal((await f.finish(pending)).ok, true);
    assert.equal(f.calls[0].signal.aborted, false);
    assert.ok(f.s.messages.some((e) => e.id === receipt.messageId));
    assert.ok(f.s.journal.data.entries.some((e) => e.id === receipt.messageId));
  });

test('removing speech after model completion also discards its unlabelled queued reaction', async (t) => {
  const f = fixture(t),
    { receipt } = f.send('대기 반응의 근거가 된 합성 발언');
  const pending = f.s.react({});
  assert.equal((await f.finish(pending)).ok, true);
  assert.equal(f.s.queue.length, 1);
  assert.equal(f.s.queue[0].replySourceId, undefined, 'the model did not label a reply');
  f.s.moderate('delete', receipt.messageId);
  f.advance();
  f.s.pump();
  assert.equal(f.s.queue.length, 0);
  assert.ok(!f.s.messages.some((e) => e.text === observation().messages[0].text));
  assert.equal(f.s.reactions.snapshot(f.s.queue).summary.rejected.cleared, 1);
});

test('removing a new unrelated message keeps a valid queued reaction', async (t) => {
  const f = fixture(t);
  f.send('유효한 합성 발언');
  const pending = f.s.react({});
  await f.finish(pending);
  const later = f.s.addMessage('pop', '응답 완료 뒤 작성한 무관한 채팅');
  f.s.moderate('delete', later.id);
  assert.equal(f.s.queue.length, 1);
  f.advance();
  f.s.pump();
  assert.ok(f.s.messages.some((e) => e.text === observation().messages[0].text));
});

test('failed source removal preserves a queued reaction and its diagnostic accounting', async (t) => {
  const f = fixture(t),
    { receipt } = f.send('삭제 실패 때 남길 발언');
  const pending = f.s.react({});
  await f.finish(pending);
  const save = f.s.journal.save;
  f.s.journal.save = () => {
    throw Error('synthetic queued removal failure');
  };
  assert.throws(() => f.s.moderate('delete', receipt.messageId), /queued removal failure/);
  f.s.journal.save = save;
  assert.equal(f.s.queue.length, 1);
  assert.equal(f.s.reactions.snapshot(f.s.queue).summary.pending, 1);
  f.advance();
  f.s.pump();
  assert.ok(f.s.messages.some((e) => e.text === observation().messages[0].text));
  assert.equal(f.s.reactions.snapshot(f.s.queue).summary.delivered, 1);
});

test('authenticated HTTP removal cancels late speech completion without restoring durable chat after restart', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'nagneon-removed-speech-'));
  let release, received, seenSignal;
  const entered = new Promise((resolve) => {
    received = resolve;
  });
  let service = await startServer({
    port: 0,
    dataDir: dir,
    localSpeech: false,
    provider: {
      status: () => ({ configured: true }),
      react: (_args, signal) => {
        seenSignal = signal;
        received();
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    },
  });
  t.after(async () => {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  });
  const s = service.studio;
  clearInterval(s.timer);
  seedMetAudience(s);
  s.configure({ ...s.settings, mode: 'live', contextualTranscription: false, lurkRatio: 0 });
  s.start();
  const headers = {
    'Content-Type': 'application/json',
    'X-Backseat-Client': 'studio',
    Authorization: 'Bearer ' + service.accessToken,
  };
  const post = (path, body) =>
    fetch(service.url + '/api/' + path, { method: 'POST', headers, body: JSON.stringify(body) });
  const utterance = {
    id: randomUUID(),
    sessionId: s.sessionId,
    source: 'microphone',
    text: '삭제할 합성 음성 전사',
  };
  const speechResponse = await post('speech', utterance);
  assert.equal(speechResponse.status, 200);
  const receipt = await speechResponse.json(),
    response = post('react', {});
  await entered;
  const removal = await post('moderate', { action: 'delete', id: receipt.messageId });
  assert.equal(removal.status, 200);
  await removal.arrayBuffer();
  release({ observation: observation() });
  const resolved = await response;
  assert.equal(resolved.status, 200);
  assert.deepEqual(await resolved.json(), { skipped: 'superseded' });
  assert.equal(seenSignal.aborted, true);
  assert.equal(s.journal.summary().count, 0);
  assert.equal(s.queue.length, 0);
  assert.equal(s.calls, 1);
  assert.equal(s.running, true);
  await service.close();
  service = await startServer({
    port: 0,
    dataDir: dir,
    localSpeech: false,
    provider: { status: () => ({ configured: true }) },
  });
  assert.equal(service.studio.journal.summary().count, 0);
  assert.equal(service.studio.economy.donationHistory().length, 0);
});
