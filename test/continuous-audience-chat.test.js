import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Studio } from '../server/studio.js';
import { Audience } from '../server/audience.js';
import { Settings } from '../server/schema.js';
import { defaults } from '../shared/defaults.js';

const observation = (messages = []) => ({ game: 'Synthetic', scene: 'paused menu', confidence: .9, excitement: .1, messages });
const chat = (personaId, text) => ({ personaId, text, kind: 'chat', spoiler: false });
function fixture(t, { enabled = true, react = async () => ({ observation: observation() }) } = {}) {
  let now = 100000;
  const requests = [];
  const s = new Studio({ settings: { ...defaults, mode: 'live', category: 'just-chatting', continuousAudienceChat: enabled, lurkRatio: 0, intervalSeconds: 5, slowModeSeconds: 0 },
    now: () => now, random: () => .5, audience: new Audience(undefined, () => {}, () => .5),
    provider: { status: () => ({ configured: true }), react: (args, signal) => { requests.push(args); return react(args, signal); } } });
  clearInterval(s.timer); s.start(); t.after(() => s.close());
  return { s, requests, advance: ms => { now += ms; }, lurk: () => { for (const p of s.settings.personas) if (p.id !== s.settings.managerId) s.audience.setPresence(p.id, 'lurking', now); } };
}

test('continuous chat is opt-in and survives settings validation without altering legacy defaults', () => {
  assert.equal(Settings.parse(defaults).continuousAudienceChat, false);
  assert.equal(Settings.parse({ ...defaults, continuousAudienceChat: true }).continuousAudienceChat, true);
  assert.throws(() => Settings.parse({ ...defaults, continuousAudienceChat: 'true' }));
});

test('without a screen or streamer speech, two quiet viewers can converse repeatedly with bounded calls and no fabricated rewards', async t => {
  let turn = 0;
  const f = fixture(t, { react: async args => ({ observation: observation(args.ambient?.continuous ?
    [chat('momo', ++turn === 1 ? '팝콘도둑님 저는 작은 퍼즐이 좋아요' : '천천히 맞추는 쪽도 나름 재밌어요'), chat('gg', turn === 1 ? '저는 탐험하는 쪽에 한 표요' : '길을 고르는 재미도 있죠')] : []) }) });
  f.lurk(); await f.s.react({});
  const before = structuredClone(f.s.observation), balance = structuredClone(f.s.economy.data);
  f.advance(15000); await f.s.react({}); assert.equal(f.requests.length, 1);
  f.advance(10000); await f.s.react({});
  assert.equal(f.requests.at(-1).ambient.continuous, true);
  assert.equal(f.requests.at(-1).speech, '');
  assert.equal(f.s.queue.length, 2);
  assert.ok(f.s.queue.every(m => m.chatDriven));
  f.advance(4000); f.s.pump(); f.s.pump(); assert.equal(f.s.messages.filter(m => m.kind === 'chat').length, 2);
  f.advance(10000); await f.s.react({}); assert.equal(f.requests.length, 2);
  f.advance(15000); await f.s.react({});
  assert.equal(f.requests.length, 3);
  assert.ok(f.requests.at(-1).viewerContext.momo.chatHistory.some(m => m.text === '저는 탐험하는 쪽에 한 표요'));
  assert.equal(f.s.queue.length, 2);
  assert.deepEqual(f.s.observation, before); assert.deepEqual(f.s.economy.data, balance);
  assert.equal(f.s.audience.presence.momo, 'lurking');
});

test('continuous chat starts without a screen, but remains off for a legacy silent session', async t => {
  for (const enabled of [false, true]) {
    const f = fixture(t, { enabled }); await f.s.react({}); f.advance(25000); await f.s.react({});
    assert.equal(f.requests.length, enabled ? 2 : 1);
    assert.equal(f.requests.at(-1).ambient?.continuous === true, enabled);
  }
});

test('continuous chat preserves fresh frames and immediately yields to new streamer speech', async t => {
  const f = fixture(t), sourceId = randomUUID();
  const video = image => ({ sessionId: f.s.sessionId, sourceId, frames: [{ image, at: f.s.now() }] });
  await f.s.react({ video: video('start') }); f.advance(25000); await f.s.react({ video: video('new-event') });
  assert.equal(f.requests.at(-1).ambient.continuous, true);
  assert.equal(f.requests.at(-1).image, 'new-event');
  f.advance(25000); await f.s.react({ video: video('next'), speech: '잠깐 이 장면 봐요' });
  assert.equal(f.requests.at(-1).speech, '잠깐 이 장면 봐요');
  assert.notEqual(f.requests.at(-1).ambient?.id, 'quiet-company');
});

test('quiet requests, AI pause and ambient disable suppress continuous attempts', async t => {
  for (const mode of ['quiet', 'paused', 'disabled']) {
    const f = fixture(t); await f.s.react({ image: 'same' });
    if (mode === 'quiet') { f.advance(5000); await f.s.react({ image: 'same', speech: '잠깐 조용히 봐주세요' }); }
    else f.s.ai.update(mode === 'paused' ? { paused: true } : { features: { ambient: false } });
    const count = f.requests.length; f.advance(120000); await f.s.react({ image: 'same' });
    assert.ok(f.requests.slice(count).every(r => !r.ambient?.continuous), mode);
  }
});

test('no absent audience or stopped session can generate continuous chat', async t => {
  const f = fixture(t); await f.s.react({ image: 'same' });
  for (const p of f.s.settings.personas) if (p.id !== f.s.settings.managerId) f.s.audience.setPresence(p.id, 'away', f.s.now());
  f.advance(25000); await f.s.react({ image: 'same' }); assert.ok(f.requests.every(r => !r.ambient?.continuous));
  f.s.stop(); await assert.rejects(() => f.s.react({ image: 'same' }), /방송을 먼저/);
});

test('continuous opportunities are not starved by a long screen interval or a prior conversation topic', async t => {
  const f = fixture(t); f.s.settings.intervalSeconds = 120;
  await f.s.react({ image: 'same', speech: '요즘 취향 이야기도 해봐요' });
  f.advance(25000); await f.s.react({ image: 'same' });
  assert.equal(f.requests.length, 2); assert.equal(f.requests.at(-1).ambient.continuous, true);
});

test('a slow empty model response has a cooldown after completion instead of immediately calling again', async t => {
  const f = fixture(t, { react: async args => {
    if (args.ambient?.continuous) f.advance(40000);
    return { observation: observation() };
  } });
  await f.s.react({}); f.advance(25000); await f.s.react({});
  assert.equal(f.requests.length, 2);
  f.advance(5000); await f.s.react({}); assert.equal(f.requests.length, 2);
  f.advance(20000); await f.s.react({}); assert.equal(f.requests.length, 3);
});

test('stopping during a continuous response drops all pending output', async t => {
  let finish;
  const f = fixture(t, { react: args => args.ambient?.continuous ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ observation: observation() }) });
  await f.s.react({ image: 'same' }); f.advance(25000);
  const pending = f.s.react({ image: 'same' });
  assert.equal(typeof finish, 'function'); f.s.stop();
  finish({ observation: observation([chat('momo', '멈춘 뒤에는 보이면 안 되는 문장')]) }); await pending;
  assert.equal(f.s.queue.length, 0); assert.ok(!f.s.messages.some(m => m.text.includes('멈춘 뒤에는')));
});

test('an explicit chat stop keeps continuous chat quiet until an explicit resume', t => {
  for (const speech of ['채팅 멈춰', '말하지 마', '잠깐 조용히 봐주세요']) {
    const f = fixture(t); f.s.ambient.context(speech); f.advance(700000);
    assert.equal(f.s.ambient.snapshot().quiet, true, speech);
    assert.equal(f.s.ambient.nextConversationAt(), null);
    f.s.ambient.context('다시 같이 얘기해요');
    assert.equal(f.s.ambient.snapshot().quiet, false);
  }
});

test('continuous chat keeps a freshly sampled unchanged photo visible and drops it after disconnect', async t => {
  const f = fixture(t), sourceId = randomUUID();
  const video = () => ({ sessionId: f.s.sessionId, sourceId, frames: [{ image: 'synthetic-static-photo', at: f.s.now() }] });
  await f.s.react({ video: video() });
  f.advance(25000); await f.s.react({ video: video() });
  assert.equal(f.requests.length, 2);
  const request = f.requests.at(-1);
  assert.equal(request.ambient.continuous, true);
  assert.equal(request.ambient.watching, true);
  assert.equal(request.image, 'synthetic-static-photo');
  assert.equal(request.frames.at(-1).image, 'synthetic-static-photo');
  assert.equal(request.screenTimeline.through, f.s.now());
  f.advance(25000); await f.s.react({});
  f.advance(25000); await f.s.react({});
  assert.equal(f.requests.at(-1).image, undefined);
  assert.deepEqual(f.requests.at(-1).frames, []);
  assert.equal(f.requests.at(-1).ambient.idle, true);
});
