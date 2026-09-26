import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { verifyOwnedPackageBuild } from '../scripts/lib/storage-maintenance.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(here);
const ownerFile = '.nagneon-storage.json';
const ownerSchema = 'nagneon.storage-owner/1';

function run(cwd, command, args, { ok = true } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true });
  if (ok && result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return result;
}

function git(cwd, args, options) {
  return run(cwd, 'git', args, options);
}

function node(cwd, args, options) {
  return run(cwd, process.execPath, args, options);
}

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'nagneon-storage-maintenance-'));
  const repo = join(base, 'repo');
  const remote = join(base, 'origin.git');
  await mkdir(join(repo, 'scripts', 'lib'), { recursive: true });
  await cp(join(projectRoot, 'scripts', 'storage-maintenance.mjs'), join(repo, 'scripts', 'storage-maintenance.mjs'));
  await cp(join(projectRoot, 'scripts', 'lib', 'storage-maintenance.mjs'), join(repo, 'scripts', 'lib', 'storage-maintenance.mjs'));
  await writeFile(join(repo, 'README.md'), 'fixture\n');
  await writeFile(join(repo, '.gitignore'), 'node_modules/\ndist/\n.models/\nartifacts/\nrelease/\n');
  git(repo, ['init', '-b', 'main']);
  git(repo, ['config', 'user.name', 'Nagneon Test']);
  git(repo, ['config', 'user.email', 'nagneon-test@example.invalid']);
  git(repo, ['add', '.gitignore', 'README.md', 'scripts']);
  git(repo, ['commit', '-m', 'fixture']);
  git(base, ['init', '--bare', remote]);
  git(repo, ['remote', 'add', 'origin', remote]);
  git(repo, ['push', '-u', 'origin', 'main']);
  t.after(async () => {
    for (const path of [join(base, 'clean'), join(base, 'dirty')]) {
      git(repo, ['worktree', 'remove', '--force', path], { ok: false });
    }
    await rm(base, { recursive: true, force: true, maxRetries: 3 });
  });
  return { base, repo, remote, head: git(repo, ['rev-parse', 'HEAD']).stdout.trim() };
}

async function owner(path, kind, state, extra = {}) {
  await mkdir(path, { recursive: true });
  await writeFile(join(path, ownerFile), JSON.stringify({
    schema: ownerSchema,
    kind,
    state,
    createdAt: new Date().toISOString(),
    ...extra,
  }, null, 2));
}

async function packageBuild(path, fingerprint, runId, payload = 'app') {
  const folder = join(path, 'app', 'Nagneon-win32-x64');
  await mkdir(folder, { recursive: true });
  const bytes = Buffer.from(payload);
  const name = 'Nagneon.exe';
  await writeFile(join(folder, name), bytes);
  await writeFile(join(path, 'manifest.json'), JSON.stringify({
    buildFingerprint: fingerprint,
    files: [{ path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }],
  }));
  await owner(path, 'package-build', 'complete', {
    fingerprint,
    folder: 'app/Nagneon-win32-x64',
    manifest: 'manifest.json',
    runId,
  });
}

function parse(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('preview is non-destructive and apply requires the exact plan hash', async t => {
  const f = await fixture(t);
  const scratch = join(f.repo, 'artifacts', 'package-scratch', 'failed-run');
  await owner(scratch, 'package-scratch', 'failed', { runId: 'failed-run' });
  await writeFile(join(scratch, 'partial.bin'), Buffer.alloc(128));
  const preview = parse(node(f.repo, ['scripts/storage-maintenance.mjs', '--plan=artifacts/cleanup-plan.json']));
  assert.equal(preview.mode, 'preview');
  assert.equal(preview.candidates.some(item => item.path === scratch && item.kind === 'package-scratch'), true);
  assert.equal((await readFile(join(scratch, 'partial.bin'))).length, 128);
  const plan = await readFile(join(f.repo, 'artifacts', 'cleanup-plan.json'));
  const actual = createHash('sha256').update(plan).digest('hex');
  assert.equal(preview.planSha256, actual);

  const wrong = node(f.repo, ['scripts/storage-maintenance.mjs', '--apply', '--plan=artifacts/cleanup-plan.json', '--plan-sha256=' + '0'.repeat(64)], { ok: false });
  assert.notEqual(wrong.status, 0);
  assert.match(wrong.stderr + wrong.stdout, /SHA-256/);
  assert.equal((await readFile(join(scratch, 'partial.bin'))).length, 128);

  if (process.platform === 'win32') {
    const applied = parse(node(f.repo, ['scripts/storage-maintenance.mjs', '--apply', '--plan=artifacts/cleanup-plan.json', '--plan-sha256=' + actual]));
    assert.equal(applied.removed.length, 1);
    await assert.rejects(readFile(join(scratch, 'partial.bin')), error => error?.code === 'ENOENT');
  }
});

test('apply rejects plans outside artifacts and forged package paths outside the producer root', async t => {
  const f = await fixture(t);
  const scratch = join(f.repo, 'artifacts', 'package-scratch', 'failed-run');
  await owner(scratch, 'package-scratch', 'failed', { runId: 'failed-run' });
  await writeFile(join(scratch, 'partial.bin'), Buffer.alloc(32));

  const preview = parse(node(f.repo, ['scripts/storage-maintenance.mjs', '--plan=artifacts/cleanup-plan.json']));
  const sourcePlan = await readFile(join(f.repo, 'artifacts', 'cleanup-plan.json'));
  const outsidePlan = join(f.base, 'outside-plan.json');
  await writeFile(outsidePlan, sourcePlan);
  const outsideHash = createHash('sha256').update(sourcePlan).digest('hex');
  let result = node(f.repo, ['scripts/storage-maintenance.mjs', '--apply', '--plan=' + outsidePlan, '--plan-sha256=' + outsideHash], { ok: false });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /artifacts/);
  assert.equal((await readFile(join(scratch, 'partial.bin'))).length, 32);

  const protectedRoot = join(f.base, 'installed-profile-protected');
  await owner(protectedRoot, 'package-build', 'complete', {
    fingerprint: 'd'.repeat(64),
    folder: 'app/Nagneon-win32-x64',
    manifest: 'manifest.json',
    runId: 'forged',
  });
  const forged = JSON.parse(sourcePlan.toString('utf8'));
  forged.candidates = [{
    path: protectedRoot,
    kind: 'package-build',
    note: 'forged outside producer root',
    type: 'directory',
    bytes: 0,
    files: 0,
    fingerprint: 'd'.repeat(64),
  }];
  const forgedText = JSON.stringify(forged, null, 2);
  const forgedPath = join(f.repo, 'artifacts', 'forged-plan.json');
  await writeFile(forgedPath, forgedText);
  const forgedHash = createHash('sha256').update(forgedText).digest('hex');
  result = node(f.repo, ['scripts/storage-maintenance.mjs', '--apply', '--plan=' + forgedPath, '--plan-sha256=' + forgedHash], { ok: false });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /package-build.*범위|범위.*package-build/);
  assert.equal(JSON.parse(await readFile(join(protectedRoot, ownerFile), 'utf8')).kind, 'package-build');
  assert.equal(preview.candidates.some(item => item.path === scratch), true);
});

test('package retention only proposes owned outputs and preserves unknown release folders', async t => {
  const f = await fixture(t);
  const release = join(f.repo, 'release');
  const first = join(release, '20260101-000000');
  const second = join(release, '20260102-000000');
  await packageBuild(first, 'a'.repeat(64), '1', 'first');
  await packageBuild(second, 'b'.repeat(64), '2', 'second');
  const unknown = join(release, 'legacy-unknown');
  await mkdir(unknown, { recursive: true });
  await writeFile(join(unknown, 'keep.txt'), 'keep');
  const preview = parse(node(f.repo, ['scripts/storage-maintenance.mjs', '--reserve-package-slot', '--plan=artifacts/package-plan.json']));
  assert.equal(preview.candidates.length, 1);
  assert.equal(preview.candidates[0].path, first);
  assert.equal(preview.snapshot.packages.protected.some(item => item.path === unknown), true);
  assert.equal(await readFile(join(unknown, 'keep.txt'), 'utf8'), 'keep');

  if (process.platform === 'win32') {
    const plan = await readFile(join(f.repo, 'artifacts', 'package-plan.json'));
    const planHash = createHash('sha256').update(plan).digest('hex');
    const applied = parse(node(f.repo, ['scripts/storage-maintenance.mjs', '--apply', '--plan=artifacts/package-plan.json', '--plan-sha256=' + planHash]));
    assert.equal(applied.removed.length, 1);
    assert.equal(applied.removed[0].path, first);
    await assert.rejects(readFile(join(first, ownerFile)), error => error?.code === 'ENOENT');
    assert.equal(JSON.parse(await readFile(join(second, ownerFile), 'utf8')).fingerprint, 'b'.repeat(64));
    assert.equal(await readFile(join(unknown, 'keep.txt'), 'utf8'), 'keep');
  }
});

test('dirty, locked and unintegrated worktrees cannot become retirement deletion plans', async t => {
  const f = await fixture(t);
  const dirty = join(f.base, 'dirty');
  git(f.repo, ['worktree', 'add', '-b', 'dirty-test', dirty, f.head]);
  await writeFile(join(dirty, 'dirty.txt'), 'dirty');
  let result = node(f.repo, ['scripts/storage-maintenance.mjs', '--retire-worktree=' + dirty, '--integrated=' + f.head], { ok: false });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /dirty|untracked/i);

  await rm(join(dirty, 'dirty.txt'));
  await writeFile(join(dirty, 'unique.txt'), 'not integrated');
  git(dirty, ['add', 'unique.txt']);
  git(dirty, ['commit', '-m', 'unintegrated']);
  result = node(f.repo, ['scripts/storage-maintenance.mjs', '--retire-worktree=' + dirty, '--integrated=' + f.head], { ok: false });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /통합|trailer|원격/);

  const clean = join(f.base, 'clean');
  git(f.repo, ['worktree', 'add', '-b', 'clean-test', clean, f.head]);
  git(f.repo, ['worktree', 'lock', clean, '--reason', 'active-test']);
  result = node(f.repo, ['scripts/storage-maintenance.mjs', '--retire-worktree=' + clean, '--integrated=' + f.head], { ok: false });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /locked/);
});

test('retirement preview targets only regenerable directories and preserves models and evidence', async t => {
  const f = await fixture(t);
  const clean = join(f.base, 'clean');
  git(f.repo, ['worktree', 'add', '-b', 'clean-test', clean, f.head]);
  await mkdir(join(clean, 'node_modules', 'pkg'), { recursive: true });
  await mkdir(join(clean, 'dist'), { recursive: true });
  await mkdir(join(clean, '.models', 'original'), { recursive: true });
  await mkdir(join(clean, 'artifacts', 'evidence'), { recursive: true });
  await writeFile(join(clean, 'node_modules', 'pkg', 'index.js'), 'generated');
  await writeFile(join(clean, 'dist', 'index.html'), 'generated');
  await writeFile(join(clean, '.models', 'original', 'model.bin'), 'protected model');
  await writeFile(join(clean, 'artifacts', 'evidence', 'result.json'), '{"protected":true}');

  const preview = parse(node(f.repo, ['scripts/storage-maintenance.mjs', '--retire-worktree=' + clean, '--integrated=' + f.head]));
  const paths = new Set(preview.candidates.map(item => item.path));
  assert.equal(paths.has(join(clean, 'node_modules')), true);
  assert.equal(paths.has(join(clean, 'dist')), true);
  assert.equal([...paths].some(path => path.startsWith(join(clean, '.models'))), false);
  assert.equal([...paths].some(path => path.startsWith(join(clean, 'artifacts', 'evidence'))), false);
  assert.equal(await readFile(join(clean, '.models', 'original', 'model.bin'), 'utf8'), 'protected model');
  assert.equal(await readFile(join(clean, 'artifacts', 'evidence', 'result.json'), 'utf8'), '{"protected":true}');
});

test('reparse content is refused instead of becoming a deletion candidate', async t => {
  const f = await fixture(t);
  const clean = join(f.base, 'clean');
  git(f.repo, ['worktree', 'add', '-b', 'clean-test', clean, f.head]);
  const generated = join(clean, 'node_modules');
  const privateDir = join(f.base, 'private');
  await mkdir(generated, { recursive: true });
  await mkdir(privateDir, { recursive: true });
  await writeFile(join(privateDir, 'keep.txt'), 'keep');
  try {
    await symlink(privateDir, join(generated, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error?.code === 'EPERM') {
      t.skip('현재 Windows 계정에서 junction/symlink fixture 생성 권한이 없습니다.');
      return;
    }
    throw error;
  }
  const preview = parse(node(f.repo, ['scripts/storage-maintenance.mjs', '--retire-worktree=' + clean, '--integrated=' + f.head]));
  assert.equal(preview.candidates.some(item => item.path === generated), false);
  assert.equal(preview.refused.some(item => item.path === generated && /reparse|link/i.test(item.reason)), true);
  assert.equal(await readFile(join(privateDir, 'keep.txt'), 'utf8'), 'keep');
});


test('verified package reuse rejects files that are not in the manifest', async t => {
  const base = await mkdtemp(join(tmpdir(), 'nagneon-package-owner-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const build = join(base, 'release', 'one'), folder = join(build, 'app', 'Nagneon-win32-x64');
  await mkdir(folder, { recursive: true });
  const payload = Buffer.from('app');
  const fingerprint = 'c'.repeat(64);
  await writeFile(join(folder, 'Nagneon.exe'), payload);
  await writeFile(join(build, 'manifest.json'), JSON.stringify({
    buildFingerprint: fingerprint,
    files: [{
      path: 'Nagneon.exe',
      bytes: payload.length,
      sha256: createHash('sha256').update(payload).digest('hex'),
    }],
  }));
  await owner(build, 'package-build', 'complete', {
    fingerprint,
    folder: 'app/Nagneon-win32-x64',
    manifest: 'manifest.json',
    runId: 'one',
  });
  await verifyOwnedPackageBuild(build, fingerprint);
  await writeFile(join(folder, 'unexpected.bin'), 'unexpected');
  await assert.rejects(verifyOwnedPackageBuild(build, fingerprint), /파일 목록/);
});

test('runtime retention fails closed for protected catalogs and preserves the latest pointer', async t => {
  const f = await fixture(t);
  const store = join(f.repo, 'artifacts', 'runtime-packs');
  const catalogs = join(store, 'catalogs');
  await owner(store, 'runtime-pack-store', 'active');
  await mkdir(catalogs, { recursive: true });
  const oldPath = join(catalogs, 'old.json'), newPath = join(catalogs, 'new.json');
  const oldCatalog = { schema: 'nagneon.runtime-pack-catalog/2', verified: true, catalogId: 'old', createdAt: '2026-01-01T00:00:00.000Z', components: [] };
  const newCatalog = { schema: 'nagneon.runtime-pack-catalog/2', verified: true, catalogId: 'new', createdAt: '2026-01-02T00:00:00.000Z', components: [] };
  await writeFile(oldPath, JSON.stringify(oldCatalog));
  await writeFile(newPath, JSON.stringify(newCatalog));
  await writeFile(join(catalogs, 'unknown.txt'), 'protected');
  let preview = parse(node(f.repo, ['scripts/storage-maintenance.mjs', '--reserve-runtime-slot']));
  assert.equal(preview.candidates.some(item => item.kind === 'runtime-catalog'), false);
  assert.equal(preview.refused.some(item => item.kind === 'runtime-retention'), true);

  await rm(join(catalogs, 'unknown.txt'));
  await writeFile(join(f.repo, 'artifacts', 'latest-runtime-packs.json'), JSON.stringify({ catalog: oldPath }));
  preview = parse(node(f.repo, ['scripts/storage-maintenance.mjs', '--reserve-runtime-slot']));
  assert.equal(preview.candidates.some(item => item.kind === 'runtime-catalog'), false);
  assert.equal(preview.refused.some(item => item.kind === 'runtime-retention'), true);

  await writeFile(join(f.repo, 'artifacts', 'latest-runtime-packs.json'), JSON.stringify({ catalog: newPath }));
  preview = parse(node(f.repo, ['scripts/storage-maintenance.mjs', '--reserve-runtime-slot']));
  assert.equal(preview.candidates.some(item => item.kind === 'runtime-catalog' && item.path === oldPath), true);
  assert.equal(preview.candidates.some(item => item.path === newPath), false);
});

test('speech runtime and runtime scratch retention only target owned non-active outputs', async t => {
  const f = await fixture(t);
  const first = join(f.repo, 'artifacts', 'speech-runtime-owned-old');
  const second = join(f.repo, 'artifacts', 'speech-runtime-owned-new');
  const unknown = join(f.repo, 'artifacts', 'speech-runtime-legacy');
  await owner(first, 'speech-runtime', 'complete', { outputName: 'speech-runtime-owned-old', createdAt: '2026-01-01T00:00:00.000Z' });
  await owner(second, 'speech-runtime', 'complete', { outputName: 'speech-runtime-owned-new', createdAt: '2026-01-02T00:00:00.000Z' });
  await mkdir(unknown, { recursive: true });
  await writeFile(join(unknown, 'keep.bin'), 'legacy');
  const runtimeScratch = join(f.repo, 'artifacts', 'runtime-packs', '.scratch', 'failed');
  await owner(runtimeScratch, 'runtime-pack-scratch', 'failed', { runId: 'failed', catalogId: 'catalog' });
  await writeFile(join(runtimeScratch, 'partial.bin'), 'partial');

  const preview = parse(node(f.repo, ['scripts/storage-maintenance.mjs', '--reserve-speech-slot']));
  assert.equal(preview.candidates.some(item => item.kind === 'speech-runtime' && item.path === first), true);
  assert.equal(preview.candidates.some(item => item.path === second), false);
  assert.equal(preview.candidates.some(item => item.kind === 'runtime-pack-scratch' && item.path === runtimeScratch), true);
  assert.equal(preview.snapshot.speechRuntimes.protected.some(item => item.path === unknown), true);
  assert.equal(await readFile(join(unknown, 'keep.bin'), 'utf8'), 'legacy');
});

test('retirement removes verified latest package/runtime pointers but preserves compact plan evidence', async t => {
  const f = await fixture(t);
  const clean = join(f.base, 'clean');
  git(f.repo, ['worktree', 'add', '-b', 'clean-test', clean, f.head]);

  const build = join(clean, 'release', 'current');
  const fingerprint = 'e'.repeat(64);
  await packageBuild(build, fingerprint, 'current', 'verified-app');
  await mkdir(join(clean, 'artifacts'), { recursive: true });
  await writeFile(join(clean, 'artifacts', 'latest-package.json'), JSON.stringify({ build }));

  const runtimeStore = join(clean, 'artifacts', 'runtime-packs');
  await owner(runtimeStore, 'runtime-pack-store', 'active');
  const runtimeCatalog = join(runtimeStore, 'catalogs', 'current.json');
  await mkdir(dirname(runtimeCatalog), { recursive: true });
  await writeFile(runtimeCatalog, JSON.stringify({
    schema: 'nagneon.runtime-pack-catalog/2',
    verified: true,
    catalogId: 'current',
    createdAt: '2026-01-01T00:00:00.000Z',
    components: [],
  }));
  await writeFile(join(clean, 'artifacts', 'latest-runtime-packs.json'), JSON.stringify({
    output: runtimeStore,
    catalog: runtimeCatalog,
    verified: true,
  }));

  const speech = join(clean, 'artifacts', 'speech-runtime-retired');
  await owner(speech, 'speech-runtime', 'complete', { outputName: 'speech-runtime-retired' });
  await writeFile(join(speech, 'runtime.bin'), 'speech');
  const evidence = join(clean, 'artifacts', 'evidence', 'keep.json');
  await mkdir(dirname(evidence), { recursive: true });
  await writeFile(evidence, '{"keep":true}');

  const preview = parse(node(f.repo, ['scripts/storage-maintenance.mjs', '--retire-worktree=' + clean, '--integrated=' + f.head, '--plan=artifacts/retire-plan.json']));
  const packageCandidate = preview.candidates.find(item => item.path === build && item.kind === 'retired-package-build');
  assert.ok(packageCandidate);
  assert.equal(packageCandidate.manifestEvidence.buildFingerprint, fingerprint);
  assert.match(packageCandidate.manifestSha256, /^[a-f0-9]{64}$/);
  assert.equal(preview.candidates.some(item => item.kind === 'retired-package-pointer' && item.build === build), true);
  assert.equal(preview.candidates.some(item => item.path === runtimeStore && item.kind === 'retired-runtime-store'), true);
  assert.equal(preview.candidates.some(item => item.kind === 'retired-runtime-pointer' && item.store === runtimeStore), true);
  assert.equal(preview.candidates.some(item => item.path === speech && item.kind === 'retired-speech-runtime'), true);
  assert.equal(preview.candidates.some(item => item.path === evidence), false);

  const planText = await readFile(join(f.repo, 'artifacts', 'retire-plan.json'));
  const plan = JSON.parse(planText);
  const recorded = plan.candidates.find(item => item.path === build);
  assert.equal(recorded.manifestEvidence.files[0].sha256, createHash('sha256').update('verified-app').digest('hex'));

  if (process.platform === 'win32') {
    const planHash = createHash('sha256').update(planText).digest('hex');
    const applied = parse(node(f.repo, ['scripts/storage-maintenance.mjs', '--apply', '--plan=artifacts/retire-plan.json', '--plan-sha256=' + planHash]));
    assert.equal(applied.removed.some(item => item.path === build), true);
    assert.equal(applied.removed.some(item => item.kind === 'retired-package-pointer'), true);
    assert.equal(applied.removed.some(item => item.path === runtimeStore), true);
    assert.equal(applied.removed.some(item => item.kind === 'retired-runtime-pointer'), true);
    assert.equal(applied.removed.some(item => item.path === speech), true);
    await assert.rejects(readFile(join(clean, 'artifacts', 'latest-package.json')), error => error?.code === 'ENOENT');
    await assert.rejects(readFile(join(clean, 'artifacts', 'latest-runtime-packs.json')), error => error?.code === 'ENOENT');
    assert.equal(await readFile(evidence, 'utf8'), '{"keep":true}');
    assert.equal(JSON.parse(await readFile(join(f.repo, 'artifacts', 'retire-plan.json'), 'utf8')).candidates.some(item => item.manifestEvidence), true);
  }
});

test('retirement preserves runtime store when the latest runtime pointer is stale', async t => {
  const f = await fixture(t);
  const clean = join(f.base, 'clean');
  git(f.repo, ['worktree', 'add', '-b', 'clean-test', clean, f.head]);
  const runtimeStore = join(clean, 'artifacts', 'runtime-packs');
  await owner(runtimeStore, 'runtime-pack-store', 'active');
  await writeFile(join(clean, 'artifacts', 'latest-runtime-packs.json'), JSON.stringify({
    output: runtimeStore,
    catalog: join(runtimeStore, 'catalogs', 'missing.json'),
    verified: true,
  }));

  const preview = parse(node(f.repo, ['scripts/storage-maintenance.mjs', '--retire-worktree=' + clean, '--integrated=' + f.head]));
  assert.equal(preview.candidates.some(item => item.path === runtimeStore), false);
  assert.equal(preview.candidates.some(item => item.kind === 'retired-runtime-pointer'), false);
  assert.equal(preview.refused.some(item => item.kind === 'retired-runtime-pointer' && /catalog|검증/.test(item.reason)), true);
  assert.equal(preview.refused.some(item => item.path === runtimeStore && item.kind === 'retired-runtime-store'), true);
});

test('retirement preserves runtime store while runtime scratch exists', async t => {
  const f = await fixture(t);
  const clean = join(f.base, 'clean');
  git(f.repo, ['worktree', 'add', '-b', 'clean-test', clean, f.head]);
  const runtimeStore = join(clean, 'artifacts', 'runtime-packs');
  await owner(runtimeStore, 'runtime-pack-store', 'active');
  const runtimeCatalog = join(runtimeStore, 'catalogs', 'current.json');
  await mkdir(dirname(runtimeCatalog), { recursive: true });
  await writeFile(runtimeCatalog, JSON.stringify({
    schema: 'nagneon.runtime-pack-catalog/2',
    verified: true,
    catalogId: 'current',
    createdAt: '2026-01-01T00:00:00.000Z',
    components: [],
  }));
  await writeFile(join(clean, 'artifacts', 'latest-runtime-packs.json'), JSON.stringify({
    output: runtimeStore,
    catalog: runtimeCatalog,
    verified: true,
  }));
  const scratch = join(runtimeStore, '.scratch', 'active');
  await owner(scratch, 'runtime-pack-scratch', 'building', { runId: 'active', catalogId: 'current' });

  const preview = parse(node(f.repo, ['scripts/storage-maintenance.mjs', '--retire-worktree=' + clean, '--integrated=' + f.head]));
  assert.equal(preview.candidates.some(item => item.path === runtimeStore), false);
  assert.equal(preview.candidates.some(item => item.kind === 'retired-runtime-pointer'), false);
  assert.equal(preview.refused.some(item => item.path === runtimeStore && /scratch/.test(item.reason)), true);
});

test('retirement refuses a corrupted non-latest owned package', async t => {
  const f = await fixture(t);
  const clean = join(f.base, 'clean');
  git(f.repo, ['worktree', 'add', '-b', 'clean-test', clean, f.head]);
  const first = join(clean, 'release', 'older');
  const latest = join(clean, 'release', 'latest');
  await packageBuild(first, '1'.repeat(64), 'older', 'older');
  await packageBuild(latest, '2'.repeat(64), 'latest', 'latest');
  await mkdir(join(clean, 'artifacts'), { recursive: true });
  await writeFile(join(clean, 'artifacts', 'latest-package.json'), JSON.stringify({ build: latest }));
  await writeFile(join(first, 'app', 'Nagneon-win32-x64', 'Nagneon.exe'), 'tampered');

  const preview = parse(node(f.repo, ['scripts/storage-maintenance.mjs', '--retire-worktree=' + clean, '--integrated=' + f.head]));
  assert.equal(preview.candidates.some(item => item.path === first), false);
  assert.equal(preview.refused.some(item => item.path === first && /무결성/.test(item.reason)), true);
  assert.equal(preview.candidates.some(item => item.path === latest && item.kind === 'retired-package-build'), true);
  assert.equal(preview.candidates.some(item => item.kind === 'retired-package-pointer' && item.build === latest), true);
});

test('retirement fails closed when latest package integrity cannot be verified', async t => {
  const f = await fixture(t);
  const clean = join(f.base, 'clean');
  git(f.repo, ['worktree', 'add', '-b', 'clean-test', clean, f.head]);
  const build = join(clean, 'release', 'current');
  const fingerprint = 'f'.repeat(64);
  await packageBuild(build, fingerprint, 'current', 'original');
  await mkdir(join(clean, 'artifacts'), { recursive: true });
  await writeFile(join(clean, 'artifacts', 'latest-package.json'), JSON.stringify({ build }));
  await writeFile(join(build, 'app', 'Nagneon-win32-x64', 'Nagneon.exe'), 'tampered');

  const preview = parse(node(f.repo, ['scripts/storage-maintenance.mjs', '--retire-worktree=' + clean, '--integrated=' + f.head]));
  assert.equal(preview.candidates.some(item => item.path === build), false);
  assert.equal(preview.candidates.some(item => item.kind === 'retired-package-pointer'), false);
  assert.equal(preview.refused.some(item => item.path === build && /참조 집합/.test(item.reason)), true);
  assert.equal(preview.refused.some(item => item.kind === 'retired-package-pointer' && /무결성/.test(item.reason)), true);
});

test('apply refuses deletion while another process command line references the target', async t => {
  if (process.platform !== 'win32') {
    t.skip('Windows process inspection contract');
    return;
  }
  const f = await fixture(t);
  const scratch = join(f.repo, 'artifacts', 'package-scratch', 'process-held');
  await owner(scratch, 'package-scratch', 'failed', { runId: 'process-held' });
  await writeFile(join(scratch, 'partial.bin'), Buffer.alloc(64));
  const preview = parse(node(f.repo, ['scripts/storage-maintenance.mjs', '--plan=artifacts/process-plan.json']));
  const plan = await readFile(join(f.repo, 'artifacts', 'process-plan.json'));
  const planHash = createHash('sha256').update(plan).digest('hex');
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},30000)', scratch], { windowsHide: true, stdio: 'ignore' });
  t.after(() => child.kill());
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  await new Promise(resolve => setTimeout(resolve, 250));
  const applied = node(f.repo, ['scripts/storage-maintenance.mjs', '--apply', '--plan=artifacts/process-plan.json', '--plan-sha256=' + planHash], { ok: false });
  assert.notEqual(applied.status, 0);
  assert.match(applied.stderr + applied.stdout, /실행 중 프로세스/);
  assert.equal((await readFile(join(scratch, 'partial.bin'))).length, 64);
  assert.equal(preview.candidates.some(item => item.path === scratch), true);
});
