import { createReadStream } from 'node:fs';
import { mkdir, lstat, mkdtemp, open, rename, rm, rmdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { resolve, join, dirname, sep } from 'node:path';

const digest = () => createHash('sha256');
export function validateRuntimeComponent(component) {
  if (!['audio', 'sound', 'microphone', 'gpu'].includes(component.id) || !Array.isArray(component.files) || !component.files.length) throw Error('Invalid runtime component');
  const seen = new Set();
  let total = 0;
  for (const file of component.files) {
    if (typeof file.path !== 'string' || !file.path.startsWith('resources/') || /[\\:\x00-\x1f]/.test(file.path) || file.path.split('/').some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p))) throw Error('Invalid runtime path');
    if (seen.has(file.path.toLowerCase())) throw Error('Duplicate runtime path');
    seen.add(file.path.toLowerCase());
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw Error('Invalid runtime integrity');
    total += file.bytes;
  }
  if (!Number.isSafeInteger(total) || total !== component.bytes || digest().update(JSON.stringify(component.files)).digest('hex') !== component.contentId) throw Error('Runtime content identity mismatch');
  return component;
}

export async function regularAncestors(path) {
  for (let current = resolve(path);; current = dirname(current)) {
    const stat = await lstat(current).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw Error('Runtime directory must not be linked');
    if (dirname(current) === current) break;
  }
}

export async function hashRuntimeFile(path, signal) {
  signal?.throwIfAborted();
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Runtime file must be regular');
  const hash = digest();
  for await (const bytes of createReadStream(path, { signal })) hash.update(bytes);
  return { bytes: stat.size, sha256: hash.digest('hex') };
}

export async function verifyRuntimeComponent(root, component, signal) {
  validateRuntimeComponent(component);
  await regularAncestors(root);
  for (const file of component.files) {
    const path = join(root, file.path);
    await regularAncestors(dirname(path));
    const actual = await hashRuntimeFile(path, signal);
    if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256) throw Object.assign(Error('Runtime file integrity mismatch: ' + file.path),{code:'runtime-integrity'});
  }
  return root;
}

// The trusted app manifest supplies the ordered files and their lengths/hashes.
// A .ngpack is one gzip stream of those file bytes, without archive paths or
// extraction directives. Verify the whole download before creating any files.
export async function installRuntimePack({ archive, component, cache, signal, repair = false, onProgress = () => {} }) {
  validateRuntimeComponent(component);
  if (component.archive?.format !== 'nagneon-runtime-gzip/1' || !Number.isSafeInteger(component.archive.bytes) || component.archive.bytes <= 0 || !/^[a-f0-9]{64}$/.test(component.archive.sha256)) throw Error('Invalid runtime archive');
  cache = resolve(cache);
  await regularAncestors(cache);
  await mkdir(cache, { recursive: true });
  // Keep native Windows DLL paths short; full identities and every file hash
  // are still verified before reuse, so the directory prefix is not trust.
  const target = join(cache, component.id + '-' + component.contentId.slice(0,32));
  const existing = await lstat(target).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
  if (existing) {
    try { await verifyRuntimeComponent(target, component, signal); return { path: target, reused: true }; }
    catch(error){if(!repair||!['runtime-integrity','ENOENT'].includes(error.code))throw error;signal?.throwIfAborted();}
  }
  const downloaded = await hashRuntimeFile(archive, signal);
  if (downloaded.bytes !== component.archive.bytes || downloaded.sha256 !== component.archive.sha256) throw Error('Runtime download integrity mismatch');
  const lock = target + '.lock';
  await mkdir(lock);
  let stage, handle, backup;
  try {
    stage = await mkdtemp(join(cache, '.install-' + component.id + '-'));
    let source;
    const unzip = createGunzip();

    let index = 0, offset = 0, total = 0, hash;
    async function advance() {
      while (index < component.files.length && !handle) {
        const file = component.files[index], path = join(stage, file.path);
        await mkdir(dirname(path), { recursive: true });
        handle = await open(path, 'wx'); hash = digest(); offset = 0;
        if (file.bytes) break;
        await finishFile();
      }
    }
    async function finishFile() {
      await handle.close(); handle = null;
      if (hash.digest('hex') !== component.files[index].sha256) throw Error('Runtime extracted file mismatch');
      index++;
    }
    try {
      await advance();
      source = createReadStream(archive, { signal });
      source.on('error', error => unzip.destroy(error));
      source.pipe(unzip);
      for await (const chunk of unzip) {
        signal?.throwIfAborted();
        let start = 0;
        while (start < chunk.length) {
          if (!handle) throw Error('Runtime archive has excess content');
          const count = Math.min(chunk.length - start, component.files[index].bytes - offset);
          const bytes = chunk.subarray(start, start + count);
          let written = 0;
          while (written < bytes.length) {
            const result = await handle.write(bytes, written, bytes.length - written);
            if (!result.bytesWritten) throw Error('Runtime file write stalled');
            written += result.bytesWritten;
          }
          hash.update(bytes); offset += count; start += count; total += count;
          if (offset === component.files[index].bytes) { await finishFile(); await advance(); }
        }
        onProgress({ extractedBytes: total, totalBytes: component.bytes });
      }
      if (index !== component.files.length || total !== component.bytes) throw Error('Runtime archive is incomplete');
      signal?.throwIfAborted();
      // Re-read staged files before publishing; never expose a partial runtime.
      await verifyRuntimeComponent(stage, component, signal);
      signal?.throwIfAborted();
      if(existing){
        await regularAncestors(target);
        backup=await mkdtemp(join(cache,'.replaced-'+component.id+'-'));
        await rename(target,join(backup,'previous'));
      }
      try { await rename(stage, target); stage = null; }
      catch(error){if(backup)await rename(join(backup,'previous'),target);throw error;}
      // The replacement is fully verified before discarding the damaged cache.
      if(backup){await rm(backup,{recursive:true});backup=null;}
      return { path: target, reused: false };
    } finally { source?.destroy(); unzip.destroy(); }
  } finally {
    await handle?.close();
    // Only this invocation's mkdtemp directory can be removed recursively.
    if (stage && dirname(stage) === cache && stage.startsWith(cache + sep + '.install-' + component.id + '-')) await rm(stage, { recursive: true });
    // An unsuccessful rename can leave an empty reservation. Never discard a
    // previous directory if restoring it failed; retain it for recovery.
    if(backup)await rmdir(backup).catch(error=>{if(!['ENOTEMPTY','EEXIST'].includes(error.code))throw error;});
    await rmdir(lock);
  }
}
