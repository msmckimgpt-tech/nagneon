import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createPackage, createPackageWithOptions, getRawHeader } from '@electron/asar';
import { PROFILE_READER } from '../server/profile-capabilities.js';
import { writePackageCapabilities, verifyPackageCapabilities, validateReaderCapability } from '../scripts/lib/package-capabilities.mjs';

test('packager binds the runtime reader to the delivered archive and final executable', async t => {
  await mkdir('artifacts/package-capability-tests', { recursive: true });
  const root = await mkdtemp(resolve('artifacts/package-capability-tests/run-'));
  const source = join(root, 'source'), folder = join(root, 'app');
  await mkdir(join(source, 'shared'), { recursive: true });
  await mkdir(join(folder, 'resources'), { recursive: true });
  await writeFile(join(source, 'package.json'), JSON.stringify({ version: '0.1.18' }));
  const reader = JSON.parse(await readFile('shared/profile-reader.json', 'utf8'));
  assert.equal(reader.reader, PROFILE_READER);
  await writeFile(join(source, 'shared/profile-reader.json'), JSON.stringify(reader));
  await writeFile(join(folder, 'Nagneon.exe'), 'synthetic final fuse-adjusted executable; never launched');
  await createPackage(source, join(folder, 'resources/app.asar'));
  const capability = await writePackageCapabilities(folder);
  assert.equal(capability.profileReader, PROFILE_READER);
  assert.deepEqual(await verifyPackageCapabilities(folder), capability);
  const original = await readFile(join(folder, 'nagneon-package.json'), 'utf8');
  await t.test('a reader claim cannot be altered while retaining genuine payload hashes', async () => {
    await writeFile(join(folder, 'nagneon-package.json'), JSON.stringify({ ...capability, profileReader: 99 }));
    await assert.rejects(verifyPackageCapabilities(folder), /differs/);
    await writeFile(join(folder, 'nagneon-package.json'), original);
  });
  await t.test('payload alteration invalidates an otherwise genuine receipt', async () => {
    await writeFile(join(folder, 'Nagneon.exe'), 'changed after receipt');
    await assert.rejects(verifyPackageCapabilities(folder), /differs/);
  });
  await t.test('unpacked capabilities cannot escape the archive hash', async () => {
    await createPackageWithOptions(source, join(folder, 'resources/unpacked.asar'), { unpackDir: 'shared' });
    assert.equal(getRawHeader(join(folder, 'resources/unpacked.asar')).header.files.shared.files['profile-reader.json'].unpacked, true);
    const { rename } = await import('node:fs/promises');
    await rename(join(folder, 'resources/unpacked.asar'), join(folder, 'resources/app.asar'));
    await assert.rejects(writePackageCapabilities(folder), /packed/);
  });
});
test('reader declarations reject future schema, coercion, arrays and unsafe numbers', () => {
  for (const value of [null, [], { schema: 'unknown', reader: 5 }, { schema: 'nagneon.profile-reader/1', reader: '5' },
    { schema: 'nagneon.profile-reader/1', reader: true }, { schema: 'nagneon.profile-reader/1', reader: 0 },
    { schema: 'nagneon.profile-reader/1', reader: 5.5 }, { schema: 'nagneon.profile-reader/1', reader: Number.MAX_SAFE_INTEGER + 1 },
    { schema: 'nagneon.profile-reader/1', reader: 5, extra: true }])
    assert.throws(() => validateReaderCapability(value), /Invalid/);
});
