import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, readdir, rm, lstat, symlink } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';
import { distributionComponents } from '../scripts/lib/distribution-components.mjs';
import { RuntimeComponents } from '../server/runtime-components.js';
import { verifyRuntimeComponent } from '../server/runtime-pack.js';

const hash = (data) => createHash('sha256').update(data).digest('hex');
const ids = ['audio', 'sound', 'microphone', 'gpu'];
const deferred = () => {
  let release;
  const promise = new Promise((done) => {
    release = done;
  });
  return { promise, release };
};
async function until(predicate) {
  for (let i = 0; i < 300; i++) {
    if (await predicate()) return;
    await delay(10);
  }
  assert.fail('Expected runtime state was not reached');
}
async function fixture(t, installed = ids) {
  await mkdir('artifacts', { recursive: true });
  const root = await mkdtemp(resolve('artifacts/readiness-'));
  const cache = join(root, 'cache');
  const files = [
    'resources/speech/python/python.exe',
    'resources/speech/model/model.bin',
    'resources/speech/microphone-model/model.bin',
    'resources/speech/gpu/library.dll',
  ].map((path) => ({ path, bytes: 1, sha256: hash('x') }));
  const packed = gzipSync(Buffer.from('x'));
  const archive = join(root, 'fixture.ngpack');
  await writeFile(archive, packed);
  const components = distributionComponents(files).filter((c) => c.id !== 'app');
  for (const component of components)
    component.archive = {
      format: 'nagneon-runtime-gzip/1',
      bytes: packed.length,
      sha256: hash(packed),
      url: `https://example.invalid/${component.id}.ngpack`,
    };
  const catalog = { format: 'nagneon-runtime-catalog/1', components };
  const target = (id) =>
    join(cache, 'installed', id + '-' + components.find((c) => c.id === id).contentId.slice(0, 32));
  const file = (id) => join(target(id), components.find((c) => c.id === id).files[0].path);
  for (const id of installed) {
    await mkdir(dirname(file(id)), { recursive: true });
    await writeFile(file(id), 'x');
  }
  const downloads = [],
    managers = [];
  const options = {
    cache,
    catalog,
    download: async ({ component }) => {
      downloads.push(component.id);
      return { path: archive };
    },
  };
  const manager = (overrides = {}) => {
    const result = new RuntimeComponents({ ...options, ...overrides });
    managers.push(result);
    return result;
  };
  t.after(async () => {
    await Promise.all(managers.map((m) => m.close()));
    await rm(root, { recursive: true, force: true });
  });
  return { root, cache, catalog, components, target, file, options, manager, downloads };
}
const statuses = (manager) =>
  Object.fromEntries(manager.snapshot().components.map((c) => [c.id, c.status]));
const allReady = Object.fromEntries(ids.map((id) => [id, 'ready']));

test('startup inspection restores all installed components offline without a prepare request', async (t) => {
  const f = await fixture(t);
  const manager = f.manager({ download: () => assert.fail('Startup must remain offline') });
  const scan = manager.inspectInstalled();
  assert.equal(manager.snapshot().preparing, false);
  assert.equal(manager.inspectInstalled(), scan);
  await scan;
  assert.deepEqual(statuses(manager), allReady);
  assert.ok(manager.snapshot().components.every((c) => c.installedBytes === c.installBytes));
  assert.equal(manager.jobs.size, 0);
  await manager.close();
  const relaunched = f.manager({ download: () => assert.fail('Relaunch must remain offline') });
  await relaunched.inspectInstalled();
  assert.deepEqual(statuses(relaunched), allReady);
});

test('startup inspection of an empty cache neither installs nor creates directories', async (t) => {
  const f = await fixture(t, []);
  const manager = f.manager();
  await manager.inspectInstalled();
  assert.deepEqual(statuses(manager), Object.fromEntries(ids.map((id) => [id, 'idle'])));
  assert.deepEqual(f.downloads, []);
  await assert.rejects(lstat(f.cache), { code: 'ENOENT' });
});

test('startup inspection distinguishes partial installations and a changed component identity', async (t) => {
  const f = await fixture(t, ['audio', 'sound', 'microphone']);
  const changed = structuredClone(f.catalog);
  const mic = changed.components.find((c) => c.id === 'microphone');
  mic.files[0].sha256 = hash('y');
  mic.contentId = hash(JSON.stringify(mic.files));
  const manager = f.manager({ catalog: changed });
  await manager.inspectInstalled();
  assert.deepEqual(statuses(manager), {
    audio: 'ready',
    sound: 'ready',
    microphone: 'idle',
    gpu: 'idle',
  });
  assert.equal(await readFile(f.file('microphone'), 'utf8'), 'x');
  assert.deepEqual(f.downloads, []);
});

test('inspection detects same-size corruption without repairing or deleting files, then explicit preparation repairs it', async (t) => {
  const f = await fixture(t);
  await writeFile(f.file('audio'), 'y');
  const savedArchive = join(f.cache, 'downloads', f.components[0].archive.sha256 + '.ngpack');
  await mkdir(dirname(savedArchive), { recursive: true });
  await writeFile(savedArchive, 'preserved compressed copy');
  const before = await lstat(f.file('audio'));
  const manager = f.manager();
  await manager.inspectInstalled();
  assert.deepEqual(statuses(manager), { ...allReady, audio: 'error' });
  assert.equal(manager.snapshot().components[0].installedBytes, 0);
  assert.equal(await readFile(f.file('audio'), 'utf8'), 'y');
  assert.equal((await lstat(f.file('audio'))).mtimeMs, before.mtimeMs);
  assert.equal(await readFile(savedArchive, 'utf8'), 'preserved compressed copy');
  assert.deepEqual(f.downloads, []);
  await manager.prepare('clips');
  assert.equal(await readFile(f.file('audio'), 'utf8'), 'x');
  assert.deepEqual(f.downloads, ['audio']);
  assert.deepEqual(statuses(manager), allReady);
});

test('an incomplete installed directory is not ready and other installed components still recover', async (t) => {
  const f = await fixture(t);
  await rm(f.file('sound'));
  const manager = f.manager();
  await manager.inspectInstalled();
  assert.deepEqual(statuses(manager), { ...allReady, sound: 'error' });
  assert.deepEqual(f.downloads, []);
  await manager.prepare('sound');
  assert.deepEqual(f.downloads, ['sound']);
  assert.deepEqual(statuses(manager), allReady);
});

test('inspection isolates permission failures and exposes neither filesystem paths nor download URLs', async (t) => {
  const f = await fixture(t);
  const manager = f.manager({
    verify: (root, component, signal) => {
      if (component.id === 'audio')
        throw Object.assign(Error(root + ' https://example.invalid/private'), { code: 'EACCES' });
      return verifyRuntimeComponent(root, component, signal);
    },
  });
  await manager.inspectInstalled();
  assert.deepEqual(statuses(manager), { ...allReady, audio: 'error' });
  const state = JSON.stringify(manager.snapshot());
  assert.ok(!state.includes(f.cache));
  assert.ok(!state.includes('example.invalid'));
  assert.deepEqual(f.downloads, []);
});

test('inspection refuses linked installation roots without changing their targets', async (t) => {
  const f = await fixture(t, ['sound', 'microphone', 'gpu']);
  const outside = join(f.root, 'linked-fixture');
  await mkdir(join(outside, 'resources', 'speech', 'python'), { recursive: true });
  await writeFile(join(outside, f.components[0].files[0].path), 'x');
  await symlink(outside, f.target('audio'), process.platform === 'win32' ? 'junction' : 'dir');
  const manager = f.manager();
  await manager.inspectInstalled();
  assert.deepEqual(statuses(manager), { ...allReady, audio: 'error' });
  assert.equal(await readFile(join(outside, f.components[0].files[0].path), 'utf8'), 'x');
  assert.deepEqual(f.downloads, []);
});

test('preparation shares an in-flight installed check and cancelling one consumer preserves the others', async (t) => {
  const f = await fixture(t);
  const gate = deferred();
  t.after(() => gate.release());
  let audioChecks = 0;
  const manager = f.manager({
    verify: async (root, component, signal) => {
      if (component.id === 'audio') {
        audioChecks++;
        await gate.promise;
      }
      return verifyRuntimeComponent(root, component, signal);
    },
  });
  const scan = manager.inspectInstalled();
  await until(() => audioChecks === 1);
  const controller = new AbortController();
  const first = manager.prepare('clips', controller.signal);
  const rejected = assert.rejects(first);
  const second = manager.prepare('clips');
  assert.equal(manager.snapshot().preparing, true);
  controller.abort();
  await rejected;
  gate.release();
  await Promise.all([second, scan]);
  assert.equal(audioChecks, 1);
  assert.deepEqual(f.downloads, []);
  assert.equal(manager.snapshot().preparing, false);
  assert.deepEqual(statuses(manager), allReady);
});

test('global install cancellation while waiting for inspection cannot start a delayed download', async (t) => {
  const f = await fixture(t);
  await writeFile(f.file('audio'), 'y');
  const gate = deferred();
  t.after(() => gate.release());
  let checking = false;
  const manager = f.manager({
    verify: async (root, component, signal) => {
      if (component.id === 'audio') {
        checking = true;
        await gate.promise;
      }
      return verifyRuntimeComponent(root, component, signal);
    },
  });
  const scan = manager.inspectInstalled();
  await until(() => checking);
  const pending = manager.prepare('clips');
  const rejected = assert.rejects(pending);
  manager.cancel();
  await rejected;
  gate.release();
  await scan;
  assert.deepEqual(f.downloads, []);
  assert.deepEqual(statuses(manager), { ...allReady, audio: 'error' });
  assert.equal(manager.snapshot().preparing, false);
});

test('inspection joining an existing installation does not keep a cancelled download alive', async (t) => {
  const f = await fixture(t, []);
  let started = false;
  const manager = f.manager({
    download: ({ signal }) => {
      started = true;
      return new Promise((yes, no) => {
        signal.throwIfAborted();
        signal.addEventListener('abort', () => no(signal.reason), { once: true });
      });
    },
  });
  const controller = new AbortController();
  const pending = manager.prepare('clips', controller.signal);
  const rejected = assert.rejects(pending);
  await until(() => started);
  const scan = manager.inspectInstalled();
  controller.abort();
  await rejected;
  await scan;
  assert.equal(manager.jobs.size, 0);
  assert.equal(statuses(manager).audio, 'idle');
});

test('app close aborts and drains installed checks and waiting preparations', async (t) => {
  const f = await fixture(t);
  let started = 0,
    stopped = 0;
  const manager = f.manager({
    verify: (root, component, signal) =>
      new Promise((yes, no) => {
        started++;
        signal.throwIfAborted();
        signal.addEventListener(
          'abort',
          () => {
            stopped++;
            no(signal.reason);
          },
          { once: true },
        );
      }),
  });
  const scan = manager.inspectInstalled();
  await until(() => started === 4);
  const pending = manager.prepare('clips');
  const rejected = assert.rejects(pending);
  await manager.close();
  await rejected;
  await scan;
  assert.equal(stopped, 4);
  assert.equal(manager.jobs.size, 0);
  assert.equal(manager.snapshot().preparing, false);
  assert.ok(manager.snapshot().components.every((c) => c.status === 'idle'));
  await assert.rejects(manager.prepare('clips'), /종료/);
  await assert.rejects(manager.inspectInstalled(), /종료/);
});

test('server restart and changed app resource directories recover ready HTTP state without preparing', async (t) => {
  const { startServer } = await import('../server/index.js');
  const { packagedRuntime } = createRequire(import.meta.url)('../desktop/runtime.cjs');
  const f = await fixture(t);
  let downloads = 0;
  for (const version of ['app-before-update', 'app-after-update']) {
    const resources = join(f.root, version, 'resources');
    for (const file of [
      'codex/bin/codex.exe',
      'speech/speech_worker.py',
      'speech/clip_inspector.py',
      'speech/clip_perception.py',
      'sound/sound_worker.py',
    ]) {
      await mkdir(dirname(join(resources, file)), { recursive: true });
      await writeFile(join(resources, file), 'synthetic worker; never executed');
    }
    const runtime = packagedRuntime(resources, { cache: f.cache, catalog: f.catalog });
    runtime.components.download = () => {
      downloads++;
      assert.fail('Startup must not download');
    };
    const service = await startServer({
      port: 0,
      persist: false,
      localSpeech: false,
      provider: { status: () => ({ configured: false }) },
      runtime,
    });
    try {
      let state;
      await until(async () => {
        const response = await fetch(service.url + '/api/state', {
          headers: { Authorization: 'Bearer ' + service.accessToken },
        });
        assert.equal(response.status, 200);
        state = await response.json();
        return state.runtimeComponents.components.every((c) => c.status !== 'checking');
      });
      assert.deepEqual(
        Object.fromEntries(state.runtimeComponents.components.map((c) => [c.id, c.status])),
        allReady,
      );
      assert.equal(state.runtimeComponents.preparing, false);
      assert.equal(downloads, 0);
      assert.equal(state.running, false);
      assert.ok(!JSON.stringify(state.runtimeComponents).includes(f.cache));
    } finally {
      await service.close();
    }
  }
  assert.deepEqual(
    (await readdir(join(f.cache, 'installed'))).sort(),
    f.components.map((c) => c.id + '-' + c.contentId.slice(0, 32)).sort(),
  );
});
