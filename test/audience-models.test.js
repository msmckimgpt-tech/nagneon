import test from 'node:test';
import assert from 'node:assert/strict';
import audienceModels from '../shared/audience-models.json' with { type: 'json' };
import { ProviderChoice, ProviderSelection, hostedModelEnv } from '../server/provider-choice.js';
import { CodexProvider } from '../server/codex-provider.js';
import { OpenAIProvider } from '../server/provider.js';

const gpt6Efforts = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
const additions = [
  ['gpt-6-sol', 'GPT-6 Sol · 경량'],
  ['gpt-6-luna', 'GPT-6 Luna · 초경량'],
];

function makeBackend(config) {
  const provider = new OpenAIProvider(hostedModelEnv(config));
  return {
    model: provider.model,
    effort: provider.effort,
    key: 'fixture-session-key',
    check: async () => {},
    status() {
      return { configured: true, model: this.model, effort: this.effort };
    },
  };
}

test('shared audience catalog exposes GPT-6 lightweight tiers once, ahead of legacy choices', () => {
  const ids = audienceModels.models.map((model) => model.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids.slice(0, 3), ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna']);
  for (const [id, label] of additions) {
    assert.deepEqual(
      audienceModels.models.find((model) => model.id === id),
      {
        id,
        label,
        efforts: gpt6Efforts,
      },
    );
  }
  for (const effort of gpt6Efforts) assert.ok(audienceModels.effortLabels[effort]);
});

for (const [model] of additions) {
  test(`${model} accepts documented efforts in both hosted providers and rejects unsupported values`, () => {
    for (const kind of ['codex', 'openai']) {
      for (const effort of gpt6Efforts) {
        const config = { kind, model, effort };
        assert.deepEqual(ProviderSelection.parse(config), config);
        const Provider = kind === 'codex' ? CodexProvider : OpenAIProvider;
        const provider = new Provider(hostedModelEnv(config));
        assert.equal(provider.model, model);
        assert.equal(provider.effort, effort);
      }
      for (const effort of ['minimal', 'ultra', 'MAX']) {
        assert.equal(ProviderSelection.safeParse({ kind, model, effort }).success, false);
      }
      assert.equal(
        ProviderSelection.safeParse({ kind, model, effort: 'low', apiKey: 'fixture' }).success,
        false,
      );
    }
  });

  test(`${model} selection survives reload without changing defaults, credentials or local audio`, async () => {
    for (const kind of ['codex', 'openai']) {
      let saved;
      const factories = { codex: makeBackend, openai: makeBackend };
      const choice = new ProviderChoice({ factories, save: (config) => (saved = config) });
      const original = choice.active;
      choice.proxy.localSpeech = true;
      choice.proxy.transcribe = async () => 'fixture-local-transcription';
      const config = { kind, model, effort: 'none' };
      await choice.select(config);
      assert.deepEqual(saved, config);
      assert.equal(choice.proxy.model, model);
      assert.equal(choice.proxy.effort, 'none');
      assert.equal(choice.proxy.key, 'fixture-session-key');
      assert.equal(await choice.proxy.transcribe(), 'fixture-local-transcription');
      assert.ok(!JSON.stringify(choice.snapshot()).includes('fixture-session-key'));
      const restored = new ProviderChoice({ factories, initial: saved });
      assert.equal(restored.proxy.model, model);
      assert.equal(restored.proxy.effort, 'none');
      choice.save = () => {
        throw new Error('fixture-save-failure');
      };
      await assert.rejects(choice.select({ kind, model, effort: 'max' }), /fixture-save-failure/);
      assert.equal(choice.proxy.effort, 'none');
      choice.save = () => {};
      await choice.select({ kind: 'codex' });
      assert.equal(choice.active, original);
      assert.equal(choice.proxy.model, 'gpt-6-astra');
      assert.equal(choice.proxy.effort, 'low');
      assert.equal(choice.proxy.localSpeech, true);
    }
  });
}

test('legacy catalog and saved models are retained rather than silently upgraded', () => {
  const legacy = [
    { id: 'gpt-6-astra', label: 'GPT-6 Astra', efforts: ['low', 'medium', 'high', 'xhigh'] },
    {
      id: 'gpt-5.4-mini',
      label: 'GPT-5.4 mini · 경량',
      efforts: ['none', 'low', 'medium', 'high', 'xhigh'],
    },
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna · 초경량', efforts: gpt6Efforts },
  ];
  for (const expected of legacy) {
    assert.deepEqual(
      audienceModels.models.find((model) => model.id === expected.id),
      expected,
    );
    for (const effort of expected.efforts) {
      const config = { kind: 'codex', model: expected.id, effort };
      const restored = new ProviderChoice({ factories: { codex: makeBackend }, initial: config });
      assert.equal(restored.proxy.model, expected.id);
      assert.equal(restored.proxy.effort, effort);
    }
  }
  assert.deepEqual(ProviderSelection.parse({ kind: 'codex' }), { kind: 'codex' });
  assert.deepEqual(hostedModelEnv({ kind: 'codex' }), {});
  assert.equal(
    ProviderSelection.safeParse({ kind: 'codex', model: 'gpt-6-astra', effort: 'max' }).success,
    false,
  );
});
