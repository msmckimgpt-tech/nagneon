import assert from 'node:assert/strict';
import { isAbsolute, dirname, join, resolve } from 'node:path';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import {
  artifactPath,
  unredirectedArtifactRoot,
} from '../../scripts/lib/packaged-profile-reader-guards.mjs';

const filenames = new Set(['world.json', 'clips.json']);
const samePath = (a, b) =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const identity = (stat) => ({ dev: stat.dev, ino: stat.ino, birthtimeMs: stat.birthtimeMs });
function statIfPresent(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
function directoryChain(path, { allowMissing = false } = {}) {
  assert.ok(isAbsolute(path), 'Fixture directory must be absolute');
  // lstat also detects dangling links, which existsSync would skip.
  for (let part = path; ; part = dirname(part)) {
    const stat = statIfPresent(part);
    if (!stat) assert.ok(allowMissing, 'Fixture directory is missing');
    else {
      assert.ok(
        stat.isDirectory() && !stat.isSymbolicLink(),
        'Fixture ancestor is a link or non-directory',
      );
      assert.ok(
        samePath(realpathSync.native(part), resolve(part)),
        'Fixture ancestor is redirected',
      );
    }
    if (part === dirname(part)) break;
  }
  unredirectedArtifactRoot(path);
}

// This is an owned synthetic fixture, not a general filesystem sandbox. Checks
// precede each operation; they do not make concurrent path replacement atomic.
export function createClipFixtureFiles(artifacts = resolve('artifacts')) {
  assert.ok(isAbsolute(artifacts), 'Fixture artifacts must be absolute');
  artifacts = resolve(artifacts);
  directoryChain(artifacts, { allowMissing: true });
  mkdirSync(artifacts, { recursive: true });
  directoryChain(artifacts);
  const rootIdentity = identity(lstatSync(artifacts));
  const folder = mkdtempSync(join(artifacts, 'clip-moderation-'));
  artifactPath(artifacts, folder);
  directoryChain(folder);
  const folderIdentity = identity(lstatSync(folder));
  let removed = false;
  function owned() {
    assert.equal(removed, false, 'Fixture was already removed');
    directoryChain(artifacts);
    assert.deepEqual(
      identity(lstatSync(artifacts)),
      rootIdentity,
      'Fixture artifacts identity changed',
    );
    artifactPath(artifacts, folder);
    directoryChain(folder);
    assert.deepEqual(
      identity(lstatSync(folder)),
      folderIdentity,
      'Fixture directory identity changed',
    );
  }
  function file(name, { required = false } = {}) {
    assert.ok(filenames.has(name), 'Unexpected fixture filename');
    owned();
    const path = artifactPath(folder, join(folder, name)),
      stat = statIfPresent(path);
    if (stat) {
      assert.ok(
        stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1,
        'Fixture file is linked or non-regular',
      );
      assert.ok(samePath(realpathSync.native(path), resolve(path)), 'Fixture file is redirected');
    } else assert.equal(required, false, 'Fixture file is missing');
    return path;
  }
  return {
    folder,
    write(name, data) {
      writeFileSync(file(name), JSON.stringify(data));
    },
    read(name) {
      return readFileSync(file(name, { required: true }), 'utf8');
    },
    remove() {
      owned();
      const names = readdirSync(folder);
      // Validate the complete flat fixture before deleting its first file.
      for (const name of names) file(name, { required: true });
      for (const name of names) unlinkSync(file(name, { required: true }));
      owned();
      rmdirSync(folder);
      removed = true;
    },
  };
}
