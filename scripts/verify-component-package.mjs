// Base-package acceptance only. Does not claim speech/device/model acceptance.
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, lstat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { extractFile } from '@electron/asar';
import { getCurrentFuseWire, FuseV1Options, FuseState } from '@electron/fuses';
import { verifyPackageSources } from './lib/package-sources.mjs';
import { validatePackageCatalog } from './lib/package-layout.mjs';
import { componentForPath } from './lib/distribution-components.mjs';

const { folder, manifest, build } = JSON.parse(await readFile('artifacts/latest-package.json', 'utf8'));
const spec = JSON.parse(await readFile(manifest, 'utf8'));
const archive = join(folder, 'resources/app.asar');
const catalog = validatePackageCatalog(JSON.parse(extractFile(archive, 'shared/runtime-catalog.json')));
const hash = async path => {
  const h = createHash('sha256');
  for await (const bytes of createReadStream(path)) h.update(bytes);
  return h.digest('hex');
};
async function files(root, prefix = '') {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    assert.equal(entry.isSymbolicLink(), false, 'No links: ' + prefix + entry.name);
    if (entry.isDirectory()) result.push(...await files(join(root, entry.name), prefix + entry.name + '/'));
    else { assert.ok(entry.isFile()); result.push(prefix + entry.name); }
  }
  return result.sort();
}
assert.equal(spec.layout, 'components');
assert.deepEqual((await readdir(join(folder, 'locales'))).sort(), ['en-US.pak', 'ko.pak']);
assert.deepEqual(spec.localePruning.kept, ['en-US', 'ko']);
assert.deepEqual(JSON.parse(await readFile(join(folder, 'resources/runtime-components.json'), 'utf8')), { schema: 'nagneon-runtime-layout/1', mode: 'components' });
assert.deepEqual(await files(folder), spec.files.map(f => f.path).sort());
for (const file of spec.files) {
  const path = join(folder, file.path);
  assert.equal((await lstat(path)).size, file.bytes);
  assert.equal(await hash(path), file.sha256, file.path);
  assert.equal(componentForPath(file.path), 'app', 'Optional payload in base package: ' + file.path);
}
const sourceCheck = await verifyPackageSources(resolve('.'), folder, spec.sourceManifest);
assert.equal(sourceCheck.passed, true, sourceCheck.failures.join('\n'));
const staged = (await files(join(build, 'runtime'))).filter(path => !path.startsWith('codex/'));
assert.deepEqual(staged, ['runtime-components.json', 'sound/sound_worker.py', 'speech/clip_inspector.py', 'speech/clip_perception.py', 'speech/speech_worker.py']);
const fuses = await getCurrentFuseWire(join(folder, 'Nagneon.exe'));
for (const option of [FuseV1Options.RunAsNode, FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseV1Options.EnableNodeCliInspectArguments, FuseV1Options.GrantFileProtocolExtraPrivileges]) assert.equal(fuses[option], FuseState.DISABLE);
for (const option of [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseV1Options.OnlyLoadAppFromAsar]) assert.equal(fuses[option], FuseState.ENABLE);
const result = {
  passed: true, checkedAt: new Date().toISOString(), folder, build,
  scope: 'base package integrity and staging; no device/model/runtime inference',
  files: spec.files.length, matchingSources: sourceCheck.matchingSources,
  bytes: spec.files.reduce((sum, f) => sum + f.bytes, 0),
  archiveSha256: await hash(archive),
  stagedOptionalPayloads: 0,
  optionalBytesNotStaged: catalog.components.reduce((sum, c) => sum + c.bytes, 0),
  optionalComponents: catalog.components.map(({ id, contentId, bytes, archive }) => ({ id, contentId, bytes, downloadBytes: archive.bytes })),
};
await writeFile('artifacts/component-package-verification.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
