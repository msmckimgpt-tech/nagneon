import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Audience } from '../server/audience.js';
import { PresenceMemory, presenceDisposition, departureRates } from '../server/audience-presence.js';
import { AudienceData } from '../server/data-schema.js';
import { sameViewingVisit, retainPresentReactions } from '../server/live-presence.js';
import { Settings } from '../server/schema.js';
import { defaults } from '../shared/defaults.js';
import { startServer } from '../server/index.js';
import { seedMetAudience } from './helpers/met-audience.js';

const blank = () => ({ sessions: 2, seconds: 600, recognized: 3, affinity: .6, peers: {}, memories: ['합성 기억'], note: '합성 메모', aliases: [], origin: { key: 'browse', label: '합성 경로', firstSeenAt: 1 } });
function fixture({ id = 'visitor', save = () => {}, lurkRatio = 0 } = {}) {
  const manager = defaults.personas.find(p => p.id === defaults.managerId);
  const viewer = { ...defaults.personas.find(p => p.id !== defaults.managerId), id, name: '합성 관객' };
  const cfg = Settings.parse({ ...defaults, mode: 'live', lurkRatio, personas: [manager, viewer] });
  let now = 100000;
  const a = new Audience({ members: { [manager.id]: blank(), [id]: blank() }, lore: [], posts: [] }, save, () => 0);
  a.autonomous = true; a.start(cfg, now);
  const advance = (seconds = 1) => { now += seconds * 1000; return a.tick(cfg, now); };
  advance();
  return { a, cfg, viewer, id, advance, at: () => now, state: () => a.presenceRuntime.members[id], member: () => a.data.members[id] };
}
function forceDeparture(f, seconds = 121) {
  f.state().target = 0; f.state().seconds = seconds;
  f.advance(); assert.equal(f.a.presence[f.id], 'away');
}
function forceReturn(f) {
  f.state().done = false; f.state().returnTarget = 0;
  f.member().presenceMemory.cooldownSeconds = 0;
  f.advance(); assert.ok(['active', 'lurking'].includes(f.a.presence[f.id]));
}

test('identity dispositions survive nickname/model/session changes; arrival motives differ', () => {
  const f = fixture(), first = presenceDisposition(f.viewer, f.member());
  assert.deepEqual(first, presenceDisposition({ ...f.viewer, name: '다른 별명', model: 'other' }, f.member()));
  assert.notDeepEqual(first, presenceDisposition({ ...f.viewer, id: 'other' }, f.member()));
  assert.equal(presenceDisposition(f.viewer, { origin: { key: 'guide' } }).motive, 'information');
  assert.equal(presenceDisposition(f.viewer, { origin: { key: 'fan' } }).motive, 'company');
});

test('grace protects a new encounter and lurking remains the same witnessed visit', () => {
  const f = fixture({ lurkRatio: .9 }), joinedAt = f.member().joinedAt, affinity = f.member().affinity;
  f.state().target = 0;
  for (let i = 1; i < 120; i++) f.advance();
  assert.equal(f.a.presence[f.id], 'lurking');
  assert.equal(f.member().joinedAt, joinedAt);
  assert.equal(f.member().affinity, affinity);
  assert.equal(f.member().seconds, 720);
  assert.ok(sameViewingVisit(f.a, f.id, joinedAt));
});

test('affinity and peer presence can moderate voluntary leaving but cannot erase outside schedules', () => {
  const traits = presenceDisposition({ id: 'visitor', sociability: .6 }, { origin: { key: 'guide' } });
  const alone = departureRates(traits, { seconds: 3000 });
  const connected = departureRates(traits, { seconds: 3000, affinity: 1, peers: 1 });
  assert.equal(alone['personal-schedule'], connected['personal-schedule']);
  assert.ok(alone['personal-schedule'] > 0);
  assert.ok(connected.rest < alone.rest && connected.exploring < alone.exploring);
  assert.deepEqual(departureRates(traits, { seconds: 30 }), {});
});

test('natural departure retains personality, relationships, notes and memories', () => {
  const f = fixture(), before = structuredClone(f.member()), persona = structuredClone(f.viewer);
  forceDeparture(f);
  for (const key of ['sessions', 'affinity', 'recognized', 'peers', 'memories', 'note', 'aliases', 'origin']) assert.deepEqual(f.member()[key], before[key], key);
  assert.deepEqual(f.viewer, persona);
  assert.equal(f.member().presenceMemory.departures, 1);
  assert.equal(f.member().presenceMemory.lastDeparture.at, f.at());
  assert.ok(f.member().presenceMemory.cooldownSeconds >= 120);
});

test('cooldown prevents immediate return and same-broadcast return is a new interval, not a new session', () => {
  const f = fixture(), sessions = f.member().sessions, oldVisit = f.member().joinedAt;
  forceDeparture(f);
  f.state().done = false; f.state().returnTarget = 0;
  f.member().presenceMemory.cooldownSeconds = 30;
  for (let i = 0; i < 29; i++) f.advance();
  assert.equal(f.a.presence[f.id], 'away');
  const seconds = f.member().seconds;
  f.advance();
  assert.ok(['active', 'lurking'].includes(f.a.presence[f.id]));
  assert.equal(f.member().sessions, sessions);
  assert.equal(f.member().seconds, seconds);
  assert.ok(f.member().joinedAt > oldVisit);
  assert.equal(f.member().presenceMemory.visits, 2);
});

test('finishing a broadcast visit is not overridden by a return lottery', () => {
  const f = fixture(); forceDeparture(f);
  f.state().done = true; f.state().returnTarget = 0; f.member().presenceMemory.cooldownSeconds = 0;
  for (let i = 0; i < 60; i++) f.advance();
  assert.equal(f.a.presence[f.id], 'away');
});

test('suspend, duplicate ticks and clock rollback do not add viewing, cooldown or churn', () => {
  const f = fixture(); forceDeparture(f);
  const before = structuredClone(f.member()), runtime = structuredClone(f.state());
  f.a.tick(f.cfg, f.at()); f.a.tick(f.cfg, f.at() - 10000);
  assert.deepEqual(f.member(), before); assert.deepEqual(f.state(), runtime);
  f.advance(3600);
  assert.deepEqual(f.member(), before); assert.deepEqual(f.state(), runtime);
});

test('one-second and five-second ticks approximate the same visit duration, not fivefold churn', () => {
  const left = fixture(), right = fixture(); let l, r;
  for (let i = 0; i < 18000 && !l; i++) { left.advance(); if (left.a.presence[left.id] === 'away') l = left.at(); }
  for (let i = 0; i < 3600 && !r; i++) { right.advance(5); if (right.a.presence[right.id] === 'away') r = right.at(); }
  assert.ok(l && r); assert.ok(Math.abs(l - r) <= 15000, `${l} vs ${r}`);
});

test('presence save failure does not publish a departure or mutate stored relationship data', () => {
  let fail = false;
  const f = fixture({ save: () => { if (fail) throw Error('synthetic disk full'); } });
  f.state().target = 0; f.state().seconds = 121;
  const before = structuredClone(f.a.data), presence = structuredClone(f.a.presence), runtime = structuredClone(f.a.presenceRuntime), revision = f.a.presenceRevision;
  fail = true; assert.throws(() => f.advance(), /synthetic disk full/);
  assert.deepEqual(f.a.data, before); assert.deepEqual(f.a.presence, presence);
  assert.deepEqual(f.a.presenceRuntime, runtime); assert.equal(f.a.presenceRevision, revision);
});

test('autonomous start save failure restores data, presence and runtime state', () => {
  const manager = defaults.personas.find(p => p.id === defaults.managerId);
  const viewer = { ...defaults.personas.find(p => p.id !== defaults.managerId), id: 'start-failure', name: '시작 실패 관객' };
  const cfg = Settings.parse({ ...defaults, mode: 'live', lurkRatio: 0, personas: [manager, viewer] });
  const input = { members: { [manager.id]: blank(), [viewer.id]: blank() }, lore: [], posts: [] };
  const a = new Audience(structuredClone(input), () => { throw Error('synthetic start save failure'); }, () => 0);
  a.autonomous = true;
  assert.throws(() => a.start(cfg, 100000), /synthetic start save failure/);
  assert.deepEqual(a.data, input);
  assert.deepEqual(a.presence, {});
  assert.equal(a.presenceRuntime, null);
});

test('versioned memory accepts legacy members but rejects corrupt or future state', () => {
  const f = fixture();
  assert.ok(AudienceData.safeParse(f.a.data).success);
  const legacy = structuredClone(f.a.data); delete legacy.members[f.id].presenceMemory;
  assert.ok(AudienceData.safeParse(legacy).success);
  for (const bad of [{ version: 2 }, { cooldownSeconds: -1 }, { cooldownSeconds: Infinity }, { surprise: true }]) {
    const value = { ...f.member().presenceMemory, ...bad };
    assert.ok(!PresenceMemory.safeParse(value).success);
    const data = structuredClone(f.a.data); data.members[f.id].presenceMemory = value;
    assert.ok(!AudienceData.safeParse(data).success);
  }
});

test('restart preserves history and remaining cooldown; stopping never fabricates a grievance', () => {
  const f = fixture(); forceDeparture(f); const before = structuredClone(f.member().presenceMemory);
  f.a.stop(); assert.deepEqual(f.member().presenceMemory, before);
  assert.deepEqual(f.a.tick(f.cfg, f.at() + 10000), []);
  const fresh = new Audience(structuredClone(f.a.data), () => {}, () => 0); fresh.autonomous = true;
  fresh.start(f.cfg, f.at() + 86400000);
  assert.equal(fresh.presence[f.id], 'away');
  assert.deepEqual(fresh.data.members[f.id].presenceMemory, before);
});

test('calling an absent viewer or criticizing a style does not summon or punish them', () => {
  const f = fixture(); forceDeparture(f); const before = structuredClone(f.member());
  f.a.context(f.cfg, '합성 관객님, 말투 바꿔주세요. 지금 다시 오세요.');
  assert.equal(f.a.presence[f.id], 'away'); assert.deepEqual(f.member(), before);
});

test('private departure motives, timers and plans do not leak into shared model context', () => {
  const f = fixture(); forceDeparture(f);
  const context = JSON.stringify(f.a.context(f.cfg));
  assert.ok(!context.includes('presenceMemory'));
  assert.ok(!context.includes('cooldownSeconds'));
  assert.ok(!context.includes('lastDeparture'));
});

test('signals require a recent accepted witness of this visit, not stale or secondhand input', () => {
  const f = fixture(), signal = { game: 'Game A', confidence: .9, excitement: 1, positiveMoment: { positive: true, supporters: [f.id] } };
  const apply = (witnesses, capturedAt, now = f.at()) => f.a.observePresence(signal, witnesses, capturedAt, now, { visual: true });
  apply([], f.at()); assert.equal(f.state().lastGame, '');
  apply([f.id], f.member().joinedAt - 1); assert.equal(f.state().lastGame, '');
  apply([f.id], f.at(), f.at() + 50000); assert.equal(f.state().lastGame, '');
  apply([f.id], f.at()); assert.equal(f.state().lastGame, 'Game A'); assert.ok(f.state().satisfiedUntil > 0);
  const before = structuredClone(f.state()); apply([f.id], f.at()); assert.deepEqual(f.state(), before);
  forceDeparture(f); forceReturn(f);
  apply([f.id], before.lastSignalAt); assert.equal(f.state().lastGame, '');
});

test('stale high excitement decays and cannot permanently agitate viewers', () => {
  const f = fixture();
  f.a.observePresence({ excitement: 1 }, [f.id], f.at(), f.at());
  for (let i = 0; i < 40; i++) f.advance();
  const stimulated = f.state().stimulation; assert.ok(stimulated > .2);
  f.state().target = Infinity;
  for (let i = 0; i < 180; i++) f.advance();
  assert.ok(f.state().stimulation < stimulated / 3);
});

test('a returned viewer cannot emit queued social actions of an earlier visit', () => {
  const f = fixture(), visits = new Map([[f.id, f.member().joinedAt]]);
  forceDeparture(f); forceReturn(f);
  const kept = retainPresentReactions({ game: 'Test', scene: '합성', confidence: .9, excitement: .3,
    messages: [{ personaId: f.id, text: '합성 반응', kind: 'chat', spoiler: false }],
    positiveMoment: { positive: true, impact: 1, reason: '합성', signature: 'synthetic', supporters: [f.id], donations: [{ personaId: f.id, message: '합성', anonymous: false }] },
    clipPicks: [{ personaId: f.id, title: '합성', reason: '합성', signature: 'synthetic' }] }, visits, f.a);
  assert.equal(kept.messages.length, 0); assert.equal(kept.clipPicks.length, 0);
  assert.equal(kept.positiveMoment.positive, false); assert.equal(kept.positiveMoment.donations.length, 0);
});

test('same-clock leave/re-entry still invalidates earlier viewing tokens', () => {
  const f = fixture(), at = f.member().joinedAt;
  f.a.setPresence(f.id, 'away', at); f.a.setPresence(f.id, 'active', at);
  assert.ok(f.member().joinedAt > at); assert.equal(sameViewingVisit(f.a, f.id, at), false);
});

test('disabled and retired viewers do not return; operational manager stays available', () => {
  const f = fixture(); f.cfg.personas.find(p => p.id === f.id).enabled = false;
  f.advance(); assert.equal(f.a.presence[f.id], 'away'); assert.equal(f.a.presenceRuntime.members[f.id], undefined);
  f.cfg.personas = f.cfg.personas.filter(p => p.id !== f.id);
  for (let i = 0; i < 100; i++) f.advance();
  assert.equal(f.a.presence[f.id], 'away'); assert.ok(f.member().memories.length);
  assert.equal(f.a.presence[f.cfg.managerId], 'active');
});

test('newly admitted viewers receive only actual post-entry watch time and no second charge', () => {
  const f = fixture(), id = 'late-arrival';
  f.cfg.personas.push({ ...f.viewer, id });
  f.a.data.members[id] = { ...blank(), sessions: 1, seconds: 0, joinedAt: f.at() + 500 };
  f.a.presence[id] = 'active';
  f.advance(); assert.equal(f.a.data.members[id].seconds, .5);
  assert.equal(f.a.data.members[id].sessions, 1); assert.equal(f.a.data.members[id].presenceMemory.visits, 1);
});

test('World-backed runtime persists departures, publishes SSE state, preserves points and hides motives', async t => {
  await mkdir('artifacts', { recursive: true }); const dataDir = await mkdtemp(join(resolve('artifacts'), 'presence-world-'));
  const provider = { status: () => ({ configured: true }), react: async () => ({ observation: { game: 'Test', scene: '합성', confidence: .9, excitement: .3, messages: [] } }) };
  let service = await startServer({ port: 0, dataDir, provider, localSpeech: false });
  t.after(() => service.close()); const s = service.studio; clearInterval(s.timer); seedMetAudience(s);
  let now = 100000; s.now = () => now; s.audience.random = () => 0;
  s.configure({ ...s.settings, mode: 'live', category: 'just-chatting', lurkRatio: 0 }); s.start(); s.autonomy.nextCheck = Infinity;
  now += 1000; s.tickAudience();
  const id = s.settings.personas.find(p => !p.system && p.id !== s.settings.managerId).id;
  const balance = s.economy.data.balance, roster = structuredClone(s.settings.personas), sessions = s.audience.data.members[id].sessions;
  const state = s.audience.presenceRuntime.members[id]; state.seconds = 121; state.target = 0;
  let updates = 0; s.on('state', () => updates++); now += 1000; s.tickAudience();
  assert.equal(s.audience.presence[id], 'away'); assert.ok(updates > 0); assert.equal(s.messages.length, 0);
  assert.equal(s.economy.data.balance, balance); assert.deepEqual(s.settings.personas, roster);
  assert.equal(s.audience.data.members[id].sessions, sessions);
  assert.ok(!JSON.stringify(s.world.publicAudience()).includes('lastDeparture'));
  const saved = structuredClone(s.audience.data.members[id].presenceMemory);
  await service.close(); service = await startServer({ port: 0, dataDir, provider, localSpeech: false });
  assert.deepEqual(service.studio.audience.data.members[id].presenceMemory, saved);
  assert.equal(service.studio.economy.data.balance, balance);
});
