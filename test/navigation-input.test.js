import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import navigation from '../desktop/navigation.cjs';
import { createNavigationHistory } from '../shared/navigation-history.js';

test('internal navigation history supports back, forward, and forward-stack replacement', () => {
  const history = createNavigationHistory('studio');
  history.push('audience');
  history.push('community');
  assert.equal(history.move('back').current, 'audience');
  assert.equal(history.move('back').current, 'studio');
  assert.equal(history.move('back').current, 'studio');
  assert.equal(history.move('forward').current, 'audience');

  history.push('clips');
  const replaced = history.snapshot();
  assert.deepEqual(replaced.entries, ['studio', 'audience', 'clips']);
  assert.equal(replaced.canForward, false);
  assert.equal(history.move('forward').current, 'clips');

  history.push('clips');
  assert.deepEqual(history.snapshot().entries, ['studio', 'audience', 'clips']);
});

test('navigation history keeps a bounded recent stack', () => {
  const history = createNavigationHistory('studio', 3);
  history.push('audience');
  history.push('community');
  history.push('clips');
  assert.deepEqual(history.snapshot().entries, ['audience', 'community', 'clips']);
  assert.equal(history.move('back').current, 'community');
  assert.equal(history.move('back').current, 'audience');
});

test('preload exposes only validated navigation history directions', () => {
  let exposed;
  const listeners = new Map();
  const ipcRenderer = {
    invoke: () => Promise.resolve(),
    send: () => {},
    on: (channel, listener) => listeners.set(channel, listener),
    removeListener: (channel, listener) => {
      if (listeners.get(channel) === listener) listeners.delete(channel);
    },
  };
  vm.runInNewContext(readFileSync(new URL('../desktop/preload.cjs', import.meta.url), 'utf8'), {
    require: () => ({
      contextBridge: { exposeInMainWorld: (_name, value) => (exposed = value) },
      ipcRenderer,
    }),
    location: { pathname: '/' },
    window: {},
  });

  const seen = [];
  const dispose = exposed.onNavigationHistory((direction) => seen.push(direction));
  const listener = listeners.get('navigation:history');
  listener({}, 'back');
  listener({}, 'forward');
  listener({}, 'unexpected');
  assert.deepEqual(seen, ['back', 'forward']);
  dispose();
  assert.equal(listeners.has('navigation:history'), false);
});

test('native commands deliver exactly one direction only to their owning window', () => {
  const main = new EventEmitter(),
    overlay = new EventEmitter(),
    sent = [];
  let destroyed = false;
  main.isDestroyed = () => destroyed;
  main.webContents = { isDestroyed: () => false, send: (...args) => sent.push(args) };
  const dispose = navigation.attachNavigationHistory(main);
  main.emit('app-command', {}, 'browser-backward');
  main.emit('app-command', {}, 'browser-forward');
  main.emit('app-command', {}, 'browser-refresh');
  overlay.emit('app-command', {}, 'browser-backward');
  assert.deepEqual(sent, [
    ['navigation:history', 'back'],
    ['navigation:history', 'forward'],
  ]);
  destroyed = true;
  main.emit('app-command', {}, 'browser-backward');
  assert.equal(sent.length, 2);
  dispose();
  assert.equal(main.listenerCount('app-command'), 0);
});

test('desktop attaches navigation to main only', () => {
  const source = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.equal(source.match(/attachNavigationHistory\(/g)?.length, 1);
  assert.match(source, /attachNavigationHistory\(main\)/);
});

test('reselecting current tab after back preserves forward history', () => {
  const history = createNavigationHistory('studio');
  history.push('audience');
  history.push('community');
  history.move('back');
  history.push('audience');
  assert.equal(history.move('forward').current, 'community');
  const snapshot = history.snapshot();
  snapshot.entries.length = 0;
  assert.equal(history.snapshot().current, 'community');
});
