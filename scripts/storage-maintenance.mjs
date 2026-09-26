import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PACKAGE_KEEP,
  RUNTIME_CATALOG_KEEP,
  SPEECH_RUNTIME_KEEP,
  STORAGE_OWNER_FILE,
  STORAGE_OWNER_SCHEMA,
  freeSpace,
  hashFile,
  listOwnedPackageBuilds,
  listOwnedSpeechRuntimes,
  listPackageScratch,
  listRuntimeScratch,
  runtimeStoreState,
  storageSnapshot,
  treeStats,
  verifyOwnedPackageBuild,
} from './lib/storage-maintenance.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const index = arg.indexOf('=');
  return index < 0 ? [arg.replace(/^--/, ''), true] : [arg.slice(2, index), arg.slice(index + 1)];
}));
const apply = args.apply === true;
const planArg = args.plan;
const planHash = args['plan-sha256'];
const reservePackage = args['reserve-package-slot'] === true;
const reserveRuntime = args['reserve-runtime-slot'] === true;
const reserveSpeech = args['reserve-speech-slot'] === true;
const retireArg = args['retire-worktree'];
const integratedArg = args.integrated;

const samePath = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase();
const inside = (base, path) => {
  const rel = relative(resolve(base), resolve(path));
  return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !rel.includes(':'));
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (cwd, gitArgs, { allowFailure = false } = {}) => {
  const result = spawnSync('git', gitArgs, { cwd, encoding: 'utf8', windowsHide: true });
  if (!allowFailure && result.status !== 0) throw Error('git ' + gitArgs.join(' ') + ' 실패: ' + (result.stderr || result.stdout).trim());
  return { status: result.status, stdout: (result.stdout || '').trim(), stderr: (result.stderr || '').trim() };
};
const parseWorktrees = text => {
  const result = []; let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) { current = { path: line.slice(9), locked: false }; result.push(current); }
    else if (!current) continue;
    else if (line.startsWith('HEAD ')) current.head = line.slice(5);
    else if (line.startsWith('branch ')) current.branch = line.slice(7);
    else if (line === 'detached') current.detached = true;
    else if (line.startsWith('locked')) current.locked = true;
  }
  return result;
};
const worktrees = () => parseWorktrees(git(root, ['worktree', 'list', '--porcelain']).stdout);
const gitCommon = () => resolve(root, git(root, ['rev-parse', '--git-common-dir']).stdout);

async function candidate(path, kind, note, extra = {}) {
  const target = resolve(path);
  const stat = await lstat(target).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (!stat) return null;
  if (stat.isSymbolicLink()) return { refused: true, path: target, kind, reason: 'reparse/symlink 경로' };
  if (stat.isDirectory()) {
    const stats = await treeStats(target);
    if (stats.links.length) return { refused: true, path: target, kind, reason: '하위 reparse/symlink 존재', links: stats.links.slice(0, 10) };
    return { path: target, kind, note, type: 'directory', bytes: stats.bytes, files: stats.files, treeFingerprint: stats.fingerprint, ...extra };
  }
  if (!stat.isFile()) return { refused: true, path: target, kind, reason: '일반 파일/디렉터리가 아님' };
  return { path: target, kind, note, type: 'file', bytes: stat.size, files: 1, sha256: await hashFile(target), ...extra };
}

function latestPointerBuild(repo) {
  try {
    const value = JSON.parse(spawnSync(process.execPath, ['-e', `const fs=require('fs');try{process.stdout.write(JSON.parse(fs.readFileSync('artifacts/latest-package.json','utf8')).build||'')}catch{}`], { cwd: repo, encoding: 'utf8', windowsHide: true }).stdout || '');
    return value;
  } catch { return null; }
}

async function validateRetire(worktreePath, integratedSha) {
  if (!worktreePath || !integratedSha) throw Error('--retire-worktree에는 --integrated=<통합 SHA>가 필요합니다.');
  const target = resolve(worktreePath), list = worktrees(), entry = list.find(item => samePath(item.path, target));
  if (!entry) throw Error('등록된 Git worktree가 아닙니다: ' + target);
  if (samePath(target, root)) throw Error('현재 main/root worktree는 retire 대상으로 사용할 수 없습니다.');
  if (entry.locked) throw Error('locked worktree는 정리할 수 없습니다.');
  const status = git(target, ['status', '--porcelain=v1', '--untracked-files=all']).stdout;
  if (status) throw Error('dirty/staged/untracked worktree는 정리할 수 없습니다.');
  const head = git(target, ['rev-parse', 'HEAD']).stdout;
  if (head !== entry.head) throw Error('worktree HEAD가 목록과 달라졌습니다.');
  const integrated = git(root, ['rev-parse', integratedSha + '^{commit}']).stdout;
  const mainRemote = git(root, ['merge-base', '--is-ancestor', integrated, 'refs/remotes/origin/main'], { allowFailure: true });
  if (mainRemote.status !== 0) throw Error('지정한 통합 SHA가 현재 origin/main에 포함됐다고 확인할 수 없습니다.');
  const ancestor = git(root, ['merge-base', '--is-ancestor', head, integrated], { allowFailure: true }).status === 0;
  let trailer = false, published = ancestor;
  if (!ancestor) {
    const body = git(root, ['show', '-s', '--format=%B', integrated]).stdout;
    trailer = body.split(/\r?\n/).some(line => line.trim() === 'Nagneon-Source-SHA: ' + head);
    if (!trailer) throw Error('squash 통합에서 원본 SHA 추적 trailer를 확인하지 못했습니다.');
    const remoteContains = git(root, ['branch', '-r', '--contains', head]).stdout.split(/\r?\n/).filter(Boolean);
    if (!remoteContains.length) throw Error('squash 원본 commit이 원격에 게시됐다고 확인할 수 없습니다.');
    published = true;
  }
  return { target, head, integrated, ancestor, trailer, published, branch: entry.branch || null };
}

function processMatches(targets) {
  if (process.platform !== 'win32') throw Error('실제 삭제 전 프로세스 검사는 Windows에서만 지원합니다.');
  const encoded = Buffer.from(JSON.stringify(targets.map(value => resolve(value))), 'utf8').toString('base64');
  const script = [
    `$nodePid=${process.pid}`,
    `$targets=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')))`,
    '$exclude=New-Object System.Collections.Generic.HashSet[int]',
    '[void]$exclude.Add([int]$PID);[void]$exclude.Add([int]$nodePid)',
    '$p=[int]$nodePid; for($i=0;$i -lt 16;$i++){ $row=Get-CimInstance Win32_Process -Filter ("ProcessId="+$p) -ErrorAction Stop; if(-not $row){break}; $p=[int]$row.ParentProcessId; if($p -le 0){break}; [void]$exclude.Add($p) }',
    '$hits=@(); Get-CimInstance Win32_Process -ErrorAction Stop | ForEach-Object { if($exclude.Contains([int]$_.ProcessId)){return}; $cmd=([string]$_.CommandLine).ToLowerInvariant(); $exe=([string]$_.ExecutablePath).ToLowerInvariant(); foreach($t in $targets){ $needle=([string]$t).ToLowerInvariant(); if(($cmd -and $cmd.Contains($needle)) -or ($exe -and $exe.StartsWith($needle))){ $hits += [pscustomobject]@{pid=[int]$_.ProcessId;name=[string]$_.Name;target=[string]$t}; break } } }; $hits | ConvertTo-Json -Compress'
  ].join('; ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw Error('실행 중 프로세스 검사를 완료하지 못했습니다: ' + (result.stderr || result.stdout).trim());
  const text = (result.stdout || '').trim();
  if (!text) return [];
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function verifyOwner(path, kind) {
  const marker = JSON.parse(await readFile(join(path, STORAGE_OWNER_FILE), 'utf8'));
  if (marker.schema !== STORAGE_OWNER_SCHEMA || marker.kind !== kind) throw Error('삭제 대상 소유권 표식이 바뀌었습니다: ' + path);
  return marker;
}

async function buildPlan() {
  const report = await storageSnapshot(root), candidates = [], refused = [];
  const add = async value => { if (!value) return; (value.refused ? refused : candidates).push(value); };

  const scratch = await listPackageScratch(root);
  for (const entry of scratch.owned) {
    if (entry.owner.state !== 'building') await add(await candidate(entry.path, 'package-scratch', '현재 저장소의 종료된 package scratch', { runId: entry.owner.runId }));
    else refused.push({ path: entry.path, kind: 'package-scratch', reason: 'building 상태이므로 자동 정리 후보 아님', state: entry.owner.state });
  }

  const runtimeScratch = await listRuntimeScratch(root);
  for (const entry of runtimeScratch.owned) {
    if (entry.owner.state !== 'building') await add(await candidate(entry.path, 'runtime-pack-scratch', '현재 저장소의 종료된 runtime pack scratch', { runId: entry.owner.runId, catalogId: entry.owner.catalogId || null }));
    else refused.push({ path: entry.path, kind: 'runtime-pack-scratch', reason: 'building 상태이므로 자동 정리 후보 아님', state: entry.owner.state });
  }

  const speech = await listOwnedSpeechRuntimes(root);
  for (const entry of speech.owned) {
    if (entry.owner.state === 'failed') await add(await candidate(entry.path, 'speech-runtime', '실패한 소유 speech runtime', { outputName: entry.owner.outputName || basename(entry.path) }));
    else if (!['complete', 'building'].includes(entry.owner.state)) refused.push({ path: entry.path, kind: 'speech-runtime', reason: '알 수 없는 speech runtime 상태', state: entry.owner.state });
    else if (entry.owner.state === 'building') refused.push({ path: entry.path, kind: 'speech-runtime', reason: 'building 상태이므로 자동 정리 후보 아님', state: entry.owner.state });
  }
  if (reserveSpeech && speech.owned.filter(entry => entry.owner.state === 'complete').length >= SPEECH_RUNTIME_KEEP) {
    const complete = speech.owned.filter(entry => entry.owner.state === 'complete');
    for (const entry of complete.slice(1)) {
      await add(await candidate(entry.path, 'speech-runtime', '다음 speech runtime 후보 공간 확보', { outputName: entry.owner.outputName || basename(entry.path) }));
    }
  }

  const packages = await listOwnedPackageBuilds(root);
  if (reservePackage && packages.owned.length >= PACKAGE_KEEP) {
    let latestBuild = null;
    try { latestBuild = JSON.parse(await readFile(join(root, 'artifacts', 'latest-package.json'), 'utf8')).build; } catch {}
    for (const entry of packages.owned.slice(1)) {
      if (latestBuild && samePath(entry.path, latestBuild)) refused.push({ path: entry.path, kind: 'package-build', reason: 'latest-package 포인터가 참조함' });
      else await add(await candidate(entry.path, 'package-build', '다음 package 후보 공간을 확보하기 위해 가장 오래된 소유 package를 제거', { fingerprint: entry.owner.fingerprint }));
    }
  }

  const runtime = await runtimeStoreState(root);
  if (reserveRuntime && runtime.verified.length >= RUNTIME_CATALOG_KEEP) {
    if (runtime.protected.length) {
      refused.push({ path: runtime.store, kind: 'runtime-retention', reason: '검토되지 않은/protected runtime catalog 항목이 있어 참조 집합을 확정할 수 없음' });
    } else {
      let latestCatalog = null;
      try { latestCatalog = JSON.parse(await readFile(join(root, 'artifacts', 'latest-runtime-packs.json'), 'utf8')).catalog || null; } catch {}
      const keep = runtime.verified.filter((entry, index) => index === 0 || (latestCatalog && samePath(entry.path, latestCatalog)));
      const remove = runtime.verified.filter(entry => !keep.includes(entry));
      if (!remove.length) refused.push({ path: runtime.store, kind: 'runtime-retention', reason: '최신 포인터와 최근 catalog를 모두 보존하면 제거 가능한 catalog가 없음' });
      const retainedPacks = new Set(keep.flatMap(({ catalog }) => catalog.components.map(component => component.archive.name)));
      const retainedCache = new Set(keep.flatMap(({ catalog }) => catalog.components.map(component => component.verifiedCacheKey).filter(Boolean)));
      for (const { path, catalog } of remove) {
        await add(await candidate(path, 'runtime-catalog', '다음 runtime catalog 공간 확보', { catalogId: catalog.catalogId }));
        for (const component of catalog.components) {
          if (!retainedPacks.has(component.archive.name)) {
            await add(await candidate(join(runtime.store, 'packs', component.archive.name), 'runtime-pack', '삭제 catalog에서만 참조되는 content pack', { catalogId: catalog.catalogId }));
            await add(await candidate(join(runtime.store, 'packs', component.archive.name + '.json'), 'runtime-pack-metadata', '삭제 content pack 메타데이터', { catalogId: catalog.catalogId }));
          }
          if (component.verifiedCacheKey && !retainedCache.has(component.verifiedCacheKey)) await add(await candidate(join(runtime.store, 'cache', component.verifiedCacheKey), 'runtime-cache', '삭제 catalog에서만 참조되는 검증 캐시', { catalogId: catalog.catalogId }));
        }
      }
    }
  }

  let retire = null;
  if (retireArg) {
    const target = isAbsolute(String(retireArg)) ? resolve(String(retireArg)) : resolve(root, String(retireArg));
    retire = await validateRetire(target, String(integratedArg || ''));
    for (const name of ['node_modules', 'dist']) await add(await candidate(join(target, name), 'retired-generated', '통합 완료 worktree의 재생성 가능한 ' + name, { worktree: target, head: retire.head }));
    const owned = await listOwnedPackageBuilds(target);
    const latestPackagePath = join(target, 'artifacts', 'latest-package.json');
    let latestPackageBuild = null;
    let latestPackageEntry = null;
    let latestPackageVerified = null;
    let packageReferenceKnown = true;
    try {
      const latestPackage = JSON.parse(await readFile(latestPackagePath, 'utf8'));
      if (typeof latestPackage.build !== 'string' || !latestPackage.build) throw Error('build 참조가 없음');
      latestPackageBuild = resolve(latestPackage.build);
      latestPackageEntry = owned.owned.find(entry => samePath(entry.path, latestPackageBuild)) || null;
      if (!samePath(dirname(latestPackageBuild), join(target, 'release')) || !latestPackageEntry) throw Error('소유된 complete package 직접 하위 경로가 아님');
      latestPackageVerified = await verifyOwnedPackageBuild(latestPackageEntry.path, latestPackageEntry.owner.fingerprint);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        packageReferenceKnown = false;
        refused.push({ path: latestPackagePath, kind: 'retired-package-pointer', reason: 'latest-package 참조/무결성을 안전하게 확인할 수 없음: ' + error.message });
      }
    }
    for (const entry of owned.owned) {
      if (!packageReferenceKnown) {
        refused.push({ path: entry.path, kind: 'retired-package-build', reason: 'latest-package 참조 집합을 확정할 수 없음' });
        continue;
      }
      const isLatest = latestPackageBuild && samePath(entry.path, latestPackageBuild);
      let verifiedEntry;
      try {
        verifiedEntry = isLatest && latestPackageVerified
          ? latestPackageVerified
          : await verifyOwnedPackageBuild(entry.path, entry.owner.fingerprint);
      } catch (error) {
        refused.push({ path: entry.path, kind: 'retired-package-build', reason: 'package 무결성을 안전하게 확인할 수 없음: ' + error.message });
        continue;
      }
      const evidence = isLatest ? {
        manifestSha256: await hashFile(verifiedEntry.manifestPath),
        manifestEvidence: verifiedEntry.manifest,
      } : {};
      await add(await candidate(entry.path, 'retired-package-build', isLatest
        ? '통합 완료 worktree의 검증된 latest package 출력'
        : '통합 완료 worktree의 검증된 비참조 소유 package 출력', {
        worktree: target,
        head: retire.head,
        fingerprint: entry.owner.fingerprint,
        ...evidence,
      }));
    }
    if (packageReferenceKnown && latestPackageBuild && latestPackageVerified) {
      await add(await candidate(latestPackagePath, 'retired-package-pointer', 'retire되는 검증 package를 가리키는 latest-package 포인터', {
        worktree: target,
        head: retire.head,
        build: latestPackageBuild,
        fingerprint: latestPackageEntry.owner.fingerprint,
      }));
    }

    const retiredScratch = await listPackageScratch(target);
    for (const entry of retiredScratch.owned) if (entry.owner.state !== 'building') await add(await candidate(entry.path, 'retired-package-scratch', '통합 완료 worktree의 종료된 package scratch', { worktree: target, head: retire.head, runId: entry.owner.runId }));

    const retiredSpeech = await listOwnedSpeechRuntimes(target);
    for (const entry of retiredSpeech.owned) {
      if (entry.owner.state === 'building') refused.push({ path: entry.path, kind: 'retired-speech-runtime', reason: 'building 상태이므로 retire 후보 아님' });
      else if (['complete', 'failed'].includes(entry.owner.state)) await add(await candidate(entry.path, 'retired-speech-runtime', '통합 완료 worktree의 재생성 가능한 speech runtime', {
        worktree: target,
        head: retire.head,
        outputName: entry.owner.outputName || basename(entry.path),
      }));
      else refused.push({ path: entry.path, kind: 'retired-speech-runtime', reason: '알 수 없는 speech runtime 상태', state: entry.owner.state });
    }
    for (const entry of retiredSpeech.protectedPaths) refused.push({ path: entry.path, kind: 'retired-speech-runtime', reason: '보호된 speech runtime: ' + entry.reason });

    const runtimeStore = join(target, 'artifacts', 'runtime-packs');
    const runtimeMarker = await readFile(join(runtimeStore, STORAGE_OWNER_FILE), 'utf8').catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (runtimeMarker) {
      const owner = JSON.parse(runtimeMarker);
      if (owner.schema === STORAGE_OWNER_SCHEMA && owner.kind === 'runtime-pack-store' && owner.state === 'active') {
        const latestRuntimePath = join(target, 'artifacts', 'latest-runtime-packs.json');
        const runtimeState = await runtimeStoreState(target);
        const runtimeScratchEntries = await readdir(join(runtimeStore, '.scratch'), { withFileTypes: true }).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error));
        let runtimeReferenced = false;
        let runtimeReferenceKnown = true;
        if (runtimeScratchEntries.length) {
          runtimeReferenceKnown = false;
          refused.push({ path: runtimeStore, kind: 'retired-runtime-store', reason: 'runtime scratch가 남아 있어 active/incomplete 상태를 배제할 수 없음' });
        }
        try {
          const latestRuntime = JSON.parse(await readFile(latestRuntimePath, 'utf8'));
          const outputRef = typeof latestRuntime.output === 'string' && latestRuntime.output ? resolve(latestRuntime.output) : null;
          const catalogRef = typeof latestRuntime.catalog === 'string' && latestRuntime.catalog ? resolve(latestRuntime.catalog) : null;
          if (!outputRef || !catalogRef || latestRuntime.verified !== true) throw Error('검증된 output/catalog 참조가 모두 필요함');
          if (!samePath(outputRef, runtimeStore) || !samePath(dirname(catalogRef), join(runtimeStore, 'catalogs'))) throw Error('retire 대상 runtime store의 직접 catalog를 참조하지 않음');
          if (!runtimeState.verified.some(entry => samePath(entry.path, catalogRef))) throw Error('latest catalog가 검증된 runtime catalog가 아님');
          runtimeReferenced = true;
        } catch (error) {
          if (error?.code !== 'ENOENT') {
            runtimeReferenceKnown = false;
            refused.push({ path: latestRuntimePath, kind: 'retired-runtime-pointer', reason: 'latest-runtime-packs 참조를 안전하게 확인할 수 없음: ' + error.message });
          }
        }
        if (runtimeState.protected.length) {
          runtimeReferenceKnown = false;
          refused.push({ path: runtimeStore, kind: 'retired-runtime-store', reason: 'protected runtime catalog 항목이 있어 retire 무결성 집합을 확정할 수 없음' });
        }
        if (!runtimeReferenceKnown) refused.push({ path: runtimeStore, kind: 'retired-runtime-store', reason: 'runtime 최신 참조/소유 집합을 확정할 수 없음' });
        else {
          await add(await candidate(runtimeStore, 'retired-runtime-store', runtimeReferenced
            ? '통합 완료 worktree의 latest content-addressed runtime pack 저장소'
            : '통합 완료 worktree의 비참조 content-addressed runtime pack 검증 저장소', {
            worktree: target,
            head: retire.head,
            catalogEvidence: runtimeState.verified.map(({ catalog }) => catalog),
          }));
          if (runtimeReferenced) await add(await candidate(latestRuntimePath, 'retired-runtime-pointer', 'retire되는 runtime store를 가리키는 latest-runtime-packs 포인터', {
            worktree: target,
            head: retire.head,
            store: runtimeStore,
          }));
        }
      } else refused.push({ path: runtimeStore, kind: 'retired-runtime-store', reason: 'runtime store 소유권 표식/상태 불일치' });
    }
  }

  const plan = {
    schema: 'nagneon.storage-cleanup-plan/1',
    createdAt: new Date().toISOString(),
    repoRoot: root,
    gitCommonDir: gitCommon(),
    repoHead: git(root, ['rev-parse', 'HEAD']).stdout,
    originMain: git(root, ['rev-parse', 'refs/remotes/origin/main']).stdout,
    options: { reservePackage, reserveRuntime, reserveSpeech, retireWorktree: retire?.target || null, integrated: retire?.integrated || null },
    retire,
    snapshot: report,
    candidates,
    refused,
    logicalCandidateBytes: candidates.reduce((sum, item) => sum + item.bytes, 0),
  };
  return plan;
}

async function revalidateCandidate(item, plan) {
  const path = resolve(item.path);
  if (item.worktree && (!plan.retire || !samePath(item.worktree, plan.retire.target))) throw Error('worktree 후보 범위가 계획과 다릅니다.');
  if (['retired-generated'].includes(item.kind)) {
    if (!item.worktree || !['node_modules', 'dist'].includes(basename(path)) || !samePath(dirname(path), item.worktree)) throw Error('재생성 후보 경로가 바뀌었습니다: ' + path);
  } else if (['package-build','retired-package-build'].includes(item.kind)) {
    const releaseRoot = item.kind === 'retired-package-build'
      ? join(plan.retire?.target || '', 'release')
      : join(root, 'release');
    if (!samePath(dirname(path), releaseRoot)) throw Error('허용된 package-build 범위를 벗어난 삭제 계획입니다: ' + path);
    const owner = await verifyOwner(path, 'package-build');
    if (owner.state !== 'complete' || owner.fingerprint !== item.fingerprint) throw Error('package-build 소유권이 바뀌었습니다.');
    await verifyOwnedPackageBuild(path, item.fingerprint);
  } else if (['package-scratch','retired-package-scratch'].includes(item.kind)) {
    const scratchRoot = item.kind === 'retired-package-scratch'
      ? join(plan.retire?.target || '', 'artifacts', 'package-scratch')
      : join(root, 'artifacts', 'package-scratch');
    if (!samePath(dirname(path), scratchRoot)) throw Error('허용된 package scratch 범위를 벗어난 삭제 계획입니다: ' + path);
    const owner = await verifyOwner(path, 'package-scratch');
    if (owner.runId !== item.runId || owner.state === 'building') throw Error('package scratch가 다시 활성 상태이거나 소유권이 바뀌었습니다.');
  } else if (item.kind === 'runtime-pack-scratch') {
    if (!samePath(dirname(path), join(root, 'artifacts', 'runtime-packs', '.scratch'))) throw Error('허용된 runtime scratch 범위를 벗어난 삭제 계획입니다: ' + path);
    const owner = await verifyOwner(path, 'runtime-pack-scratch');
    if (owner.runId !== item.runId || owner.state === 'building') throw Error('runtime pack scratch가 다시 활성 상태이거나 소유권이 바뀌었습니다.');
  } else if (item.kind === 'speech-runtime') {
    if (!samePath(dirname(path), join(root, 'artifacts')) || !basename(path).startsWith('speech-runtime-')) throw Error('허용된 speech runtime 범위를 벗어난 삭제 계획입니다: ' + path);
    const owner = await verifyOwner(path, 'speech-runtime');
    if (owner.state === 'building') throw Error('speech runtime이 building 상태입니다.');
  } else if (item.kind === 'retired-speech-runtime') {
    if (!plan.retire || !samePath(dirname(path), join(plan.retire.target, 'artifacts')) || !basename(path).startsWith('speech-runtime-')) throw Error('허용된 retired speech runtime 범위를 벗어난 삭제 계획입니다: ' + path);
    const owner = await verifyOwner(path, 'speech-runtime');
    if (!['complete', 'failed'].includes(owner.state)) throw Error('retired speech runtime 상태가 바뀌었습니다.');
  } else if (item.kind === 'retired-package-pointer') {
    if (!plan.retire || !samePath(path, join(plan.retire.target, 'artifacts', 'latest-package.json'))) throw Error('허용된 retired package pointer 범위를 벗어난 삭제 계획입니다: ' + path);
    const pointer = JSON.parse(await readFile(path, 'utf8'));
    const build = typeof pointer.build === 'string' && pointer.build ? resolve(pointer.build) : null;
    if (!build || !samePath(build, item.build) || !samePath(dirname(build), join(plan.retire.target, 'release'))) throw Error('latest-package 참조가 계획과 달라졌습니다.');
    if (!plan.candidates.some(value => value.kind === 'retired-package-build' && samePath(value.path, build) && value.fingerprint === item.fingerprint)) throw Error('latest-package가 검증된 retire package 후보와 묶여 있지 않습니다.');
  } else if (item.kind === 'retired-runtime-pointer') {
    if (!plan.retire || !samePath(path, join(plan.retire.target, 'artifacts', 'latest-runtime-packs.json'))) throw Error('허용된 retired runtime pointer 범위를 벗어난 삭제 계획입니다: ' + path);
    const pointer = JSON.parse(await readFile(path, 'utf8'));
    const store = resolve(item.store);
    const outputRef = typeof pointer.output === 'string' && pointer.output ? resolve(pointer.output) : null;
    const catalogRef = typeof pointer.catalog === 'string' && pointer.catalog ? resolve(pointer.catalog) : null;
    const runtimeState = await runtimeStoreState(plan.retire.target);
    const runtimeScratchEntries = await readdir(join(store, '.scratch'), { withFileTypes: true }).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error));
    if (!samePath(store, join(plan.retire.target, 'artifacts', 'runtime-packs')) || pointer.verified !== true || !outputRef || !catalogRef || !samePath(outputRef, store) || !samePath(dirname(catalogRef), join(store, 'catalogs')) || !runtimeState.verified.some(entry => samePath(entry.path, catalogRef)) || runtimeState.protected.length || runtimeScratchEntries.length) throw Error('latest-runtime-packs 참조가 계획과 달라졌거나 검증/active 상태를 확인할 수 없습니다.');
    if (!plan.candidates.some(value => value.kind === 'retired-runtime-store' && samePath(value.path, store))) throw Error('latest-runtime-packs가 retire runtime 후보와 묶여 있지 않습니다.');
  } else if (item.kind === 'retired-runtime-store') {
    if (!plan.retire || !samePath(path, join(plan.retire.target, 'artifacts', 'runtime-packs'))) throw Error('허용된 retired runtime store 범위를 벗어난 삭제 계획입니다: ' + path);
    const owner = await verifyOwner(path, 'runtime-pack-store');
    if (owner.state !== 'active') throw Error('retired runtime store 소유권 상태가 바뀌었습니다.');
    const runtimeState = await runtimeStoreState(plan.retire.target);
    const runtimeScratchEntries = await readdir(join(path, '.scratch'), { withFileTypes: true }).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error));
    if (runtimeState.protected.length || runtimeScratchEntries.length) throw Error('retired runtime store의 protected catalog 또는 runtime scratch 상태가 바뀌었습니다.');
  } else if (['runtime-catalog','runtime-pack','runtime-pack-metadata','runtime-cache'].includes(item.kind)) {
    const runtimeRoot = join(root, 'artifacts', 'runtime-packs');
    const expectedParent = item.kind === 'runtime-catalog'
      ? join(runtimeRoot, 'catalogs')
      : item.kind === 'runtime-cache'
        ? join(runtimeRoot, 'cache')
        : join(runtimeRoot, 'packs');
    if (!samePath(dirname(path), expectedParent)) throw Error('허용된 runtime 정리 범위를 벗어난 삭제 계획입니다: ' + path);
    await verifyOwner(runtimeRoot, 'runtime-pack-store');
  } else throw Error('지원하지 않는 삭제 후보 종류입니다: ' + item.kind);

  const fresh = await candidate(path, item.kind, item.note);
  if (!fresh || fresh.refused || fresh.type !== item.type || fresh.bytes !== item.bytes || fresh.files !== item.files || (item.treeFingerprint && fresh.treeFingerprint !== item.treeFingerprint) || (item.sha256 && fresh.sha256 !== item.sha256)) throw Error('계획 이후 삭제 대상이 변경되었습니다: ' + path);
  return fresh;
}

async function applyPlan(path, expectedHash) {
  if (!path || !expectedHash || !/^[a-f0-9]{64}$/i.test(String(expectedHash))) throw Error('--apply에는 --plan과 정확한 --plan-sha256이 모두 필요합니다.');
  const absolute = isAbsolute(String(path)) ? resolve(String(path)) : resolve(root, String(path));
  const planRoot = join(root, 'artifacts');
  if (!inside(planRoot, absolute) || samePath(planRoot, absolute)) throw Error('정리 계획 파일은 현재 worktree artifacts 아래의 일반 파일이어야 합니다.');
  const planStat = await lstat(absolute);
  if (!planStat.isFile() || planStat.isSymbolicLink()) throw Error('정리 계획 파일이 일반 파일이 아닙니다.');
  const bytes = await readFile(absolute);
  const actualHash = sha(bytes);
  if (actualHash.toLowerCase() !== String(expectedHash).toLowerCase()) throw Error('계획 파일 SHA-256이 다릅니다.');
  const plan = JSON.parse(bytes.toString('utf8'));
  if (plan.schema !== 'nagneon.storage-cleanup-plan/1' || !samePath(plan.repoRoot, root) || !samePath(plan.gitCommonDir, gitCommon())) throw Error('현재 저장소용 정리 계획이 아닙니다.');
  if (git(root, ['rev-parse', 'HEAD']).stdout !== plan.repoHead || git(root, ['rev-parse', 'refs/remotes/origin/main']).stdout !== plan.originMain) throw Error('계획 이후 Git 기준 상태가 바뀌었습니다. 새 preview가 필요합니다.');
  if (plan.retire) {
    const current = await validateRetire(plan.retire.target, plan.retire.integrated);
    if (current.head !== plan.retire.head) throw Error('계획 이후 retire worktree HEAD가 바뀌었습니다.');
  }
  for (const item of plan.candidates) await revalidateCandidate(item, plan);
  const hits = processMatches(plan.candidates.map(item => item.path));
  if (hits.length) throw Error('삭제 대상 사용 가능성이 있는 실행 중 프로세스가 있습니다: ' + JSON.stringify(hits));
  const before = await freeSpace(root), moved = [];
  try {
    for (const item of plan.candidates) {
      const source = resolve(item.path), quarantine = join(dirname(source), '.nagneon-delete-' + basename(source) + '-' + randomUUID());
      await rename(source, quarantine);
      moved.push({ source, quarantine, item });
    }
  } catch (error) {
    for (const entry of moved.reverse()) await rename(entry.quarantine, entry.source).catch(() => {});
    throw Error('삭제 전 격리 rename에 실패해 실제 삭제를 시작하지 않았습니다: ' + error.message);
  }
  const removed = [];
  try {
    for (const entry of moved) {
      await rm(entry.quarantine, { recursive: entry.item.type === 'directory', force: false });
      removed.push(entry);
    }
  } catch (error) {
    for (const entry of moved.filter(value => !removed.includes(value)).reverse()) await rename(entry.quarantine, entry.source).catch(() => {});
    throw Error('격리 후 삭제 중 오류가 발생했습니다. 이미 제거된 항목과 복구된 항목을 확인하세요: ' + error.message);
  }
  const after = await freeSpace(root);
  return {
    schema: 'nagneon.storage-cleanup-result/1',
    appliedAt: new Date().toISOString(),
    plan: absolute,
    planSha256: actualHash,
    removed: removed.map(({ item }) => ({ path: item.path, kind: item.kind, logicalBytes: item.bytes })),
    logicalBytesRemoved: removed.reduce((sum, { item }) => sum + item.bytes, 0),
    freeBytesBefore: before.freeBytes,
    freeBytesAfter: after.freeBytes,
    measuredFreeBytesDelta: after.freeBytes - before.freeBytes,
  };
}

if (apply) {
  console.log(JSON.stringify(await applyPlan(planArg, planHash), null, 2));
} else {
  const plan = await buildPlan();
  const output = {
    mode: 'preview',
    snapshot: plan.snapshot,
    blockingNextPackage: plan.snapshot.packages.owned.length >= PACKAGE_KEEP || plan.snapshot.packageScratch.owned.length > 0,
    blockingNextRuntimeCatalog: plan.snapshot.runtimePacks.verifiedCatalogs.length >= RUNTIME_CATALOG_KEEP || plan.snapshot.runtimePacks.scratch.length > 0,
    blockingNextSpeechRuntime: plan.snapshot.speechRuntimes.owned.filter(item => item.state === 'complete').length >= SPEECH_RUNTIME_KEEP,
    candidates: plan.candidates,
    refused: plan.refused,
    logicalCandidateBytes: plan.logicalCandidateBytes,
  };
  if (planArg) {
    const absolute = isAbsolute(String(planArg)) ? resolve(String(planArg)) : resolve(root, String(planArg));
    if (!inside(join(root, 'artifacts'), absolute)) throw Error('정리 계획 파일은 현재 worktree artifacts 아래에만 작성할 수 있습니다.');
    await mkdir(dirname(absolute), { recursive: true });
    const text = JSON.stringify(plan, null, 2);
    await writeFile(absolute, text, { flag: 'wx' });
    output.plan = absolute;
    output.planSha256 = sha(Buffer.from(text));
  }
  console.log(JSON.stringify(output, null, 2));
}
