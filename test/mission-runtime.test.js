import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Studio } from '../server/studio.js';
import { Settings, Observation } from '../server/schema.js';
import { MissionBoard } from '../server/mission-board.js';
import { refusesMissions } from '../server/mission-runtime.js';
import { OpenAIProvider, format } from '../server/provider.js';
import { startServer } from '../server/index.js';
import { defaults } from '../shared/defaults.js';
const action = (values = {}) => ({
  kind: 'propose',
  personaId: 'momo',
  templateId: 'one-attempt',
  target: 40,
  amount: 20,
  missionId: null,
  reason: '재시작 없이 몰입하는 한 판이 궁금해서',
  ...values,
});
const observation = (values = {}) => ({
  game: '합성 게임',
  scene: '한 판 시작 전 합성 준비 장면',
  confidence: 0.9,
  excitement: 0.2,
  messages: [],
  missionActions: [action()],
  ...values,
});
function setup(t, react = async () => ({ observation: observation() })) {
  let now = 100000000;
  const s = new Studio({
    settings: Settings.parse({
      ...defaults,
      mode: 'live',
      category: 'gaming',
      lurkRatio: 0,
      slowModeSeconds: 0,
      chatPace: 8,
    }),
    now: () => now,
    random: () => 0.5,
    provider: { status: () => ({ configured: true }), react },
  });
  clearInterval(s.timer);
  s.audience.random = () => 0.5;
  s.start();
  t.after(() => s.close());
  return {
    s,
    advance: (ms = 20000) => (now += ms),
    send: (text) => s.receiveSpeech({ id: randomUUID(), sessionId: s.sessionId, text }),
  };
}
function seed(s, target = 20) {
  const { missionId } = s.missions.board.execute(
    {
      requestId: randomUUID(),
      kind: 'propose',
      personaId: 'momo',
      templateId: 'one-attempt',
      target,
      amount: 20,
      reason: '합성 흐름 확인',
    },
    s.missions.context(),
  );
  return missionId;
}
test('live request carries personal budgets and optional independent actions without extra calls or P transfers', async (t) => {
  let args;
  const { s, send } = setup(t, async (input) => {
    args = input;
    return { observation: Observation.parse(observation()) };
  });
  const economy = structuredClone(s.economy.data);
  send('게임에서 다른 도전도 해볼까?');
  await s.react({});
  assert.equal(args.missions.enabled, true);
  assert.equal(args.missions.budgets.momo.balance, 100);
  assert.equal(s.missions.board.data.campaigns.length, 1);
  assert.equal(s.calls, 1);
  assert.deepEqual(s.economy.data, economy);
  assert.equal(s.state().missions.campaigns[0].supporterCount, 1);
  assert.ok(s.messages.some((m) => m.missionEvent && /AI 관객 미션 제안/.test(m.text)));
  assert.equal(Object.hasOwn(args.viewerContext.momo, 'missionExperience'), true);
});
test('silence, opposition and differing motivations are valid; observations do not force funding', async (t) => {
  let turn = 0,
    missionId;
  const { s, send, advance } = setup(t, async () => {
    turn++;
    return {
      observation: observation({
        missionActions:
          turn === 1
            ? [action()]
            : turn === 2
              ? [
                  action({
                    kind: 'oppose',
                    personaId: 'gg',
                    missionId,
                    templateId: null,
                    target: null,
                    amount: null,
                    reason: '평소 방식이 더 재밌어서',
                  }),
                ]
              : [],
      }),
    };
  });
  send('다른 플레이를 보고 싶은 사람 있어?');
  await s.react({});
  missionId = s.missions.board.data.campaigns[0].id;
  advance();
  send('편하게 의견을 말해봐');
  await s.react({});
  assert.equal(s.missions.board.data.campaigns[0].opponents[0].personaId, 'gg');
  assert.equal(s.missions.board.data.campaigns[0].contributions.length, 1);
  advance();
  send('계속 게임해볼게');
  await s.react({});
  assert.equal(s.missions.board.data.ledger.filter((e) => e.kind === 'hold').length, 1);
});
test('important or uncertain scenes, chatting category, stale capture and blocked AI cannot initiate missions', async (t) => {
  for (const values of [{ excitement: 0.95 }, { confidence: 0.3 }]) {
    const { s, send } = setup(t, async () => ({ observation: observation(values) }));
    send('이 장면을 봐');
    await s.react({});
    assert.equal(s.missions.board.data.campaigns.length, 0);
  }
  const { s, send } = setup(t);
  s.settings.category = 'just-chatting';
  send('수다하자');
  await s.react({});
  assert.equal(s.missions.board.data.campaigns.length, 0);
  s.settings.category = 'gaming';
  const ctx = {
    diagnosticId: randomUUID(),
    witnessVisits: new Map(s.missions.witnesses().map((w) => [w.personaId, w.joinedAt])),
    capturedAt: s.now(),
    scene: '합성 화면',
    confidence: 1,
    excitement: 0,
    eligible: ['momo'],
  };
  for (const boundary of [{ stale: true }, { chatDriven: true }, { sourceRemoved: true }])
    s.missions.observe([action()], { ...ctx, ...boundary });
  s.ai.data.policy.paused = true;
  s.missions.observe([action()], ctx);
  assert.equal(s.missions.board.data.campaigns.length, 0);
});
test('departed, returned, new, disabled and system viewers cannot pledge from a captured request', async (t) => {
  for (const change of ['depart', 'return', 'disabled', 'system', 'new']) {
    let finish;
    const { s, send, advance } = setup(t, () => new Promise((resolve) => (finish = resolve)));
    if (change === 'new') s.audience.setPresence('momo', 'away', s.now());
    send('게임 진행을 같이 볼까');
    const job = s.react({});
    assert.equal(typeof finish, 'function');
    if (['depart', 'return'].includes(change)) s.audience.setPresence('momo', 'away', s.now());
    if (change === 'return' || change === 'new') {
      advance(1);
      s.audience.setPresence('momo', 'active', s.now());
    }
    if (change === 'disabled') s.settings.personas.find((p) => p.id === 'momo').enabled = false;
    if (change === 'system') s.settings.personas.find((p) => p.id === 'momo').system = true;
    finish({ observation: observation() });
    await job;
    assert.equal(s.missions.board.data.campaigns.length, 0, change);
  }
});

test('focused or uncertain scenes defer joining, opposing and completion candidates without spending', (t) => {
  const { s } = setup(t);
  const missionId = seed(s, 40);
  const input = {
    diagnosticId: randomUUID(),
    witnessVisits: new Map(s.missions.witnesses().map((w) => [w.personaId, w.joinedAt])),
    capturedAt: s.now(),
    scene: '합성 보스전 집중 장면',
    confidence: 0.9,
    excitement: 0.95,
    eligible: ['momo', 'gg'],
  };
  const actions = ['join', 'oppose'].map((kind) =>
    action({
      kind,
      personaId: 'gg',
      missionId,
      templateId: null,
      target: null,
      amount: kind === 'join' ? 20 : null,
    }),
  );
  const before = structuredClone(s.missions.board.data);
  s.missions.observe(actions, input);
  s.missions.observe(actions, { ...input, confidence: 0.3, excitement: 0.2 });
  assert.deepEqual(s.missions.board.data, before);
  s.missions.board.execute(
    {
      requestId: randomUUID(),
      kind: 'join',
      personaId: 'gg',
      missionId,
      amount: 20,
      reason: '합성 도전 동참',
    },
    s.missions.context(),
  );
  s.missions.command({ requestId: randomUUID(), kind: 'accept', missionId });
  s.missions.observe(
    [action({ kind: 'suggest-complete', missionId, templateId: null, target: null, amount: null })],
    input,
  );
  assert.equal(s.missions.board.data.campaigns[0].status, 'accepted');
  assert.equal(s.missions.board.data.ledger.filter((e) => e.kind === 'consume').length, 0);
});
test('refusal drops queued and late mission pressure but preserves paid negotiations and advice permission rules', async (t) => {
  const { s, send } = setup(t);
  const missionId = seed(s);
  s.accept(
    observation({
      missionActions: [],
      messages: ['momo', 'gg'].map((personaId) => ({
        personaId,
        text: '한 번 도전하자',
        kind: 'chat',
        spoiler: false,
        missionTopic: true,
        missionId,
      })),
    }),
    s.now(),
    false,
    'live',
  );
  assert.equal(s.queue.filter((m) => m.missionTopic).length, 1);
  const quote = s.special.quote({ targets: ['gg'], kind: 'cheer', text: '짧게 응원해줘' }).id;
  s.special.bid({ id: quote, amount: s.economy.data.quotes.find((q) => q.id === quote).ask });
  const economy = structuredClone(s.economy.data);
  send('미션은 그만. 힌트도 주지 마.');
  assert.equal(s.missions.board.data.enabled, false);
  assert.equal(s.missions.board.data.wallets.momo.balance, 100);
  assert.equal(s.queue.filter((m) => m.missionTopic).length, 0);
  assert.deepEqual(s.economy.data, economy);
  s.accept(
    observation({
      missionActions: [],
      messages: [
        {
          personaId: 'momo',
          text: '다시 도전해줘',
          kind: 'chat',
          spoiler: false,
          missionTopic: true,
          missionId,
        },
      ],
    }),
    s.now(),
    false,
    'live',
  );
  assert.equal(s.queue.length, 0);
  s.missions.command({ kind: 'enabled', enabled: true, requestId: randomUUID() });
  assert.equal(s.missions.board.data.enabled, true);
  for (const text of ['힌트는 그만', '힌트 하나 부탁해', '좋아 해볼게'])
    assert.equal(refusesMissions(text), false);
  assert.equal(refusesMissions('“미션은 그만”이라고 친구가 말했어'), false);
});

test('mission refusal recognition preserves negated refusals, separate topics and quoted past statements', () => {
  for (const text of [
    '미션은 그만',
    '미션 안 할래.',
    '미션을 거절할게',
    '도전 제안은 지금은 사양할게',
    'please stop missions',
    'don’t suggest more missions',
  ])
    assert.equal(refusesMissions(text), true, text);
  for (const text of [
    '미션 거절하지 않을게',
    '미션은 거절하진 않을게',
    '미션 그만두지 마',
    '미션은 좋고 힌트는 그만',
    '미션 말고 힌트는 그만',
    '어제 미션을 거절했었어',
    '‘미션 그만’은 인용이야',
    'don’t stop missions',
    '좋아 해볼게',
  ])
    assert.equal(refusesMissions(text), false, text);
});
test('deleted input and clear suppress mission actions from late responses; unrelated removed history preserves them', async (t) => {
  for (const removal of ['delete', 'clear', 'unrelated']) {
    let finish, args;
    const { s, send, advance } = setup(t, (input) => {
      args = input;
      return new Promise((resolve) => (finish = resolve));
    });
    const old = s.addMessage('momo', '이전 방문의 평범한 인사');
    advance();
    for (const p of s.settings.personas) {
      s.audience.setPresence(p.id, 'away', s.now());
      s.audience.setPresence(p.id, 'active', s.now());
    }
    const receipt = send('새로운 게임 도전을 볼까?');
    const job = s.react({});
    if (removal === 'unrelated') {
      assert.equal(
        Object.values(args.viewerContext).some((p) => p.chatHistory.some((m) => m.id === old.id)),
        false,
      );
      s.moderate('delete', old.id);
    } else s.moderate(removal, receipt.messageId);
    finish({ observation: observation() });
    await job;
    assert.equal(s.missions.board.data.campaigns.length, removal === 'unrelated' ? 1 : 0, removal);
  }
});
test('shutdown and a later broadcast never accept a late proposal or completion recommendation', async (t) => {
  let finish;
  const { s, send } = setup(t, () => new Promise((resolve) => (finish = resolve)));
  send('도전 아이디어 있어?');
  const job = s.react({});
  s.stop();
  s.start();
  finish({ observation: observation() });
  await job;
  assert.equal(s.missions.board.data.campaigns.length, 0);
});
test('failed mission saves preserve holds, close AI participation and cannot keep a broadcast running', (t) => {
  const { s } = setup(t);
  const missionId = seed(s);
  s.missions.command({ kind: 'accept', missionId, requestId: randomUUID() });
  const before = structuredClone(s.missions.board.data);
  s.missions.board.save = () => {
    throw Error('합성 디스크 오류');
  };
  assert.throws(
    () =>
      s.missions.command({ kind: 'confirm', missionId, completed: true, requestId: randomUUID() }),
    /원장 저장/,
  );
  assert.deepEqual(s.missions.board.data, before);
  assert.equal(s.missions.context().allowAI, false);
  s.stop();
  assert.equal(s.running, false);
  assert.deepEqual(s.missions.board.data, before);
  assert.match(s.state().missions.error, /원장 저장/);
  s.missions.board.save = () => {};
  s.missions.tick();
  assert.equal(s.missions.board.data.wallets.momo.balance, 100);
});
test('provider schema retains legacy defaults and sends no enabled mission contract outside live requests', () => {
  assert.deepEqual(
    Observation.parse(observation({ missionActions: undefined })).missionActions,
    [],
  );
  assert.equal(format.schema.required.includes('missionActions'), true);
  const provider = new OpenAIProvider({ OPENAI_API_KEY: 'synthetic-placeholder' });
  const payload = provider.payload({
    settings: Settings.parse(defaults),
    speech: '',
    special: { kind: 'thought' },
  });
  assert.equal(JSON.parse(payload.input[0].content[0].text).missions.enabled, false);
  assert.match(payload.instructions, /반대·무관심/);
  assert.match(payload.instructions, /P 지급을 결정할 권한이 없다/);
});

test('a failed witnessed-scene save freezes mission participation without inventing evidence or consuming P', (t) => {
  const { s } = setup(t);
  const missionId = seed(s);
  s.missions.command({ requestId: randomUUID(), kind: 'accept', missionId });
  const before = structuredClone(s.missions.board.data),
    economy = structuredClone(s.economy.data);
  s.missions.board.save = () => {
    throw Error('합성 장면 저장 실패');
  };
  assert.throws(
    () =>
      s.missions.observe([], {
        diagnosticId: randomUUID(),
        witnessVisits: new Map(s.missions.witnesses().map((w) => [w.personaId, w.joinedAt])),
        capturedAt: s.now(),
        scene: '합성 도전 결과 화면',
        confidence: 0.9,
        excitement: 0.2,
        image: true,
        eligible: ['momo'],
      }),
    /원장 저장/,
  );
  assert.deepEqual(s.missions.board.data, before);
  assert.deepEqual(s.economy.data, economy);
  assert.equal(s.missions.context().allowAI, false);
  assert.match(s.state().missions.error, /장면 저장 실패/);
  s.missions.board.save = () => {};
});

async function persistent(t) {
  const dir = mkdtempSync(join(tmpdir(), 'nagneon-mission-http-'));
  let service;
  const boot = async () => {
    service = await startServer({
      port: 0,
      dataDir: dir,
      localSpeech: false,
      provider: {
        status: () => ({ configured: true }),
        react: async () => ({ observation: observation() }),
      },
    });
    clearInterval(service.studio.timer);
    return service;
  };
  t.after(async () => {
    if (service) await service.close();
    rmSync(dir, { recursive: true });
  });
  await boot();
  service.studio.world.change((d) => {
    d.settings = Settings.parse({
      ...defaults,
      mode: 'live',
      category: 'gaming',
      lurkRatio: 0,
      communityActivityEnabled: false,
    });
    for (const p of d.settings.personas)
      d.audience.members[p.id] = {
        sessions: 1,
        seconds: 300,
        recognized: 0,
        affinity: 0.5,
        peers: {},
        memories: [],
      };
  });
  service.studio.audience.random = () => 0.5;
  service.studio.start();
  assert.equal(
    service.studio.audience.presence.momo,
    'active',
    'synthetic existing viewer actually joins before mission admission',
  );
  const post = async (body) => {
    const response = await fetch(service.url + '/api/missions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + service.accessToken,
        'X-Backseat-Client': 'studio',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  return {
    dir,
    get service() {
      return service;
    },
    boot,
    post,
  };
}
test('authenticated HTTP commands serialize duplicate completion and competing decisions exactly once', async (t) => {
  const f = await persistent(t);
  const s = f.service.studio,
    missionId = seed(s);
  const P = s.economy.data.balance;
  assert.equal((await f.post({ kind: 'accept', missionId, requestId: randomUUID() })).status, 200);
  const request = { kind: 'confirm', missionId, completed: true, requestId: randomUUID() };
  const results = await Promise.all([f.post(request), f.post(request)]);
  assert.equal(
    results.every((r) => r.status === 200),
    true,
  );
  assert.equal(results.filter((r) => r.body.duplicate).length, 1);
  assert.equal(s.missions.board.data.ledger.filter((e) => e.kind === 'consume').length, 1);
  assert.equal(s.economy.data.balance, P);
  assert.equal((await f.post({ ...request, completed: false })).status, 409);
  const stored = JSON.parse(readFileSync(join(f.dir, 'missions.json'), 'utf8'));
  assert.equal(stored.campaigns[0].status, 'completed');
  await f.service.close();
  await f.boot();
  assert.equal(f.service.studio.missions.board.data.wallets.momo.consumed, 20);
  assert.equal(
    f.service.studio.missions.board.data.ledger.filter((e) => e.kind === 'release').length,
    0,
  );
});
test('two simultaneous terminal decisions can only consume or release, never both', async (t) => {
  const f = await persistent(t);
  const s = f.service.studio,
    missionId = seed(s);
  s.missions.command({ kind: 'accept', missionId, requestId: randomUUID() });
  const results = await Promise.all([
    f.post({ kind: 'confirm', missionId, completed: true, requestId: randomUUID() }),
    f.post({ kind: 'cancel', missionId, requestId: randomUUID() }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const rows = s.missions.board.data.ledger.filter((e) => ['consume', 'release'].includes(e.kind));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 20);
});

test('a stale HTTP acceptance commits and publishes the deadline refund even though the decision returns 409', async (t) => {
  const f = await persistent(t),
    s = f.service.studio,
    missionId = seed(s);
  const deadline = s.missions.board.data.campaigns[0].fundingDeadline;
  s.now = () => deadline;
  s.missions.board.clock = () => deadline;
  const published = [];
  s.on('state', (state) => published.push(state.missions));
  const P = s.economy.data.balance;
  const response = await f.post({ requestId: randomUUID(), kind: 'accept', missionId });
  assert.equal(response.status, 409);
  assert.match(response.body.error, /유효한 미션/);
  assert.equal(published.at(-1).campaigns[0].status, 'expired');
  const read = await fetch(f.service.url + '/api/state', {
    headers: { Authorization: 'Bearer ' + f.service.accessToken },
  });
  assert.equal(read.status, 200);
  const current = await read.json();
  assert.equal(current.missions.campaigns[0].status, 'expired');
  assert.equal(current.missions.wallets.momo.held, 0);
  assert.equal(s.missions.board.data.ledger.filter((e) => e.kind === 'release').length, 1);
  assert.equal(s.economy.data.balance, P);
  assert.equal((await f.post({ requestId: randomUUID(), kind: 'accept', missionId })).status, 409);
  assert.equal(s.missions.board.data.ledger.filter((e) => e.kind === 'release').length, 1);
});
test('mission route rejects viewer pledges, model settlement claims and unauthenticated requests', async (t) => {
  const f = await persistent(t);
  const before = structuredClone(f.service.studio.missions.board.data);
  assert.equal((await f.post({ ...action(), requestId: randomUUID() })).status, 400);
  assert.equal(
    (await f.post({ kind: 'enabled', enabled: true, completed: true, requestId: randomUUID() }))
      .status,
    400,
  );
  const response = await fetch(f.service.url + '/api/missions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'enabled', enabled: false, requestId: randomUUID() }),
  });
  assert.equal(response.status, 403);
  assert.deepEqual(f.service.studio.missions.board.data, before);
});
test('missing, corrupt and newer mission primary fail closed without backup rollback or touching old profile files', async (t) => {
  for (const failure of ['missing', 'corrupt', 'newer']) {
    const f = await persistent(t);
    seed(f.service.studio);
    await f.service.close();
    const file = join(f.dir, 'missions.json'),
      world = readFileSync(join(f.dir, 'world.json')),
      marker = readFileSync(join(f.dir, 'profile-format.json'));
    assert.equal(existsSync(file + '.bak.1'), true);
    const backup = readFileSync(file + '.bak.1');
    if (failure === 'missing') unlinkSync(file);
    else
      writeFileSync(
        file,
        failure === 'corrupt' ? '{broken synthetic json' : JSON.stringify({ version: 2 }),
      );
    await assert.rejects(f.boot(), /기본 저장 파일을 자동 복구/);
    assert.deepEqual(readFileSync(join(f.dir, 'world.json')), world);
    assert.deepEqual(readFileSync(join(f.dir, 'profile-format.json')), marker);
    assert.deepEqual(readFileSync(file + '.bak.1'), backup);
    if (failure === 'missing') assert.equal(existsSync(file), false);
  }
});
test('independent mission file leaves the existing profile reader and Economy schema untouched', async (t) => {
  const f = await persistent(t);
  const marker = readFileSync(join(f.dir, 'profile-format.json'), 'utf8');
  const economy = structuredClone(f.service.studio.economy.data);
  seed(f.service.studio);
  assert.equal(readFileSync(join(f.dir, 'profile-format.json'), 'utf8'), marker);
  assert.deepEqual(f.service.studio.economy.data, economy);
  assert.equal(JSON.parse(marker).minReader, 2);
  assert.equal(JSON.parse(readFileSync(join(f.dir, 'world.json'), 'utf8')).version, 2);
});
