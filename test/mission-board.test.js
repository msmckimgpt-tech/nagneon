import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  MissionBoard,
  MissionData,
  emptyMissions,
  safeMissionReason,
} from '../server/mission-board.js';
import { JsonStore } from '../server/storage.js';
import { missionRules } from '../shared/mission-rules.js';

function fixture(save = () => {}) {
  let at = 10000000;
  const people = ['alpha', 'beta', 'gamma', 'delta'].map((id) => ({ id, name: id }));
  const ctx = {
    running: true,
    sessionId: randomUUID(),
    gameId: 'test-game',
    gameName: '합성 게임',
    gaming: true,
    allowAI: true,
    people,
    witnesses: people.map((p) => ({ personaId: p.id, joinedAt: at })),
    blockedWords: [],
  };
  const b = new MissionBoard(emptyMissions(), save, () => at);
  const command = (values) => b.execute({ requestId: randomUUID(), ...values }, ctx);
  const propose = (values = {}) =>
    command({
      kind: 'propose',
      personaId: 'alpha',
      templateId: 'one-attempt',
      target: 40,
      amount: 20,
      reason: '다른 방식의 도전이 궁금해서',
      ...values,
    }).missionId;
  const joinMission = (missionId, values = {}) =>
    command({
      kind: 'join',
      missionId,
      personaId: 'beta',
      amount: 20,
      reason: '긴장되는 한 판을 같이 보고 싶어서',
      ...values,
    });
  return { b, ctx, command, propose, joinMission, advance: (ms) => (at += ms) };
}
test('funding holds an independent budget; over-target pledge accepts only the remainder and never implies acceptance', () => {
  const { b, propose, joinMission } = fixture();
  const missionId = propose({ target: 30 });
  assert.equal(b.data.wallets.alpha.balance, 80);
  assert.equal(b.data.campaigns[0].status, 'funding');
  const result = joinMission(missionId, { amount: 40 });
  assert.equal(result.amount, 10);
  assert.equal(b.data.wallets.beta.balance, 90);
  assert.equal(b.data.campaigns[0].status, 'ready');
  const publicState = b.snapshot([{ id: 'alpha' }, { id: 'beta' }]);
  assert.equal(publicState.campaigns[0].total, 30);
  assert.equal(publicState.campaigns[0].supporterCount, 2);
  assert.equal(b.data.ledger.filter((e) => e.kind === 'consume').length, 0);
  assert.equal(Object.hasOwn(b.data, 'balance'), false);
});
test('attempt and success templates expose different promises; only user confirmation consumes each contribution once', () => {
  for (const templateId of ['one-attempt', 'boss-clear']) {
    const { b, propose, joinMission, command, ctx } = fixture();
    const missionId = propose({ templateId });
    joinMission(missionId);
    command({ kind: 'accept', missionId });
    command({
      kind: 'suggest-complete',
      missionId,
      personaId: 'gamma',
      reason: '공유 화면의 완료 후보',
    });
    assert.equal(b.data.campaigns[0].status, 'review');
    assert.equal(b.data.wallets.alpha.consumed, 0);
    const request = { requestId: randomUUID(), kind: 'confirm', missionId, completed: true };
    b.execute(request, ctx);
    const committed = structuredClone(b.data);
    assert.equal(b.execute(request, ctx).duplicate, true);
    assert.deepEqual(b.data, committed);
    assert.equal(b.data.wallets.alpha.consumed, 20);
    assert.equal(b.data.wallets.beta.consumed, 20);
    assert.equal(b.data.ledger.filter((e) => e.kind === 'consume').length, 2);
    assert.throws(() => command({ kind: 'confirm', missionId, completed: true }), /유효한 미션/);
    const title = b.snapshot().campaigns[0].template;
    assert.equal(title.type, templateId === 'one-attempt' ? 'performance' : 'success');
    assert.match(
      title.condition,
      templateId === 'one-attempt' ? /실패해도/ : /실패하면 완료가 아닙니다/,
    );
  }
});
test('same ID with changed content is rejected across phases and a restarted receipt never allocates again', () => {
  const { b, ctx } = fixture();
  const request = {
    requestId: randomUUID(),
    kind: 'propose',
    personaId: 'alpha',
    templateId: 'no-items',
    target: 40,
    amount: 20,
    reason: '아이템을 아껴보는 장면이 궁금해서',
  };
  const first = b.execute(request, ctx);
  assert.equal(b.execute(request, ctx).duplicate, true);
  assert.throws(() => b.execute({ ...request, amount: 21 }, ctx), /같은 요청 ID/);
  const restored = new MissionBoard(b.data);
  assert.equal(restored.data.campaigns[0].status, 'cancelled');
  assert.equal(
    restored.execute(request, { ...ctx, sessionId: randomUUID() }).missionId,
    first.missionId,
  );
  assert.equal(restored.data.campaigns.length, 1);
  assert.equal(restored.data.wallets.alpha.balance, 100);
});
test('refusal returns holds and blocks the same terms even under another proposer or a larger goal', () => {
  const { b, propose, command, advance } = fixture();
  const missionId = propose();
  command({ kind: 'reject', missionId });
  advance(600000);
  assert.equal(b.data.wallets.alpha.balance, 100);
  assert.throws(() => propose({ personaId: 'beta', target: 200 }), /제안을 허용하지/);
  command({ kind: 'reopen', templateId: 'one-attempt' });
  assert.ok(propose({ personaId: 'beta' }));
});
test('conditions cannot silently inherit funds or opinions: revision returns all holds and creates a new unpledged version', () => {
  const { b, propose, joinMission, command } = fixture();
  const missionId = propose();
  joinMission(missionId);
  command({
    kind: 'oppose',
    missionId,
    personaId: 'gamma',
    reason: '평소 플레이를 더 보고 싶어서',
  });
  const next = command({ kind: 'revise', missionId, templateId: 'boss-clear', target: 60 });
  assert.notEqual(next.missionId, missionId);
  assert.equal(b.data.campaigns[0].status, 'revised');
  const m = b.data.campaigns[1];
  assert.equal(m.rootId, missionId);
  assert.equal(m.version, 2);
  assert.equal(m.contributions.length, 0);
  assert.equal(m.opponents.length, 0);
  assert.equal(b.data.wallets.alpha.balance, 100);
  assert.equal(b.data.wallets.beta.balance, 100);
  assert.throws(() => joinMission(missionId), /유효한 미션/);
  assert.throws(() => command({ kind: 'accept', missionId: m.id }), /목표를 모은/);
});
test('funding, unaccepted ready, performing and delayed confirmation expire with full release at their exact deadlines', () => {
  for (const phase of ['funding', 'ready', 'accepted', 'review']) {
    const { b, ctx, propose, joinMission, command, advance } = fixture();
    const missionId = propose();
    if (phase !== 'funding') joinMission(missionId);
    if (['accepted', 'review'].includes(phase)) command({ kind: 'accept', missionId });
    if (phase === 'review')
      command({
        kind: 'suggest-complete',
        missionId,
        personaId: 'gamma',
        reason: '불확실한 완료 후보',
      });
    advance(
      phase === 'accepted'
        ? missionRules.performanceMs
        : phase === 'review'
          ? missionRules.reviewMs
          : missionRules.fundingMs,
    );
    assert.throws(() => joinMission(missionId), /유효한 미션/);
    assert.equal(b.data.campaigns[0].status, 'expired');
    assert.equal(b.data.wallets.alpha.balance, 100);
    assert.equal(b.expire(ctx.sessionId, ctx.gameId), false);
    assert.equal(b.data.ledger.filter((e) => e.kind === 'consume').length, 0);
  }
});

test('revision cannot duplicate another active condition or release the original holds on a rejected edit', () => {
  const { b, propose, command, advance } = fixture();
  const first = propose({ templateId: 'one-attempt' });
  advance(missionRules.globalCooldownMs);
  propose({ personaId: 'beta', templateId: 'boss-clear' });
  const before = structuredClone(b.data);
  assert.throws(
    () => command({ kind: 'revise', missionId: first, templateId: 'boss-clear', target: 60 }),
    /다른 미션/,
  );
  assert.deepEqual(b.data, before);
  assert.equal(b.data.wallets.alpha.balance, 80);
});
test('stop and restart release exactly once; consumed settlements survive without any refund', () => {
  const { b, propose, joinMission, command } = fixture();
  const missionId = propose();
  joinMission(missionId);
  command({ kind: 'accept', missionId });
  const pending = structuredClone(b.data);
  const restored = new MissionBoard(pending);
  const recovered = structuredClone(restored.data);
  restored.stop();
  assert.deepEqual(restored.data, recovered);
  assert.deepEqual(new MissionBoard(recovered).data, recovered);
  command({ kind: 'confirm', missionId, completed: true });
  const completed = structuredClone(b.data);
  b.stop();
  assert.deepEqual(b.data, completed);
  assert.deepEqual(new MissionBoard(completed).data, completed);
});
test('nonfulfillment, cancellation and global stop return all contributions and never consume', () => {
  for (const outcome of ['cancel', 'failed', 'stop']) {
    const { b, propose, joinMission, command } = fixture();
    const missionId = propose();
    joinMission(missionId);
    command({ kind: 'accept', missionId });
    if (outcome === 'failed') command({ kind: 'confirm', missionId, completed: false });
    else if (outcome === 'stop') command({ kind: 'enabled', enabled: false });
    else command({ kind: 'cancel', missionId });
    assert.equal(b.data.wallets.alpha.balance, 100);
    assert.equal(b.data.wallets.beta.balance, 100);
    assert.equal(b.data.ledger.filter((e) => e.kind === 'consume').length, 0);
  }
});
test('proposal gates, invalid amounts, unavailable people and dangerous reasons leave no wallet or negative balance', () => {
  for (const values of [
    { amount: -1 },
    { amount: 41 },
    { target: 201 },
    { personaId: '__proto__' },
    { personaId: 'missing' },
    { reason: '현금 결제해서 아이템 구매해요' },
    { templateId: 'outside-task' },
  ]) {
    const { b, propose } = fixture();
    assert.throws(() => propose(values));
    assert.deepEqual(b.data, emptyMissions());
  }
  for (const gate of ['running', 'gaming', 'allowAI']) {
    const { b, ctx, propose } = fixture();
    ctx[gate] = false;
    assert.throws(() => propose());
    assert.deepEqual(b.data, emptyMissions());
  }
  const { b, propose, command, joinMission } = fixture();
  const missionId = propose({ amount: 40 });
  assert.throws(() => joinMission(missionId, { personaId: 'alpha' }), /이미 참여/);
  assert.throws(() => command({ kind: 'accept', missionId: randomUUID() }), /유효한 미션/);
  assert.equal(safeMissionReason('개인정보와 주소를 공개하자'), false);
  assert.equal(b.data.wallets.alpha.balance, 60);
});
test('cooldowns and active cap bound proposals without requiring roles or fabricated supporters', () => {
  const { b, propose, command, advance } = fixture();
  propose({ target: 20 });
  assert.throws(() => propose({ templateId: 'no-items', personaId: 'beta' }), /잠시 쉬어/);
  advance(120000);
  propose({ templateId: 'no-items', personaId: 'beta', target: 20 });
  assert.throws(() => propose({ templateId: 'boss-clear', personaId: 'gamma' }), /진행 중인 미션/);
  assert.equal(b.snapshot().campaigns.length, 2);
  assert.equal(
    b.snapshot().campaigns.every((m) => m.supporterCount === 1),
    true,
  );
  command({ kind: 'accept', missionId: b.data.campaigns[0].id });
  assert.throws(
    () =>
      command({
        kind: 'revise',
        missionId: b.data.campaigns[0].id,
        templateId: 'boss-clear',
        target: 20,
      }),
    /수락 전/,
  );
});
test('recharge accounts for holds; refund cannot exceed the wallet cap or mint points under clock rollback', () => {
  const { b, propose, command, advance } = fixture();
  const missionId = propose({ target: 20 });
  command({ kind: 'accept', missionId });
  advance(599999);
  assert.equal(b.snapshot([{ id: 'alpha' }]).wallets.alpha.balance, 80);
  command({ kind: 'cancel', missionId });
  assert.equal(b.data.wallets.alpha.balance, 100);
  advance(-400000);
  assert.equal(b.snapshot([{ id: 'alpha' }]).wallets.alpha.balance, 100);
  assert.equal(b.data.wallets.alpha.issued, 100);
  MissionData.parse(b.data);
});
test('wallet, status, receipt and on-disk JSON roll back together when rename fails, then one retry commits', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'nagneon-mission-atomic-'));
  t.after(() => rmSync(dir, { recursive: true }));
  let fail = false;
  const store = new JsonStore(join(dir, 'missions.json'), {
    validate: (d) => MissionData.parse(d),
    initial: emptyMissions,
    fs: {
      renameSync: (...args) => {
        if (fail && args[0].endsWith('.tmp')) throw Error('합성 rename 실패');
        return renameSync(...args);
      },
    },
  });
  store.save(emptyMissions());
  const f = fixture((d) => store.save(d));
  const request = {
    requestId: randomUUID(),
    kind: 'propose',
    personaId: 'alpha',
    templateId: 'one-attempt',
    target: 40,
    amount: 20,
    reason: '합성 원자성 확인',
  };
  const before = readFileSync(store.file, 'utf8');
  fail = true;
  assert.throws(() => f.b.execute(request, f.ctx), /미션 원장 저장/);
  assert.deepEqual(f.b.data, emptyMissions());
  assert.equal(readFileSync(store.file, 'utf8'), before);
  fail = false;
  f.b.execute(request, f.ctx);
  assert.equal(f.b.execute(request, f.ctx).duplicate, true);
  assert.equal(store.load().ledger.filter((e) => e.kind === 'hold').length, 1);
  fail = true;
  assert.throws(() => f.b.stop(), /미션 원장 저장/);
  assert.equal(f.b.data.campaigns[0].status, 'funding');
  assert.throws(() => new MissionBoard(f.b.data, (d) => store.save(d)), /미션 원장 저장/);
  fail = false;
  const restarted = new MissionBoard(store.load(), (d) => store.save(d));
  assert.equal(restarted.data.wallets.alpha.balance, 100);
  assert.equal(restarted.data.ledger.filter((e) => e.kind === 'release').length, 1);
});
test('corrupted negative balances, fake consume, mismatched holds, future schema and duplicate IDs fail validation', () => {
  const { b, propose } = fixture();
  propose();
  for (const mutate of [
    (d) => (d.wallets.alpha.balance = -1),
    (d) => (d.wallets.alpha.balance += 1),
    (d) => (d.wallets.alpha.consumed += 1),
    (d) => (d.campaigns[0].contributions[0].amount -= 1),
    (d) => (d.campaigns[0].status = 'completed'),
    (d) => (d.version = 2),
    (d) => d.ledger.push(d.ledger[0]),
  ]) {
    const corrupt = structuredClone(b.data);
    mutate(corrupt);
    assert.equal(MissionData.safeParse(corrupt).success, false);
  }
});
test('read snapshots are detached and witness memory excludes donors who did not observe a scene', () => {
  const { b, propose, joinMission, command, ctx } = fixture();
  const missionId = propose();
  joinMission(missionId);
  command({ kind: 'accept', missionId });
  b.observeEvidence({
    requestId: randomUUID(),
    capturedAt: b.now(),
    scene: '한 번의 도전을 끝내는 합성 화면',
    witnesses: [{ personaId: 'gamma', joinedAt: b.now() }],
    sessionId: ctx.sessionId,
    gameId: ctx.gameId,
  });
  command({ kind: 'confirm', missionId, completed: true });
  assert.equal(b.viewerContext('alpha').scenes.length, 0);
  assert.equal(b.viewerContext('gamma').scenes.length, 1);
  assert.equal(b.viewerContext('outsider').events.length, 0);
  assert.ok(b.viewerContext('alpha').events.some((e) => e.source === 'user-confirmation'));
  const before = structuredClone(b.data),
    state = b.snapshot([{ id: 'alpha' }]);
  state.campaigns[0].contributions[0].amount = 1;
  state.wallets.alpha.balance = 0;
  const condition = state.templates[0].condition;
  state.templates[0].condition = '임의 조건';
  state.campaigns[0].template.condition = '몰래 바꾼 조건';
  assert.equal(b.snapshot().templates[0].condition, condition);
  assert.notEqual(b.snapshot().campaigns[0].template.condition, '몰래 바꾼 조건');
  assert.deepEqual(b.data, before);
});
