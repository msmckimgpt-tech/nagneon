import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderRouter } from '../server/provider-routing.js';
import { confidentChoice, certainNoul } from '../server/decision/policies.js';
import { ClipFeatures, Clips } from '../server/clips.js';
import { OpenAIProvider } from '../server/provider.js';
import { defaults } from '../shared/defaults.js';
const config = {
  kind: 'routing',
  version: 1,
  connections: [
    { id: 'first', label: '첫 연결', provider: { kind: 'openai', model: 'test-a', vision: true } },
    {
      id: 'second',
      label: '다음 연결',
      provider: { kind: 'openai', model: 'test-b', vision: false },
    },
  ],
  routes: { default: { primary: 'first', fallbacks: ['second'] } },
};
test('route hint only permutes current configured capable paths and preserves fallback', async () => {
  const calls = [];
  let failed = false;
  const router = new ProviderRouter(config, {
    create: (c) => ({
      model: c.provider.model,
      status: () => ({ configured: true }),
      react: async () => {
        calls.push(c.id);
        if (failed && c.id === 'second') throw Object.assign(Error('offline'), { code: 'network' });
        return { observation: { messages: [] } };
      },
    }),
  });
  const args = { settings: { webSearch: false } };
  const routes = router.decisionRoutes(args);
  assert.deepEqual(
    routes.candidates.map((c) => c.id),
    ['first', 'second'],
  );
  await router.react({ ...args, decisionRouteHint: { token: routes.token, id: 'second' } });
  assert.deepEqual(calls, ['second']);
  calls.length = 0;
  failed = true;
  await router.react({ ...args, decisionRouteHint: { token: routes.token, id: 'second' } });
  assert.deepEqual(calls, ['second', 'first']);
  calls.length = 0;
  await router.react({
    ...args,
    image: 'synthetic',
    decisionRouteHint: { token: routes.token, id: 'second' },
  });
  assert.deepEqual(calls, ['first']);
  assert.deepEqual(
    router.decisionRoutes({ ...args, adviceRequested: true, settings: { webSearch: true } })
      .candidates,
    [],
  );
  calls.length = 0;
  await router.react({ ...args, decisionRouteHint: { token: {}, id: 'second' } });
  assert.deepEqual(calls, ['first']);
});
test('choice confidence and selected probability are both required; Noul has no confidence', () => {
  assert.equal(
    confidentChoice({ type: 'choice', choice: 'a', confidence: 0.4, probabilities: { a: 1 } }, [
      'a',
    ]),
    null,
  );
  assert.equal(
    confidentChoice({ type: 'choice', choice: 'a', confidence: 1, probabilities: { a: 0.4 } }, [
      'a',
    ]),
    null,
  );
  assert.equal(
    confidentChoice({ type: 'choice', choice: 'bad', confidence: 1, probabilities: { bad: 1 } }, [
      'a',
    ]),
    null,
  );
  for (const value of [NaN, Infinity, -0.1, 1.1, 0.5])
    assert.equal(certainNoul({ type: 'noul', noul: value }), null);
  assert.equal(certainNoul({ type: 'noul', noul: 0.99 }), true);
  assert.equal(certainNoul({ type: 'noul', noul: 0.01 }), false);
});
test('clip projection runs actual eligibility again before storage', () => {
  const clips = new Clips({ now: () => 1000000 }),
    s = {
      running: true,
      settings: { ...defaults, mode: 'live', autoHighlights: true },
      now: () => 1000000,
      sessionId: 'synthetic',
      startedAt: 1,
      messages: [],
      log() {},
      publish() {},
    };
  const features = new ClipFeatures(s, clips),
    pick = { personaId: 'pop', title: '합성 후보', reason: '같이 웃음', signature: 'synthetic' },
    observation = {
      game: '합성',
      scene: '합성',
      confidence: 1,
      messages: [],
      clipPicks: [{ ...pick, personaId: 'unknown' }, pick],
    },
    context = { speech: '합성 발언', witnesses: ['pop'], capturedAt: 1000000 };
  assert.deepEqual(features.eligiblePicks(observation, context), [pick]);
  s.settings.personas = s.settings.personas.map((p) => ({ ...p, enabled: p.id !== 'pop' }));
  assert.deepEqual(features.spectatorPicks(observation, context), []);
  assert.equal(clips.data.length, 0);
});
test('intent hint reaches actual prompt while advice refusal remains authoritative', () => {
  const p = new OpenAIProvider({});
  const payload = p.payload({
    settings: defaults,
    speech: '그냥 봐줘',
    viewerContext: { pop: { intentHint: 'acknowledge' } },
    advicePolicy: { allowed: false, maxMessages: 0 },
  });
  const text = JSON.stringify(payload);
  assert.match(text, /intentHint/);
  assert.match(text, /acknowledge/);
  assert.match(text, /allowed\\?"?:false/);
  assert.match(payload.instructions, /advicePolicy가 우선/);
  assert.doesNotMatch(
    p.payload({ settings: defaults, speech: '그냥 봐줘' }).instructions,
    /intentHint/,
  );
});
