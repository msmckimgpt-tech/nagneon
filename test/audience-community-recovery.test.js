import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/index.js';
import { digest } from '../server/social-runtime-state.js';
import { StateStream } from '../server/state-stream.js';
import { applyStatePatch } from '../shared/state-patch.js';

const birth = {
  name: '합성관객',
  personality: '퍼즐에서 다른 길을 찾아보는 관객',
  values: '자기 속도로 발견하기',
  sociability: 0.6,
  expertise: 0.3,
};
const output = (messages = [], arrival = null) => ({
  observation: {
    game: '퍼즐',
    scene: '합성 장면',
    confidence: 0.8,
    excitement: 0.2,
    messages,
    arrival,
  },
  usage: { total_tokens: 1 },
});
async function fixture(t, react = async () => output([], birth), dataDir) {
  let now = Date.now(),
    calls = 0;
  const service = await startServer({
    port: 0,
    persist: !!dataDir,
    dataDir,
    localSpeech: false,
    now: () => now,
    provider: {
      status: () => ({ configured: true }),
      react: async (args, signal) => {
        calls++;
        return react(args, signal);
      },
    },
  });
  const s = service.studio;
  // Freeze after server initialization so constructor deadlines do not sit
  // ahead of this fixture's clock when startup takes more than a second.
  now = s.now();
  clearInterval(s.timer);
  s.now = () => now;
  s.configure({ ...s.settings, mode: 'live', lurkRatio: 0 });
  s.social.preferences({ enabled: false });
  t.after(() => service.close());
  const settle = async () => {
    const until = Date.now() + 5000;
    while (s.autonomy.pending) {
      assert.ok(Date.now() < until, 'synthetic arrival did not settle');
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
  return {
    s,
    service,
    settle,
    advance: (ms) => (now += ms),
    get calls() {
      return calls;
    },
  };
}

test('busy minute boundaries defer a natural arrival to the next idle slot without losing it', async (t) => {
  const f = await fixture(t),
    { s } = f;
  s.start();
  s.random = () => 0;
  // Sustained screen/speech work is busy at every old minute boundary, but
  // each response has an idle slot two seconds later. Use actual pump ticks.
  for (let second = 1; second <= 660; second++) {
    f.advance(1000);
    s.busy = second % 60 <= 1;
    s.pump();
    await f.settle();
  }
  assert.equal(f.calls, 1, 'natural discovery must reach an idle model slot');
  assert.equal(s.settings.personas.length, 2);
  assert.equal(s.economy.data.balance, 200, 'natural arrival is free');
  assert.equal(Object.values(s.world.data.autonomy.receipts)[0].source.path, 'broadcast');
});

test('a declined lottery or failed arrival still consumes one check and cannot retry every pump', async (t) => {
  const f = await fixture(t, async () => {
      throw Error('synthetic model failure');
    }),
    { s } = f;
  s.start();
  s.autonomy.seconds = 600;
  f.advance(60000);
  s.random = () => 0.9;
  s.pump();
  assert.equal(f.calls, 0);
  s.random = () => 0;
  for (let i = 0; i < 59; i++) {
    f.advance(1000);
    s.pump();
  }
  assert.equal(f.calls, 0, 'a declined lottery cannot be rerolled in the same minute');
  f.advance(1000);
  s.pump();
  await f.settle();
  assert.equal(f.calls, 1);
  for (let i = 0; i < 59; i++) {
    f.advance(1000);
    s.pump();
  }
  assert.equal(f.calls, 1, 'failure must not generate an immediate retry storm');
  assert.equal(s.economy.data.balance, 200);
  assert.equal(s.settings.personas.length, 1);
});

test('a deferred check creates no suspend backlog and respects discovery policy and admission cooldown', async (t) => {
  const f = await fixture(t),
    { s } = f;
  s.start();
  s.random = () => 0;
  s.autonomy.seconds = 600;
  f.advance(60000);
  s.busy = true;
  s.pump();
  f.advance(4 * 3600000);
  s.busy = false;
  s.ai.update({ features: { discovery: false } });
  s.pump();
  assert.equal(f.calls, 0);
  s.ai.update({ features: { discovery: true } });
  f.advance(1000);
  s.pump();
  await f.settle();
  assert.equal(f.calls, 1, 'wake-up creates one opportunity, no catch-up burst');
  for (let i = 0; i < 299; i++) {
    f.advance(1000);
    s.pump();
  }
  assert.equal(f.calls, 1, 'successful admission keeps the five-minute cooldown');
});

for (const silent of [false, true])
  test(`ending a live session persists a ${silent ? 'silent review receipt' : 'witnessed review and state update'} across restart`, async (t) => {
    const dataDir = mkdtempSync(join(tmpdir(), 'nagneon-community-recovery-'));
    const f = await fixture(
        t,
        async (args) => {
          assert.equal(args.special.kind, 'community-review');
          assert.equal(args.offStream, true);
          assert.equal(args.history.length, 3);
          assert.ok(!JSON.stringify(args).includes('목격하지 않은 합성 발언'));
          return output(
            silent
              ? []
              : [
                  {
                    personaId: 'reviewer',
                    text: '그 퍼즐 옆길 아직도 궁금하네 ㅋㅋ',
                    kind: 'chat',
                    spoiler: false,
                  },
                ],
          );
        },
        dataDir,
      ),
      { s } = f;
    s.world.change((w) => {
      w.settings.personas.push({
        ...birth,
        id: 'reviewer',
        color: '#8bcdd2',
        role: 'viewer',
        enabled: true,
        system: false,
      });
      w.audience.members.reviewer = {
        sessions: 1,
        seconds: 60,
        recognized: 0,
        affinity: 0.3,
        peers: {},
        memories: [],
      };
    });
    s.ai.update({ background: true });
    s.start();
    const sessionId = s.sessionId;
    for (let i = 0; i < 4; i++)
      s.journal.record(
        {
          id: randomUUID(),
          personaId: 'streamer',
          name: '합성방장',
          text: i === 3 ? '목격하지 않은 합성 발언' : `합성 퍼즐 대화 ${i}`,
          time: s.now(),
          kind: 'streamer',
        },
        { sessionId, witnesses: i === 3 ? [] : ['reviewer'] },
      );
    assert.equal(
      s.communityActivity.candidates(s.now()).filter((c) => c.kind === 'review').length,
      0,
    );
    s.stop();
    const wire = new StateStream();
    let client = JSON.parse(wire.encode(s.state()).split('data: ')[1]);
    let update;
    s.on('state', (state) => {
      const frame = wire.encode(state);
      if (frame) {
        const data = JSON.parse(frame.split('data: ')[1]);
        client = frame.startsWith('event: state-patch') ? applyStatePatch(client, data) : data;
      }
      if (state.audience.posts.length) update = state;
    });
    f.advance(61000);
    s.pump();
    await s.communityActivity.active?.promise;
    assert.equal(f.calls, 1);
    assert.equal(s.audience.data.communityActivity.reviews.length, 1);
    assert.equal(s.audience.data.posts.length, silent ? 0 : 1);
    assert.equal(s.ai.snapshot().recent[0].activityResult, silent ? 'no-post' : 'post-created');
    assert.deepEqual(client.audience.posts, JSON.parse(JSON.stringify(s.state().audience.posts)));
    assert.equal(client.ai.recent[0].activityResult, silent ? 'no-post' : 'post-created');
    assert.equal(client.ai.recent[0].application, 'accepted');
    if (!silent) assert.equal(update.audience.posts[0].category, '후기');
    await f.service.close();
    const next = await fixture(
      t,
      async () => {
        assert.fail('a persisted review must not regenerate');
      },
      dataDir,
    );
    assert.equal(next.s.audience.data.communityActivity.reviews[0].sessionId, sessionId);
    assert.equal(next.s.audience.data.posts.length, silent ? 0 : 1);
    next.s.ai.update({ background: true });
    next.advance(3600001);
    next.s.pump();
    await next.s.communityActivity.active?.promise;
    assert.equal(next.calls, 0);
  });

test('community residents receive distinct tastes and a delayed reply keeps its actual parent and author', async (t) => {
  // A protocol test with synthetic model output, not a claim about model quality
  // or current internet opinion. No outside source is fetched or invented.
  const author = {
    id: randomUUID(),
    communityId: 'guide',
    joinedAt: Date.now(),
    admitted: false,
    persona: {
      ...birth,
      id: 'explorer',
      name: '탐색파',
      values: '공략 없이 탐색하기',
      color: '#8bcdd2',
      role: 'viewer',
      enabled: true,
      system: false,
    },
  };
  const reader = {
    ...author,
    id: randomUUID(),
    persona: {
      ...author.persona,
      id: 'planner',
      name: '계획파',
      values: '공략을 비교하고 시간을 아끼기',
    },
  };
  const f = await fixture(t, async (args) => {
      assert.equal(args.settings.webSearch, false);
      assert.deepEqual(args.history, []);
      assert.equal(args.settings.personas.length, 1);
      const p = args.settings.personas[0];
      if (args.special.kind === 'social-daily') {
        assert.equal(p.values, author.persona.values);
        assert.match(
          args.special.instruction,
          /현실 뉴스\/유행\/날짜\/실제 사이트 방문을 지어내지 않는다/,
        );
        return output([
          {
            personaId: p.id,
            text: '공략 없이 돌아다니다 옆길을 찾았어',
            kind: 'chat',
            spoiler: false,
          },
        ]);
      }
      assert.equal(args.special.kind, 'social-discuss');
      assert.equal(p.values, reader.persona.values);
      assert.equal(args.special.delivered.authorPersonaId, author.persona.id);
      return output([
        {
          personaId: p.id,
          text: '난 지도로 먼저 확인하는 게 편하더라',
          kind: 'chat',
          spoiler: false,
          replyTo: args.special.delivered.comments[0].id,
        },
      ]);
    }),
    { s } = f;
  s.social.preferences({ enabled: true });
  s.world.change((w) => w.socialWorld.residents.push(author, reader));
  s.ai.update({ background: true });
  const run = async (target) => {
    const op = { controller: new AbortController(), epoch: s.epoch, social: true };
    s.communityActivity.active = op;
    try {
      op.promise = s.communityActivity.run(target, op);
      await op.promise;
    } finally {
      s.communityActivity.active = null;
      s.busy = false;
    }
  };
  await run({
    kind: 'social-daily',
    id: author.id,
    viewer: author.persona,
    revision: digest('synthetic-daily'),
    raw: { residentId: author.id, communityId: 'guide', topicId: 'practice' },
  });
  const post = s.social.data().threads[0];
  s.social.comment(post.id, { text: '지도를 보고 해도 괜찮을까?' });
  f.advance(31 * 60000);
  const target = s.social
    .candidates(s.now())
    .find((c) => c.kind === 'social-discuss' && c.viewer.id === reader.persona.id);
  assert.ok(target);
  await run(target);
  const detail = s.social.detail(post.id);
  assert.equal(detail.comments.length, 2);
  assert.equal(detail.comments[1].parentId, detail.comments[0].id);
  assert.equal(s.social.data().threads[0].comments[1].residentId, reader.id);
  assert.equal(
    s.social.data().receipts.length,
    0,
    'reading a discussion cannot manufacture broadcast witnessing',
  );
});
