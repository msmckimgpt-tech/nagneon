import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { SpeechQueue } from '../src/speech-flow.ts';

test('system sound recovery has a lifetime budget and ignores stale failures', async () => {
  const effects = [],
    states = [],
    listeners = [],
    timers = new Map();
  let serial = 0;
  const track = { readyState: 'live' },
    stream = { getAudioTracks: () => [track] };
  const compiled = ts.transpileModule(
    readFileSync(new URL('../src/useSystemSound.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  class Listening {
    constructor(options) {
      this.options = options;
      this.stops = 0;
      listeners.push(this);
    }
    async start() {}
    stopCapture() {
      this.stops++;
    }
  }
  const imports = {
    react: {
      useEffect: (fn) => effects.push(fn),
      useRef: (value) => ({ current: value }),
      useState: (value) => [value, (next) => states.push(next)],
    },
    './speech-flow': { SpeechQueue },
    './continuous-listening': { ContinuousListening: Listening },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: (id) => imports[id],
    AbortController,
    crypto,
    Error,
    MediaStream: class {
      constructor(tracks) {
        this.tracks = tracks;
      }
      getTracks() {
        return this.tracks;
      }
    },
    fetch: async () => ({ ok: true, json: async () => ({ transport: 'subscription' }) }),
    setTimeout: (fn, delay) => (timers.set(++serial, { fn, delay }), serial),
    clearTimeout: (id) => timers.delete(id),
    clearInterval() {},
  });
  module.exports.useSystemSound(stream, 'broadcast', () => {});
  const cleanup = effects[0](),
    flush = () => new Promise((resolve) => setImmediate(resolve));
  await flush();
  assert.equal(listeners.length, 1);
  for (const delay of [1000, 2000, 5000]) {
    const current = listeners.at(-1);
    current.options.onCaptureFailure(Error('disconnected'));
    current.options.onCaptureFailure(Error('duplicate stale failure'));
    assert.equal(timers.size, 1);
    const [id, timer] = [...timers.entries()][0];
    assert.equal(timer.delay, delay);
    timers.delete(id);
    timer.fn();
    await flush();
    assert.equal(listeners.at(-1).options.track, track);
  }
  assert.equal(listeners.length, 4);
  listeners.at(-1).options.onCaptureFailure(Error('fourth failure'));
  assert.equal(timers.size, 0);
  assert.equal(states.at(-1), 'fourth failure');
  assert.ok(states.includes('연결 오류'));
  cleanup();
  assert.equal(listeners.length, 4);
  assert.ok(listeners.every((listener) => listener.stops > 0));
});
