import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, writeFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { packageLayout, validatePackageCatalog, stageComponentRuntime } from '../scripts/lib/package-layout.mjs';

const catalog = JSON.parse(await readFile(new URL('../shared/runtime-catalog.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(catalog);
test('Windows packaging defaults to components; full bundling is explicit', () => {
  assert.deepEqual(packageLayout([]), { modular: true, speech: undefined });
  assert.equal(packageLayout(['--components']).modular, true);
  assert.equal(packageLayout(['--speech=legacy']).modular, true);
  assert.deepEqual(packageLayout(['--bundled', '--speech=runtime']), { modular: false, speech: 'runtime' });
  assert.throws(() => packageLayout(['--bundled']), /--speech/);
  assert.throws(() => packageLayout(['--bundled', '--components', '--speech=runtime']), /함께/);
});
test('pinned catalog rejects missing, duplicate, damaged and insecure components', () => {
  assert.equal(validatePackageCatalog(catalog), catalog);
  const broken = [
    c => c.components.pop(),
    c => c.components.push(c.components[0]),
    c => c.components[0].files[0].bytes++,
    c => c.components[0].archive.sha256 = 'missing',
    c => c.components[0].archive.bytes = 0,
    c => c.components[0].archive.url = 'http://example.invalid/runtime',
    c => c.components[0].archive.url = 'https://user:password@example.invalid/runtime',
  ];
  for (const mutate of broken) {
    const c = clone(); mutate(c); assert.throws(() => validatePackageCatalog(c));
  }
});
test('self-consistent catalogs still require correct component files', () => {
  for (const replacement of ['resources/speech/python/not-python.exe', 'resources/sound/model/not-python.exe']) {
    const c = clone(), audio = c.components.find(c => c.id === 'audio');
    audio.files.find(f => f.path === 'resources/speech/python/python.exe').path = replacement;
    audio.contentId = createHash('sha256').update(JSON.stringify(audio.files)).digest('hex');
    assert.throws(() => validatePackageCatalog(c), /필수|분류/);
  }
});
test('component staging needs only workers, never models; packaged startup resolves optional cache', async t => {
  await mkdir('artifacts', { recursive: true });
  const root = await mkdtemp(resolve('artifacts/package-layout-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source'), target = join(root, 'resources');
  await mkdir(join(source, 'scripts'), { recursive: true });
  const names = ['speech_worker.py', 'clip_inspector.py', 'clip_perception.py', 'sound_worker.py'];
  for (const name of names) await writeFile(join(source, 'scripts', name), name);
  await stageComponentRuntime(source, target, catalog);
  assert.deepEqual((await readdir(target)).sort(), ['runtime-components.json', 'sound', 'speech']);
  assert.deepEqual((await readdir(join(target, 'speech'))).sort(), ['clip_inspector.py', 'clip_perception.py', 'speech_worker.py']);
  assert.deepEqual(await readdir(join(target, 'sound')), ['sound_worker.py']);
  await mkdir(join(target, 'codex', 'bin'), { recursive: true });
  await writeFile(join(target, 'codex', 'bin', 'codex.exe'), 'synthetic, not an executable');
  const { packagedRuntime } = createRequire(import.meta.url)('../desktop/runtime.cjs');
  const runtime = packagedRuntime(target, { cache: join(root, 'cache'), catalog });
  assert.equal(runtime.speech.modelName, 'medium');
  assert.match(runtime.speech.python, /installed/);
  assert.deepEqual(JSON.parse(await readFile(join(target, 'runtime-components.json'), 'utf8')), { schema: 'nagneon-runtime-layout/1', mode: 'components' });
  assert.deepEqual(await readdir(source), ['scripts']);
  await assert.rejects(stageComponentRuntime(source, target, catalog), /exist/i);
});
test('invalid catalog fails before creating component staging', async t => {
  await mkdir('artifacts', { recursive: true });
  const root = await mkdtemp(resolve('artifacts/package-invalid-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(stageComponentRuntime(root, join(root, 'output'), { format: 'wrong' }));
  assert.deepEqual(await readdir(root), []);
});
