import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Studio } from '../server/studio.js';
import { Audience } from '../server/audience.js';
import { defaults } from '../shared/defaults.js';
import { attachDecision } from './helpers/jev.js';
const observation = {
  game: '합성',
  scene: '함께 이야기하는 장면',
  confidence: 0.8,
  excitement: 0.4,
  messages: [
    { personaId: 'pop', text: '커피 마시며 보니까 좋다', kind: 'chat', spoiler: false },
    { personaId: 'momo', text: '같이 쉬어 가자', kind: 'chat', spoiler: false },
  ],
};
function fixture(t, options = {}) {
  let now = 100000;
  const generated = [];
  const s = new Studio({
    settings: { ...defaults, mode: 'live', lurkRatio: 0, slowModeSeconds: 0 },
    audience: new Audience(
      undefined,
      () => {},
      () => 0.5,
    ),
    random: () => 0.5,
    now: () => now,
    provider: {
      status: () => ({ configured: true }),
      react: async (args) => {
        generated.push(args);
        return { observation: structuredClone(observation) };
      },
    },
  });
  clearInterval(s.timer);
  s.start();
  s.addMessage('pop', '오늘은 천천히 지켜볼게', 'chat');
  const d = attachDecision(s, options);
  t.after(async () => {
    await d.decision.close();
    await s.close();
  });
  return { s, generated, ...d, advance: (ms) => (now += ms) };
}
for (const options of [{ mode: 'off' }, { key: false }])
  test(`live ${JSON.stringify(options)} preserves output and avoids candidate projection`, async (t) => {
    const f = fixture(t, options);
    f.s.journal.recallCandidates = () => {
      throw Error('unnecessary projection');
    };
    await f.s.react({ speech: '잠깐 쉬자' });
    assert.equal(f.calls.length, 0);
    assert.deepEqual(
      f.s.queue.map((m) => m.text),
      observation.messages.map((m) => m.text),
    );
  });
test('one live batch ranks eligible targets and optional memory without crossing viewer scope', async (t) => {
  const f = fixture(t, { judge: (r) => ({ target: 'v2', memory_0: 'r0', intent: 'acknowledge' }) });
  const id = randomUUID();
  f.s.journal.record(
    {
      id,
      time: 1000,
      personaId: 'pop',
      name: '팝콘도둑',
      text: '차가운 보리차 한 잔',
      kind: 'chat',
    },
    { sessionId: randomUUID(), witnesses: ['momo'] },
  );
  await f.s.react({ speech: '잠깐 쉬자' });
  assert.equal(f.calls.length, 1);
  assert.equal(f.generated.length, 1);
  assert.equal(f.generated[0].settings.personas[0].id, 'pop');
  assert.ok(f.generated[0].viewerContext.momo.recollections.some((r) => r.sourceId === id));
  assert.ok(!f.generated[0].viewerContext.pop.recollections.some((r) => r.sourceId === id));
  assert.equal(f.generated[0].viewerContext.momo.intentHint, 'acknowledge');
  assert.equal(f.generated[0].advicePolicy.allowed, false);
});
test('shadow never reorders targets, injects hints or filters messages', async (t) => {
  const f = fixture(t, { mode: 'shadow', judge: () => ({ target: 'v2', intent: 'acknowledge' }) });
  await f.s.react({ speech: '잠깐 쉬자' });
  assert.equal(f.calls.length, 1);
  assert.equal(f.generated[0].settings.personas[0].id, 'momo');
  assert.equal(f.generated[0].viewerContext.momo.intentHint, undefined);
  assert.deepEqual(
    f.s.queue.map((m) => m.text),
    observation.messages.map((m) => m.text),
  );
});
test(
  'aborted preflight cannot invoke generator or affect a new epoch',
  { timeout: 1500 },
  async (t) => {
    let release, entered;
    const ready = new Promise((r) => (entered = r));
    const f = fixture(t, {
      judge: async () => {
        entered();
        await new Promise((r) => (release = r));
        return { target: 'v2' };
      },
    });
    const pending = f.s.react({ speech: '이번 이야기' });
    await ready;
    f.s.stop();
    release();
    assert.equal((await pending).skipped, 'stopped');
    assert.equal(f.generated.length, 0);
    f.s.start();
    f.advance(10000);
    f.decision.configure({ ...f.decision.config, mode: 'off' });
    await f.s.react({ speech: '다음 이야기' });
    assert.equal(f.generated.length, 1);
    assert.equal(f.generated[0].settings.personas[0].id, 'momo');
  },
);
test('journal candidates broaden optional recall and preserve correction, pinned and chronological slots', () => {
  const s = new Studio({ provider: { status: () => ({ configured: true }) } });
  clearInterval(s.timer);
  const sessionId = randomUUID(),
    ids = [];
  for (let i = 0; i < 14; i++) {
    const id = randomUUID();
    ids.push(id);
    s.journal.record(
      {
        id,
        time: 1000 + i * 200000,
        personaId: 'pop',
        name: '팝콘',
        text: i === 0 ? '망원경으로 먼 별을 찾았어' : `커피 이야기 ${i}`,
        kind: 'chat',
      },
      { sessionId, witnesses: ['momo'] },
    );
  }
  s.journal.pin(ids[12], true);
  const plan = s.journal.recallCandidates('momo', '커피');
  assert.ok(plan.optional.some((e) => e.id === ids[0]));
  assert.ok(!s.journal.recall('momo', '커피').some((e) => e.sourceId === ids[0]));
  const recall = s.journal.recall('momo', '커피', [], { preferredIds: [ids[0]] });
  assert.ok(recall.some((e) => e.sourceId === ids[0]));
  assert.ok(recall.some((e) => e.sourceId === ids[12]));
  assert.deepEqual(
    recall.map((e) => e.at),
    recall.map((e) => e.at).sort((a, b) => a - b),
  );
  assert.deepEqual(s.journal.recall('new', '커피', [], { preferredIds: [ids[0]] }), []);
  s.close();
});
test('memory and intent remain effective when live-plan is disabled', async (t) => {
  const f = fixture(t, { tasks: { 'live-plan': false }, judge: () => ({ intent: 'acknowledge' }) });
  await f.s.react({ speech: '그냥 함께 봐줘' });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].questions.target, undefined);
  assert.equal(f.generated[0].viewerContext.pop.intentHint, 'acknowledge');
});
test('semantic omission preserves addressed speech and the sole user-response candidate', async (t) => {
  const f = fixture(t, { judge: () => ({ message_0: 'e0' }) });
  await f.s.react({ speech: '팝콘도둑 오늘은 어때?' });
  assert.ok(f.s.queue.some((m) => m.personaId === 'pop'));
});
test('optional semantic duplicate is omitted without regenerating or changing scene facts', async (t) => {
  const f = fixture(t, { judge: () => ({ message_0: 'e0' }) });
  await f.s.react({ image: 'data:image/png;base64,c3ludGhldGlj' });
  assert.equal(f.generated.length, 1);
  assert.deepEqual(
    f.s.queue.map((m) => m.personaId),
    ['momo'],
  );
  assert.equal(f.s.observation.scene, observation.scene);
  assert.equal(f.s.observation.confidence, observation.confidence);
});
test('journal removal during preflight rebuilds the prompt instead of resurrecting deleted memory', async (t) => {
  let release, entered;
  const ready = new Promise((r) => (entered = r));
  let calls = 0;
  const f = fixture(t, {
    judge: async () => {
      if (!calls++) {
        entered();
        await new Promise((r) => (release = r));
      }
      return { memory_0: 'r0' };
    },
  });
  const id = randomUUID();
  f.s.journal.record(
    { id, time: 1000, personaId: 'pop', name: '팝콘', text: '오래된 별 이야기', kind: 'chat' },
    { sessionId: randomUUID(), witnesses: ['momo'] },
  );
  const pending = f.s.react({ speech: '별 이야기' });
  await ready;
  f.s.journal.forget([id]);
  release();
  await pending;
  assert.ok(!JSON.stringify(f.generated).includes('오래된 별 이야기'));
});
test('recall keeps pinned correction chains when an optional semantic candidate is promoted', () => {
  const s = new Studio({ provider: { status: () => ({ configured: true }) } });
  clearInterval(s.timer);
  const sessionId = randomUUID();
  const entries = [
      ['streamer', '내일 파란 장비 쓰자', 1000],
      ['streamer', '정정할게 파란 장비는 취소하고 빨간 장비', 2000],
      ['pop', '천체 망원경', 200000],
      ...Array.from({ length: 12 }, (_, i) => ['gg', `장비 메모 ${i}`, 400000 + i * 200000]),
    ],
    ids = [];
  for (const [personaId, text, time] of entries) {
    const id = randomUUID();
    ids.push(id);
    s.journal.record(
      {
        id,
        personaId,
        text,
        time,
        name: personaId,
        kind: personaId === 'streamer' ? 'streamer' : 'chat',
      },
      { sessionId, witnesses: ['momo'] },
    );
  }
  s.journal.pin(ids[0], true);
  const result = s.journal.recall('momo', '장비', [], { preferredIds: [ids[2]] });
  assert.ok(result.some((e) => e.sourceId === ids[0]));
  assert.ok(result.some((e) => e.sourceId === ids[1]));
  assert.ok(result.some((e) => e.sourceId === ids[2]));
  s.close();
});
test('disabled decisions preserve the synchronous start of the existing model operation', async (t) => {
  const f = fixture(t, { mode: 'off' });
  const pending = f.s.reactInput({ speech: '지금 이야기' });
  assert.equal(f.generated.length, 1);
  await pending;
});
test('semantic omission still reports the original generated count', async (t) => {
  const f = fixture(t, { judge: () => ({ message_0: 'e0' }) });
  await f.s.react({ image: 'data:image/png;base64,c3ludGhldGlj' });
  const d = f.s.reactions.snapshot(f.s.queue);
  assert.equal(d.summary.generated, 2);
  assert.equal(d.summary.rejected.duplicate, 1);
});
test('opt-in route selection shares the live preflight and never adds a third decision call', async (t) => {
  const { ProviderRouter } = await import('../server/provider-routing.js');
  const selected = [];
  const f = fixture(t, { tasks: { 'route-hint': true }, judge: () => ({ route: 'second' }) });
  const router = new ProviderRouter(
    {
      kind: 'routing',
      version: 1,
      connections: [
        { id: 'first', label: '첫 연결', provider: { kind: 'openai', model: 'first' } },
        { id: 'second', label: '다음 연결', provider: { kind: 'openai', model: 'second' } },
      ],
      routes: { default: { primary: 'first', fallbacks: ['second'] } },
    },
    {
      create: (c) => ({
        model: c.id,
        status: () => ({ configured: true }),
        react: async (args) => {
          selected.push(c.id);
          assert.equal(args.decisionRouteHint, undefined);
          return {
            observation: {
              ...structuredClone(observation),
              clipPicks: [
                { personaId: 'pop', title: '첫 후보', reason: '합성', signature: 'first' },
                { personaId: 'momo', title: '둘째 후보', reason: '합성', signature: 'second' },
              ],
            },
          };
        },
      }),
    },
  );
  f.s.settings.autoHighlights = true;
  f.s.autonomy = { snapshot: () => ({}), stop() {}, evolve() {} };
  f.s.provider = f.s.ai.wrap(router);
  await f.s.react({ speech: '잠깐 쉬자' });
  assert.deepEqual(selected, ['second']);
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls[0].questions.route);
  assert.ok(f.calls[0].questions.intent);
});
test('clip relevance alone uses one postflight batch and commits only the eligible chosen clip', async (t) => {
  const f = fixture(t, {
    tasks: {
      'live-plan': false,
      'memory-rerank': false,
      'intent-hint': false,
      'reaction-check': false,
    },
    judge: () => ({ clip: 'c1' }),
  });
  f.s.settings.autoHighlights = true;
  f.s.autonomy = { snapshot: () => ({}), stop() {}, evolve() {} };
  f.s.provider = f.s.ai.wrap({
    status: () => ({ configured: true }),
    react: async () => ({
      observation: {
        ...structuredClone(observation),
        clipPicks: [
          { personaId: 'pop', title: '첫 후보', reason: '합성 이야기', signature: 'first' },
          {
            personaId: 'momo',
            title: '선택 후보',
            reason: '구체적인 합성 이야기',
            signature: 'second',
          },
        ],
      },
    }),
  });
  await f.s.react({ speech: '잠깐 쉬자' });
  assert.equal(f.calls.length, 1);
  assert.ok(f.calls[0].questions.clip);
  assert.equal(f.calls[0].questions.message_0, undefined);
  assert.equal(f.s.clips.data.length, 1);
  assert.equal(f.s.clips.data[0].title, '선택 후보');
});
test('sole answer survives even a strong duplicate proposal', async (t) => {
  const f = fixture(t, { judge: () => ({ message_0: 'e0' }) });
  f.s.provider = f.s.ai.wrap({
    status: () => ({ configured: true }),
    react: async () => ({
      observation: { ...structuredClone(observation), messages: [observation.messages[0]] },
    }),
  });
  await f.s.react({ speech: '잠깐 쉬자' });
  assert.equal(f.s.queue.length, 1);
  assert.equal(f.s.queue[0].personaId, 'pop');
  assert.ok(f.calls.every((c) => !c.questions.message_0));
});
test('viewer re-entry during preflight rebuilds fresh per-visit chat scope', async (t) => {
  let release, entered;
  const ready = new Promise((r) => (entered = r));
  let n = 0;
  const f = fixture(t, {
    judge: async () => {
      if (!n++) {
        entered();
        await new Promise((r) => (release = r));
      }
      return {};
    },
  });
  const pending = f.s.react({ speech: '이번 이야기' });
  await ready;
  f.s.audience.data.members.pop.joinedAt = f.s.now() + 1;
  f.advance(2);
  release();
  await pending;
  assert.ok(
    !JSON.stringify(f.generated[0].viewerContext.pop.chatHistory).includes(
      '오늘은 천천히 지켜볼게',
    ),
  );
});
test('deleting a recalled source during postflight prevents stale publication', async (t) => {
  let release, entered;
  const ready = new Promise((r) => (entered = r));
  const f = fixture(t, {
    judge: async (r) => {
      if (r.questions.message_0) {
        entered();
        await new Promise((r) => (release = r));
      }
      return { message_0: 'invalid-choice' };
    },
  });
  const id = randomUUID();
  f.s.journal.record(
    { id, time: 1000, personaId: 'pop', name: '팝콘', text: '오래된 별 이야기', kind: 'chat' },
    { sessionId: randomUUID(), witnesses: ['momo'] },
  );
  f.s.journal.pin(id, true);
  const pending = f.s.react({ image: 'data:image/png;base64,c3ludGhldGlj' });
  await ready;
  f.s.journal.forget([id]);
  release();
  assert.equal((await pending).skipped, 'superseded');
  assert.equal(f.s.queue.length, 0);
  assert.equal(f.decision.snapshot().last.outcome, 'abstain');
});

test('preflight re-entry removes captured speech frames from the actual provider payload', async (t) => {
  let entered, release;
  const ready = new Promise((r) => (entered = r));
  let count = 0;
  const f = fixture(t, {
    judge: async () => {
      if (!count++) {
        entered();
        await new Promise((r) => (release = r));
      }
      return {};
    },
  });
  f.advance(6000);
  const at = f.s.now(),
    image = 'data:image/png;base64,' + Buffer.from('private historical frame').toString('base64');
  f.s.receiveSpeech({
    id: randomUUID(),
    sessionId: f.s.sessionId,
    text: '이 장면 이야기해 보자',
    source: 'microphone',
    capture: {
      startedAt: at - 1000,
      endedAt: at - 100,
      screen: {
        sessionId: f.s.sessionId,
        sourceId: randomUUID(),
        frames: [{ image, at: at - 500 }],
      },
    },
  });
  const pending = f.s.react({});
  await ready;
  f.s.audience.data.members.pop.joinedAt = at - 10;
  release();
  await pending;
  assert.equal(f.generated[0].liveSpeech.length, 1);
  assert.equal(f.generated[0].liveSpeech[0].capture.screen, undefined);
  const { OpenAIProvider } = await import('../server/provider.js');
  const payload = new OpenAIProvider({}).payload(f.generated[0]);
  assert.equal(payload.input[0].content.filter((c) => c.type === 'input_image').length, 0);
});
for (const invalid of ['spoiler', 'blocked', 'advice'])
  test(`semantic omission never sacrifices the usable user response for a ${invalid} candidate`, async (t) => {
    const f = fixture(t, { judge: () => ({ message_0: 'e0' }) });
    f.s.settings.blockedWords = ['금지문구'];
    const second = {
      ...observation.messages[1],
      ...(invalid === 'spoiler'
        ? { spoiler: true }
        : invalid === 'blocked'
          ? { text: '금지문구' }
          : { advice: true }),
    };
    f.s.provider = f.s.ai.wrap({
      status: () => ({ configured: true }),
      react: async () => ({
        observation: {
          ...structuredClone(observation),
          messages: [observation.messages[0], second],
        },
      }),
    });
    await f.s.react({ speech: '이번 이야기 해보자' });
    assert.deepEqual(
      f.s.queue.map((m) => m.personaId),
      ['pop'],
    );
  });
test('postflight visit change cannot turn semantic omission into a silent user response', async (t) => {
  let entered, release;
  const ready = new Promise((r) => (entered = r));
  const f = fixture(t, {
    judge: async (r) => {
      if (r.questions.clip) {
        entered();
        await new Promise((r) => (release = r));
      }
      return { message_0: 'e0' };
    },
  });
  f.s.settings.autoHighlights = true;
  f.s.autonomy = { snapshot: () => ({}), stop() {}, evolve() {} };
  f.s.provider = f.s.ai.wrap({
    status: () => ({ configured: true }),
    react: async () => ({
      observation: {
        ...structuredClone(observation),
        clipPicks: [
          { personaId: 'pop', title: '첫 후보', reason: '합성', signature: 'first' },
          { personaId: 'momo', title: '둘째 후보', reason: '합성', signature: 'second' },
        ],
      },
    }),
  });
  const pending = f.s.react({ speech: '이번 이야기 해보자' });
  await ready;
  f.s.audience.data.members.momo.joinedAt = f.s.now() + 1;
  f.advance(2);
  release();
  await pending;
  assert.deepEqual(
    f.s.queue.map((m) => m.personaId),
    ['pop'],
  );
  assert.ok(f.calls.every((c) => !c.questions.message_0));
});
for (const reaction of [true, false])
  test(`promoted recalled source deleted during generation is rejected with reaction-check=${reaction}`, async (t) => {
    const targetText = '커피 조합 10';
    let entered, release, prompt;
    const ready = new Promise((r) => (entered = r));
    const f = fixture(t, {
      tasks: { 'reaction-check': reaction },
      judge: (r) => {
        const selected = r.state.viewers?.[0]?.memories?.find((m) => m.text === targetText);
        return selected ? { memory_0: selected.id } : {};
      },
    });
    let targetId;
    for (let i = 0; i < 14; i++) {
      const id = randomUUID();
      if (i === 10) targetId = id;
      f.s.journal.record(
        {
          id,
          time: 1000 + i * 1000,
          personaId: 'pop',
          name: '팝콘',
          text: `커피 조합 ${i}`,
          kind: 'chat',
        },
        { sessionId: randomUUID(), witnesses: ['momo'] },
      );
    }
    assert.ok(!f.s.journal.recall('momo', '커피').some((e) => e.sourceId === targetId));
    f.s.provider = f.s.ai.wrap({
      status: () => ({ configured: true }),
      react: async (args) => {
        prompt = args;
        entered();
        await new Promise((r) => (release = r));
        return {
          observation: {
            ...structuredClone(observation),
            messages: [{ ...observation.messages[0], text: targetText }],
          },
        };
      },
    });
    const pending = f.s.react({ speech: '커피' });
    await ready;
    assert.ok(prompt.viewerContext.momo.recollections.some((e) => e.sourceId === targetId));
    f.s.journal.forget([targetId]);
    release();
    assert.equal((await pending).skipped, 'superseded');
    assert.equal(f.s.queue.length, 0);
  });
for (const decision of [{ mode: 'off' }, { key: false }])
  test(`baseline recall deletion during generation is guarded with ${JSON.stringify(decision)}`, async (t) => {
    let entered, release, prompt;
    const ready = new Promise((r) => (entered = r));
    const f = fixture(t, decision),
      id = randomUUID();
    f.s.journal.record(
      { id, time: 1000, personaId: 'pop', name: '팝콘', text: '커피 원문', kind: 'chat' },
      { sessionId: randomUUID(), witnesses: ['momo'] },
    );
    f.s.provider = f.s.ai.wrap({
      status: () => ({ configured: true }),
      react: async (args) => {
        prompt = args;
        entered();
        await new Promise((r) => (release = r));
        return { observation: structuredClone(observation) };
      },
    });
    const pending = f.s.react({ speech: '커피' });
    await ready;
    assert.ok(prompt.viewerContext.momo.recollections.some((e) => e.sourceId === id));
    f.s.journal.forget([id]);
    release();
    assert.equal((await pending).skipped, 'superseded');
    assert.equal(f.s.queue.length, 0);
    assert.equal(f.calls.length, 0);
  });

test('shadow postflight leaves non-user-turn duplicate candidates unchanged', async (t) => {
  const f = fixture(t, { mode: 'shadow', judge: () => ({ message_0: 'e0' }) });
  await f.s.react({ image: 'data:image/png;base64,c3ludGhldGlj' });
  assert.equal(f.calls.length, 1);
  assert.ok(f.calls[0].questions.message_0);
  assert.deepEqual(
    f.s.queue.map((m) => m.text),
    observation.messages.map((m) => m.text),
  );
});
