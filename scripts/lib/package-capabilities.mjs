import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extractFile, getRawHeader, uncache } from '@electron/asar';

export const capabilityFile = 'nagneon-package.json';
const digest = async path => {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
};
function embeddedJson(archive, name) {
  let node = getRawHeader(archive).header;
  for (const part of name.split('/')) {
    if (node.link !== undefined || node.unpacked || !Object.hasOwn(node.files || {}, part))
      throw Error('Package capability must be packed inside the archive: ' + name);
    node = node.files[part];
  }
  if (node.link !== undefined || node.unpacked || node.files || node.size > 1024 * 1024)
    throw Error('Invalid packed capability entry: ' + name);
  return JSON.parse(extractFile(archive, join(...name.split('/'))).toString('utf8'));
}
export function validateReaderCapability(value) {
  if (!value || value.schema !== 'nagneon.profile-reader/1' ||
      !Number.isSafeInteger(value.reader) || value.reader < 1 || Object.keys(value).length !== 2)
    throw Error('Invalid profile reader capability.');
  return value.reader;
}
export async function derivePackageCapabilities(folder) {
  const archive = join(folder, 'resources/app.asar');
  uncache(archive);
  const pkg = embeddedJson(archive, 'package.json');
  if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(pkg.version) ||
      !pkg.version.split('.').map(Number).every(Number.isSafeInteger))
    throw Error('Invalid package application version.');
  const profileReader = validateReaderCapability(embeddedJson(archive, 'shared/profile-reader.json'));
  return {
    schema: 'nagneon.package-capabilities/1', appVersion: pkg.version, profileReader,
    exeSha256: await digest(join(folder, 'Nagneon.exe')), asarSha256: await digest(archive),
  };
}
export async function writePackageCapabilities(folder) {
  const capability = await derivePackageCapabilities(folder);
  await writeFile(join(folder, capabilityFile), JSON.stringify(capability, null, 2) + '\n');
  return capability;
}
export async function verifyPackageCapabilities(folder) {
  const declared = JSON.parse(await readFile(join(folder, capabilityFile), 'utf8'));
  const actual = await derivePackageCapabilities(folder);
  if (Object.keys(declared).length !== Object.keys(actual).length ||
      Object.entries(actual).some(([key, value]) => declared[key] !== value))
    throw Error('Package capability differs from its delivered application.');
  return actual;
}
