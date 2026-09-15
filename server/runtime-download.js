import { mkdir, mkdtemp, lstat, open, rename, rm, rmdir } from 'node:fs/promises';
import { resolve, join, dirname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { validateRuntimeComponent, regularAncestors, hashRuntimeFile } from './runtime-pack.js';

// The URL and integrity record must come from the catalog shipped in the app.
// No account credentials, user profile, or renderer-supplied manifest is used.
export async function downloadRuntimePack({ url, component, cache, signal, repair = false, onProgress = () => {}, fetcher = fetch }) {
  validateRuntimeComponent(component);
  const expected = component.archive;
  if (expected?.format !== 'nagneon-runtime-gzip/1' || !Number.isSafeInteger(expected.bytes) || expected.bytes <= 0 || !/^[a-f0-9]{64}$/.test(expected.sha256)) throw Error('Invalid runtime archive');
  const address = new URL(url);
  if (address.protocol !== 'https:' || address.username || address.password) throw Error('Runtime download requires HTTPS');
  cache = resolve(cache); await regularAncestors(cache); await mkdir(cache, { recursive: true });
  const target = join(cache, expected.sha256 + '.ngpack');
  const existing = await lstat(target).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
  if (existing) {
    const actual = await hashRuntimeFile(target, signal);
    if (actual.bytes === expected.bytes && actual.sha256 === expected.sha256) return { path: target, reused: true };
    if(!repair)throw Error('Cached runtime archive is damaged');
  }
  const lock = target + '.lock'; await mkdir(lock);
  let stage, handle, response;
  try {
    signal?.throwIfAborted();
    response = await fetcher(address.href, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (response.url && new URL(response.url).protocol !== 'https:') throw Error('Runtime redirect requires HTTPS');
    if (!response.ok || !response.body) throw Error('Runtime download failed: HTTP ' + response.status);
    const length = response.headers.get('content-length');
    if (length !== null && Number(length) !== expected.bytes) throw Error('Runtime download size differs');
    stage = await mkdtemp(join(cache, '.download-'));
    const temporary = join(stage, 'payload'); handle = await open(temporary, 'wx');
    let total = 0; const hash = createHash('sha256');
    for await (const chunk of response.body) {
      signal?.throwIfAborted();
      total += chunk.byteLength;
      if (total > expected.bytes) throw Error('Runtime download exceeds expected size');
      hash.update(chunk);
      let offset = 0;
      while (offset < chunk.byteLength) {
        const written = await handle.write(chunk, offset, chunk.byteLength - offset);
        if (!written.bytesWritten) throw Error('Runtime download write stalled');
        offset += written.bytesWritten;
      }
      onProgress({ downloadedBytes: total, totalBytes: expected.bytes });
    }
    if (total !== expected.bytes || hash.digest('hex') !== expected.sha256) throw Error('Runtime download integrity mismatch');
    signal?.throwIfAborted();
    await handle.close(); handle = null;
    await rename(temporary, target);
    return { path: target, reused: false };
  } finally {
    await handle?.close();
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
    if (stage && dirname(stage) === cache && stage.startsWith(cache + sep + '.download-')) await rm(stage, { recursive: true });
    await rmdir(lock);
  }
}
