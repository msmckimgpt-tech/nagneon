import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm, statfs, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

export const STORAGE_OWNER_SCHEMA = 'nagneon.storage-owner/1';
export const PACKAGE_KEEP = 2;
export const RUNTIME_CATALOG_KEEP = 2;
export const SPEECH_RUNTIME_KEEP = 2;
export const STORAGE_OWNER_FILE = '.nagneon-storage.json';

const digest = value => createHash('sha256').update(value).digest('hex');
const inside = (root, path) => {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !rel.includes(':'));
};

export async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}

export async function treeStats(path, { allowMissing = false } = {}) {
  const root = resolve(path);
  const first = await lstat(root).catch(error => {
    if (allowMissing && error.code === 'ENOENT') return null;
    throw error;
  });
  if (!first) return { exists: false, bytes: 0, files: 0, directories: 0, links: [], fingerprint: null };
  if (!first.isDirectory() || first.isSymbolicLink()) throw Error('저장 경로가 일반 디렉터리가 아닙니다: ' + root);
  let bytes = 0, files = 0, directories = 1;
  const links = [], entries = [], stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) { links.push(full); continue; }
      if (entry.isDirectory()) { directories++; stack.push(full); continue; }
      if (!entry.isFile()) throw Error('검토되지 않은 파일 형식입니다: ' + full);
      const stat = await lstat(full);
      if (stat.isSymbolicLink()) { links.push(full); continue; }
      bytes += stat.size;
      files++;
      entries.push({
        path: relative(root, full).split(sep).join('/'),
        bytes: stat.size,
        mtimeMs: stat.mtimeMs,
        ctimeMs: stat.ctimeMs,
      });
    }
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { exists: true, bytes, files, directories, links, fingerprint: storageFingerprint(entries) };
}

export async function freeSpace(path) {
  const value = await statfs(resolve(path));
  return { freeBytes: value.bavail * value.bsize, totalBytes: value.blocks * value.bsize };
}

export function storageFingerprint(value) {
  return digest(Buffer.from(JSON.stringify(value)));
}

async function readJson(path) {
  return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
}

async function readOwner(path, expectedKind) {
  const marker = join(path, STORAGE_OWNER_FILE);
  const value = await readJson(marker).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!value) return null;
  if (value.schema !== STORAGE_OWNER_SCHEMA || (expectedKind && value.kind !== expectedKind)) throw Error('저장 소유권 표식 형식이 다릅니다: ' + marker);
  return value;
}

async function listDirectories(path) {
  const entries = await readdir(path, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  return entries.filter(entry => entry.isDirectory() && !entry.isSymbolicLink()).map(entry => join(path, entry.name));
}

async function listTreeFiles(path, prefix = '') {
  const result = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const full = join(path, entry.name), name = prefix + entry.name;
    if (entry.isSymbolicLink()) throw Error('저장 경로에 링크가 있습니다: ' + full);
    if (entry.isDirectory()) result.push(...await listTreeFiles(full, name + '/'));
    else if (entry.isFile()) result.push(name);
    else throw Error('검토되지 않은 파일 형식입니다: ' + full);
  }
  return result.sort();
}

export async function listOwnedSpeechRuntimes(root) {
  const artifacts = join(resolve(root), 'artifacts'), owned = [], protectedPaths = [];
  for (const path of await listDirectories(artifacts)) {
    if (!basename(path).startsWith('speech-runtime-')) continue;
    const owner = await readOwner(path).catch(error => { protectedPaths.push({ path, reason: error.message }); return null; });
    if (owner?.kind === 'speech-runtime') owned.push({ path, owner });
    else protectedPaths.push({ path, reason: owner ? 'speech-runtime 소유권 표식이 아님' : '소유권 표식 없음' });
  }
  owned.sort((a, b) => String(b.owner.createdAt).localeCompare(String(a.owner.createdAt)));
  return { owned, protectedPaths };
}

export async function listRuntimeScratch(root) {
  const base = join(resolve(root), 'artifacts', 'runtime-packs', '.scratch'), owned = [], protectedPaths = [];
  for (const path of await listDirectories(base)) {
    const owner = await readOwner(path).catch(error => { protectedPaths.push({ path, reason: error.message }); return null; });
    if (owner?.kind === 'runtime-pack-scratch') owned.push({ path, owner });
    else protectedPaths.push({ path, reason: owner ? 'runtime-pack-scratch 소유권 표식이 아님' : '소유권 표식 없음' });
  }
  return { owned, protectedPaths };
}

export async function listOwnedPackageBuilds(root) {
  const release = join(resolve(root), 'release'), owned = [], protectedPaths = [];
  for (const path of await listDirectories(release)) {
    const owner = await readOwner(path).catch(error => { protectedPaths.push({ path, reason: error.message }); return null; });
    if (owner?.kind === 'package-build' && owner.state === 'complete') owned.push({ path, owner });
    else protectedPaths.push({ path, reason: owner ? '완료된 package-build 표식이 아님' : '소유권 표식 없음' });
  }
  owned.sort((a, b) => String(b.owner.createdAt).localeCompare(String(a.owner.createdAt)));
  return { owned, protectedPaths };
}

export async function listPackageScratch(root) {
  const base = join(resolve(root), 'artifacts', 'package-scratch'), owned = [], protectedPaths = [];
  for (const path of await listDirectories(base)) {
    const owner = await readOwner(path).catch(error => { protectedPaths.push({ path, reason: error.message }); return null; });
    if (owner?.kind === 'package-scratch') owned.push({ path, owner });
    else protectedPaths.push({ path, reason: '소유권 표식 없음' });
  }
  return { owned, protectedPaths };
}

export async function verifyOwnedPackageBuild(path, expectedFingerprint) {
  const build = resolve(path), owner = await readOwner(build, 'package-build');
  if (!owner || owner.state !== 'complete') throw Error('완료된 Nagneon 패키지 출력이 아닙니다.');
  if (expectedFingerprint && owner.fingerprint !== expectedFingerprint) throw Error('패키지 입력 지문이 다릅니다.');
  if (!inside(build, join(build, owner.folder || ''))) throw Error('패키지 폴더가 출력 경로를 벗어납니다.');
  const folder = join(build, owner.folder), manifestPath = join(build, owner.manifest || 'manifest.json');
  const manifest = await readJson(manifestPath);
  if (manifest.buildFingerprint !== owner.fingerprint || !Array.isArray(manifest.files)) throw Error('패키지 매니페스트와 소유권 표식이 다릅니다.');
  const expectedFiles = manifest.files.map(file => file.path).sort();
  const actualFiles = await listTreeFiles(folder);
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) throw Error('재사용 패키지 파일 목록이 매니페스트와 다릅니다.');
  for (const file of manifest.files) {
    if (typeof file.path !== 'string' || file.path.split(/[\\/]/).some(part => part === '..')) throw Error('패키지 파일 경로가 잘못되었습니다.');
    const target = join(folder, ...file.path.split('/')), stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.bytes || await hashFile(target) !== file.sha256) throw Error('재사용 패키지 무결성 오류: ' + file.path);
  }
  return { build, folder, manifestPath, owner, manifest };
}

export async function packageGate(root, fingerprint, { keep = PACKAGE_KEEP } = {}) {
  const scratch = await listPackageScratch(root);
  if (scratch.owned.length || scratch.protectedPaths.length) {
    const error = Error('이전 패키징 scratch가 남아 있습니다. 저장량 미리보기/명시 정리 후 다시 시도하세요.');
    error.code = 'NAGNEON_STORAGE_SCRATCH_PRESENT';
    error.details = scratch;
    throw error;
  }
  const builds = await listOwnedPackageBuilds(root);
  for (const entry of builds.owned) {
    if (entry.owner.fingerprint !== fingerprint) continue;
    return { reused: await verifyOwnedPackageBuild(entry.path, fingerprint), builds };
  }
  if (builds.owned.length >= keep) {
    const error = Error(`검증된 패키지 후보 ${keep}개를 이미 보존 중입니다. 새 후보를 만들기 전에 저장량 미리보기와 명시 정리를 수행하세요.`);
    error.code = 'NAGNEON_STORAGE_RETENTION_FULL';
    error.details = { keep, builds: builds.owned.map(({ path, owner }) => ({ path, createdAt: owner.createdAt, fingerprint: owner.fingerprint })) };
    throw error;
  }
  return { reused: null, builds };
}

export async function createPackageScratch(root, runId) {
  const repo = resolve(root), base = join(repo, 'artifacts', 'package-scratch');
  await mkdir(base, { recursive: true });
  const scratch = join(base, runId);
  if (!inside(base, scratch) || basename(scratch) !== runId) throw Error('패키지 scratch 경로가 잘못되었습니다.');
  await mkdir(scratch);
  const owner = { schema: STORAGE_OWNER_SCHEMA, kind: 'package-scratch', state: 'building', runId, createdAt: new Date().toISOString() };
  await writeFile(join(scratch, STORAGE_OWNER_FILE), JSON.stringify(owner, null, 2), { flag: 'wx' });
  const stage = join(scratch, 'stage'), runtime = join(scratch, 'runtime'), app = join(scratch, 'app'), publish = join(scratch, 'publish');
  for (const path of [stage, runtime, app]) await mkdir(path);
  return { scratch, stage, runtime, app, publish, owner };
}

export async function markPackageScratch(scratch, runId, state, detail) {
  const owner = await readOwner(scratch, 'package-scratch');
  if (!owner || owner.runId !== runId) throw Error('패키지 scratch 소유권이 바뀌었습니다.');
  const next = { ...owner, state, updatedAt: new Date().toISOString(), ...(detail ? { detail: String(detail).slice(0, 1000) } : {}) };
  await writeFile(join(scratch, STORAGE_OWNER_FILE), JSON.stringify(next, null, 2));
  return next;
}

export async function removeOwnedPackageScratch(root, scratch, runId) {
  const repo = resolve(root), base = join(repo, 'artifacts', 'package-scratch'), target = resolve(scratch);
  if (!inside(base, target) || dirname(target) !== base) throw Error('삭제 가능한 package scratch 경로가 아닙니다.');
  const owner = await readOwner(target, 'package-scratch');
  if (!owner || owner.runId !== runId || !['complete', 'published'].includes(owner.state)) throw Error('완료 소유권을 확인하지 못해 scratch를 보존합니다.');
  const stats = await treeStats(target);
  if (stats.links.length) throw Error('scratch 안에 링크/reparse 후보가 있어 자동 정리를 중단합니다.');
  const quarantine = join(base, '.delete-' + runId + '-' + process.pid);
  await rename(target, quarantine);
  await rm(quarantine, { recursive: true, force: false });
  return stats;
}

export async function writePackageBuildOwner(build, value) {
  const path = resolve(build);
  const owner = { schema: STORAGE_OWNER_SCHEMA, kind: 'package-build', state: 'complete', ...value };
  await writeFile(join(path, STORAGE_OWNER_FILE), JSON.stringify(owner, null, 2), { flag: 'wx' });
  return owner;
}

export async function runtimeStoreState(root) {
  const store = join(resolve(root), 'artifacts', 'runtime-packs'), catalogs = join(store, 'catalogs');
  const result = [];
  for (const path of await listDirectories(catalogs)) result.push({ path, protected: true, reason: '예상하지 못한 디렉터리형 catalog' });
  for (const entry of await readdir(catalogs, { withFileTypes: true }).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error))) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const path = join(catalogs, entry.name);
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) {
      result.push({ path, protected: true, reason: '검토되지 않은 catalog 항목' });
      continue;
    }
    try {
      const value = await readJson(path);
      if (value.schema === 'nagneon.runtime-pack-catalog/2' && value.verified === true) result.push({ path, catalog: value });
      else result.push({ path, protected: true, reason: '검증된 catalog 형식이 아님' });
    } catch (error) { result.push({ path, protected: true, reason: error.message }); }
  }
  const verified = result.filter(item => item.catalog).sort((a, b) => String(b.catalog.createdAt).localeCompare(String(a.catalog.createdAt)));
  return { store, verified, protected: result.filter(item => !item.catalog) };
}

export async function storageSnapshot(root) {
  const repo = resolve(root);
  const [packages, scratch, runtime, runtimeScratch, speech] = await Promise.all([
    listOwnedPackageBuilds(repo),
    listPackageScratch(repo),
    runtimeStoreState(repo),
    listRuntimeScratch(repo),
    listOwnedSpeechRuntimes(repo),
  ]);
  return {
    schema: 'nagneon.storage-snapshot/1',
    checkedAt: new Date().toISOString(),
    root: repo,
    drive: await freeSpace(repo),
    packages: { keep: PACKAGE_KEEP, owned: packages.owned.map(({ path, owner }) => ({ path, createdAt: owner.createdAt, fingerprint: owner.fingerprint })), protected: packages.protectedPaths },
    packageScratch: { owned: scratch.owned.map(({ path, owner }) => ({ path, state: owner.state, runId: owner.runId })), protected: scratch.protectedPaths },
    runtimePacks: {
      keep: RUNTIME_CATALOG_KEEP,
      verifiedCatalogs: runtime.verified.map(({ path, catalog }) => ({ path, createdAt: catalog.createdAt, catalogId: catalog.catalogId })),
      protected: runtime.protected,
      scratch: runtimeScratch.owned.map(({ path, owner }) => ({ path, state: owner.state, runId: owner.runId, catalogId: owner.catalogId })),
      scratchProtected: runtimeScratch.protectedPaths,
    },
    speechRuntimes: {
      keep: SPEECH_RUNTIME_KEEP,
      owned: speech.owned.map(({ path, owner }) => ({ path, state: owner.state, createdAt: owner.createdAt, inputFingerprint: owner.inputFingerprint || null })),
      protected: speech.protectedPaths,
    },
  };
}
