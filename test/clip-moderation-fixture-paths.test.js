import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  linkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import {
  artifactPath,
  unredirectedArtifactRoot,
} from '../scripts/lib/packaged-profile-reader-guards.mjs';
import { createClipFixtureFiles } from './lib/clip-moderation-fixture-paths.js';

function sandbox(t) {
  const artifacts = resolve('artifacts');
  unredirectedArtifactRoot(artifacts);
  mkdirSync(artifacts, { recursive: true });
  unredirectedArtifactRoot(artifacts);
  const root = mkdtempSync(join(artifacts, 'clip-fixture-paths-'));
  t.after(() => {
    artifactPath(artifacts, root);
    unredirectedArtifactRoot(root);
    const visit = (dir) => {
      for (const name of readdirSync(dir)) {
        const file = join(dir, name),
          stat = lstatSync(file);
        assert.equal(
          stat.isSymbolicLink(),
          false,
          'Preserve a sandbox whose link was not restored',
        );
        if (stat.isDirectory()) visit(file);
        else assert.ok(stat.isFile());
      }
    };
    visit(root);
    assert.equal(realpathSync.native(root), root);
    rmSync(root, { recursive: true });
  });
  const outside = join(root, 'owned-target');
  mkdirSync(outside);
  writeFileSync(join(outside, 'sentinel.json'), 'synthetic target must stay unchanged');
  return { root, outside, artifacts: join(root, 'artifacts') };
}
const junction = (target, path) =>
  symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir');
function unlinkDirectoryLink(path) {
  assert.ok(lstatSync(path).isSymbolicLink());
  if (process.platform === 'win32') rmdirSync(path);
  else unlinkSync(path);
}
function inventory(root) {
  const rows = [];
  const visit = (dir, prefix = '') => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name),
        stat = lstatSync(path),
        relative = prefix + name;
      assert.equal(stat.isSymbolicLink(), false);
      if (stat.isDirectory()) {
        rows.push({ path: relative, type: 'directory' });
        visit(path, relative + '/');
      } else
        rows.push({
          path: relative,
          type: 'file',
          bytes: stat.size,
          sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
        });
    }
  };
  visit(root);
  return rows;
}

test('clip fixture creates missing directories, preserves JSON and removes only its own flat files', (t) => {
  const f = sandbox(t),
    root = join(f.artifacts, 'nested'),
    files = createClipFixtureFiles(root);
  assert.ok(existsSync(files.folder));
  const world = { title: '원문 ＳＹＮＴＨ', balance: 200 },
    clips = [{ title: 'MiXeD 원문' }];
  files.write('world.json', world);
  files.write('world.json', { ...world, balance: 201 });
  files.write('clips.json', clips);
  assert.deepEqual(JSON.parse(files.read('world.json')), { ...world, balance: 201 });
  assert.deepEqual(JSON.parse(files.read('clips.json')), clips);
  files.remove();
  assert.equal(existsSync(files.folder), false);
  assert.throws(() => files.write('world.json', world), /already removed/);
  assert.deepEqual(readdirSync(root), []);
});

test('an artifacts junction is rejected before creating any fixture or target bytes', (t) => {
  const f = sandbox(t),
    before = inventory(f.outside);
  junction(f.outside, f.artifacts);
  try {
    assert.throws(() => createClipFixtureFiles(f.artifacts), /link|redirected/);
    assert.deepEqual(inventory(f.outside), before);
  } finally {
    unlinkDirectoryLink(f.artifacts);
  }
});

test('a junction ancestor is rejected before mkdir of a missing artifacts path', (t) => {
  const f = sandbox(t),
    alias = join(f.root, 'alias'),
    before = inventory(f.outside);
  junction(f.outside, alias);
  try {
    assert.throws(
      () => createClipFixtureFiles(join(alias, 'missing', 'artifacts')),
      /link|redirected/,
    );
    assert.deepEqual(inventory(f.outside), before);
    assert.equal(existsSync(join(f.outside, 'missing')), false);
  } finally {
    unlinkDirectoryLink(alias);
  }
});

test('a dangling junction ancestor is rejected without creating its target', (t) => {
  const f = sandbox(t),
    missing = join(f.root, 'absent-target'),
    alias = join(f.root, 'dangling');
  junction(missing, alias);
  try {
    assert.throws(() => createClipFixtureFiles(join(alias, 'artifacts')), /link|redirected/);
    assert.equal(existsSync(missing), false);
  } finally {
    unlinkDirectoryLink(alias);
  }
});

for (const kind of ['fixture directory', 'artifacts directory']) {
  test('replacing the ' + kind + ' with a junction blocks persist, read and cleanup', (t) => {
    const f = sandbox(t),
      files = createClipFixtureFiles(f.artifacts);
    files.write('world.json', { original: true });
    const original = kind === 'fixture directory' ? files.folder : f.artifacts,
      parked = join(f.root, 'parked');
    const beforeTarget = inventory(f.outside),
      beforeOwned = inventory(original);
    renameSync(original, parked);
    junction(f.outside, original);
    try {
      for (const operation of [
        () => files.write('world.json', { bad: true }),
        () => files.read('world.json'),
        () => files.remove(),
      ])
        assert.throws(operation, /link|redirected/);
      assert.deepEqual(inventory(f.outside), beforeTarget);
      assert.deepEqual(inventory(parked), beforeOwned);
    } finally {
      unlinkDirectoryLink(original);
      renameSync(parked, original);
      files.remove();
    }
  });
}

test('a replacement regular directory at the same path cannot gain fixture ownership', (t) => {
  const f = sandbox(t),
    files = createClipFixtureFiles(f.artifacts),
    parked = join(f.root, 'parked');
  files.write('world.json', { original: true });
  renameSync(files.folder, parked);
  mkdirSync(files.folder);
  writeFileSync(join(files.folder, 'world.json'), 'unowned replacement');
  const replacement = inventory(files.folder),
    original = inventory(parked);
  try {
    for (const operation of [
      () => files.write('world.json', { bad: true }),
      () => files.read('world.json'),
      () => files.remove(),
    ])
      assert.throws(operation, /identity changed/);
    assert.deepEqual(inventory(files.folder), replacement);
    assert.deepEqual(inventory(parked), original);
  } finally {
    unlinkSync(join(files.folder, 'world.json'));
    rmdirSync(files.folder);
    renameSync(parked, files.folder);
    files.remove();
  }
});

test('linked files and unknown cleanup entries preserve target and all existing fixture bytes', (t) => {
  const f = sandbox(t),
    files = createClipFixtureFiles(f.artifacts);
  files.write('clips.json', [{ original: true }]);
  const target = join(f.outside, 'sentinel.json'),
    linked = join(files.folder, 'world.json'),
    before = inventory(f.outside),
    original = files.read('clips.json');
  linkSync(target, linked);
  try {
    for (const operation of [
      () => files.write('world.json', { bad: true }),
      () => files.read('world.json'),
      () => files.remove(),
    ])
      assert.throws(operation, /linked|non-regular/);
    assert.deepEqual(inventory(f.outside), before);
    assert.equal(files.read('clips.json'), original);
  } finally {
    unlinkSync(linked);
  }
  const unknown = join(files.folder, 'unknown');
  junction(f.outside, unknown);
  try {
    assert.throws(() => files.remove(), /Unexpected fixture filename/);
    assert.deepEqual(inventory(f.outside), before);
    assert.equal(files.read('clips.json'), original);
  } finally {
    unlinkDirectoryLink(unknown);
    files.remove();
  }
});

test('relative roots, traversal and unknown filenames cannot create a file', (t) => {
  const f = sandbox(t),
    files = createClipFixtureFiles(f.artifacts),
    before = inventory(f.outside);
  assert.throws(() => createClipFixtureFiles('relative'), /absolute/);
  for (const name of [
    '../owned-target/sentinel.json',
    '../outside.json',
    'world.json.extra',
    'clips.json/child',
    '',
  ]) {
    assert.throws(() => files.write(name, { bad: true }), /Unexpected fixture filename/);
    assert.throws(() => files.read(name), /Unexpected fixture filename/);
  }
  assert.deepEqual(readdirSync(files.folder), []);
  assert.deepEqual(inventory(f.outside), before);
  files.remove();
});
