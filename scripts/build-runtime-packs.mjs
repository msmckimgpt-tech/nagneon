import { mkdir, readFile, writeFile, lstat, rename, readdir, rm } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { distributionComponents } from './lib/distribution-components.mjs';
import { writeRuntimePack } from './lib/runtime-pack.mjs';
import { installRuntimePack } from '../server/runtime-pack.js';
import {
  RUNTIME_CATALOG_KEEP,
  STORAGE_OWNER_FILE,
  STORAGE_OWNER_SCHEMA,
  freeSpace,
  hashFile,
  runtimeStoreState,
  storageFingerprint,
  treeStats,
} from './lib/storage-maintenance.mjs';

const storageBefore = await freeSpace(resolve('.'));
const latest = JSON.parse(await readFile('artifacts/latest-package.json', 'utf8'));
const manifest = JSON.parse(await readFile(latest.manifest, 'utf8'));
const components = distributionComponents(manifest.files).filter(c => c.id !== 'app' && c.files.length);
if (!components.length) throw Error('실행 구성 pack을 만들 optional payload가 없습니다. 전체 동봉 패키지를 먼저 준비하세요.');
const catalogId = storageFingerprint(components.map(({ id, contentId, bytes, files }) => ({ id, contentId, bytes, files })));
const store = resolve('artifacts/runtime-packs'), packs = join(store, 'packs'), catalogs = join(store, 'catalogs'), cache = join(store, 'cache'), scratchBase = join(store, '.scratch');
for (const path of [store, packs, catalogs, cache, scratchBase]) await mkdir(path, { recursive: true });
const storeOwnerPath = join(store, STORAGE_OWNER_FILE);
const storeOwnerStat = await lstat(storeOwnerPath).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
if (!storeOwnerStat) {
  await writeFile(storeOwnerPath, JSON.stringify({ schema: STORAGE_OWNER_SCHEMA, kind: 'runtime-pack-store', state: 'active', createdAt: new Date().toISOString() }, null, 2), { flag: 'wx' });
} else {
  if (!storeOwnerStat.isFile() || storeOwnerStat.isSymbolicLink()) throw Error('runtime pack 저장소 소유권 표식이 일반 파일이 아닙니다.');
  const owner = JSON.parse(await readFile(storeOwnerPath, 'utf8'));
  if (owner.schema !== STORAGE_OWNER_SCHEMA || owner.kind !== 'runtime-pack-store' || owner.state !== 'active') throw Error('runtime pack 저장소 소유권 표식이 다릅니다.');
}
const existingScratch = (await readdir(scratchBase, { withFileTypes: true })).filter(entry => entry.isDirectory() || entry.isSymbolicLink());
if (existingScratch.length) throw Error('이전 runtime pack scratch가 남아 있습니다. 저장량 미리보기/명시 정리 후 다시 시도하세요.');
const state = await runtimeStoreState(resolve('.'));
const existingCatalog = state.verified.find(({ catalog }) => catalog.catalogId === catalogId);
async function verifyCatalog(value) {
  for (const component of value.components) {
    const archive = join(packs, component.archive.name);
    const actual = await lstat(archive);
    if (!actual.isFile() || actual.isSymbolicLink() || actual.size !== component.archive.bytes || await hashFile(archive) !== component.archive.sha256) throw Error('기존 runtime pack 무결성 오류: ' + component.id);
    await installRuntimePack({ archive, component, cache });
  }
}
if (existingCatalog) {
  await verifyCatalog(existingCatalog.catalog);
  await writeFile('artifacts/latest-runtime-packs.json', JSON.stringify({ output: store, catalog: existingCatalog.path, verified: true, reused: true }, null, 2));
  console.log(JSON.stringify({
    catalogId, reused: true, catalog: existingCatalog.path,
    components: existingCatalog.catalog.components.map(c => ({ id: c.id, contentId: c.contentId, compressedBytes: c.archive.bytes })),
    storage: { freeBytesBefore: storageBefore.freeBytes, freeBytesAfter: (await freeSpace(resolve('.'))).freeBytes, store: await treeStats(store) },
  }, null, 2));
} else {
  if (state.verified.length >= RUNTIME_CATALOG_KEEP) throw Error(`검증된 runtime pack catalog ${RUNTIME_CATALOG_KEEP}개를 이미 보존 중입니다. 새 catalog를 만들기 전에 저장량 미리보기와 명시 정리를 수행하세요.`);
  const runId = new Date().toISOString().replace(/[:.]/g, '-'), scratch = join(scratchBase, runId);
  await mkdir(scratch);
  const marker = { schema: STORAGE_OWNER_SCHEMA, kind: 'runtime-pack-scratch', state: 'building', runId, createdAt: new Date().toISOString(), catalogId };
  await writeFile(join(scratch, STORAGE_OWNER_FILE), JSON.stringify(marker, null, 2), { flag: 'wx' });
  const report = { schema: 'nagneon.runtime-pack-catalog/2', catalogId, createdAt: new Date().toISOString(), sourceManifest: latest.manifest, packageFolder: latest.folder, output: store, verified: false, components: [] };
  const created = [];
  const published = [];
  const catalogPath = join(catalogs, catalogId + '.json');
  let complete = false, catalogCommitted = false;
  try {
    for (const component of components) {
      const name = component.id + '-' + component.contentId + '.ngpack';
      const archive = join(packs, name), metadata = archive + '.json';
      const archiveStat = await lstat(archive).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
      const metadataStat = await lstat(metadata).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
      let packed, reused = false;
      if (archiveStat || metadataStat) {
        if (!archiveStat || !metadataStat || !archiveStat.isFile() || archiveStat.isSymbolicLink() || !metadataStat.isFile() || metadataStat.isSymbolicLink()) throw Error('runtime pack 저장소에 부분/불명확 출력이 있습니다: ' + name);
        packed = JSON.parse(await readFile(metadata, 'utf8'));
        if (packed.id !== component.id || packed.contentId !== component.contentId || JSON.stringify(packed.files) !== JSON.stringify(component.files)) throw Error('runtime pack 메타데이터가 현재 입력과 다릅니다: ' + name);
        const actualHash = await hashFile(archive);
        if (archiveStat.size !== packed.archive.bytes || actualHash !== packed.archive.sha256) throw Error('runtime pack 압축 무결성 오류: ' + name);
        reused = true;
      } else {
        const scratchArchive = join(scratch, name);
        packed = await writeRuntimePack(latest.folder, component, scratchArchive);
        await writeFile(scratchArchive + '.json', JSON.stringify(packed, null, 2), { flag: 'wx' });
        created.push({ name, scratchArchive });
      }
      const installed = await installRuntimePack({ archive: reused ? archive : join(scratch, name), component: packed, cache });
      report.components.push({ ...packed, archive: { ...packed.archive, name }, verifiedCacheKey: installed.path.split(/[\\/]/).at(-1), reusedArchive: reused });
      console.log(JSON.stringify({ id: component.id, contentId: component.contentId, unpackedBytes: component.bytes, compressedBytes: packed.archive.bytes, reusedArchive: reused, verified: true }));
    }

    try {
      for (const entry of created) {
        const finalArchive = join(packs, entry.name), finalMetadata = finalArchive + '.json';
        await rename(entry.scratchArchive, finalArchive);
        published.push({ from: finalArchive, to: entry.scratchArchive });
        await rename(entry.scratchArchive + '.json', finalMetadata);
        published.push({ from: finalMetadata, to: entry.scratchArchive + '.json' });
      }
      report.verified = true;
      await writeFile(catalogPath, JSON.stringify(report, null, 2), { flag: 'wx' });
      catalogCommitted = true;
    } catch (error) {
      if (!catalogCommitted) {
        for (const entry of published.reverse()) await rename(entry.from, entry.to).catch(() => {});
      }
      throw error;
    }

    marker.state = 'complete'; marker.updatedAt = new Date().toISOString();
    await writeFile(join(scratch, STORAGE_OWNER_FILE), JSON.stringify(marker, null, 2));
    const stats = await treeStats(scratch);
    if (stats.links.length) throw Error('runtime pack scratch에 링크/reparse 후보가 있어 정리를 중단합니다.');
    await rm(scratch, { recursive: true, force: false });
    complete = true;
    await writeFile('artifacts/latest-runtime-packs.json', JSON.stringify({ output: store, catalog: catalogPath, verified: true, reused: false }, null, 2));
    console.log(JSON.stringify({
      catalogId, reused: false, catalog: catalogPath, createdPacks: created.length, scratchBytesRemoved: stats.bytes,
      components: report.components.map(c => ({ id: c.id, contentId: c.contentId, compressedBytes: c.archive.bytes, reusedArchive: c.reusedArchive })),
      storage: { freeBytesBefore: storageBefore.freeBytes, freeBytesAfter: (await freeSpace(resolve('.'))).freeBytes, store: await treeStats(store) },
    }, null, 2));
  } finally {
    if (!complete) {
      marker.state = catalogCommitted ? 'complete' : 'failed';
      marker.updatedAt = new Date().toISOString();
      await writeFile(join(scratch, STORAGE_OWNER_FILE), JSON.stringify(marker, null, 2)).catch(() => {});
    }
  }
}
