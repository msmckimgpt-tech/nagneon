import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startServer } from '../server/index.js';
import { digest } from '../server/social-runtime-state.js';
import { socialContentHash } from '../server/social-content.js';
import { attachDecision } from './helpers/jev.js';
import { CultureLearning } from '../server/culture/learning.js';
import { Studio } from '../server/studio.js';
import { defaults } from '../shared/defaults.js';
const person = (id) => ({
  id,
  name: id,
  personality: '퍼즐을 좋아하는 차분한 주민',
  values: '발견',
  expertise: 0.4,
  sociability: 0.6,
  color: '#8bcdd2',
  role: 'viewer',
  enabled: true,
  system: false,
});
const response = (extra) => ({
  observation: {
    game: '일상',
    scene: '',
    confidence: 0.7,
    excitement: 0.2,
    messages: [],
    ...extra,
  },
});
async function fixture(t, options = {}) {
  const generated = [];
  const service = await startServer({
    port: 0,
    persist: false,
    localSpeech: false,
    provider: {
      status: () => ({ configured: true }),
      react: async (a) => {
        generated.push(a);
        return response(
          a.special.kind === 'social-read'
            ? { communityVotes: [{ personaId: 'reader', recommended: false }] }
            : {
                messages: [
                  {
                    personaId: 'author',
                    text: '퍼즐의 숨은 길 이야기',
                    kind: 'chat',
                    spoiler: false,
                  },
                ],
              },
        );
      },
    },
  });
  const s = service.studio;
  clearInterval(s.timer);
  s.settings.mode = 'live';
  s.settings.title = 'PRIVATE TITLE';
  s.settings.streamer = 'PRIVATE NAME';
  s.ai.update({ background: true });
  s.tutorialReady = () => true;
  const d = attachDecision(s, options);
  t.after(async () => {
    await d.decision.close();
    await service.close();
  });
  const author = {
      id: randomUUID(),
      communityId: 'guide',
      persona: person('author'),
      joinedAt: s.now() - 10000,
      admitted: true,
    },
    reader = {
      id: randomUUID(),
      communityId: 'guide',
      persona: person('reader'),
      joinedAt: s.now() - 10000,
      admitted: false,
    };
  s.world.change((w) => {
    w.settings.mode = 'live';
    w.settings.personas.push(author.persona);
    w.audience.members.author = {
      sessions: 1,
      seconds: 0,
      recognized: 0,
      affinity: 0.2,
      peers: {},
      memories: [],
    };
    w.socialWorld.residents.push(author, reader);
  });
  const id = randomUUID();
  s.journal.record(
    {
      id,
      personaId: 'streamer',
      name: '방장',
      text: '공개된 퍼즐 발언',
      kind: 'streamer',
      time: s.now() - 1000,
    },
    { sessionId: randomUUID(), witnesses: ['author'] },
  );
  const source = s.social.source(
    s.journal.data.entries.find((e) => e.id === id),
    'author',
  );
  const run = async (target) => {
    const op = {
      controller: new AbortController(),
      epoch: s.epoch,
      social: target.kind.startsWith('social-'),
    };
    s.communityActivity.active = op;
    op.promise = s.communityActivity.run(target, op);
    try {
      return await op.promise;
    } finally {
      s.communityActivity.active = null;
      s.busy = false;
    }
  };
  await run({
    kind: 'social-mention',
    id: author.id,
    viewer: author.persona,
    revision: digest('mention'),
    raw: { residentId: author.id, communityId: 'guide', topicId: 'practice', source },
  });
  const thread = s.social.data().threads[0],
    target = {
      kind: 'social-read',
      id: thread.id,
      viewer: reader.persona,
      revision: digest(thread),
      raw: {
        residentId: reader.id,
        communityId: 'guide',
        topicId: 'practice',
        source,
        threadId: thread.id,
        threadHash: socialContentHash(thread),
      },
    };
  return { ...d, s, generated, run, target, source };
}
for (const [mode, score, wantCalls, wantInterest] of [
  ['assist', 0.99, 1, true],
  ['assist', 0.5, 2, false],
  ['shadow', 0.99, 2, false],
])
  test(`social-read ${mode}/${score} uses actual delivery with conservative fallback`, async (t) => {
    const f = await fixture(t, { mode, judge: () => ({ interested: score }) });
    await f.run(f.target);
    assert.equal(f.generated.length, wantCalls);
    assert.equal(f.calls.length, 1);
    assert.equal(f.s.social.data().receipts.length, 1);
    assert.equal(f.s.social.data().receipts[0].interested, wantInterest);
    assert.ok(f.calls[0].state.delivered.text.includes('퍼즐'));
    assert.doesNotMatch(JSON.stringify(f.calls), /PRIVATE TITLE|PRIVATE NAME|공개된 퍼즐 발언/);
    assert.ok(f.s.communityActivity.data().attempts.length >= 2);
  });
for (const stale of ['source', 'liveSequence'])
  test(`social-read ignores late ${stale} changes and creates no receipt`, async (t) => {
    let release, entered;
    const ready = new Promise((r) => (entered = r));
    const f = await fixture(t, {
      judge: async () => {
        entered();
        await new Promise((r) => (release = r));
        return { interested: 0.99 };
      },
    });
    const pending = f.run(f.target);
    await Promise.race([
      ready,
      new Promise((_, reject) => setTimeout(() => reject(Error('missing hook')), 1000)),
    ]);
    if (stale === 'source') f.s.journal.forget([f.source.id]);
    else f.s.social.startLive();
    release();
    if (stale === 'source') await assert.rejects(pending, { name: 'AbortError' });
    else await pending;
    assert.equal(f.s.social.data().receipts.length, 0);
    assert.equal(f.generated.length, 1);
  });
test('culture strong irrelevance skips generation without refreshing old analysis', async (t) => {
  let generated = 0;
  const s = new Studio({
    settings: { ...defaults, mode: 'live', cultureDomains: ['https://culture.example.org'] },
    provider: {
      status: () => ({ configured: true }),
      react: async () => {
        generated++;
        return response({ cultureAnalysis: { tendencies: '', patterns: [] } });
      },
    },
  });
  clearInterval(s.timer);
  s.ai.update({ background: true, features: { culture: true } });
  const f = attachDecision(s, { judge: () => ({ document_0: 0.01 }) });
  t.after(async () => {
    await f.decision.close();
    await s.close();
  });
  const c = new CultureLearning(s, {
    collect: async () => ({
      digest: 'new',
      documents: [{ url: 'https://culture.example.org/', text: '로그인 및 광고' }],
    }),
  });
  c.sync();
  const item = c.data.sources[0];
  await c.run({ controller: new AbortController(), epoch: s.epoch }, item);
  assert.equal(f.calls.length, 1);
  assert.equal(generated, 0);
  assert.equal(c.data.sources[0].analyzedAt, 0);
  assert.equal(c.data.sources[0].digest, 'new');
});
test('selected community affinity stays inside persisted attempt and stale candidates never read', async (t) => {
  const f = await fixture(t, { judge: () => ({ interested: 0.01 }) });
  const clip = f.s.clips.create({
    title: '합성 퍼즐 클립',
    game: '합성',
    scene: '퍼즐',
    participants: [{ id: 'author', name: 'author' }],
    messages: [],
    sessionId: randomUUID(),
  });
  const candidate = f.s.communityActivity
    .candidates(f.s.now())
    .find((c) => c.kind === 'clip' && c.id === clip.id);
  assert.ok(candidate);
  const before = f.generated.length;
  await f.run(candidate);
  assert.equal(f.calls.length, 1);
  assert.equal(f.generated.length, before);
  assert.equal(f.s.clips.get(clip.id).comments.length, 0);
  assert.equal(f.s.clips.data[0].activityReads, undefined);
  assert.ok(f.s.communityActivity.data().attempts.some((a) => a.id === clip.id));
});
test('no eligible community candidates performs no decision calls', async (t) => {
  const s = new Studio({
    settings: { ...defaults, mode: 'live' },
    provider: { status: () => ({ configured: true }) },
  });
  clearInterval(s.timer);
  let now = 1000000;
  s.now = () => now;
  s.ai.update({ background: true });
  const f = attachDecision(s);
  t.after(async () => {
    await f.decision.close();
    await s.close();
  });
  s.communityActivity.lastInput = 0;
  s.lastRequest = 0;
  s.communityActivity.wakeAt = 0;
  assert.deepEqual(s.communityActivity.candidates(now), []);
  s.communityActivity.tick();
  assert.equal(f.calls.length, 0);
});
