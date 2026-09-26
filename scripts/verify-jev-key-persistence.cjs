// Run this script in three separate Electron processes: write, restore, removed.
// It uses only a synthetic key and an isolated profile.
const { app, safeStorage } = require('electron');
const { resolve, join } = require('node:path');
const { mkdirSync, existsSync, readFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { JevKeyStore } = require('../desktop/jev-key-store.cjs');

const stage = process.argv.at(-1);
const out = resolve(process.env.JEV_SMOKE_OUT || join(process.env.TMPDIR || '.', 'jev-key-smoke'));
const profile = join(out, 'profile');
const file = join(profile, 'data', 'secrets', 'jev-key.bin');
const syntheticKey = 'jev-synthetic-persistence-only';
mkdirSync(profile, { recursive: true });
app.setName('Nagneon');
app.setPath('userData', profile);

app.whenReady().then(async () => {
  let service;
  try {
    assert.ok(['write', 'restore', 'removed'].includes(stage));
    const { startServer } = await import(pathToFileURL(resolve('server/index.js')).href);
    service = await startServer({
      port: 0,
      dataDir: join(profile, 'data'),
      localSpeech: false,
      provider: {
        model: 'synthetic',
        status: () => ({ kind: 'codex', configured: true }),
        react: async () => ({ observation: { messages: [] } }),
      },
      decisionKeyStore: new JevKeyStore({ file, safeStorage }),
      decisionFetchImpl: () => {
        throw new Error('The smoke must not call a provider');
      },
    });
    const decision = service.studio.decision;
    if (stage === 'write') {
      assert.equal(decision.snapshot().configured, false);
      const saved = decision.setKey(syntheticKey);
      assert.equal(saved.keyStorage, 'saved');
      assert.equal(existsSync(file), true);
      assert.equal(readFileSync(file).includes(syntheticKey), false);
      const configFile = join(profile, 'data', 'decision.json');
      if (existsSync(configFile))
        assert.equal(readFileSync(configFile).includes(syntheticKey), false);
      assert.equal(JSON.stringify(saved).includes(syntheticKey), false);
    } else if (stage === 'restore') {
      const restored = decision.snapshot();
      assert.equal(restored.configured, true);
      assert.equal(restored.keyStorage, 'saved');
      assert.equal(restored.probe, null);
      assert.equal(restored.last, null);
      assert.equal(JSON.stringify(restored).includes(syntheticKey), false);
      assert.equal(decision.setKey('').configured, false);
      assert.equal(existsSync(file), false);
    } else {
      assert.equal(decision.snapshot().configured, false);
      assert.equal(decision.snapshot().keyStorage, 'none');
    }
    process.stdout.write(`JEV encrypted key ${stage}: PASS\n`);
    await service.close();
    app.exit(0);
  } catch (error) {
    process.stderr.write(`JEV encrypted key ${stage}: FAIL (${error.message})\n`);
    await service?.close().catch(() => {});
    app.exit(1);
  }
});
