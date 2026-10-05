import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Knowledge } from '../server/knowledge.js';
import { KnowledgeData } from '../server/data-schema.js';
import { Audience } from '../server/audience.js';
import { Studio } from '../server/studio.js';
import { Settings } from '../server/schema.js';
import { defaults } from '../shared/defaults.js';
import { startServer } from '../server/index.js';
import { seedMetAudience } from './helpers/met-audience.js';

const game = 'Synthetic visit game';
const observation = () => ({
  game,
  scene: '합성 게임 장면',
  confidence: 0.9,
  excitement: 0.2,
  messages: [],
});
const visits = (newAt = 100000) =>
  new Map([
    ['momo', 100000],
    ['new', newAt],
  ]);
const people = ['momo', 'new'];
const watch = (knowledge, at, visitMap) =>
  knowledge.observe(game, `합성 장면 ${at}`, at, 0.5, people, visitMap);
const settings = () =>
  Settings.parse({
    ...defaults,
    mode: 'live',
    category: 'gaming',
    gameId: 'auto',
    lurkRatio: 0,
    slowModeSeconds: 0,
    intervalSeconds: 5,
    personas: defaults.personas.filter((p) => ['momo', 'new', 'luna'].includes(p.id)),
  });

function fixture(t, react) {
  let now = 100000;
  const inputs = [];
  const studio = new Studio({
    settings: settings(),
    now: () => now,
    random: () => 0.5,
    audience: new Audience(
      undefined,
      () => {},
      () => 0.5,
    ),
    provider: {
      status: () => ({ configured: true }),
      react: async (args) => {
        inputs.push(args);
        return react ? react(args) : { observation: observation() };
      },
    },
  });
  clearInterval(studio.timer);
  studio.start();
  t.after(() => studio.close());
  return { studio, inputs, advance: (ms) => (now += ms) };
}

function returnViewer(studio) {
  studio.moderate('ban', 'new');
  studio.moderate('unban', 'new');
}

test('a returning identity keeps its prior knowledge without gaining the interval across its absence', () => {
  const knowledge = new Knowledge();
  watch(knowledge, 100000, visits());
  watch(knowledge, 104000, visits());
  watch(knowledge, 110000, visits(109000));
  let entry = knowledge.get(game);
  assert.equal(entry.watched.new, 4);
  assert.equal(entry.watched.momo, 10);
  assert.equal(entry.seconds, 10, 'the game itself remained on screen');
  assert.ok(
    entry.observations[0].witnesses.includes('new'),
    'actual earlier experience is retained',
  );
  watch(knowledge, 116000, visits(109000));
  entry = knowledge.get(game);
  assert.equal(entry.watched.new, 10, 'the new continuous visit can learn normally');
  assert.equal(entry.watched.momo, 16);
});

test('captured visit snapshots survive caller mutation and unknown continuity never becomes proof', () => {
  const knowledge = new Knowledge(),
    captured = visits();
  watch(knowledge, 100000, captured);
  captured.set('new', 100500);
  watch(knowledge, 104000, visits());
  assert.equal(knowledge.get(game).watched.new, 4);
  for (const unavailable of [
    new Map(),
    new Map([['new', undefined]]),
    new Map([['new', null]]),
    new Map([['new', NaN]]),
    new Map([['new', Infinity]]),
    new Map([['new', 999999999]]),
    { new: 100000 },
  ]) {
    const current = new Knowledge();
    watch(current, 100000, unavailable);
    watch(current, 104000, unavailable);
    assert.equal(
      current.get(game).watched.new ?? 0,
      0,
      'invalid or missing captured epochs cannot grant watch time',
    );
  }
  const mixed = new Knowledge();
  watch(mixed, 100000);
  watch(mixed, 104000, visits());
  assert.equal(
    mixed.get(game).watched.new ?? 0,
    0,
    'tracked and untracked snapshots cannot bridge',
  );
  watch(mixed, 110000);
  assert.equal(mixed.get(game).watched.new ?? 0, 0);
});

test('failed saves do not advance a visit snapshot or award duplicate time on retry', () => {
  let fail = false,
    stored;
  const knowledge = new Knowledge({}, (data) => {
    if (fail) throw Error('synthetic disk full');
    stored = KnowledgeData.parse(structuredClone(data));
  });
  watch(knowledge, 100000, visits());
  const original = structuredClone(knowledge.lastSeen);
  fail = true;
  assert.throws(() => watch(knowledge, 104000, visits(103000)), /synthetic disk full/);
  assert.deepEqual(knowledge.lastSeen, original);
  assert.equal(knowledge.get(game).seconds, 0);
  fail = false;
  watch(knowledge, 104000, visits(103000));
  assert.equal(stored[knowledge.key(game)].watched.new ?? 0, 0);
  watch(knowledge, 110000, visits(103000));
  assert.equal(knowledge.get(game).watched.new, 6);
  assert.equal(knowledge.get(game).watched.momo, 10);
});

test('untracked standalone callers retain their existing accounting and restart resets continuity', () => {
  const knowledge = new Knowledge();
  watch(knowledge, 100000);
  watch(knowledge, 104000);
  assert.equal(knowledge.get(game).watched.new, 4);
  const restarted = new Knowledge(KnowledgeData.parse(structuredClone(knowledge.entries)));
  watch(restarted, 10000000, visits(10000000));
  assert.equal(restarted.get(game).watched.new, 4);
  assert.equal(restarted.get(game).observations.length, 3);
});

test('Studio passes visit continuity into both knowledge and the next audience model packet', async (t) => {
  const { studio, inputs, advance } = fixture(t);
  await studio.react({ image: 'synthetic-first', speech: '함께 봐요' });
  advance(6000);
  await studio.react({ image: 'synthetic-second', speech: '계속 보고 있어요' });
  advance(5000);
  returnViewer(studio);
  advance(1000);
  await studio.react({ image: 'synthetic-return', speech: '다시 함께 봐요' });
  assert.equal(studio.knowledge.get(game).watched.new, 6);
  assert.equal(studio.knowledge.get(game).watched.momo, 12);
  advance(6000);
  await studio.react({ image: 'synthetic-after-return', speech: '이제 이어 볼게요' });
  assert.equal(
    inputs[3].viewerKnowledge.new.watchedSeconds,
    6,
    'a provider cannot receive invented personal familiarity',
  );
  assert.equal(studio.knowledge.get(game).watched.new, 12);
});

test('late analysis keeps the captured earlier visit rather than substituting the current visit', async (t) => {
  let release,
    calls = 0;
  const { studio, advance } = fixture(t, () =>
    ++calls === 2 ? new Promise((r) => (release = r)) : { observation: observation() },
  );
  await studio.react({ image: 'synthetic-first', speech: '함께 봐요' });
  advance(6000);
  const pending = studio.react({
    image: 'synthetic-before-leaving',
    speech: '이 장면도 함께 봐요',
  });
  assert.ok(release);
  advance(2000);
  returnViewer(studio);
  advance(1000);
  release({ observation: observation() });
  await pending;
  assert.equal(
    studio.knowledge.get(game).watched.new,
    6,
    'the captured interval was truly witnessed before departure',
  );
  advance(6000);
  await studio.react({ image: 'synthetic-return', speech: '다음 장면도 함께 봐요' });
  assert.equal(
    studio.knowledge.get(game).watched.new,
    6,
    'late completion cannot bridge the two visits',
  );
  assert.equal(studio.knowledge.get(game).watched.momo, 15);
});

test('quiet witnesses gain continuous game knowledge even when excluded from speaking personas', async (t) => {
  const { studio, inputs, advance } = fixture(t);
  studio.audience.presence.momo = 'lurking';
  studio.audience.presence.new = 'lurking';
  studio.settings.personas.find((p) => p.id === 'momo').sociability = 1;
  studio.settings.personas.find((p) => p.id === 'new').sociability = 0;
  await studio.react({ image: 'synthetic-first' });
  assert.ok(!inputs[0].settings.personas.some((p) => p.id === 'new'));
  advance(6000);
  await studio.react({ image: 'synthetic-second' });
  assert.equal(studio.audience.presence.new, 'lurking');
  assert.equal(studio.knowledge.get(game).watched.new, 6);
});

test('identical-frame bookkeeping resumes only within the new visit without an extra model call', async (t) => {
  const { studio, inputs, advance } = fixture(t);
  const frame = { image: 'synthetic-still' };
  await studio.react(frame);
  advance(6000);
  assert.equal((await studio.react(frame)).skipped, 'unchanged-input');
  assert.equal(studio.knowledge.get(game).watched.new, 6);
  advance(5000);
  returnViewer(studio);
  advance(1000);
  await studio.react(frame);
  assert.equal(studio.knowledge.get(game).watched.new, 6);
  advance(6000);
  assert.equal((await studio.react(frame)).skipped, 'unchanged-input');
  assert.equal(studio.knowledge.get(game).watched.new, 12);
  assert.equal(studio.knowledge.get(game).watched.momo, 18);
  assert.equal(inputs.length, 2);
});

test('authenticated loopback reactions persist only continuous personal watch time across a disk restart', async (t) => {
  await mkdir('artifacts', { recursive: true });
  const dataDir = await mkdtemp(join(resolve('artifacts'), 'knowledge-visits-http-'));
  let now = 100000;
  const provider = {
    status: () => ({ configured: true }),
    react: async () => ({ observation: observation() }),
  };
  let service = await startServer({ port: 0, dataDir, provider, localSpeech: false });
  t.after(() => service?.close());
  const setup = (fresh = false) => {
    const studio = service.studio;
    clearInterval(studio.timer);
    studio.now = () => now;
    studio.audience.random = () => 0;
    if (fresh) seedMetAudience(studio);
    studio.configure({
      ...studio.settings,
      mode: 'live',
      category: 'gaming',
      gameId: 'auto',
      lurkRatio: 0,
      intervalSeconds: 5,
    });
    studio.start();
    studio.audience.random = () => 0.5;
    studio.autonomy.nextCheck = Infinity;
    return studio;
  };
  const post = async (path, body) => {
    const response = await fetch(`${service.url}/api/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${service.accessToken}`,
        'Content-Type': 'application/json',
        'X-Backseat-Client': 'studio',
      },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 200, await response.text());
  };
  const studio = setup(true);
  const frame = { image: 'data:image/png;base64,AAAA', speech: '합성 게임을 함께 봐요' };
  await post('react', frame);
  now += 6000;
  await post('react', { ...frame, speech: '합성 게임을 계속 봐요' });
  now += 5000;
  await post('moderate', { action: 'ban', id: 'new' });
  await post('moderate', { action: 'unban', id: 'new' });
  now += 1000;
  await post('react', { ...frame, speech: '합성 게임을 다시 봐요' });
  assert.equal(studio.knowledge.get(game).watched.new, 6);
  const witnessedScenes = structuredClone(studio.knowledge.get(game).observations);
  await service.close();
  service = await startServer({ port: 0, dataDir, provider, localSpeech: false });
  now += 100000;
  const restarted = setup();
  await post('react', { ...frame, speech: '새 방송의 첫 장면이에요' });
  assert.equal(
    restarted.knowledge.get(game).watched.new,
    6,
    'offline and cross-visit gaps were never persisted as personal viewing',
  );
  assert.equal(restarted.knowledge.get(game).watched.momo, 12);
  assert.deepEqual(
    restarted.knowledge.get(game).observations,
    witnessedScenes,
    'deduplicated, legitimately witnessed scenes survive unchanged',
  );
});
