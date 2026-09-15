import { createReadStream, createWriteStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { join, dirname } from 'node:path';
import { validateRuntimeComponent, verifyRuntimeComponent, regularAncestors, hashRuntimeFile } from '../../server/runtime-pack.js';

export async function writeRuntimePack(root, component, output, signal) {
  validateRuntimeComponent(component);
  await verifyRuntimeComponent(root, component, signal);
  await regularAncestors(dirname(output));
  const file = await open(output, 'wx');
  async function* bytes() {
    for (const entry of component.files) yield* createReadStream(join(root, entry.path), { signal });
  }
  try {
    await pipeline(Readable.from(bytes()), createGzip({ level: 6 }), createWriteStream(output, { fd: file.fd, autoClose: false }), { signal });
  } finally { await file.close(); }
  return { ...component, archive: { format: 'nagneon-runtime-gzip/1', ...await hashRuntimeFile(output, signal) } };
}
