import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Studio } from '../server/studio.js';
import { startServer } from '../server/index.js';
import { defaults } from '../shared/defaults.js';

function make(t) {
  const s = new Studio({
    provider: {
      status: () => ({ configured: true }),
      react: () => {
        throw Error('No model call permitted');
      },
    },
    settings: { ...defaults, mode: 'live', communityActivityEnabled: false },
    now: () => 100000,
  });
  clearInterval(s.timer);
  t.after(() => s.close());
  s.start();
  return s;
}
function fill(s, count) {
  return Array.from({ length: count }, (_, index) =>
    s.publishMessage(s.prepareMessage('momo', '합성 채팅 ' + index), { publishState: false }),
  );
}
const query = (s) => ({ sessionId: s.sessionId, revision: s.chatHistory.revision });

test('current broadcast pages cross the 500-message window without repeats during new arrivals or clock reversal', (t) => {
  const s = make(t),
    all = fill(s, 605);
  assert.equal(s.messages.length, 500);
  let page = s.chatHistory.page(query(s));
  assert.deepEqual(
    page.messages.map((m) => m.id),
    all.slice(-100).map((m) => m.id),
  );
  const seen = [...page.messages];
  s.now = () => 99999;
  const later = s.addMessage('momo', '나중에 도착');
  while (page.hasMore) {
    page = s.chatHistory.page({ ...query(s), before: page.messages[0].historySequence });
    seen.unshift(...page.messages);
  }
  assert.deepEqual(
    seen.map((m) => m.id),
    all.map((m) => m.id),
  );
  assert.equal(new Set(seen.map((m) => m.id)).size, 605);
  assert.equal(
    seen.some((m) => m.id === later.id),
    false,
  );
  assert.equal(s.chatHistory.page(query(s)).messages.at(-1).id, later.id);
});

test('new sessions exclude past broadcasts and reject their cursors; stopped current broadcasts remain readable', (t) => {
  const s = make(t),
    old = fill(s, 4),
    oldQuery = query(s);
  s.stop();
  assert.deepEqual(
    s.chatHistory.page(oldQuery).messages.map((m) => m.id),
    old.map((m) => m.id),
  );
  s.start();
  assert.throws(() => s.chatHistory.page(oldQuery), /방송이나 채팅 기록/);
  assert.deepEqual(s.chatHistory.page(query(s)).messages, []);
  const fresh = s.addMessage('momo', '새 방송');
  assert.deepEqual(
    s.chatHistory.page(query(s)).messages.map((m) => m.id),
    [fresh.id],
  );
  assert.equal(s.journal.data.entries.length, 5);
});

test('deleting old chat invalidates in-flight pages; clearing cannot reveal previously retained chat', (t) => {
  const s = make(t),
    all = fill(s, 510),
    stale = query(s);
  s.moderate('delete', all[0].id);
  assert.throws(() => s.chatHistory.page(stale), /채팅 기록/);
  assert.equal(
    s.chatHistory.page({ ...query(s), before: 4 }).messages.some((m) => m.id === all[0].id),
    false,
  );
  const oldMemory = s.journal.data.entries.find((m) => m.id === all[1].id);
  s.moderate('clear');
  assert.deepEqual(s.chatHistory.page(query(s)).messages, []);
  assert.equal(s.chatHistory.snapshot().hasMore, false);
  assert.deepEqual(
    s.journal.data.entries.find((m) => m.id === oldMemory.id),
    oldMemory,
  );
  const newMessage = s.addMessage('momo', '비운 뒤 새 채팅');
  assert.deepEqual(
    s.chatHistory.page(query(s)).messages.map((m) => m.id),
    [newMessage.id],
  );
});

test('history keeps correction and anonymous donation display, excluding witnesses and internal model metadata', (t) => {
  const s = make(t);
  const donation = {
    ...s.prepareMessage('anonymous', '익명 응원', 'donation'),
    name: '익명의 관객',
    donation: { amount: 5, anonymous: true },
    secretDebug: 'not public',
  };
  s.publishMessage(donation, { publishState: false });
  const speech = {
    ...s.prepareMessage('streamer', '원문', 'streamer'),
    transcription: {
      source: 'microphone',
      correction: { text: '교정', confidence: 0.95, reason: '합성', at: 100000 },
    },
  };
  s.publishMessage(speech, { publishState: false });
  fill(s, 500);
  const page = s.chatHistory.page({ ...query(s), before: 3 });
  assert.deepEqual(page.messages[0].donation, donation.donation);
  assert.equal(page.messages[0].name, '익명의 관객');
  assert.equal(page.messages[1].transcription.correction.text, '교정');
  for (const message of page.messages)
    for (const key of ['witnesses', 'sessionId', 'secretDebug', 'title'])
      assert.equal(key in message, false);
  page.messages[1].transcription.correction.text = '변조';
  assert.equal(s.journal.data.entries[1].transcription.correction.text, '교정');
});

test('rehearsal uses only its bounded live chat and does not persist or retrieve previous broadcasts', (t) => {
  const s = make(t);
  fill(s, 4);
  s.stop();
  s.configure({ ...s.settings, mode: 'rehearsal' });
  s.start();
  fill(s, 501);
  assert.equal(s.journal.data.entries.length, 4);
  const page = s.chatHistory.page({ ...query(s), before: 10 });
  assert.deepEqual(
    page.messages.map((m) => m.historySequence),
    [2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.equal(page.hasMore, false);
});

test('retention stays bounded while an early pinned message remains pageable after thousands of arrivals', (t) => {
  const s = make(t);
  const first = s.addMessage('momo', '합성 고정 기록');
  s.journal.pin(first.id, true);
  fill(s, 4505);
  assert.equal(s.journal.data.entries.length, 4000);
  assert.ok(s.chatHistory.positions.size <= 4500);
  const page = s.chatHistory.page({ ...query(s), before: 508 });
  assert.equal(page.messages[0].id, first.id);
  assert.ok(page.messages.every((m) => m.historySequence < 508));
  assert.equal(page.hasMore, false);
  const current = s.chatHistory.page(query(s));
  assert.equal(current.messages.at(-1).historySequence, 4506);
});

test('authenticated history API validates session, revision and page bound without calling models', async (t) => {
  let calls = 0;
  const service = await startServer({
    port: 0,
    persist: false,
    localSpeech: false,
    provider: {
      status: () => ({ configured: false }),
      react: () => {
        calls++;
        throw Error('Unexpected model');
      },
    },
  });
  t.after(() => service.close());
  clearInterval(service.studio.timer);
  service.studio.start();
  fill(service.studio, 105);
  const params = new URLSearchParams({ ...query(service.studio), revision: '0' });
  const url = service.url + '/api/chat/history?' + params;
  const headers = { Authorization: 'Bearer ' + service.accessToken };
  assert.equal((await fetch(url)).status, 401);
  const response = await fetch(url, { headers });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const page = await response.json();
  assert.equal(page.messages.length, 100);
  assert.equal(page.hasMore, true);
  for (const suffix of ['&limit=101', '&before=-1', '&before=1.2', '&unexpected=true'])
    assert.equal((await fetch(url + suffix, { headers })).status, 400);
  params.set('sessionId', randomUUID());
  assert.notEqual(
    (await fetch(service.url + '/api/chat/history?' + params, { headers })).status,
    200,
  );
  assert.equal(calls, 0);
});
