import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { attachSubscriptionVoiceGuard } from '../desktop/subscription-voice-guard.cjs';
function setup() {
  const contents = new EventEmitter(),
    window = new EventEmitter();
  let destroyed = 0,
    stops = 0;
  Object.assign(window, {
    webContents: contents,
    isDestroyed: () => destroyed > 0,
    destroy() {
      destroyed++;
      window.emit('closed');
    },
  });
  const voice = {
    session: { active: true },
    stop() {
      stops++;
      return Promise.resolve();
    },
  };
  const dispose = attachSubscriptionVoiceGuard({ window, voice, intervalMs: 5 });
  return {
    contents,
    voice,
    dispose,
    get destroyed() {
      return destroyed;
    },
    get stops() {
      return stops;
    },
  };
}
test('renderer failure releases only the owning window and stops its voice once', () => {
  const p = setup();
  p.contents.emit('unresponsive');
  p.contents.emit('render-process-gone');
  assert.equal(p.destroyed, 1);
  assert.equal(p.stops, 1);
  p.dispose();
});
test('normal idle state does not release windows or start a device', () => {
  const p = setup();
  p.voice.session.active = false;
  p.contents.emit('unresponsive');
  assert.equal(p.destroyed, 0);
  assert.equal(p.stops, 0);
  p.dispose();
});
test('server heartbeat timeout still releases renderer tracks after host stop', async () => {
  const p = setup();
  p.voice.session = { active: false, stopReason: 'heartbeat-timeout' };
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(p.destroyed, 1);
  p.dispose();
});
