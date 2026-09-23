import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { startServer } from '../server/index.js';
import { JsonStore } from '../server/storage.js';
import { defaults } from '../shared/defaults.js';
import { Ambient } from '../server/ambient.js';
import { OpenAIProvider } from '../server/provider.js';
import { liveViewerContext } from '../server/viewer-context.js';

async function waitFor(condition) {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, `Timed out waiting for ${condition}`);
    await new Promise((resolve) => setImmediate(resolve));
  }
}
const birth = {
  name: '이끼수첩',
  personality: 'PRIVATE_PERSONALITY: 조용한 탐험과 식물 이야기를 좋아한다.',
  values: 'PRIVATE_VALUES: 스스로 발견하는 즐거움',
  sociability: 0.6,
  expertise: 0.3,
};
const result = (extra = {}) => ({
  observation: {
    game: 'Just Chatting',
    scene: '식물 취향 이야기',
    confidence: 0.8,
    excitement: 0.2,
    messages: [],
    arrival: null,
    viewerChanges: [],
    clipPicks: [],
    ...extra,
  },
  usage: { total_tokens: 1 },
});
const fake = (fn = async () => result({ arrival: birth })) => ({
  status: () => ({ configured: true }),
  react: fn,
});
const directory = () => mkdtempSync(join(tmpdir(), 'backseat-autonomy-'));
async function open(t, options = {}) {
  const dataDir = options.dataDir || directory();
  const service = await startServer({
    port: 0,
    dataDir,
    localSpeech: false,
    provider: fake(),
    ...options,
  });
  t?.after(() => service.close());
  clearInterval(service.studio.timer);
  return { ...service, dataDir };
}
function req(s, path, body, method = body === undefined ? 'GET' : 'POST') {
  return fetch(s.url + '/api/' + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + s.accessToken,
      'X-Backseat-Client': 'studio',
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function start(service) {
  service.studio.configure({ ...service.studio.settings, mode: 'live', lurkRatio: 0 });
  service.studio.start();
}
async function meet(service) {
  return service.studio.autonomy.arrive(randomUUID());
}
const raw = (s) => JSON.parse(readFileSync(join(s.dataDir, 'world.json'), 'utf8'));

test('more than 40 viewers can meet, retain all witnesses and reload without a roster ceiling', async (t) => {
  const service = await open(null),
    s = service.studio;
  try {
    s.world.change((d) => {
      const template = d.settings.personas[0];
      for (let i = 0; i < 100; i++) {
        const id = 'large-roster-' + i;
        d.settings.personas.push({
          ...template,
          id,
          name: '관객' + i,
          system: false,
          role: 'viewer',
        });
        d.audience.members[id] = {
          sessions: 1,
          seconds: 0,
          recognized: 0,
          affinity: 0.9,
          peers: {},
          memories: [],
        };
      }
    });
    start(service);
    const arrival = await meet(service);
    assert.equal(arrival.status, 'completed');
    const ids = s.settings.personas.filter((p) => !p.system).map((p) => p.id);
    assert.equal(ids.length, 101);
    for (const id of ids) {
      s.audience.data.members[id].joinedAt = s.startedAt;
      s.audience.presence[id] = 'active';
    }
    s.addMessage('streamer', '모두 같은 화면을 함께 보고 있어요', 'streamer');
    s.knowledge.observe('확장 관객 검사', '함께 본 합성 장면', s.now(), 0.5, ids);
    s.knowledge.observe('확장 관객 검사', '다음 합성 장면', s.now() + 1000, 0.5, ids);
    assert.equal(Object.keys(s.knowledge.get('확장 관객 검사').watched).length, 101);
    assert.equal(s.lastError, '');
    assert.equal(
      s.journal.data.entries.at(-1).witnesses.filter((id) => ids.includes(id)).length,
      101,
    );
    assert.equal(s.knowledge.entries['확장 관객 검사'].observations.at(-1).witnesses.length, 101);
  } finally {
    await service.close();
  }
  const reloaded = await open(t, { dataDir: service.dataDir });
  assert.equal(reloaded.studio.settings.personas.filter((p) => !p.system).length, 101);
  assert.equal(
    reloaded.studio.journal.data.entries.at(-1).witnesses.filter((id) => id !== 'mod').length >=
      101,
    true,
  );
  assert.equal(
    reloaded.studio.knowledge.entries['확장 관객 검사'].observations.at(-1).witnesses.length,
    101,
  );
  assert.equal('maxViewers' in reloaded.studio.autonomy.snapshot(), false);
});

test('first meeting waits behind an active observation without a charge or duplicate generation', async (t) => {
  let release,
    calls = 0;
  const service = await open(t, {
    provider: fake(async (args) => {
      calls++;
      return args.special?.kind === 'audience-arrival'
        ? result({ arrival: birth })
        : new Promise((r) => (release = r));
    }),
  });
  start(service);
  const s = service.studio,
    observation = s.react({ speech: '게임을 시작할게요.' });
  await waitFor(() => !!release);
  const requestId = randomUUID(),
    meeting = req(service, 'audience/arrive', { requestId });
  await waitFor(() => !!s.autonomy.waiting);
  assert.equal(raw(service).economy.balance, 200);
  assert.equal(raw(service).autonomy.receipts[requestId], undefined);
  assert.equal(s.autonomy.snapshot().waiting, true);
  const duplicate = await (await req(service, 'audience/arrive', { requestId })).json();
  assert.equal(duplicate.status, 'pending');
  assert.equal(duplicate.queued, true);
  assert.equal((await req(service, 'audience/arrive', { requestId: randomUUID() })).status, 409);
  release(result());
  await observation;
  const receipt = await (await meeting).json();
  assert.equal(receipt.status, 'completed');
  assert.equal(calls, 2);
  assert.equal(raw(service).economy.balance, 150);
  assert.equal(s.settings.personas.filter((p) => !p.system).length, 1);
  assert.equal(s.autonomy.snapshot().pending, false);
  const retry = await (await req(service, 'audience/arrive', { requestId })).json();
  assert.equal(retry.personaId, receipt.personaId);
  assert.equal(calls, 2);
});

test('stopping while a first meeting waits cancels the wait with no charge and leaves the ID retryable', async (t) => {
  let release;
  const service = await open(t, {
    provider: fake(async (args) =>
      args.special?.kind === 'audience-arrival'
        ? result({ arrival: birth })
        : new Promise((r) => (release = r)),
    ),
  });
  start(service);
  const s = service.studio,
    observation = s.react({ speech: '조금 기다려주세요.' });
  await waitFor(() => !!release);
  const requestId = randomUUID(),
    meeting = req(service, 'audience/arrive', { requestId });
  await waitFor(() => !!s.autonomy.waiting);
  s.stop();
  const response = await meeting;
  assert.equal(response.status, 409);
  assert.equal(raw(service).economy.balance, 200);
  assert.equal(s.autonomy.snapshot().pending, false);
  assert.equal(s.listenerCount('state'), 0);
  assert.equal(raw(service).autonomy.receipts[requestId], undefined);
  release(result());
  await observation;
  s.start();
  const receipt = await (await req(service, 'audience/arrive', { requestId })).json();
  assert.equal(receipt.status, 'completed');
  assert.equal(raw(service).economy.balance, 150);
});

test('fresh profile has no hidden waiting audience; settings/API cannot create or edit one', async (t) => {
  const service = await open(t);
  const initial = await (await req(service, 'state')).json();
  assert.equal(initial.settings.personas.filter((p) => !p.system).length, 0);
  assert.deepEqual(raw(service).autonomy.retired, {});
  assert.equal(
    (
      await req(
        service,
        'settings',
        {
          ...initial.settings,
          personas: [
            ...initial.settings.personas,
            { ...initial.settings.personas[0], id: 'forged', system: false },
          ],
        },
        'PUT',
      )
    ).status,
    409,
  );
  assert.equal(
    (await req(service, 'settings', { ...initial.settings, title: '내 방송' }, 'PUT')).status,
    200,
  );
  start(service);
  assert.equal(service.studio.settings.personas.length, 1);
  assert.equal(service.studio.calls, 0);
  assert.equal(
    (await req(service, 'audience/arrive', { requestId: randomUUID(), name: '내가 고른 이름' }))
      .status,
    400,
  );
});

test('arrival holds, settles once, redacts traits on state/SSE/export and reveals only after purchase', async (t) => {
  let release;
  const service = await open(t, { provider: fake(async () => new Promise((r) => (release = r))) });
  start(service);
  const requestId = randomUUID(),
    pending = req(service, 'audience/arrive', { requestId });
  await waitFor(() => !!release);
  assert.equal(raw(service).economy.balance, 150);
  assert.equal(raw(service).settings.personas.length, 1);
  const duplicate = await (await req(service, 'audience/arrive', { requestId })).json();
  assert.equal(duplicate.status, 'pending');
  assert.equal(duplicate.source, undefined);
  release(result({ arrival: birth }));
  const receipt = await (await pending).json();
  assert.equal(receipt.status, 'completed');
  assert.equal(receipt.source, undefined);
  const id = receipt.personaId;
  assert.equal(raw(service).settings.personas.length, 2);
  assert.equal(service.studio.calls, 1);
  for (const route of ['state', 'export']) {
    const value = JSON.stringify(await (await req(service, route)).json());
    assert.ok(!value.includes('PRIVATE_'));
    assert.ok(!value.includes('firstSeenAt'));
  }
  const stream = await req(service, 'events');
  const reader = stream.body.getReader();
  const event = new TextDecoder().decode((await reader.read()).value);
  await reader.cancel();
  assert.ok(!event.includes('PRIVATE_'));
  const again = await (await req(service, 'audience/arrive', { requestId })).json();
  assert.equal(again.personaId, id);
  assert.equal(raw(service).economy.balance, 150);
  assert.equal(service.studio.calls, 1);
  // Test wallet credit is explicit fixture setup, not a production points path.
  service.studio.economy.change((d) => {
    d.balance = 100;
  });
  const unlockId = randomUUID();
  assert.equal(
    (await req(service, 'special/unlock', { kind: 'profile', personaId: id, requestId: unlockId }))
      .status,
    200,
  );
  const publicState = await (await req(service, 'state')).json();
  assert.match(
    publicState.settings.personas.find((p) => p.id === id).personality,
    /PRIVATE_PERSONALITY/,
  );
  assert.equal(
    publicState.audience.members[id].peers,
    undefined,
    'profile does not unlock relationships',
  );
  await req(service, 'special/unlock', { kind: 'profile', personaId: id, requestId: unlockId });
  assert.equal(raw(service).economy.balance, 70);
  service.studio.economy.change((d) => {
    d.purchases = d.purchases.filter((p) => p.kind !== 'profile');
  });
  assert.equal(
    service.studio.world.revealed(id, 'profile'),
    true,
    'permanent unlock survives receipt history pruning',
  );
  await req(service, 'special/unlock', { kind: 'profile', personaId: id, requestId: randomUUID() });
  assert.equal(raw(service).economy.balance, 70);
});

test('failed final commit refunds the hold without a ghost viewer; profile unlock disk failure takes no points', async (t) => {
  const service = await open(t);
  start(service);
  const save = JsonStore.prototype.save;
  let failed = false;
  JsonStore.prototype.save = function (value) {
    if (
      this.file === join(service.dataDir, 'world.json') &&
      value.settings.personas.length === 2 &&
      !failed
    ) {
      failed = true;
      throw Error('injected final commit failure');
    }
    return save.call(this, value);
  };
  try {
    await assert.rejects(meet(service), /commit failure/);
  } finally {
    JsonStore.prototype.save = save;
  }
  assert.equal(failed, true);
  assert.equal(raw(service).settings.personas.length, 1);
  assert.equal(raw(service).economy.balance, 200);
  assert.equal(Object.values(raw(service).autonomy.receipts)[0].status, 'failed');
  const { personaId } = await meet(service);
  service.studio.economy.change((d) => {
    d.balance = 100;
  });
  JsonStore.prototype.save = function (value) {
    if (
      this.file === join(service.dataDir, 'world.json') &&
      value.economy.purchases.some((p) => p.kind === 'profile')
    )
      throw Error('unlock disk full');
    return save.call(this, value);
  };
  try {
    assert.throws(
      () => service.studio.special.unlock({ kind: 'profile', personaId, requestId: randomUUID() }),
      /disk full/,
    );
  } finally {
    JsonStore.prototype.save = save;
  }
  assert.equal(service.studio.economy.data.balance, 100);
  assert.equal(service.studio.world.revealed(personaId, 'profile'), false);
  assert.equal(raw(service).economy.balance, 100);
});

for (const mode of ['held', 'completed'])
  test(`real process termination ${mode}: restart recovers all-or-nothing settlement and preserves request identity`, async (t) => {
    const dataDir = directory(),
      requestId = randomUUID();
    const child = spawn(
      process.execPath,
      ['test/fixtures/arrival-crash.mjs', dataDir, mode, requestId],
      { cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let errors = '';
    child.stderr.on('data', (b) => (errors += b));
    const marker = mode === 'held' ? 'HELD' : 'COMMITTED';
    const ready = new Promise((resolve, reject) => {
      let text = '';
      const timer = setTimeout(() => reject(Error('child timeout ' + errors)), 15000);
      child.stdout.on('data', (b) => {
        text += b;
        if (text.includes(marker)) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(Error('child exited ' + code + ' ' + errors));
      });
    });
    try {
      await ready;
      const exit = once(child, 'exit');
      child.kill();
      await exit;
    } finally {
      if (child.exitCode === null) child.kill();
    }
    const service = await open(t, { dataDir });
    const record = raw(service),
      receipt = record.autonomy.receipts[requestId];
    assert.equal(record.economy.balance, mode === 'held' ? 200 : 150);
    assert.equal(record.settings.personas.filter((p) => !p.system).length, mode === 'held' ? 0 : 1);
    assert.equal(receipt.status, mode === 'held' ? 'failed' : 'completed');
    const retried = await service.studio.autonomy.arrive(requestId);
    assert.equal(retried.status, receipt.status);
    assert.equal(service.studio.calls, 0);
    assert.equal(raw(service).economy.balance, record.economy.balance);
  });

test('stop cancels a background arrival and returns points; blocked origins consume no call', async (t) => {
  let entered = false;
  const service = await open(t, {
    provider: fake(async (_args, signal) => {
      entered = true;
      return new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(Error('cancelled')), { once: true }),
      );
    }),
  });
  start(service);
  const pending = meet(service);
  await waitFor(() => !!entered);
  service.studio.stop();
  await assert.rejects(pending, /cancelled/);
  assert.equal(raw(service).economy.balance, 200);
  assert.equal(raw(service).settings.personas.length, 1);
  assert.equal(service.studio.busy, false);
  await assert.rejects(meet(service), /방송/);
  assert.equal(service.studio.calls, 1);
});

test('legacy migration keeps met IDs/history, archives unmet candidates, and does not rerun after restart', async () => {
  const dataDir = directory();
  writeFileSync(join(dataDir, 'settings.json'), JSON.stringify(defaults));
  const old = {
    members: {
      momo: {
        sessions: 2,
        seconds: 900,
        recognized: 1,
        affinity: 0.4,
        peers: {},
        memories: ['기존 기억'],
        note: '개인 메모',
      },
    },
    lore: [],
    posts: [],
  };
  writeFileSync(join(dataDir, 'audience.json'), JSON.stringify(old));
  let service = await open(null, { dataDir });
  try {
    assert.ok(service.studio.settings.personas.some((p) => p.id === 'momo'));
    assert.ok(!service.studio.settings.personas.some((p) => p.id === 'gg'));
    assert.equal(raw(service).autonomy.retired.gg.reason, 'legacy-unmet');
    assert.equal(service.studio.audience.data.members.momo.note, '개인 메모');
  } finally {
    await service.close();
  }
  const legacy = readFileSync(join(dataDir, 'settings.json'), 'utf8');
  writeFileSync(join(dataDir, 'settings.json'), '{stale invalid legacy');
  service = await open(null, { dataDir });
  try {
    assert.equal(service.studio.settings.personas.length, 2);
    assert.deepEqual(service.studio.audience.data.members.momo.memories, ['기존 기억']);
    assert.equal(readFileSync(join(dataDir, 'settings.json'), 'utf8'), '{stale invalid legacy');
  } finally {
    await service.close();
    writeFileSync(join(dataDir, 'settings.json'), legacy);
  }
});

test('natural arrivals create at the actual chance, avoid suspend catch-up and use real spectator clip sources', async (t) => {
  let args;
  const service = await open(t, {
    provider: fake(async (value) => {
      args = value;
      return result({ arrival: birth });
    }),
  });
  start(service);
  const s = service.studio;
  s.social.preferences({ enabled: false });
  let now = Date.now();
  s.now = () => now;
  s.random = () => 0;
  s.autonomy.start();
  for (let i = 0; i < 599; i++) {
    now += 1000;
    s.pump();
  }
  assert.equal(s.settings.personas.length, 1);
  assert.equal(s.calls, 0);
  now += 1000;
  s.pump();
  await waitFor(() => !s.busy);
  assert.equal(s.settings.personas.length, 2);
  assert.equal(args.special.source.path, 'broadcast');
  assert.equal(s.economy.data.balance, 200);
  now += 3600000;
  s.pump();
  await waitFor(() => !s.busy);
  assert.ok(s.calls <= 2, 'one chance at wake, no backlog');
  const creator = s.settings.personas.find((p) => !p.system);
  const c = s.clips.create({
    title: '조용한 식물 이야기',
    game: 'Just Chatting',
    scene: '공개 취향 대화',
    participants: [],
    messages: [],
    sessionId: s.sessionId,
    creator: { id: creator.id, name: creator.name, reason: '내 관심사' },
    source: 'spectator',
  });
  now += 360000;
  s.pump();
  await waitFor(() => !s.busy);
  assert.equal(args.special.source.path, 'clip');
  assert.equal(args.special.source.clipId, c.id);
  assert.equal(args.special.clip.interest, '일상 대화와 취향 교류');
  assert.equal(args.special.clip.scene, undefined);
  const admitted = s.settings.personas.at(-1);
  assert.equal(
    s.clips.recallArrival(s.audience.data.members[admitted.id].arrivalClip, now).scene,
    '공개 취향 대화',
  );
});

test('viewer evolution needs witnessed speech and keeps notes, names and prior authors on the same ID', async (t) => {
  let args;
  const service = await open(t, {
    provider: fake(async (value) => {
      args = value;
      return value.special?.kind === 'audience-arrival' ? result({ arrival: birth }) : result();
    }),
  });
  start(service);
  const { personaId: id } = await meet(service),
    s = service.studio;
  let now = Date.now() + 700000;
  s.now = () => now;
  s.world.change((d) => {
    d.audience.members[id].seconds = 600;
  });
  await req(service, `audience/${id}/note`, { text: 'SECRET_STREAMER_NOTE' }, 'PUT');
  const old = s.addMessage(id, '식물 이야기 좋아요');
  const change = {
    personaId: id,
    preference: '식물 이야기를 더 즐기게 됨',
    nickname: '이끼친구',
    reason: '관심사가 통했다',
    evidence: '같이 식물 키워보자',
    sociabilityDelta: 0.05,
  };
  s.autonomy.evolve([change], change.evidence, []);
  assert.equal(s.settings.personas.find((p) => p.id === id).name, birth.name);
  s.autonomy.evolve([change], change.evidence, [id]);
  assert.equal(s.settings.personas.find((p) => p.id === id).name, '이끼친구');
  assert.equal(s.audience.data.members[id].note, 'SECRET_STREAMER_NOTE');
  assert.equal(s.audience.data.members[id].aliases[0].name, birth.name);
  assert.equal(old.personaId, id);
  assert.equal(old.name, birth.name);
  await s.react({ speech: '요즘 식물 키우기에 빠졌어요' });
  assert.ok(!JSON.stringify(args).includes('SECRET_STREAMER_NOTE'));
  assert.equal(args.ambient.id, 'taste');
  const publicState = s.state();
  assert.equal(publicState.settings.personas.find((p) => p.id === id).values, undefined);
  assert.equal(publicState.audience.members[id].note, 'SECRET_STREAMER_NOTE');
  assert.equal(publicState.observation.viewerChanges, undefined);
  const receipt = s.world.data.autonomy.receipts;
  await req(service, 'audience/' + id, undefined, 'DELETE');
  assert.ok(!s.settings.personas.some((p) => p.id === id));
  assert.equal(s.audience.data.members[id].note, 'SECRET_STREAMER_NOTE');
  assert.deepEqual(s.world.data.autonomy.receipts, receipt);
  assert.equal(s.messages.find((m) => m.id === old.id).name, birth.name);
});

test('speech adaptation needs separate witnessed scenes, an emitted trial and own acceptance after a restart', async (t) => {
  const service = await open(t);
  start(service);
  const { personaId: id } = await meet(service),
    s = service.studio;
  let now = Date.now() + 700000;
  s.now = () => now;
  const name = s.settings.personas.find((p) => p.id === id).name;
  s.world.change((d) => {
    d.audience.members[id].seconds = 600;
  });
  const request = `${name}님 존댓말 좀 줄이고 반말로 말해줘`,
    preference = '말투: 반말을 조금 더 자주 쓰는 편이 편해짐';
  const change = {
    personaId: id,
    preference,
    nickname: '',
    reason: '스트리머 요청을 들음',
    evidence: request,
    sociabilityDelta: 0,
  };
  s.autonomy.observeStyleScene(request, [id], { sourceId: 'heard-1', capturedAt: now });
  s.autonomy.evolve([change], request, [id], { sourceId: 'heard-1', capturedAt: now });
  assert.equal(s.audience.data.members[id].speechStyleAdaptation.stage, 'heard');
  assert.deepEqual(s.audience.data.members[id].preferences || [], []);
  const same = structuredClone(s.audience.data.members[id].speechStyleAdaptation);
  s.autonomy.observeStyleScene(request, [id], { sourceId: 'heard-1', capturedAt: now });
  assert.deepEqual(s.audience.data.members[id].speechStyleAdaptation, same);
  now += 1000;
  const scene = '오늘은 게임 얘기를 좀 해보자';
  s.autonomy.observeStyleScene(scene, [id], { sourceId: 'scene-2', capturedAt: now });
  s.autonomy.evolve(
    [{ ...change, evidence: scene, reason: '직접 시험해 보고 싶음' }],
    scene,
    [id],
    { sourceId: 'scene-2', capturedAt: now },
  );
  assert.equal(s.audience.data.members[id].speechStyleAdaptation.stage, 'considering');
  assert.equal(s.audience.data.members[id].speechStyleAdaptation.trialRequested, true);
  now += 1000;
  s.addMessage(id, '나 이쪽이 더 편하네');
  assert.equal(s.audience.data.members[id].speechStyleAdaptation.stage, 'trial');
  const trialId = s.audience.data.members[id].speechStyleAdaptation.trialMessageId;
  s.autonomy.evolve([{ ...change, evidence: scene, reason: '직접 해 보니 편해짐' }], scene, [id], {
    sourceId: 'scene-2',
    capturedAt: now,
  });
  assert.equal(s.audience.data.members[id].speechStyleAdaptation.stage, 'trial');
  s.world.change((d) => {
    d.audience.members[id].seconds = 1200;
    d.audience.members[id].sessions = 2;
  });
  now += 1000;
  const reaction = '아까 말한 게 자연스럽네';
  s.autonomy.observeStyleScene(reaction, [id], { sourceId: 'scene-3', capturedAt: now });
  s.autonomy.evolve(
    [{ ...change, evidence: reaction, reason: '직접 말해 보고 내 방식에 맞는다고 느껴짐' }],
    reaction,
    [id],
    { sourceId: 'scene-3', capturedAt: now },
  );
  const adopted = s.audience.data.members[id].speechStyleAdaptation;
  assert.equal(adopted.stage, 'adopted');
  assert.equal(adopted.trialMessageId, trialId);
  assert.equal(s.audience.data.members[id].speechStyleOverlay.register, 'casual');
  assert.deepEqual(s.audience.data.members[id].preferences || [], []);
  await service.close();
  const reloaded = await open(t, { dataDir: service.dataDir });
  assert.deepEqual(reloaded.studio.audience.data.members[id].speechStyleAdaptation, adopted);
  assert.equal(reloaded.studio.audience.data.members[id].speechStyleOverlay.register, 'casual');
  const person = reloaded.studio.settings.personas.find((p) => p.id === id);
  const context = liveViewerContext(
    { members: [{ id, joinedAt: reloaded.studio.audience.data.members[id].joinedAt }] },
    [person],
    [],
    null,
    { privateMembers: reloaded.studio.audience.data.members, now },
  );
  assert.equal(context.viewerContext[id].speechStyle.register, 'casual');
  assert.equal(context.audience.members[0].speechStyleAdaptation, undefined);
  assert.equal(context.audience.members[0].speechStyleOverlay, undefined);
  reloaded.studio.autonomy.observeStyleScene(`${person.name}님 이번에는 존댓말로 말해줘`, [id], {
    sourceId: 'new-request',
    capturedAt: now + 2000,
  });
  assert.equal(reloaded.studio.audience.data.members[id].speechStyleAdaptation.stage, 'heard');
  assert.equal(reloaded.studio.audience.data.members[id].speechStyleOverlay.register, 'casual');
});

test('a witnessed stop request blocks the next offending viewer reply before publication', async (t) => {
  const service = await open(t);
  start(service);
  const { personaId: id } = await meet(service),
    s = service.studio;
  const name = s.settings.personas.find((p) => p.id === id).name,
    at = s.now();
  s.autonomy.observeStyleScene(`${name}님 비꼬는 말투는 불편하니 그만해`, [id], {
    sourceId: 'boundary-1',
    capturedAt: at,
  });
  assert.equal(s.autonomy.violatesStyleBoundary(id, '또 놀리려고 했지'), true);
  s.queue = [];
  s.accept(
    result({
      messages: [{ personaId: id, text: '또 놀리려고 했지', kind: 'chat', spoiler: false }],
    }).observation,
    at,
    false,
    'live',
    {
      visits: new Map([[id, s.audience.data.members[id].joinedAt]]),
      banterAllowed: { [id]: true },
    },
  );
  assert.equal(s.queue.length, 0);
  s.accept(
    result({ messages: [{ personaId: id, text: '알겠습니다.', kind: 'chat', spoiler: false }] })
      .observation,
    at,
    false,
    'live',
    {
      visits: new Map([[id, s.audience.data.members[id].joinedAt]]),
      banterAllowed: { [id]: false },
    },
  );
  assert.equal(s.queue.length, 1);
});

test('quiet personal favorites produce spectator clips without donation, forbid manual routes and respect recording consent', async (t) => {
  const service = await open(t);
  start(service);
  const { personaId: id } = await meet(service),
    s = service.studio;
  s.stop();
  s.configure({ ...s.settings, autoHighlights: true });
  s.audience.random = () => 0;
  s.start();
  const at = s.now();
  const msg = s.addMessage('streamer', '조용히 식물 이야기를 하자', 'streamer');
  const observation = result({
    clipPicks: [
      {
        personaId: id,
        title: '작은 화분 이야기',
        reason: '같은 취미라 좋아서',
        signature: '작은 화분',
      },
    ],
  }).observation;
  const clips = s.clipFeatures.spectatorPicks(observation, {
    speech: msg.text,
    witnesses: [id],
    capturedAt: at,
  });
  assert.equal(clips.length, 1);
  assert.equal(clips[0].creator.id, id);
  assert.equal(clips[0].source, 'spectator');
  assert.equal(s.economy.data.balance, 150);
  assert.equal(
    s.clipFeatures.spectatorPicks(observation, {
      speech: msg.text,
      witnesses: [id],
      capturedAt: at,
    }).length,
    0,
  );
  assert.equal((await req(service, 'clips', {})).status, 409);
  for (const path of ['director/clip', 'seasons/clip', 'director/start', 'seasons/resume'])
    assert.equal((await req(service, path, {})).status, 410);
  s.settings.autoHighlights = false;
  assert.equal(
    s.clipFeatures.spectatorPicks(observation, {
      speech: msg.text,
      witnesses: [id],
      capturedAt: at,
    }).length,
    0,
  );
  const response = await fetch(
    service.url +
      `/api/clips/${clips[0].id}/video?startedAt=${at - 1000}&endedAt=${at + 1000}&hasAudio=true`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + service.accessToken,
        'X-Backseat-Client': 'studio',
        'Content-Type': 'video/webm',
      },
      body: Buffer.alloc(120),
    },
  );
  assert.equal(response.status, 409);
  assert.equal(s.clips.get(clips[0].id).video, false);
});

test('ordinary conversation follows the streamer and backs off after a refusal without mode controls', () => {
  let now = 1000000;
  const ambient = new Ambient({ now: () => now });
  assert.equal(ambient.context('오늘은 처음으로 보스를 해냈어요').id, 'celebration');
  assert.equal(ambient.context('그만하고 쉬고 싶어').quiet, true);
  assert.equal(ambient.snapshot().active, null);
  now += 1000;
  assert.equal(ambient.context('게임 계속 볼게').quiet, true);
  now += 600000;
  assert.equal(ambient.context('만약에 내가 마법사라면?').id, 'improv');
  now += 300000;
  assert.equal(ambient.context('화면 봐요'), null);
});

test('failed stop persistence still stops and aborts the broadcast with a visible storage error', async (t) => {
  const service = await open(t);
  start(service);
  const s = service.studio,
    save = s.world.save,
    controller = s.controller;
  s.world.save = () => {
    throw Error('stop disk full');
  };
  s.autonomy.seconds += 1;
  try {
    s.stop();
    assert.equal(s.running, false);
    assert.equal(controller.signal.aborted, true);
    assert.equal(s.busy, false);
    assert.match(s.lastError, /stop disk full/);
    assert.deepEqual(s.audience.presence, {});
  } finally {
    s.world.save = save;
  }
});

test('streamer notes are excluded from every model payload, including off-stream member maps', async (t) => {
  const service = await open(t),
    p = new OpenAIProvider();
  for (const members of [
    [{ id: 'a', note: 'DO_NOT_SEND_NOTE', memories: ['공개 발언'] }],
    { a: { note: 'DO_NOT_SEND_NOTE', memories: ['공개 발언'] } },
  ]) {
    const payload = p.payload({
      settings: service.studio.settings,
      history: [],
      speech: '',
      offStream: true,
      audience: { members },
    });
    const serialized = JSON.stringify(payload);
    assert.ok(!serialized.includes('DO_NOT_SEND_NOTE'));
    assert.ok(serialized.includes('공개 발언'));
  }
});

test('failed opening write never leaves a half-started broadcast', async (t) => {
  const service = await open(t),
    s = service.studio;
  s.configure({ ...s.settings, mode: 'live' });
  const save = s.world.save;
  s.world.save = () => {
    throw Error('opening disk full');
  };
  try {
    assert.throws(() => s.start(), /disk full/);
    assert.equal(s.running, false);
    assert.equal(s.sessionId, null);
    assert.equal(s.controller.signal.aborted, true);
    assert.deepEqual(s.audience.presence, {});
  } finally {
    s.world.save = save;
  }
});

test('removing a viewer during a paid answer refunds instead of publishing a stale identity', async (t) => {
  const service = await open(t);
  start(service);
  const { personaId } = await meet(service),
    s = service.studio;
  s.economy.change((d) => {
    d.balance = 100;
  });
  let release;
  s.provider.react = async () => new Promise((r) => (release = r));
  const pending = s.special.generate({
    kind: 'interview',
    personaId,
    question: '어떤 취향이 좋아요?',
    requestId: randomUUID(),
  });
  await waitFor(() => !!release);
  s.autonomy.remove(personaId);
  release(result({ messages: [{ personaId, text: '뒤늦은 대답', kind: 'chat', spoiler: false }] }));
  await assert.rejects(pending, /제거/);
  assert.equal(s.economy.data.balance, 100);
  assert.ok(!s.messages.some((m) => m.text === '뒤늦은 대답'));
});
