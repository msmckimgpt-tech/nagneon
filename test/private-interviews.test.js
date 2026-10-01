import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Studio } from '../server/studio.js';
import { startServer } from '../server/index.js';
import { Settings } from '../server/schema.js';
import { EconomyData } from '../server/data-schema.js';
import { defaults } from '../shared/defaults.js';

const settings = Settings.parse({
  ...defaults,
  mode: 'live',
  lurkRatio: 0,
  communityActivityEnabled: false,
});
const answer = (text = '같이 웃는 방송이 좋아요.', personaId = 'momo') => ({ personaId, text });
const result = (extra = {}) => ({
  kind: 'interview',
  personaId: 'momo',
  at: 100,
  question: '어떤 방송이 좋아요?',
  messages: [answer()],
  ...extra,
});
const receipt = (output, extra = {}) => ({
  id: randomUUID(),
  kind: 'interview',
  key: 'momo:어떤 방송이 좋아요?',
  cost: 40,
  status: 'completed',
  at: 100,
  fingerprint: 'synthetic-interview',
  result: output,
  ...extra,
});
function studio(t, provider = { status: () => ({ configured: true }) }) {
  const s = new Studio({ settings, provider });
  clearInterval(s.timer);
  t.after(() => s.close());
  s.start();
  return s;
}

test('a storage-valid incomplete interview cannot break the whole viewer notebook', (t) => {
  const s = studio(t);
  for (const messages of [undefined, null, 'legacy text', {}, [null], [42]]) {
    s.economy.data.purchases = [receipt(result()), receipt(result({ messages }))];
    assert.equal(EconomyData.safeParse(s.economy.data).success, true);
    const before = structuredClone(s.economy.data);
    const notebook = s.special.profile('momo');
    assert.deepEqual(notebook.preferences, [
      { at: 100, question: result().question, answers: [answer().text] },
    ]);
    assert.deepEqual(
      s.economy.data,
      before,
      'reading preserves every original purchase and balance',
    );
  }
});

test('private preferences contain only readable answers from their own stable viewer ID', (t) => {
  const s = studio(t);
  s.economy.data.purchases = [
    receipt(
      result({
        messages: [
          answer(),
          answer('다른 관객의 비공개 답변', 'gg'),
          null,
          'legacy entry',
          { personaId: 'momo', text: { secret: 'invalid answer' } },
          answer('   '),
        ],
      }),
    ),
  ];
  assert.deepEqual(s.special.profile('momo').preferences[0].answers, [answer().text]);
  assert.deepEqual(s.special.profile('gg').preferences, []);
});

test('receipt ownership and completion are checked before reusing an interview answer', (t) => {
  const s = studio(t);
  s.economy.data.purchases = [
    receipt(result()),
    receipt(result({ messages: [answer('다른 구매 주인')] }), { key: 'gg:다른 질문' }),
    receipt(result({ messages: [answer('미완료 답변')] }), { status: 'pending' }),
    receipt(result({ messages: [answer('실패한 답변')] }), { status: 'failed' }),
    receipt(result({ messages: [answer('다른 기능의 답변')] }), { kind: 'thought' }),
    receipt(result({ kind: 'contract', messages: [answer('잘못된 결과 종류')] })),
    receipt(result({ personaId: 'gg', messages: [answer('잘못된 결과 주인')] })),
  ];
  const before = structuredClone(s.economy.data);
  assert.deepEqual(s.special.profile('momo').preferences[0].answers, [answer().text]);
  assert.equal(s.special.profile('momo').preferences.length, 1);
  assert.deepEqual(s.economy.data, before);
});

test('broken recent receipts do not crowd readable interviews out of the latest four', (t) => {
  const s = studio(t);
  s.economy.data.purchases = Array.from({ length: 6 }, (_, index) =>
    receipt(
      result({
        at: 100 + index,
        question: `질문 ${index}`,
        messages: [answer(`답변 ${index}`)],
      }),
    ),
  );
  s.economy.data.purchases.push(
    ...Array.from({ length: 5 }, () => receipt(result({ messages: null }))),
  );
  assert.deepEqual(
    s.special.profile('momo').preferences.map((p) => p.question),
    ['질문 2', '질문 3', '질문 4', '질문 5'],
  );
});

test('legacy result metadata uses the durable receipt date and survives nickname changes', (t) => {
  const s = studio(t);
  const legacy = result({
    kind: undefined,
    at: undefined,
    messages: [{ ...answer(), name: '예전닉네임' }],
  });
  s.economy.data.purchases = [receipt(legacy, { at: 321 })];
  s.settings.personas.find((p) => p.id === 'momo').name = '새닉네임';
  assert.deepEqual(s.special.profile('momo').preferences, [
    { at: 321, question: legacy.question, answers: [answer().text] },
  ]);
  for (const at of [null, -1, Infinity, 'yesterday', 8.64e15 + 1]) {
    s.economy.data.purchases[0].result.at = at;
    assert.equal(s.special.profile('momo').preferences[0].at, 321);
  }
});

test('malformed stored text cannot enter the next model request as a private preference', (t) => {
  const s = studio(t);
  const invalid = [
    result({ question: null }),
    result({ question: ' ' }),
    result({ question: '가'.repeat(601) }),
    result({ messages: [answer('가'.repeat(241))] }),
    result({ messages: [] }),
  ];
  s.economy.data.purchases = [receipt(result()), ...invalid.map((r) => receipt(r))];
  assert.equal(s.special.profile('momo').preferences.length, 1);
});

test('a readable preference projection cannot mutate the stored interview', (t) => {
  const s = studio(t);
  s.economy.data.purchases = [receipt(result())];
  const before = structuredClone(s.economy.data);
  const preference = s.special.preferences('momo')[0];
  preference.answers[0] = 'edited projection';
  preference.answers.push('new projection');
  preference.question = 'edited question';
  assert.deepEqual(s.economy.data, before);
});

test('persisted partial interviews survive restart, free notebook reads, and a subsequent private answer', async (t) => {
  await mkdir(resolve('artifacts'), { recursive: true });
  const dataDir = await mkdtemp(join(resolve('artifacts'), 'private-interview-history-'));
  const calls = [];
  const provider = {
    status: () => ({ configured: true }),
    react: async (args) => {
      calls.push(args);
      return {
        observation: {
          messages: [{ ...answer('오늘도 편하게 얘기해요.'), kind: 'chat', spoiler: false }],
        },
      };
    },
  };
  let service;
  t.after(async () => {
    await service?.close();
  });
  const boot = async () => {
    service = await startServer({ port: 0, dataDir, provider, localSpeech: false });
    clearInterval(service.studio.timer);
  };
  const post = async (path, body) => {
    const response = await fetch(`${service.url}/api/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${service.accessToken}`,
        'X-Backseat-Client': 'studio',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const originals = [
    receipt(result()),
    receipt(result({ messages: null })),
    receipt(result({ messages: [answer(), null, answer('다른 관객만 아는 답변', 'gg')] })),
  ];
  await boot();
  service.studio.world.change((d) => {
    d.settings = structuredClone(settings);
    for (const p of d.settings.personas)
      d.audience.members[p.id] = {
        sessions: 1,
        seconds: 60,
        recognized: 0,
        affinity: 0.5,
        peers: {},
        memories: [],
      };
    d.economy.purchases = structuredClone(originals);
    d.autonomy.unlocks.momo = { profile: true };
  });
  await service.close();
  service = undefined;
  await boot();
  const economyBefore = structuredClone(service.studio.economy.data);
  const worldBefore = await readFile(join(dataDir, 'world.json'), 'utf8');
  const reopened = await post('special/unlock', {
    kind: 'profile',
    personaId: 'momo',
    requestId: randomUUID(),
  });
  assert.equal(reopened.status, 200);
  assert.equal(reopened.body.cached, true);
  assert.equal(reopened.body.result.preferences.length, 2);
  assert.deepEqual(
    reopened.body.result.preferences.flatMap((p) => p.answers),
    [answer().text, answer().text],
  );
  assert.equal(calls.length, 0);
  assert.deepEqual(service.studio.economy.data, economyBefore);
  assert.equal(await readFile(join(dataDir, 'world.json'), 'utf8'), worldBefore);
  service.studio.start();
  const next = await post('special/generate', {
    kind: 'interview',
    personaId: 'momo',
    question: '오늘은 어떤가요?',
    requestId: randomUUID(),
  });
  assert.equal(next.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].audience.members.length, 1);
  assert.equal(calls[0].audience.members[0].id, 'momo');
  assert.deepEqual(
    calls[0].audience.members[0].privateInterviews.flatMap((p) => p.answers),
    [answer().text, answer().text],
  );
  assert.equal(service.studio.messages.length, 0, 'private interviews stay out of public chat');
  assert.equal(service.studio.economy.data.balance, economyBefore.balance - 40);
  assert.deepEqual(service.studio.economy.data.purchases.slice(0, originals.length), originals);
  await service.close();
  service = undefined;
  await boot();
  assert.deepEqual(service.studio.economy.data.purchases.slice(0, originals.length), originals);
  assert.equal(service.studio.special.profile('momo').preferences.length, 3);
  assert.deepEqual(service.studio.special.profile('gg').preferences, []);
});
