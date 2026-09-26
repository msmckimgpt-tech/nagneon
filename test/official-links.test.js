import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { openOfficialKeyConsole } = require('../desktop/official-links.cjs');

test('only the trusted main window opens the fixed official key console', async () => {
  const mainWebContents = {};
  const external = [];
  const options = {
    mainWebContents,
    serviceUrl: 'http://127.0.0.1:4318',
    openExternal: (url) => {
      external.push(url);
      return Promise.resolve();
    },
  };
  await openOfficialKeyConsole({
    ...options,
    event: { sender: mainWebContents, senderFrame: { url: 'http://127.0.0.1:4318/' } },
  });
  assert.deepEqual(external, ['https://console.typesafe.ai/keys']);
  await openOfficialKeyConsole({
    ...options,
    provider: 'openrouter',
    event: { sender: mainWebContents, senderFrame: { url: 'http://127.0.0.1:4318/' } },
  });
  assert.deepEqual(external.at(-1), 'https://openrouter.ai/settings/keys');
  assert.throws(() =>
    openOfficialKeyConsole({
      ...options,
      provider: 'https://attacker.example/',
      event: { sender: mainWebContents, senderFrame: { url: 'http://127.0.0.1:4318/' } },
    }),
  );
  assert.throws(() =>
    openOfficialKeyConsole({
      ...options,
      event: { sender: {}, senderFrame: { url: 'http://127.0.0.1:4318/' } },
    }),
  );
  assert.throws(() =>
    openOfficialKeyConsole({
      ...options,
      event: { sender: mainWebContents, senderFrame: { url: 'https://attacker.example/' } },
    }),
  );
  assert.deepEqual(external, [
    'https://console.typesafe.ai/keys',
    'https://openrouter.ai/settings/keys',
  ]);
});
