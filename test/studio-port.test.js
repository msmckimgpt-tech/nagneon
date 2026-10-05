import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
const { startStableStudio, storedPort } = createRequire(import.meta.url)(
  '../desktop/studio-port.cjs',
);
async function fixture(t) {
  const root = resolve('artifacts');
  await mkdir(root, { recursive: true });
  const profile = await mkdtemp(join(root, 'studio-origin-test-'));
  assert.ok(profile.startsWith(root + sep));
  t.after(() => rm(profile, { recursive: true }));
  return profile;
}

test('desktop restart reuses its loopback origin without persisting a server credential', async (t) => {
  const profile = await fixture(t),
    ports = [];
  const start = async (port) => {
    ports.push(port);
    return {
      url: 'http://127.0.0.1:' + (port || 49321),
      accessToken: 'synthetic-private-token',
      close: async () => {},
    };
  };
  await startStableStudio({ profile, start });
  await startStableStudio({ profile, start });
  assert.deepEqual(ports, [0, 49321]);
  assert.deepEqual(
    JSON.parse(await readFile(join(profile, 'data', 'desktop-origin.json'), 'utf8')),
    { version: 1, port: 49321 },
  );
  assert.equal(storedPort(profile), 49321);
});

test('an occupied previous port changes only this app origin and preserves the chosen microphone', async (t) => {
  const profile = await fixture(t);
  await startStableStudio({
    profile,
    start: async () => ({ url: 'http://127.0.0.1:49321', close: async () => {} }),
  });
  const microphone = '{"deviceId":"previous-origin-device","label":"selected microphone"}';
  await writeFile(join(profile, 'data', 'microphone.json'), microphone);
  const ports = [];
  await startStableStudio({
    profile,
    start: async (port) => {
      ports.push(port);
      if (port) throw Object.assign(Error('occupied'), { code: 'EADDRINUSE' });
      return { url: 'http://127.0.0.1:49322', close: async () => {} };
    },
  });
  assert.deepEqual(ports, [49321, 0]);
  assert.equal(storedPort(profile), 49322);
  assert.equal(await readFile(join(profile, 'data', 'microphone.json'), 'utf8'), microphone);
});

test('corrupt origin settings are preserved and never silently replaced', async (t) => {
  const profile = await fixture(t),
    file = join(profile, 'data', 'desktop-origin.json');
  await mkdir(join(profile, 'data'));
  await writeFile(file, '{broken');
  let starts = 0;
  await assert.rejects(
    startStableStudio({
      profile,
      start: async () => {
        starts++;
      },
    }),
    /보존/,
  );
  assert.equal(starts, 0);
  assert.equal(await readFile(file, 'utf8'), '{broken');
});

test('origin verification failure closes the newly owned service', async (t) => {
  const profile = await fixture(t);
  let closed = false;
  await assert.rejects(
    startStableStudio({
      profile,
      start: async () => ({
        url: 'http://0.0.0.0:49321',
        close: async () => {
          closed = true;
        },
      }),
    }),
    /로컬 연결 주소/,
  );
  assert.equal(closed, true);
  assert.equal(storedPort(profile), 0);
});
