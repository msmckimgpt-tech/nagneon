import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startServer } from '../server/index.js';
import { clipTextSnapshot } from '../server/clip-memory.js';
import { digest } from '../server/social-runtime-state.js';
import { socialContentHash } from '../server/social-content.js';
import { seedMetAudience } from './helpers/met-audience.js';
import { attachDecision } from './helpers/jev.js';

const speech = '망원경 이야기를 다시 해 볼까';
const response = () => ({
  observation: {
    game: '일상',
    scene: '쉬는 시간',
    confidence: 0.8,
    excitement: 0.2,
    messages: [
      { personaId: 'momo', kind: 'chat', text: '밤하늘 이야기가 기억나네', spoiler: false },
    ],
  },
});
const choose = (request) =>
  Object.fromEntries(
    Object.entries(request.questions).flatMap(([id, q]) => {
      if (!id.startsWith('clip_memory_') && !id.startsWith('social_memory_')) return [];
      const found = Object.entries(q.criteria).find(
        ([key, text]) => key !== 'keep-existing' && JSON.stringify(text).includes('멀리 있는 별'),
      );
      return found ? [[id, found[0]]] : [];
    }),
  );
async function fixture(t, options = {}) {
  const generated = [];
  const service = await startServer({
    port: 0,
    persist: false,
    localSpeech: false,
    provider: {
      status: () => ({ configured: true }),
      react: async (args) => {
        generated.push(args);
        return response();
      },
    },
  });
  const s = service.studio;
  clearInterval(s.timer);
  seedMetAudience(s);
  let now = Date.now();
  s.now = () => now;
  s.clips.now = () => now - 10000;
  s.settings.mode = 'live';
  s.settings.slowModeSeconds = 0;
  s.settings.lurkRatio = 0;
  s.start();
  const decision = attachDecision(s, { judge: choose, ...options });
  t.after(async () => {
    await decision.decision.close();
    await service.close();
  });
  return { s, generated, ...decision, advance: (n) => (now += n) };
}
function clips(f, viewerId = 'momo') {
  const ids = [];
  for (let i = 0; i < 4; i++) {
    const clip = f.s.clips.create({
      title: i ? `망원경 보관 ${i}` : '멀리 있는 별',
      game: '일상',
      scene: '읽은 소개',
      sessionId: randomUUID(),
      source: 'manual',
      participants: [],
      messages: [],
    });
    ids.push(clip.id);
    f.s.clips.comment(clip.id, {
      name: '방장',
      text: i ? `망원경 보관 이야기 ${i}` : '별 이름은 북극성이야',
    });
    f.s.clips.commentBatch(clip.id, [], {
      reading: clipTextSnapshot(f.s.clips.get(clip.id)),
      readers: [viewerId],
    });
  }
  return ids;
}
function social(f, viewerId = 'momo') {
  const s = f.s,
    at = s.now() - 20000;
  const author = {
    id: randomUUID(),
    communityId: 'guide',
    persona: s.settings.personas.find((p) => p.id === 'pop'),
    joinedAt: at - 1000,
    admitted: true,
  };
  const reader = {
    ...author,
    id: randomUUID(),
    persona: s.settings.personas.find((p) => p.id === viewerId),
  };
  const sourceId = randomUUID();
  s.journal.record(
    {
      id: sourceId,
      time: at,
      personaId: 'streamer',
      name: '방장',
      kind: 'streamer',
      text: '밤하늘 관찰 이야기',
    },
    { sessionId: randomUUID(), witnesses: ['pop'] },
  );
  const source = s.social.source(
    s.journal.data.entries.find((e) => e.id === sourceId),
    'pop',
  );
  const ids = [];
  s.social.change((d) => {
    d.residents.push(author, reader);
    for (let i = 0; i < 5; i++) {
      const thread = {
        id: randomUUID(),
        communityId: 'guide',
        topicId: 'practice',
        residentId: author.id,
        kind: 'mention',
        title: '공동체 이야기',
        text: i ? `정리와 보관 이야기 ${i}` : '멀리 있는 별을 찾아보자',
        at: at + i,
        source,
      };
      ids.push(thread.id);
      d.threads.push(thread);
      d.receipts.push({
        id: randomUUID(),
        residentId: reader.id,
        threadId: thread.id,
        threadHash: socialContentHash(thread),
        deliveredHash: digest({ id: thread.id, title: thread.title, text: thread.text }),
        operationId: randomUUID(),
        receivedAt: at + 100 + i,
        receivedLiveSequence: 0,
        eligibleFromLiveSequence: 1,
        interested: true,
        source,
      });
    }
  });
  return { ids, sourceId };
}

test('one preflight promotes eligible clip and social sources outside the baseline final slots', async (t) => {
  const f = await fixture(t),
    clipIds = clips(f),
    socialIds = social(f).ids;
  assert.ok(!f.s.clips.recall('momo', speech).some((c) => c.clipId === clipIds[0]));
  assert.ok(!f.s.social.memory('momo').some((c) => c.text.includes('멀리 있는 별')));
  const before = JSON.stringify({ clips: f.s.clips.data, social: f.s.social.data() });
  await f.s.react({ speech });
  const packet = f.generated[0].viewerContext.momo;
  assert.ok(packet.clipMemories.some((c) => c.clipId === clipIds[0]));
  assert.ok(packet.heardFromCommunity.some((c) => c.text === '멀리 있는 별을 찾아보자'));
  assert.equal(packet.clipMemories.length, 2);
  assert.equal(packet.heardFromCommunity.length, 3);
  assert.deepEqual(f.generated[0].viewerContext.pop.clipMemories, []);
  assert.deepEqual(f.generated[0].viewerContext.pop.heardFromCommunity, []);
  assert.equal(f.calls.length, 1);
  const sent = JSON.stringify(f.calls[0]);
  for (const id of [...clipIds, ...socialIds]) assert.ok(!sent.includes(id));
  assert.equal(JSON.stringify({ clips: f.s.clips.data, social: f.s.social.data() }), before);
});
for (const options of [{ mode: 'off' }, { key: false }, { mode: 'shadow' }, { judge: () => ({}) }])
  test(`clip and social fallback preserves baseline DTOs ${JSON.stringify(options)}`, async (t) => {
    const f = await fixture(t, options);
    clips(f);
    social(f);
    const expectedClips = f.s.clips.recall('momo', speech),
      expectedSocial = f.s.social.memory('momo');
    await f.s.react({ speech });
    assert.deepEqual(f.generated[0].viewerContext.momo.clipMemories, expectedClips);
    assert.deepEqual(f.generated[0].viewerContext.momo.heardFromCommunity, expectedSocial);
    assert.equal(f.calls.length, options.mode === 'off' || options.key === false ? 0 : 1);
  });
for (const kind of ['clip', 'social'])
  test(`${kind} removal during preflight refreshes provider memory`, async (t) => {
    const f = await fixture(t, {
      judge: (request) => {
        if (kind === 'clip') f.s.clips.remove(ids[1]);
        else f.s.social.forget('thread', [ids[4]]);
        return choose(request);
      },
    });
    const ids = kind === 'clip' ? clips(f) : social(f).ids;
    await f.s.react({ speech });
    const text = JSON.stringify(f.generated[0].viewerContext.momo);
    assert.ok(!text.includes(kind === 'clip' ? ids[1] : '정리와 보관 이야기 4'));
  });
for (const kind of ['clip', 'social'])
  test(`${kind} baseline removal during generation suppresses stale publication without JEV`, async (t) => {
    const f = await fixture(t, { mode: 'off' }),
      ids = kind === 'clip' ? clips(f) : social(f).ids;
    f.s.provider.react = async (args) => {
      f.generated.push(args);
      if (kind === 'clip') f.s.clips.remove(ids[1]);
      else f.s.social.forget('thread', [ids[4]]);
      return response();
    };
    assert.equal((await f.s.react({ speech })).skipped, 'superseded');
    assert.equal(f.s.queue.length, 0);
  });

test('promoted clip keeps protected streamer replies, corrected quotes and text-only provenance', async (t) => {
  const f = await fixture(t),
    ids = clips(f),
    id = ids[0];
  const correction = { text: '별 이름은 북극성이야', confidence: 0.91, source: 'contextual-stt' };
  f.s.clips.change((data) => {
    const c = data.find((c) => c.id === id);
    c.video = true;
    c.hasAudio = true;
    c.messages.push({
      id: randomUUID(),
      time: f.s.now() - 15000,
      personaId: 'streamer',
      name: '방장',
      kind: 'streamer',
      text: '망원경 이야기는 북그성이야',
      transcription: {
        source: 'microphone',
        correction: { text: correction.text, confidence: 0.91 },
      },
    });
  });
  for (let i = 0; i < 5; i++)
    f.s.clips.comment(id, {
      personaId: 'pop',
      kind: 'ai',
      name: '팝콘',
      text: `길고 긴 합성 설명 ${i} ${'가'.repeat(400)}`,
    });
  const reply = f.s.clips.comment(id, { name: '방장', text: '망원경은 빌린 거야' });
  const corrected = f.s.clips.comment(id, { name: '방장', text: '아까 설명을 정정할게' });
  f.s.clips.commentBatch(id, [], {
    reading: clipTextSnapshot(f.s.clips.get(id)),
    readers: ['momo'],
  });
  // Keep the desired bundle outside lexical baseline despite its protected replies.
  for (const other of ids.slice(1)) {
    f.s.clips.comment(other, { name: '방장', text: speech });
    f.s.clips.commentBatch(other, [], {
      reading: clipTextSnapshot(f.s.clips.get(other)),
      readers: ['momo'],
    });
    f.s.clips.change((data) => {
      data.find((c) => c.id === other).readings[0].readAt += 1;
    });
  }
  assert.ok(!f.s.clips.recall('momo', speech, f.s.now()).some((c) => c.clipId === id));
  await f.s.react({ speech });
  const row = f.generated[0].viewerContext.momo.clipMemories.find((c) => c.clipId === id);
  assert.ok(row);
  assert.equal(row.encounter, 'clip-text');
  assert.equal(row.media, undefined);
  assert.ok(row.items.some((m) => m.id === reply.id));
  assert.ok(row.items.some((m) => m.id === corrected.id));
  assert.ok(
    row.items.some(
      (m) =>
        m.text === '망원경 이야기는 북그성이야' &&
        m.transcriptionCorrection.text === correction.text &&
        m.transcriptionCorrection.confidence === 0.91,
    ),
  );
  assert.ok(row.items.length <= 4);
  assert.deepEqual(
    row.items.map((m) => m.at),
    row.items.map((m) => m.at).sort((a, b) => a - b),
  );
});

test('unknown, duplicate and foreign preferences never widen clip or social eligibility', async (t) => {
  const f = await fixture(t),
    own = clips(f),
    foreign = clips(f, 'pop'),
    socialIds = social(f).ids;
  const preferred = [foreign[0], 'missing', own[0], own[0]];
  const actual = f.s.clips.recall('momo', speech, f.s.now(), { preferredIds: preferred });
  assert.ok(actual.some((c) => c.clipId === own[0]));
  assert.ok(actual.every((c) => !foreign.includes(c.clipId)));
  assert.equal(new Set(actual.map((c) => c.clipId)).size, actual.length);
  const receipt = f.s.social.data().receipts.find((r) => r.threadId === socialIds[0]);
  assert.deepEqual(f.s.social.memory('pop', { preferredIds: [receipt.id, receipt.id] }), []);
  const selected = f.s.social.memory('momo', { preferredIds: ['missing', receipt.id, receipt.id] });
  assert.equal(selected.length, 3);
  assert.equal(selected.filter((c) => c.text.includes('멀리 있는 별')).length, 1);
  assert.ok(selected.every((c) => !('id' in c) && !('fingerprint' in c) && !('source' in c)));
});
for (const kind of ['clip', 'social']) {
  test(`${kind} edited optional source invalidates a strong stale preflight selection`, async (t) => {
    const f = await fixture(t, {
      judge: (request) => {
        const selected = choose(request);
        if (kind === 'clip')
          f.s.clips.change((data) => {
            data.find((c) => c.id === ids[0]).comments[0].text = '새로 수정한 내용';
          });
        else
          f.s.social.change((d) => {
            d.threads.find((c) => c.id === ids[0]).text = '새로 수정한 내용';
          });
        return selected;
      },
    });
    const ids = kind === 'clip' ? clips(f) : social(f).ids;
    await f.s.react({ speech });
    const packet = f.generated[0].viewerContext.momo;
    assert.ok(
      kind === 'clip'
        ? !packet.clipMemories.some((c) => c.clipId === ids[0])
        : !packet.heardFromCommunity.some((c) => c.text.includes('멀리 있는 별')),
    );
    assert.equal(f.calls.length, 1);
  });
  test(`${kind} removal during abstaining postflight prevents stale publication`, async (t) => {
    const f = await fixture(t, {
      judge: (request) => {
        if (request.questions.message_0) {
          if (kind === 'clip') f.s.clips.remove(ids[0]);
          else f.s.social.forget('thread', [ids[4]]);
        }
        return { message_0: 'unknown-id' };
      },
    });
    const ids = kind === 'clip' ? clips(f) : social(f).ids;
    f.s.addMessage('momo', '밤하늘 이야기를 나눴지', 'chat');
    assert.equal(
      (await f.s.react({ image: 'data:image/png;base64,c3ludGhldGlj' })).skipped,
      'superseded',
    );
    assert.equal(f.calls.length, 1);
    assert.equal(f.s.queue.length, 0);
    assert.equal(f.decision.snapshot().last.outcome, 'abstain');
  });
  test(`${kind} re-entry during generation invalidates the captured recall visit`, async (t) => {
    const f = await fixture(t, { mode: 'off' });
    kind === 'clip' ? clips(f) : social(f);
    f.s.provider.react = async () => {
      f.s.audience.data.members.momo.joinedAt = f.s.now() + 1;
      f.advance(2);
      return response();
    };
    assert.equal((await f.s.react({ speech })).skipped, 'superseded');
    assert.equal(f.s.queue.length, 0);
  });
}

test('foreign candidate response cannot select another viewer receipt', async (t) => {
  const f = await fixture(t, {
    judge: (request) => {
      const entry = Object.entries(request.questions).find(([id]) => id.startsWith('clip_memory_'));
      return { [entry[0]]: 'c19_0' };
    },
  });
  clips(f);
  const expected = f.s.clips.recall('momo', speech);
  await f.s.react({ speech });
  assert.deepEqual(f.generated[0].viewerContext.momo.clipMemories, expected);
  assert.equal(f.decision.snapshot().last.outcome, 'abstain');
});

test('large recall libraries share bounded preflight with target, intent and route, plus one postflight', async (t) => {
  const f = await fixture(t, { tasks: { 'route-hint': true } }),
    s = f.s;
  const clipIds = clips(f);
  social(f);
  const at = s.now() - 5000;
  // Give a large roster its own synthetic receipts. The real live admission
  // path below chooses up to nine viewers; none borrow another viewer's identity.
  s.world.change((w) => {
    const model = w.settings.personas.find((p) => p.id === 'momo');
    for (let i = 0; i < 18; i++) {
      const persona = {
        ...model,
        id: `reader${i}`,
        name: `합성관객${i}`,
        personality: '\\"'.repeat(90),
        values: '가'.repeat(120),
      };
      w.settings.personas.push(persona);
      w.audience.members[persona.id] = {
        ...structuredClone(w.audience.members.momo),
        joinedAt: at,
      };
      const resident = {
        id: randomUUID(),
        communityId: 'guide',
        persona,
        joinedAt: at - 30000,
        admitted: true,
      };
      w.socialWorld.residents.push(resident);
      for (const receipt of w.socialWorld.receipts.slice(0, 5))
        w.socialWorld.receipts.push({
          ...receipt,
          id: randomUUID(),
          operationId: randomUUID(),
          residentId: resident.id,
        });
    }
  });
  for (const p of s.settings.personas) {
    s.audience.presence[p.id] = 'active';
    for (const id of clipIds)
      s.clips.commentBatch(id, [], { reading: clipTextSnapshot(s.clips.get(id)), readers: [p.id] });
    for (let i = 0; i < 12; i++)
      s.journal.record(
        {
          id: randomUUID(),
          time: at - i - 100000,
          personaId: 'streamer',
          name: '방장',
          kind: 'streamer',
          text: `기억 ${i} ${'\\"'.repeat(120)}`,
        },
        { sessionId: randomUUID(), witnesses: [p.id] },
      );
  }
  s.provider.decisionRoutes = () => ({
    token: 'synthetic-route-token',
    candidates: [
      { id: 'one', model: 'synthetic-one', kind: 'test' },
      { id: 'two', model: 'synthetic-two', kind: 'test' },
    ],
  });
  s.provider.react = async (args) => {
    f.generated.push(args);
    return {
      observation: {
        ...response().observation,
        clipPicks: [
          { personaId: 'momo', title: '합성 후보 하나', reason: '들려준 이야기', signature: 'one' },
          { personaId: 'pop', title: '합성 후보 둘', reason: '구체적인 이야기', signature: 'two' },
        ],
      },
    };
  };
  s.settings.autoHighlights = true;
  s.settings.chatPace = 8;
  // Existing clips have no creator, leaving normal live clip-pick eligibility intact.
  await s.react({ speech });
  assert.equal(f.generated.length, 1);
  assert.equal(f.calls.length, 2);
  const pre = f.calls[0];
  assert.ok(pre.questions.target);
  assert.ok(pre.questions.intent);
  assert.ok(pre.questions.route);
  assert.ok(Object.keys(pre.questions).some((id) => id.startsWith('memory_')));
  assert.ok(Object.keys(pre.questions).some((id) => id.startsWith('clip_memory_')));
  assert.ok(Object.keys(pre.questions).some((id) => id.startsWith('social_memory_')));
  assert.ok(JSON.stringify(pre.state).length <= 24000);
  assert.ok(JSON.stringify(pre).length <= 48000);
  for (const persona of f.generated[0].settings.personas) {
    const packet = f.generated[0].viewerContext[persona.id];
    assert.ok(
      packet.clipMemories.some((c) => c.clipId === clipIds[0]),
      `${persona.id} can promote a clip outside its baseline two`,
    );
    if (s.social.memory(persona.id).length)
      assert.ok(
        packet.heardFromCommunity.some((c) => c.text === '멀리 있는 별을 찾아보자'),
        `${persona.id} can promote social memory outside its baseline three`,
      );
  }
  assert.ok(f.calls[1].questions.clip);
});

for (const mutation of ['receipt', 'source', 'mute'])
  test(`social ${mutation} change during generation invalidates exact receipt evidence`, async (t) => {
    const f = await fixture(t, { mode: 'off' }),
      { sourceId } = social(f);
    f.s.provider.react = async () => {
      if (mutation === 'receipt')
        f.s.social.change((d) => {
          d.receipts = d.receipts.slice(0, -1);
        });
      if (mutation === 'source')
        f.s.journal.change((d) => {
          d.entries.find((e) => e.id === sourceId).text = '정정된 방송 이야기';
        });
      if (mutation === 'mute') f.s.social.preferences({ mutedCommunities: ['guide'] });
      return response();
    };
    assert.equal((await f.s.react({ speech })).skipped, 'superseded');
    assert.equal(f.s.queue.length, 0);
  });

test('clip receipt media signature changes invalidate generation while media provenance remains sampled', async (t) => {
  const f = await fixture(t, { mode: 'off' }),
    ids = clips(f),
    id = ids[1];
  f.s.clips.commentBatch(id, [], {
    reading: clipTextSnapshot(f.s.clips.get(id)),
    readers: ['momo'],
    mediaReading: {
      version: 1,
      signature: 'a'.repeat(64),
      readAt: f.s.now() - 10000,
      frameTimes: [f.s.now() - 15000],
      scene: '실제 전달된 일부 장면',
      audio: [],
    },
  });
  f.s.provider.react = async (args) => {
    const row = args.viewerContext.momo.clipMemories.find((c) => c.clipId === id);
    assert.equal(row.encounter, 'clip-media-samples');
    assert.equal(row.media.sceneSource, 'model-description');
    f.s.clips.change((data) => {
      data.find((c) => c.id === id).readings[0].media.signature = 'b'.repeat(64);
    });
    return response();
  };
  assert.equal((await f.s.react({ speech })).skipped, 'superseded');
  assert.equal(f.s.queue.length, 0);
});

test('discovery-summary receipt deletion during generation cannot publish stale clip recall', async (t) => {
  const f = await fixture(t, { mode: 'off' }),
    s = f.s;
  const c = s.clips.create({
    title: '입장 때 읽은 소개',
    game: '일상',
    scene: '소개로만 들은 밤하늘',
    participants: [],
    messages: [],
    sessionId: randomUUID(),
  });
  const { arrivalClipSnapshot } = await import('../server/arrival-clip-memory.js');
  const receiptId = randomUUID(),
    at = s.now() - 1000;
  s.world.change((w) => {
    w.autonomy.receipts[receiptId] = {
      status: 'completed',
      cost: 0,
      at,
      source: { path: 'clip', key: 'clip', label: '합성 소개', clipId: c.id },
      personaId: 'momo',
    };
    w.audience.members.momo.origin = {
      key: 'clip',
      label: '합성 소개',
      firstSeenAt: at,
      path: 'clip',
      clipId: c.id,
    };
    w.audience.members.momo.arrivalClip = {
      version: 1,
      clipId: c.id,
      receiptId,
      receivedAt: at,
      hash: arrivalClipSnapshot(c).hash,
    };
  });
  s.provider.react = async (args) => {
    assert.equal(args.viewerContext.momo.arrivalClipMemory.experience, 'read-discovery-summary');
    s.clips.remove(c.id);
    return response();
  };
  assert.equal((await s.react({ speech })).skipped, 'superseded');
  assert.equal(s.queue.length, 0);
});

test('nine viewers spend journal quota on outside-baseline memories and retain pinned sources', async (t) => {
  const query = '망원경 관찰 이어 가자';
  const f = await fixture(t, {
    tasks: {
      'live-plan': false,
      'intent-hint': false,
      'route-hint': false,
      'reaction-check': false,
      'clip-relevance': false,
    },
    judge: (request) =>
      Object.fromEntries(
        Object.entries(request.questions)
          .filter(([id]) => id.startsWith('memory_'))
          .map(([id, question]) => [
            id,
            Object.entries(question.criteria).find(([, text]) => text === '망원경 관찰 2')?.[0] ||
              'r0',
          ]),
      ),
  });
  const s = f.s;
  s.world.change((w) => {
    const model = w.settings.personas.find((p) => p.id === 'momo');
    for (let i = w.settings.personas.length; i < 9; i++) {
      const persona = { ...model, id: `journal-reader${i}`, name: `기록관객${i}` };
      w.settings.personas.push(persona);
      w.audience.members[persona.id] = {
        ...structuredClone(w.audience.members.momo),
        joinedAt: s.now(),
      };
    }
    w.settings.chatPace = 8;
  });
  const viewers = s.settings.personas.map((p) => p.id),
    ids = [],
    pinned = randomUUID();
  for (const id of viewers) s.audience.presence[id] = 'active';
  s.journal.record(
    {
      id: pinned,
      time: s.now() - 200000,
      personaId: 'streamer',
      name: '방장',
      kind: 'streamer',
      text: '반드시 간직할 약속',
    },
    { sessionId: randomUUID(), witnesses: viewers },
  );
  s.journal.pin(pinned, true);
  for (let i = 0; i < 6; i++) {
    const id = randomUUID();
    ids.push(id);
    s.journal.record(
      {
        id,
        time: s.now() - 100000 + i * 1000,
        personaId: 'streamer',
        name: '방장',
        kind: 'streamer',
        text: `망원경 관찰 ${i}`,
      },
      { sessionId: randomUUID(), witnesses: viewers },
    );
  }
  for (const id of viewers) {
    const baseline = s.journal.recall(id, query).map((row) => row.sourceId);
    assert.deepEqual(baseline, [pinned, ...ids.slice(3)]);
  }
  await s.react({ speech: query });
  assert.equal(f.calls.length, 1);
  assert.equal(f.generated[0].settings.personas.length, 9);
  for (const viewer of viewers) {
    const rows = f.generated[0].viewerContext[viewer].recollections;
    assert.ok(
      rows.some((row) => row.sourceId === ids[2]),
      `${viewer} promotes a journal source outside its baseline`,
    );
    assert.ok(
      rows.some((row) => row.sourceId === pinned),
      `${viewer} retains its protected source`,
    );
    assert.deepEqual(
      rows.map((row) => row.at),
      rows.map((row) => row.at).sort((a, b) => a - b),
    );
  }
  assert.equal(Object.keys(f.calls[0].questions).length, 9);
  assert.ok(
    Object.values(f.calls[0].questions).every(
      (question) => !Object.values(question.criteria).includes('망원경 관찰 5'),
    ),
  );
});
