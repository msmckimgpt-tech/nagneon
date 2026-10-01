import test from 'node:test';
import assert from 'node:assert/strict';
import { startScreenPreview } from '../scripts/lib/sampled-screen-preview.ts';

function fixture({ visible = true, drawCost = 0, context = true } = {}) {
  let at = 1000,
    id = 0,
    draws = 0,
    sourceStops = 0;
  const scheduled = new Map(),
    statuses = [];
  const video = {
    currentTime: 1,
    videoWidth: 1920,
    videoHeight: 1080,
    readyState: 2,
    paused: false,
    ended: false,
    pause: () => sourceStops++,
    srcObject: { getTracks: () => [{ stop: () => sourceStops++ }] },
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () =>
      context
        ? {
            drawImage: () => {
              draws++;
              at += drawCost;
            },
          }
        : null,
  };
  const control = startScreenPreview(video, canvas, (s) => statuses.push(s), {
    visible,
    now: () => at,
    schedule: (fn, ms) => {
      scheduled.set(++id, { fn, ms });
      return id;
    },
    cancel: (n) => scheduled.delete(n),
  });
  return {
    control,
    video,
    canvas,
    statuses,
    scheduled,
    draws: () => draws,
    sourceStops: () => sourceStops,
    advance: (ms = 125) => {
      at += ms;
      video.currentTime += ms / 1000;
    },
    wait: (ms) => {
      at += ms;
    },
    tick: () => {
      const [key, { fn }] = scheduled.entries().next().value;
      scheduled.delete(key);
      fn();
    },
  };
}
test('display caps pixels and cadence while retaining the original source', () => {
  const f = fixture();
  assert.deepEqual([f.canvas.width, f.canvas.height], [960, 540]);
  assert.equal(f.scheduled.size, 1);
  assert.equal([...f.scheduled.values()][0].ms, 125);
  f.tick();
  assert.equal(f.draws(), 1, 'unchanged decoded frame is not redrawn');
  f.advance();
  f.tick();
  assert.equal(f.draws(), 2);
  assert.equal(
    f.statuses.filter((s) => s === 'live').length,
    1,
    'frames do not trigger state changes',
  );
  f.control.stop();
  assert.equal(f.sourceStops(), 0);
  assert.equal(f.scheduled.size, 0);
  assert.equal(f.canvas.width, 0);
});
test('hidden preview has no timer or paints and returns to the newest decoded frame', () => {
  const f = fixture({ visible: false });
  assert.equal(f.scheduled.size, 0);
  assert.equal(f.draws(), 0);
  for (let i = 0; i < 20; i++) f.control.setVisible(false);
  f.advance(4000);
  f.control.setVisible(true);
  assert.equal(f.draws(), 1);
  assert.equal(f.scheduled.size, 1);
  assert.equal(f.statuses.at(-1), 'live');
  f.control.setVisible(false);
  assert.equal(f.scheduled.size, 0);
  assert.equal(f.statuses.at(-1), 'paused');
  f.advance(10000);
  assert.equal(f.draws(), 1);
  f.control.stop();
  assert.equal(f.sourceStops(), 0);
});
test('hide and resize do not relabel an old frozen frame as live', () => {
  const f = fixture();
  f.wait(2600);
  f.tick();
  assert.equal(f.statuses.at(-1), 'stale');
  f.control.setWidth(420);
  f.tick();
  assert.equal(f.canvas.width, 420);
  assert.equal(f.statuses.at(-1), 'stale');
  f.control.setVisible(false);
  f.wait(5000);
  f.control.setVisible(true);
  assert.equal(f.statuses.at(-1), 'stale');
  f.advance();
  f.tick();
  assert.equal(f.statuses.at(-1), 'live');
  f.control.stop();
});
test('slow display painting lowers only display rate without accumulating work', () => {
  const f = fixture({ drawCost: 120 });
  assert.ok([...f.scheduled.values()][0].ms > 125);
  assert.equal(f.scheduled.size, 1);
  for (let i = 0; i < 10; i++) {
    f.advance();
    f.tick();
    assert.equal(f.scheduled.size, 1);
  }
  assert.equal(f.sourceStops(), 0);
  assert.ok([...f.scheduled.values()][0].ms <= 500);
  f.control.stop();
});
test('replacement cleanup makes even a late timer harmless', () => {
  const old = fixture(),
    late = [...old.scheduled.values()][0].fn;
  old.control.stop();
  old.control.stop();
  const next = fixture();
  late();
  old.control.setVisible(true);
  old.control.setWidth(20);
  assert.equal(old.draws(), 1);
  assert.equal(old.scheduled.size, 0);
  assert.equal(next.draws(), 1);
  assert.equal(next.scheduled.size, 1);
  next.control.stop();
});
test('decoder wait and display failure leave capture and recording ownership intact', () => {
  const f = fixture({ visible: false });
  f.video.readyState = 0;
  f.control.setVisible(true);
  assert.equal(f.statuses.at(-1), 'waiting');
  f.video.readyState = 2;
  f.advance();
  f.tick();
  f.video.paused = true;
  f.tick();
  assert.equal(f.statuses.at(-1), 'stale');
  f.control.stop();
  assert.equal(f.sourceStops(), 0);
  const fail = fixture({ context: false });
  assert.equal(fail.statuses.at(-1), 'error');
  assert.equal(fail.scheduled.size, 0);
  assert.equal(fail.sourceStops(), 0);
  fail.control.stop();
});
