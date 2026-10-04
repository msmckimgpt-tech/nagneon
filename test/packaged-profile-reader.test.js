import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import {
  artifactPath,
  loopbackUrl,
  backgroundObservation,
  syntheticEnvironment,
  assertDurableInventory,
  unredirectedArtifactRoot,
  assertRestartInventory,
  assertRestartWitness,
  pendingDebuggerPort,
} from '../scripts/lib/packaged-profile-reader-guards.mjs';

test('debugger discovery retries a pending fresh file without masking denied access or invalid data', () => {
  assert.equal(pendingDebuggerPort({ code: 'ENOENT' }), true);
  assert.equal(pendingDebuggerPort({ code: 'EBUSY' }), true);
  for (const value of [
    null,
    Error('Malformed port'),
    { code: 'EACCES' },
    { code: 'EPERM' },
    { code: 'ELOOP' },
    { code: 'ECONNREFUSED' },
  ])
    assert.equal(pendingDebuggerPort(value), false);
});

test('artifact ancestors are checked without writes before creating a missing root', () => {
  const root = resolve('artifacts/not-created');
  const regular = {
    existsSync: (path) => path !== root,
    lstatSync: () => ({ isDirectory: () => true, isSymbolicLink: () => false }),
    realpathSync: (path) => path,
  };
  assert.doesNotThrow(() => unredirectedArtifactRoot(root, regular));
  assert.throws(() =>
    unredirectedArtifactRoot(root, {
      ...regular,
      lstatSync: () => ({ isDirectory: () => true, isSymbolicLink: () => true }),
    }),
  );
  assert.throws(() =>
    unredirectedArtifactRoot(root, { ...regular, realpathSync: () => resolve('foreign') }),
  );
  assert.throws(() => unredirectedArtifactRoot('relative', regular));
});

test('read-only restart accepts exactly one distinguishable backup rotation and a fresh lifecycle trace', () => {
  const row = (path, letter) => ({ path, bytes: letter.charCodeAt(0), sha256: letter.repeat(64) });
  const before = [
    row('world.json', 'a'),
    row('world.json.bak.1', 'a'),
    row('world.json.bak.2', 'b'),
    row('world.json.bak.3', 'c'),
    row('profile-format.json', 'd'),
    row('conversation-journal-index.json', 'e'),
    row('conversation-journal-chunks/' + 'f'.repeat(64) + '.json', 'f'),
    row('desktop-origin.json', 'd'),
    row('missions.json', 'e'),
  ];
  // Independent expected vector: [P=A,B1=A,B2=B,B3=C] -> [A,A,A,B].
  const once = [
    row('world.json', 'a'),
    row('world.json.bak.1', 'a'),
    row('world.json.bak.2', 'a'),
    row('world.json.bak.3', 'b'),
    ...before.slice(4),
  ];
  const trace = {
    path: 'broadcast-trace/trace-1790901910360-00000000-0000-4000-8000-000000000000.jsonl',
    bytes: 100,
    sha256: 'b'.repeat(64),
  };
  assert.doesNotThrow(() => assertRestartWitness(before));
  assert.doesNotThrow(() => assertRestartInventory(before, [...once, trace]));
  assert.throws(() => assertRestartInventory(before, before)); // zero saves
  const twice = [...once];
  twice[3] = row('world.json.bak.3', 'a');
  assert.throws(() => assertRestartInventory(before, twice));
  assert.throws(() => assertRestartInventory(before, once.slice(1)));
  for (const path of [
    'world.json.bak.4',
    'world.json.tmp',
    'world.json.corrupt-unknown',
    'unknown.json',
    'broadcast-trace/unexpected.json',
  ])
    assert.throws(() => assertRestartInventory(before, [...once, row(path, 'd')]));
  for (let index = 0; index < once.length; index++) {
    const changed = structuredClone(once);
    changed[index].sha256 = '0'.repeat(64);
    assert.throws(() => assertRestartInventory(before, changed));
  }
  const ambiguous = before.map((r) =>
    r.path.startsWith('world.json') ? { ...r, sha256: 'a'.repeat(64) } : r,
  );
  assert.throws(() => assertRestartWitness(ambiguous));
  assert.throws(() => assertRestartInventory(before, [...once, once[0]]));
});

test('packaged profile guards reject artifact root, relative paths and sibling escapes', () => {
  const root = resolve('artifacts');
  assert.equal(artifactPath(root, resolve(root, 'case/profile')), resolve(root, 'case/profile'));
  for (const path of [
    root,
    'relative/profile',
    resolve(root, '../foreign'),
    resolve(root + '-other/profile'),
  ])
    assert.throws(() => artifactPath(root, path));
});

test('isolated debugger URLs cannot redirect evaluation to a foreign service', () => {
  assert.equal(
    loopbackUrl('ws://127.0.0.1:4567/devtools/page/test-123', {
      protocol: 'ws:',
      port: 4567,
      debuggerSocket: true,
    }),
    'ws://127.0.0.1:4567/devtools/page/test-123',
  );
  for (const url of [
    'ws://example.com:4567/devtools/page/test',
    'ws://localhost:4567/devtools/page/test',
    'ws://user@127.0.0.1:4567/devtools/page/test',
    'ws://127.0.0.1:4568/devtools/page/test',
    'ws://127.0.0.1:4567/devtools/browser/test',
    'ws://127.0.0.1:4567/devtools/page/test#fragment',
  ])
    assert.throws(() => loopbackUrl(url, { protocol: 'ws:', port: 4567, debuggerSocket: true }));
});

const profile = resolve('artifacts/synthetic/profile'),
  version = '0.1.18';
const ready = {
  kind: 'background-observation',
  passed: true,
  profile,
  version,
  shutdownDelayMs: 10000,
  visible: false,
  rendererReady: true,
  displayedVersion: version,
  running: false,
  periodicWorkPaused: true,
  provider: { kind: 'openai' },
};
test('exit zero or partial, failed and duplicate readiness records do not imply acceptance', () => {
  assert.deepEqual(
    backgroundObservation('other log\n' + JSON.stringify(ready), { profile, version }),
    ready,
  );
  for (const text of [
    '',
    'exit 0',
    JSON.stringify(ready).slice(0, -1),
    JSON.stringify(ready) + '\n' + JSON.stringify(ready),
    JSON.stringify({ ...ready, passed: false }),
    JSON.stringify({ ...ready, profile: resolve('artifacts/foreign') }),
    JSON.stringify({ ...ready, displayedVersion: null }),
    JSON.stringify({ ...ready, shutdownDelayMs: 1500 }),
    JSON.stringify({ ...ready, periodicWorkPaused: false }),
    JSON.stringify(ready) + '\n' + '{"kind":"background-observation"',
    JSON.stringify(ready) + '\n' + JSON.stringify({ kind: 'background-observation-cancelled' }),
  ])
    assert.throws(() => backgroundObservation(text, { profile, version }));
});

test('durable inventory rejects unknown additions, removed inputs and permissive filename prefixes', () => {
  const row = { path: 'missions.json', bytes: 8, sha256: 'a'.repeat(64) };
  const before = [row, { path: 'world.json', bytes: 4, sha256: 'b'.repeat(64) }];
  const newHash = 'c'.repeat(64);
  const valid = [
    ...before,
    { path: 'conversation-journal-chunks/' + newHash + '.json', bytes: 10, sha256: newHash },
  ];
  assert.doesNotThrow(() => assertDurableInventory(before, valid, [newHash]));
  for (const after of [
    valid.slice(1),
    [...before, { path: 'unknown.json', bytes: 4, sha256: newHash }],
    [...before, { path: 'world.jsonx', bytes: 4, sha256: newHash }],
    valid.map((r) => (r.path.startsWith('conversation-') ? { ...r, sha256: 'd'.repeat(64) } : r)),
  ])
    assert.throws(() => assertDurableInventory(before, after, [newHash]));
  assert.throws(() => assertDurableInventory(before, valid, []));
  const origin = { path: 'desktop-origin.json', bytes: 26, sha256: newHash };
  assert.doesNotThrow(() => assertDurableInventory(before, [...before, origin], [], origin));
  assert.throws(() =>
    assertDurableInventory(before, [...before, origin], [], { ...origin, path: 'unknown.json' }),
  );
  assert.throws(() =>
    assertDurableInventory(before, [...before, origin], [], { ...origin, sha256: 'd'.repeat(64) }),
  );
});

test('negative acceptance requires an explicit startup failure for the expected profile', () => {
  const failure = {
    kind: 'background-observation',
    passed: false,
    stage: 'startup',
    profile,
    version,
    error: '합성 시작 오류',
  };
  assert.deepEqual(
    backgroundObservation(JSON.stringify(failure), { profile, version, failure: true }),
    failure,
  );
  for (const value of [
    ready,
    { ...failure, error: '' },
    { ...failure, stage: 'renderer' },
    { ...failure, passed: true },
  ])
    assert.throws(() =>
      backgroundObservation(JSON.stringify(value), { profile, version, failure: true }),
    );
});

test('synthetic child environment drops credentials without modifying its parent', () => {
  const original = {
    PATH: 'local-runtime',
    OPENAI_API_KEY: 'synthetic-key',
    ANTHROPIC_API_KEY: 'synthetic-key',
    ACCESS_TOKEN: 'synthetic-token',
    PASSWORD: 'synthetic-password',
    OPENAI_MODEL: 'parent-model',
    OPENAI_REASONING_EFFORT: 'parent-effort',
    NODE_OPTIONS: '--require=foreign',
    CODEX_HOME: 'parent-home',
    TEMP: 'synthetic-parent-temp',
    TMP: 'synthetic-parent-tmp',
  };
  const child = syntheticEnvironment(original, profile);
  for (const key of [
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'ACCESS_TOKEN',
    'PASSWORD',
    'OPENAI_MODEL',
    'OPENAI_REASONING_EFFORT',
    'NODE_OPTIONS',
  ])
    assert.equal(Object.hasOwn(child, key), false);
  assert.equal(child.CODEX_HOME, resolve(profile, 'codex-home'));
  assert.equal(child.AI_PROVIDER, 'openai');
  assert.equal(child.PATH, original.PATH);
  assert.equal(original.OPENAI_API_KEY, 'synthetic-key');
  assert.equal(child.TEMP, resolve(profile, 'temp'));
  assert.equal(child.TMP, resolve(profile, 'temp'));
  assert.equal(original.TEMP, 'synthetic-parent-temp');
  assert.equal(original.TMP, 'synthetic-parent-tmp');
});
