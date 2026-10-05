import test from 'node:test';
import assert from 'node:assert/strict';
import { startVideoPreview } from '../src/video-preview.ts';
const flush = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  let at = 1000,
    id = 0,
    pauses = 0,
    trackStops = 0;
  const scheduled = new Map(),
    pending = [],
    statuses = [];
  const stream = { getTracks: () => [{ stop: () => trackStops++ }] };
  const video = {
    currentTime: 1,
    readyState: 2,
    videoWidth: 1920,
    paused: false,
    ended: false,
    srcObject: null,
    pause: () => {
      pauses++;
    },
    play: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
  };
  const control = startVideoPreview(video, stream, (s) => statuses.push(s), {
    now: () => at,
    schedule: (fn) => {
      scheduled.set(++id, fn);
      return id;
    },
    cancel: (n) => scheduled.delete(n),
  });
  return {
    control,
    video,
    stream,
    scheduled,
    pending,
    statuses,
    pauses: () => pauses,
    trackStops: () => trackStops,
    advance: (ms = 1000) => {
      at += ms;
      video.currentTime += ms / 1000;
    },
    wait: (ms) => (at += ms),
    tick: () => {
      const [key, fn] = scheduled.entries().next().value;
      scheduled.delete(key);
      fn();
    },
  };
}
test('display is initially idle; visible playback and repeated refresh have one timer', async () => {
  const f = fixture();
  assert.equal(f.video.srcObject, null);
  assert.equal(f.pending.length, 0);
  assert.equal(f.scheduled.size, 0);
  f.control.setVisible(true);
  assert.equal(f.video.srcObject, f.stream);
  f.pending[0].resolve();
  await flush();
  assert.equal(f.statuses.at(-1), 'live');
  for (let i = 0; i < 20; i++) f.control.setVisible(true);
  assert.equal(f.pending.length, 1);
  assert.equal(f.scheduled.size, 1);
  f.advance();
  f.tick();
  assert.equal(f.statuses.filter((s) => s === 'live').length, 1);
  f.control.stop();
  assert.equal(f.trackStops(), 0);
});
test('hidden or unmounted display pauses and detaches without stopping shared tracks', async () => {
  const f = fixture();
  f.control.setVisible(true);
  f.pending[0].resolve();
  await flush();
  const late = [...f.scheduled.values()][0];
  f.control.setVisible(false);
  assert.equal(f.scheduled.size, 0);
  assert.equal(f.video.srcObject, null);
  assert.equal(f.statuses.at(-1), 'paused');
  assert.equal(f.pauses(), 1);
  assert.equal(f.trackStops(), 0);
  late();
  assert.equal(f.scheduled.size, 0);
  f.advance(5000);
  f.control.setVisible(true);
  f.pending[1].resolve();
  await flush();
  assert.equal(f.video.srcObject, f.stream);
  assert.equal(f.statuses.at(-1), 'live');
  f.control.stop();
  f.control.stop();
  assert.equal(f.scheduled.size, 0);
  assert.equal(f.video.srcObject, null);
  assert.equal(f.trackStops(), 0);
});
test('old playback completions cannot revive hidden, replaced, or closed previews', async () => {
  for (const reject of [false, true]) {
    const f = fixture();
    f.control.setVisible(true);
    f.control.setVisible(false);
    f.control.setVisible(true);
    if (reject) f.pending[0].reject(Error('old play'));
    else f.pending[0].resolve();
    await flush();
    assert.equal(f.scheduled.size, 0);
    assert.equal(f.statuses.at(-1), 'waiting');
    f.pending[1].resolve();
    await flush();
    assert.equal(f.scheduled.size, 1);
    f.control.stop();
    assert.equal(f.trackStops(), 0);
  }
  const f = fixture();
  f.control.setVisible(true);
  f.control.stop();
  f.pending[0].resolve();
  await flush();
  assert.equal(f.scheduled.size, 0);
  assert.equal(f.video.srcObject, null);
});
test('frozen display is marked stale; fresh playback recovers without root updates', async () => {
  const f = fixture();
  f.control.setVisible(true);
  f.pending[0].resolve();
  await flush();
  f.wait(3000);
  f.tick();
  assert.equal(f.statuses.at(-1), 'stale');
  f.advance();
  f.tick();
  assert.equal(f.statuses.at(-1), 'live');
  f.video.paused = true;
  f.tick();
  assert.equal(f.statuses.at(-1), 'stale');
  f.control.stop();
});
test('display playback failure is reported without ending the capture stream', async () => {
  const f = fixture();
  f.control.setVisible(true);
  f.pending[0].reject(Error('display unavailable'));
  await flush();
  assert.equal(f.statuses.at(-1), 'error');
  assert.equal(f.video.srcObject, null);
  assert.equal(f.scheduled.size, 0);
  assert.equal(f.trackStops(), 0);
  f.control.setVisible(true);
  f.pending[1].resolve();
  await flush();
  assert.equal(f.statuses.at(-1), 'live');
  f.control.stop();
});
