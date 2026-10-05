import test from 'node:test';
import assert from 'node:assert/strict';
import { ContextClipBuffer } from '../src/context-clip-buffer.ts';

const T = 1_000_000;
function harness({ delay = 0, bytes = 120, failStart = 0, kind = 'video', sessionId = 'a' } = {}) {
  let time = T,
    id = 0,
    failures = 0,
    maxActive = 0;
  const timers = new Map(),
    recorders = [];
  const clock = {
    now: () => time,
    set: (fn, ms) => {
      timers.set(++id, { at: time + ms, fn });
      return id;
    },
    clear: (id) => timers.delete(id),
  };
  function tick(ms) {
    const end = time + ms;
    for (;;) {
      const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      time = next[1].at;
      timers.delete(next[0]);
      next[1].fn();
    }
    time = end;
  }
  const create = () => {
    if (failStart === recorders.length + 1) throw Error('synthetic encoder failure');
    const rec = {
      state: 'inactive',
      stops: 0,
      start() {
        this.state = 'recording';
        maxActive = Math.max(maxActive, recorders.filter((r) => r.state === 'recording').length);
      },
      stop() {
        this.stops++;
        this.state = 'inactive';
        clock.set(() => {
          this.ondataavailable?.({
            data: new Blob([new Uint8Array(bytes).fill(recorders.indexOf(this) + 1)]),
          });
          this.onstop?.();
        }, delay);
      },
    };
    recorders.push(rec);
    return rec;
  };
  const buffer = new ContextClipBuffer({
    sessionId,
    kind,
    hasAudio: true,
    create,
    clock,
    onFailure: () => failures++,
  });
  buffer.start();
  return { buffer, tick, recorders, timers, failures: () => failures, maxActive: () => maxActive };
}
const window = (start, end) => ({
  startedAt: T + start,
  endedAt: T + end,
  eventStartedAt: T + start + 8000,
  eventEndedAt: T + end - 6000,
  basis: 'capture',
});

test('a pick at the old 15-second boundary includes setup, core and aftermath in one recorder', async (t) => {
  const h = harness();
  t.after(() => h.buffer.dispose());
  h.tick(15_100);
  const p = h.buffer.takeAt(T + 15_000, window(6000, 23000));
  h.tick(7900);
  const clip = await p;
  assert.deepEqual([clip.startedAt, clip.endedAt], [T, T + 23000]);
  assert.equal(new Uint8Array(await clip.blob.arrayBuffer())[0], 1);
  assert.equal(clip.blob.size, 120, 'one WebM recording, never concatenated headers');
});
test('event length selects the end instead of an arbitrary rotation', async (t) => {
  const h = harness();
  t.after(() => h.buffer.dispose());
  h.tick(20_000);
  const p = h.buffer.takeAt(T + 16000, window(7000, 34000));
  h.tick(14000);
  assert.equal((await p).endedAt, T + 34000);
  assert.ok(h.maxActive() <= 2);
});
test('nearby updated picks extend the same recorder and all waiters share its final bytes', async (t) => {
  const h = harness();
  t.after(() => h.buffer.dispose());
  h.tick(15000);
  const first = h.buffer.takeAt(T + 14000, window(4000, 22000));
  h.tick(5000);
  const second = h.buffer.takeAt(T + 14000, window(4000, 31000));
  h.tick(11000);
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b);
  assert.equal(a.endedAt, T + 31000);
  assert.equal(h.recorders[0].stops, 1);
  assert.ok(h.maxActive() <= 2);
});
test('late nomination selects the original completed recording, never current unrelated pixels', async (t) => {
  const h = harness();
  t.after(() => h.buffer.dispose());
  h.tick(105000);
  const clip = await h.buffer.takeAt(T + 16000, window(8000, 25000));
  assert.deepEqual([clip.startedAt, clip.endedAt], [T, T + 30000]);
  assert.equal(new Uint8Array(await clip.blob.arrayBuffer())[0], 1);
});
test('ambiguous or invalid event bounds safely use moment context', async (t) => {
  for (const bounds of [
    undefined,
    window(0, 100000),
    window(17000, 21000),
    { startedAt: NaN, endedAt: Infinity },
  ]) {
    const h = harness();
    t.after(() => h.buffer.dispose());
    h.tick(16000);
    const p = h.buffer.takeAt(T + 16000, bounds);
    h.tick(6000);
    const clip = await p;
    assert.equal(clip.endedAt, T + 22000);
    assert.ok(clip.startedAt <= T + 16000);
  }
});
test('startup and a delayed stop gap never claim unavailable pre-context or footage', async (t) => {
  const h = harness({ delay: 1000 });
  t.after(() => h.buffer.dispose());
  h.tick(1000);
  const p = h.buffer.takeAt(T + 1000);
  h.tick(6500);
  assert.equal(await h.buffer.takeAt(T + 7500), null);
  h.tick(500);
  const clip = await p;
  assert.deepEqual([clip.startedAt, clip.endedAt], [T, T + 7000]);
});
test('long extension stays within 45 seconds and two encoders', async (t) => {
  const h = harness();
  t.after(() => h.buffer.dispose());
  h.tick(22000);
  const p = h.buffer.takeAt(T + 22000, window(14000, 57000));
  h.tick(35000);
  const clip = await p;
  assert.ok(clip.endedAt - clip.startedAt <= 45000);
  assert.ok(h.maxActive() <= 2);
});
test('expiration, future times and a restarted session cannot borrow stale footage', async () => {
  const h = harness();
  h.tick(151000);
  assert.equal(await h.buffer.takeAt(T + 5000), null);
  for (const at of [NaN, Infinity, T - 1, T + 160000])
    assert.equal(await h.buffer.takeAt(at), null);
  const p = h.buffer.takeAt(T + 151000);
  h.buffer.dispose();
  assert.equal(await p, null);
  const restart = harness({ sessionId: 'b' });
  restart.tick(1000);
  const next = restart.buffer.takeAt(T + 1000);
  restart.tick(6000);
  assert.equal((await next).sessionId, 'b');
  restart.buffer.dispose();
});
test('completed and active bytes share a bounded budget; huge active data fails closed', async () => {
  const h = harness({ bytes: 9 * 1024 * 1024 });
  h.tick(60000);
  assert.equal(await h.buffer.takeAt(T + 1000), null);
  h.buffer.dispose();
  const huge = harness({ bytes: 20 * 1024 * 1024 + 1 });
  huge.tick(1000);
  const p = huge.buffer.takeAt(T + 1000);
  huge.tick(6000);
  assert.equal(await p, null);
  assert.equal(huge.failures(), 1);
  assert.equal(huge.timers.size, 0);
});
test('dispose resolves all waiters, clears timers, and ignores queued callbacks', async () => {
  const h = harness({ delay: 1000 });
  h.tick(16000);
  const p = h.buffer.takeAt(T + 16000);
  const count = h.recorders.length;
  h.buffer.dispose();
  h.buffer.dispose();
  h.tick(1000);
  assert.equal(await p, null);
  assert.equal(h.timers.size, 0);
  assert.equal(h.recorders.length, count);
});
test('start failure, overlapping encoder failure and hung stop terminate the buffer once', async () => {
  for (const failStart of [1, 2]) {
    const h = harness({ failStart });
    h.tick(15000);
    assert.equal(h.failures(), 1);
    assert.equal(h.timers.size, 0);
  }
  const h = harness({ delay: 50000 });
  h.tick(1000);
  const p = h.buffer.takeAt(T + 1000);
  h.tick(10000);
  assert.equal(await p, null);
  assert.equal(h.failures(), 1);
  h.tick(50000);
  assert.equal(h.recorders.length, 1);
});
test('audio-only context retains its MIME and session, and encoder errors release both recorders', async () => {
  const h = harness({ kind: 'audio' });
  h.tick(16000);
  const p = h.buffer.takeAt(T + 16000);
  h.tick(6000);
  const clip = await p;
  assert.equal(clip.kind, 'audio');
  assert.equal(clip.blob.type, 'audio/webm');
  h.recorders.at(-1).onerror();
  h.tick(0);
  assert.equal(h.failures(), 1);
  assert.equal(h.timers.size, 0);
});

test('maximum selection leaves timer headroom and minimum selection remains a complete second', async t => {
  const h = harness(); t.after(() => h.buffer.dispose()); h.tick(16000);
  const max = h.buffer.takeAt(T+16000, window(0,45000)); h.tick(28500);
  const clip = await max;
  assert.deepEqual([clip.startedAt,clip.endedAt],[T,T+44500]);
  const small = harness(); t.after(() => small.buffer.dispose()); small.tick(100);
  const min = small.buffer.takeAt(T+100,window(0,1000)); small.tick(900);
  assert.equal((await min).endedAt-T,1000);
});

test('two individually legal active recordings cannot exceed the shared 24 MiB budget', async () => {
  const h=harness(); h.tick(15000); const waiting=h.buffer.takeAt(T+15000);
  const chunk=bytes=>({data:new Blob([new Uint8Array(bytes)])});
  h.recorders[0].ondataavailable(chunk(9*1024*1024));
  h.recorders[1].ondataavailable(chunk(9*1024*1024));
  h.recorders[1].ondataavailable(chunk(7*1024*1024)); h.tick(0);
  assert.equal(await waiting,null); assert.equal(h.failures(),1); assert.equal(h.timers.size,0);
});
