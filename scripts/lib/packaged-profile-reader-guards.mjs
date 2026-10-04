import assert from 'node:assert/strict';
import { isAbsolute, relative, resolve, dirname } from 'node:path';
import { existsSync, lstatSync, realpathSync } from 'node:fs';

export function unredirectedArtifactRoot(
  root,
  filesystem = { existsSync, lstatSync, realpathSync },
) {
  assert.ok(isAbsolute(root), 'Artifact root must be absolute');
  let ancestor = root;
  while (!filesystem.existsSync(ancestor)) {
    assert.notEqual(ancestor, dirname(ancestor), 'Artifact root has no existing ancestor');
    ancestor = dirname(ancestor);
  }
  for (let part = ancestor; ; part = dirname(part)) {
    assert.ok(
      filesystem.lstatSync(part).isDirectory() && !filesystem.lstatSync(part).isSymbolicLink(),
      'Artifact ancestor is a link or non-directory',
    );
    assert.equal(
      filesystem.realpathSync(part).toLowerCase(),
      resolve(part).toLowerCase(),
      'Artifact ancestor is redirected',
    );
    if (part === dirname(part)) break;
  }
}

// These guards do not open a profile, launch an app or establish acceptance.
export function artifactPath(root, value) {
  assert.ok(isAbsolute(root) && isAbsolute(value), 'Artifact paths must be absolute');
  const suffix = relative(root, value);
  assert.ok(
    suffix &&
      !isAbsolute(suffix) &&
      suffix !== '..' &&
      !suffix.startsWith('../') &&
      !suffix.startsWith('..\\'),
    'Path must be strictly inside this worktree artifacts',
  );
  return resolve(value);
}

export function loopbackUrl(value, { protocol = 'http:', port, debuggerSocket = false } = {}) {
  const url = new URL(value);
  assert.equal(url.protocol, protocol, 'Unexpected local transport protocol');
  assert.equal(url.hostname, '127.0.0.1', 'Only the isolated IPv4 loopback is allowed');
  assert.ok(!url.username && !url.password && !url.hash && !url.search, 'Unexpected URL fields');
  assert.ok(
    Number(url.port) > 0 && Number(url.port) <= 65535,
    'An explicit local port is required',
  );
  if (port !== undefined) assert.equal(Number(url.port), port, 'Debugger port differs');
  if (debuggerSocket) assert.match(url.pathname, /^\/devtools\/page\/[a-zA-Z0-9-]+$/);
  return url.href;
}

// Used only while reading this run's fresh DevToolsActivePort. Permission,
// malformed content and all unrelated errors remain failures.
export function pendingDebuggerPort(error) {
  return error?.code === 'ENOENT' || error?.code === 'EBUSY';
}

export function backgroundObservation(text, { profile, version, failure = false }) {
  const observations = [];
  for (const line of text.split(/\r?\n/)) {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      assert.ok(!line.includes('background-observation'), 'Malformed background result');
      continue;
    }
    assert.notEqual(
      value?.kind,
      'background-observation-cancelled',
      'Background run was cancelled',
    );
    if (value?.kind === 'background-observation') observations.push(value);
  }
  assert.equal(observations.length, 1, 'Exactly one complete background result is required');
  const result = observations[0];
  assert.equal(result.profile, profile, 'Reported profile differs');
  assert.equal(result.version, version, 'Reported version differs');
  assert.equal(result.passed, !failure, 'Unexpected background result');
  if (failure) {
    assert.equal(result.stage, 'startup', 'Failure must be a startup rejection');
    assert.ok(typeof result.error === 'string' && result.error.trim(), 'Startup error is missing');
  } else {
    assert.equal(result.shutdownDelayMs, 10000, 'Delivered diagnostic delay differs');
    assert.equal(result.visible, false);
    assert.equal(result.rendererReady, true);
    assert.equal(result.displayedVersion, version, 'Renderer version must be observed');
    assert.equal(result.running, false);
    assert.equal(result.periodicWorkPaused, true);
    assert.equal(result.provider?.kind, 'openai');
  }
  return result;
}

export function syntheticEnvironment(environment, profile) {
  const isolated = { ...environment };
  for (const name of Object.keys(isolated)) {
    if (
      /(?:^|_)(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|COOKIE)(?:_|$)/i.test(name) ||
      /^(?:OPENAI_MODEL|OPENAI_REASONING_EFFORT|NODE_OPTIONS|CODEX_HOME)$/i.test(name)
    )
      delete isolated[name];
  }
  return {
    ...isolated,
    AI_PROVIDER: 'openai',
    CODEX_HOME: resolve(profile, 'codex-home'),
    APPDATA: resolve(profile, 'roaming'),
    LOCALAPPDATA: resolve(profile, 'local'),
    TEMP: resolve(profile, 'temp'),
    TMP: resolve(profile, 'temp'),
    ELECTRON_RUN_AS_NODE: '',
  };
}

export function assertDurableInventory(before, after, referencedChunkHashes, desktopOriginRow) {
  if (desktopOriginRow) assert.equal(desktopOriginRow.path, 'desktop-origin.json');
  const mutable = (name) =>
    /^(?:world|profile-format|conversation-journal-index)\.json(?:\.bak\.[1-3])?$/.test(name) ||
    /^broadcast-trace\/(?:correlation\.json(?:\.bak\.[1-3])?|trace-\d{13}-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.jsonl)$/.test(
      name,
    );
  for (const row of before) {
    if (!mutable(row.path))
      assert.deepEqual(
        after.find((other) => other.path === row.path),
        row,
        'Unrelated durable input changed: ' + row.path,
      );
  }
  for (const row of after) {
    if (before.some((other) => other.path === row.path) || mutable(row.path)) continue;
    if (desktopOriginRow && row.path === 'desktop-origin.json') {
      assert.deepEqual(row, desktopOriginRow, 'Desktop origin differs from validated endpoint');
      continue;
    }
    const chunk = /^conversation-journal-chunks\/([a-f0-9]{64})\.json$/.exec(row.path);
    assert.ok(
      chunk && referencedChunkHashes.includes(chunk[1]) && row.sha256 === chunk[1],
      'Unexpected new durable path: ' + row.path,
    );
  }
}

export function assertRestartWitness(before) {
  assert.equal(
    new Set(before.map((row) => row.path)).size,
    before.length,
    'Restart inventory contains duplicate paths',
  );
  const names = ['world.json', 'world.json.bak.1', 'world.json.bak.2', 'world.json.bak.3'];
  const rows = names.map((name) => before.find((row) => row.path === name));
  assert.ok(rows.every(Boolean), 'Restart requires all three world backup generations');
  assert.equal(
    new Set(rows.map((row) => row.sha256)).size,
    names.length,
    'Restart requires distinct primary and backup witnesses to detect every rotation',
  );
  return rows;
}

export function assertRestartInventory(before, after) {
  assertRestartWitness(before);
  assert.equal(new Set(after.map((row) => row.path)).size, after.length);
  for (const row of before) {
    assert.deepEqual(
      after.find((other) => other.path === row.path),
      row,
      'Read-only restart changed durable input: ' + row.path,
    );
  }
  for (const row of after) {
    if (before.some((other) => other.path === row.path)) continue;
    assert.match(
      row.path,
      /^broadcast-trace\/trace-\d{13}-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.jsonl$/,
      'Restart added an unexpected durable path',
    );
  }
}
