import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { startServer } from '../server/index.js';

const config = {
  kind: 'routing',
  version: 1,
  connections: [
    { id: 'main', label: '구독', provider: { kind: 'codex', model: 'future' } },
    {
      id: 'api',
      label: '개별 API',
      provider: { kind: 'openai', model: 'custom', base: 'https://example.com/v1' },
    },
  ],
  routes: { default: { primary: 'main' }, chat: { primary: 'api' } },
};
const testOptions = { timeout: 30_000 };

function entrySignal() {
  let notify,
    entered = false;
  const promise = new Promise((resolve) => {
    notify = () => {
      entered = true;
      resolve();
    };
  });
  return {
    promise,
    notify,
    get entered() {
      return entered;
    },
  };
}

async function observeProbeEntry({ entry, pending, signal }) {
  if (signal.aborted) throw new Error('Probe entry observation aborted');
  let onAbort;
  const aborted = new Promise((resolve) => {
    onAbort = () => resolve({ kind: 'aborted' });
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    // Every race branch fulfills, including a later cancelled HTTP response.
    const result = await Promise.race([
      entry.then(() => ({ kind: 'entered' })),
      pending.then(
        (response) => ({ kind: 'settled', status: response.status }),
        () => ({ kind: 'transport' }),
      ),
      aborted,
    ]);
    if (result.kind === 'entered') return;
    if (result.kind === 'settled') {
      throw new Error(`Probe ended before backend entry (HTTP ${result.status})`);
    }
    if (result.kind === 'transport') {
      throw new Error('Probe transport failed before backend entry');
    }
    throw new Error('Probe entry observation aborted');
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

async function withFixture(run) {
  const artifactRoot = resolve('artifacts');
  const folder = await mkdtemp(resolve(artifactRoot, 'routing-api-'));
  const operation = new AbortController();
  const watchdog = setTimeout(
    () => operation.abort(new Error('Synthetic probe operation deadline')),
    25_000,
  );
  watchdog.unref();
  const sinks = [];
  const state = { gate: true, block: false, enter: null, called: null, calls: 0, aborts: 0 };
  let service,
    successful = false;
  const factory = (config) => ({
    model: config?.model || 'default',
    effort: 'low',
    key: '',
    bin: 'official-cli',
    env: {},
    check: async () => {},
    status() {
      return { configured: true, model: this.model };
    },
    async react(_args, signal) {
      state.calls++;
      if (signal.aborted) {
        state.aborts++;
        throw new Error('Synthetic probe cancelled');
      }
      if (state.block) {
        const held = new Promise((_, reject) => {
          const onAbort = () => {
            signal.removeEventListener('abort', onAbort);
            state.aborts++;
            reject(new Error('Synthetic probe cancelled'));
          };
          if (signal.aborted) onAbort();
          else signal.addEventListener('abort', onAbort, { once: true });
        });
        state.called?.();
        state.enter?.();
        await held;
      } else {
        state.called?.();
        state.enter?.();
      }
      return {
        observation: { messages: [{ personaId: 'probe', text: '안녕하세요' }] },
        usage: { total_tokens: 1 },
      };
    },
  });
  const options = {
    port: 0,
    dataDir: folder,
    localSpeech: false,
    providerSwitchAllowed: () => state.gate,
    providerFactories: { codex: factory, configuredApi: factory },
  };
  const post = (path, body = {}, signal = operation.signal) => {
    const pending = (async () => {
      const response = await fetch(service.url + '/api/' + path, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + service.accessToken,
          'Content-Type': 'application/json',
          'X-Backseat-Client': 'studio',
        },
        body: JSON.stringify(body),
        signal: signal === operation.signal ? signal : AbortSignal.any([operation.signal, signal]),
      });
      return { ok: response.ok, status: response.status, value: await response.json() };
    })();
    // Observe rejection immediately, even while the test awaits backend entry.
    sinks.push(
      pending.then(
        () => ({ kind: 'fulfilled' }),
        () => ({ kind: 'rejected' }),
      ),
    );
    return pending;
  };
  const fixture = {
    folder,
    operation,
    state,
    post,
    get service() {
      return service;
    },
    async restart() {
      await service.close();
      service = await startServer(options);
      operation.signal.throwIfAborted();
    },
  };
  try {
    service = await startServer(options);
    operation.signal.throwIfAborted();
    await run(fixture);
    successful = true;
  } finally {
    clearTimeout(watchdog);
    operation.abort(new Error('Synthetic fixture cleanup'));
    await service?.close();
    await Promise.all(sinks);
    assert.equal(existsSync(resolve(folder, '.nagneon-writer')), false);
    if (successful) {
      assert.equal(dirname(folder), artifactRoot);
      assert.ok(basename(folder).startsWith('routing-api-'));
      assert.notEqual(folder, artifactRoot);
      await rm(folder, { recursive: true, force: false });
    }
  }
}

async function prepareRouting(fixture) {
  assert.equal((await fixture.post('connection/provider', config)).ok, true);
  assert.equal(
    (await fixture.post('connection/routing/key', { id: 'api', apiKey: 'private-key' })).ok,
    true,
  );
}

test(
  'API routes persist with the same world, isolate credentials and cancel individual probes',
  testOptions,
  async () => {
    await withFixture(async (fixture) => {
      const { state, post, operation } = fixture;
      const title = fixture.service.studio.settings.title;
      await prepareRouting(fixture);
      assert.ok(!JSON.stringify(fixture.service.studio.state()).includes('private-key'));
      assert.ok(
        !(await readFile(resolve(fixture.folder, 'provider-choice.json'), 'utf8')).includes(
          'private-key',
        ),
      );
      state.gate = false;
      assert.equal(
        (await post('connection/routing/key', { id: 'api', apiKey: 'other' })).ok,
        false,
      );
      state.gate = true;
      await fixture.restart();
      assert.equal(fixture.service.studio.settings.title, title);
      assert.equal(
        fixture.service.studio.state().providerChoice.routing.config.connections[1].provider.model,
        'custom',
      );
      assert.equal((await post('connection/routing/probe', { id: 'api' })).value.status, 'ready');
      state.block = true;
      state.calls = 0;
      state.aborts = 0;
      const entry = entrySignal();
      state.enter = entry.notify;
      const pending = post('connection/routing/probe', { id: 'api' });
      await observeProbeEntry({ entry: entry.promise, pending, signal: operation.signal });
      assert.equal(state.calls, 1);
      assert.equal((await post('connection/provider', { kind: 'codex' })).ok, false);
      assert.equal((await post('connection/probe/cancel')).ok, true);
      assert.equal((await pending).value.status, 'cancelled');
      assert.equal(state.aborts, 1);
      assert.equal((await post('connection/provider', { kind: 'codex' })).ok, true);
      assert.equal(fixture.service.studio.settings.title, title);
    });
  },
);

test(
  'probe entry observation preserves a legitimate early HTTP 409 without backend entry',
  testOptions,
  async () => {
    await withFixture(async (fixture) => {
      await prepareRouting(fixture);
      fixture.state.gate = false;
      fixture.state.block = true;
      const entry = entrySignal();
      fixture.state.enter = entry.notify;
      const pending = fixture.post('connection/routing/probe', { id: 'api' });
      await assert.rejects(
        observeProbeEntry({ entry: entry.promise, pending, signal: fixture.operation.signal }),
        { message: 'Probe ended before backend entry (HTTP 409)' },
      );
      assert.equal((await pending).status, 409);
      assert.equal((await pending).ok, false);
      assert.equal(fixture.state.calls, 0);
      assert.equal(fixture.state.aborts, 0);
      assert.equal(entry.entered, false);
    });
  },
);

test(
  'probe HTTP 200 readiness does not conceal a missing backend entry callback',
  testOptions,
  async () => {
    await withFixture(async (fixture) => {
      await prepareRouting(fixture);
      const entry = entrySignal();
      const pending = fixture.post('connection/routing/probe', { id: 'api' });
      await assert.rejects(
        observeProbeEntry({ entry: entry.promise, pending, signal: fixture.operation.signal }),
        { message: 'Probe ended before backend entry (HTTP 200)' },
      );
      assert.equal((await pending).status, 200);
      assert.equal((await pending).value.status, 'ready');
      assert.equal(fixture.state.calls, 1);
      assert.equal(entry.entered, false);
    });
  },
);

test(
  'a held probe with no entry callback leaves its observer on abort and still cancels the backend',
  testOptions,
  async () => {
    await withFixture(async (fixture) => {
      await prepareRouting(fixture);
      const called = entrySignal(),
        entry = entrySignal();
      fixture.state.block = true;
      fixture.state.called = called.notify;
      const pending = fixture.post('connection/routing/probe', { id: 'api' });
      await observeProbeEntry({ entry: called.promise, pending, signal: fixture.operation.signal });
      const observer = new AbortController();
      const observation = observeProbeEntry({
        entry: entry.promise,
        pending,
        signal: AbortSignal.any([fixture.operation.signal, observer.signal]),
      });
      observer.abort(new Error('Synthetic observer cancellation'));
      await assert.rejects(observation, { message: 'Probe entry observation aborted' });
      assert.equal(called.entered, true);
      assert.equal(entry.entered, false);
      assert.equal(fixture.state.calls, 1);
      assert.equal((await fixture.post('connection/probe/cancel')).ok, true);
      assert.equal((await pending).value.status, 'cancelled');
      assert.equal(fixture.state.aborts, 1);
    });
  },
);

test(
  'probe transport rejection exposes no private abort reason and never enters the backend',
  testOptions,
  async () => {
    await withFixture(async (fixture) => {
      await prepareRouting(fixture);
      const entry = entrySignal(),
        transport = new AbortController();
      transport.abort(new Error('Synthetic private-key sentinel'));
      assert.equal(transport.signal.reason.message.includes('private-key'), true);
      const pending = fixture.post('connection/routing/probe', { id: 'api' }, transport.signal);
      await assert.rejects(
        observeProbeEntry({ entry: entry.promise, pending, signal: fixture.operation.signal }),
        { message: 'Probe transport failed before backend entry' },
      );
      assert.equal(
        await pending.then(
          () => false,
          () => true,
        ),
        true,
      );
      assert.equal(fixture.state.calls, 0);
      assert.equal(entry.entered, false);
    });
  },
);
