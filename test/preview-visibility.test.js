import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const { attachPreviewVisibility } = createRequire(import.meta.url)(
  '../desktop/preview-visibility.cjs',
);
test('native hide/minimize gate only display, validate sender and clean listeners on close', () => {
  const main = new EventEmitter(),
    contents = new EventEmitter(),
    sent = [],
    handlers = new Map();
  let showing = true,
    minimized = false,
    destroyed = false;
  Object.defineProperty(main, 'webContents', {
    get: () => {
      if (destroyed) throw Error('Window object is destroyed');
      return contents;
    },
  });
  main.isDestroyed = () => destroyed;
  main.isVisible = () => showing;
  main.isMinimized = () => minimized;
  contents.mainFrame = {};
  contents.isDestroyed = () => false;
  contents.send = (...args) => sent.push(args);
  const ipcMain = {
    handle: (name, fn) => handlers.set(name, fn),
    removeHandler: (name) => handlers.delete(name),
  };
  attachPreviewVisibility({ main, ipcMain });
  const query = handlers.get('preview:visibility'),
    event = { sender: contents, senderFrame: contents.mainFrame };
  assert.equal(query(event), true);
  assert.throws(() => query({ sender: {}, senderFrame: contents.mainFrame }));
  assert.throws(() => query({ sender: contents, senderFrame: {} }));
  minimized = true;
  main.emit('minimize');
  assert.deepEqual(sent.at(-1), ['preview:visible', false]);
  assert.equal(query(event), false);
  minimized = false;
  main.emit('restore');
  assert.deepEqual(sent.at(-1), ['preview:visible', true]);
  showing = false;
  main.emit('hide');
  contents.emit('did-finish-load');
  assert.deepEqual(sent.at(-1), ['preview:visible', false]);
  showing = true;
  main.emit('show');
  assert.deepEqual(sent.at(-1), ['preview:visible', true]);
  destroyed = true;
  assert.doesNotThrow(() => main.emit('closed'));
  assert.equal(handlers.size, 0);
  for (const name of ['minimize', 'restore', 'hide', 'show'])
    assert.equal(main.listenerCount(name), 0);
  assert.equal(contents.listenerCount('did-finish-load'), 0);
});
