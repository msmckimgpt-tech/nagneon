import type { ClipSegment } from './clip-buffer';

export type ClipWindow = {
  startedAt: number;
  endedAt: number;
  eventStartedAt: number;
  eventEndedAt: number;
  basis: string;
};
type Timer = ReturnType<typeof setTimeout>;
type Clock = {
  now: () => number;
  set: (fn: () => void, ms: number) => Timer;
  clear: (timer: Timer | undefined) => void;
};
type Options = {
  sessionId: string;
  hasAudio: boolean;
  kind?: 'video' | 'audio';
  create: () => MediaRecorder;
  onFailure: () => void;
  clock?: Clock;
};
type Slot = {
  rec: MediaRecorder;
  startedAt: number;
  stoppedAt: number | null;
  deadline: number;
  selected: boolean;
  parts: Blob[];
  bytes: number;
  timer?: Timer;
  watchdog?: Timer;
};
const DEFAULT_MS = 30_000,
  STEP_MS = 15_000,
  MAX_MS = 45_000,
  RETENTION_MS = 120_000,
  MAX_BYTES = 24 * 1024 * 1024,
  MAX_SEGMENT_BYTES = 20 * 1024 * 1024;
// Leave scheduling headroom so an ordinary late timer does not invalidate a
// maximum-length clip. Actual capture time still must fit the 45-second limit.
const MAX_RECORD_MS = MAX_MS - 500;
const defaultClock: Clock = {
  now: Date.now,
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (timer) => clearTimeout(timer),
};

// Overlap independently playable recorders. Never join separate WebM headers.
// At most two encoders per source; requests select an end, bounded by 45 seconds.
export class ContextClipBuffer {
  private clock: Clock;
  private slots = new Set<Slot>();
  private segments: ClipSegment[] = [];
  private pending = new Set<{
    slot: Slot;
    at: number;
    resolve: (clip: ClipSegment | null) => void;
    timer: Timer;
  }>();
  private rotation?: Timer;
  private closed = false;
  private started = false;
  private lastStartedAt = -Infinity;
  private options: Options;
  constructor(options: Options) {
    this.options = options;
    this.clock = options.clock || defaultClock;
  }
  start() {
    if (this.closed || this.started) return;
    this.started = true;
    this.record();
    this.schedule();
  }
  private schedule() {
    if (this.closed) return;
    this.rotation = this.clock.set(() => {
      if (this.slots.size < 2) this.record();
      this.schedule();
    }, STEP_MS);
  }
  private prune(extra = 0) {
    this.segments = this.segments.filter((s) => this.clock.now() - s.endedAt <= RETENTION_MS);
    let bytes =
      extra +
      [...this.slots].reduce((sum, s) => sum + s.bytes, 0) +
      this.segments.reduce((sum, s) => sum + s.blob.size, 0);
    while (this.segments.length && (this.segments.length > 10 || bytes > MAX_BYTES))
      bytes -= this.segments.shift()!.blob.size;
    return bytes <= MAX_BYTES;
  }
  private arm(slot: Slot) {
    this.clock.clear(slot.timer);
    slot.timer = this.clock.set(
      () => {
        if (this.closed || !this.slots.has(slot) || slot.stoppedAt !== null) return;
        slot.stoppedAt = this.clock.now();
        slot.watchdog = this.clock.set(() => this.fail(), 4000);
        try {
          if (slot.rec.state === 'recording') slot.rec.stop();
          else this.fail();
        } catch {
          this.fail();
        }
      },
      Math.max(0, slot.deadline - this.clock.now()),
    );
  }
  private record() {
    if (this.closed || this.slots.size >= 2) return;
    try {
      const rec = this.options.create(),
        startedAt = this.clock.now();
      const slot: Slot = {
        rec,
        startedAt,
        stoppedAt: null,
        deadline: startedAt + DEFAULT_MS,
        selected: false,
        parts: [],
        bytes: 0,
      };
      this.slots.add(slot);
      this.lastStartedAt = startedAt;
      rec.ondataavailable = (e) => {
        if (this.closed || !this.slots.has(slot) || !e.data.size) return;
        if (slot.bytes + e.data.size > MAX_SEGMENT_BYTES || !this.prune(e.data.size)) {
          this.fail();
          return;
        }
        slot.bytes += e.data.size;
        slot.parts.push(e.data);
      };
      rec.onerror = () => {
        if (this.slots.has(slot)) this.fail();
      };
      rec.onstop = () => {
        if (this.closed || !this.slots.has(slot)) return;
        this.clock.clear(slot.timer);
        this.clock.clear(slot.watchdog);
        const endedAt = slot.stoppedAt ?? this.clock.now(),
          kind = this.options.kind || 'video';
        const clip =
          slot.parts.length && endedAt - startedAt >= 1000 && endedAt - startedAt <= MAX_MS
            ? {
                blob: new Blob(slot.parts, { type: kind + '/webm' }),
                startedAt,
                endedAt,
                kind,
                sessionId: this.options.sessionId,
                hasAudio: this.options.hasAudio,
              }
            : null;
        this.slots.delete(slot);
        slot.parts = [];
        slot.bytes = 0;
        if (clip) this.segments.push(clip);
        this.prune();
        for (const p of this.pending)
          if (p.slot === slot) {
            this.clock.clear(p.timer);
            this.pending.delete(p);
            p.resolve(clip && clip.startedAt <= p.at && clip.endedAt >= p.at ? clip : null);
          }
        // A stop callback may run just after the cadence timer saw two slots.
        // Fill that due overlap now, without ever launching a third encoder.
        if (
          !this.slots.size ||
          (this.slots.size < 2 && this.clock.now() - this.lastStartedAt >= STEP_MS)
        )
          this.record();
      };
      rec.start(1000);
      this.arm(slot);
    } catch {
      this.fail();
    }
  }
  takeAt(at: number, window?: ClipWindow): Promise<ClipSegment | null> {
    const now = this.clock.now();
    if (this.closed || !Number.isFinite(at) || at > now || this.pending.size >= 100)
      return Promise.resolve(null);
    this.prune();
    const valid =
      window &&
      Number.isFinite(window.startedAt) &&
      Number.isFinite(window.endedAt) &&
      window.startedAt <= at &&
      window.endedAt >= at &&
      window.endedAt - window.startedAt <= MAX_MS;
    const start = valid ? window.startedAt : at - 8000,
      end = valid ? window.endedAt : at + 6000;
    const candidates: Array<{
      clip?: ClipSegment;
      slot?: Slot;
      start: number;
      end: number;
      coverage: number;
    }> = [];
    const add = (startedAt: number, endedAt: number, item: { clip?: ClipSegment; slot?: Slot }) => {
      if (startedAt > at || endedAt < at) return;
      candidates.push({
        ...item,
        start: startedAt,
        end: endedAt,
        coverage: Math.max(0, Math.min(end, endedAt) - Math.max(start, startedAt)),
      });
    };
    for (const clip of this.segments) add(clip.startedAt, clip.endedAt, { clip });
    for (const slot of this.slots)
      add(slot.startedAt, slot.stoppedAt ?? Math.min(slot.startedAt + MAX_RECORD_MS, Math.max(now, end)), {
        slot,
      });
    candidates.sort(
      (a, b) =>
        b.coverage - a.coverage ||
        Math.abs(a.start - start) - Math.abs(b.start - start) ||
        a.end - b.end,
    );
    const chosen = candidates[0];
    if (!chosen) return Promise.resolve(null);
    if (chosen.clip) return Promise.resolve(chosen.clip);
    const slot = chosen.slot!;
    if (slot.stoppedAt === null) {
      // A later overlapping nomination may extend, but cannot truncate a waiter.
      const deadline = Math.min(slot.startedAt + MAX_RECORD_MS, Math.max(now, slot.startedAt + 1000, end));
      slot.deadline = slot.selected ? Math.max(slot.deadline, deadline) : deadline;
      slot.selected = true;
      this.arm(slot);
    }
    return new Promise((resolve) => {
      const p = {
        slot,
        at,
        resolve,
        timer: this.clock.set(() => {
          this.pending.delete(p);
          resolve(null);
        }, MAX_MS + 4000),
      };
      this.pending.add(p);
    });
  }
  private fail() {
    if (this.closed) return;
    this.dispose();
    this.options.onFailure();
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.clock.clear(this.rotation);
    for (const p of this.pending) {
      this.clock.clear(p.timer);
      p.resolve(null);
    }
    this.pending.clear();
    this.segments = [];
    for (const slot of this.slots) {
      this.clock.clear(slot.timer);
      this.clock.clear(slot.watchdog);
      slot.parts = [];
      slot.bytes = 0;
      slot.rec.ondataavailable = null;
      slot.rec.onerror = null;
      slot.rec.onstop = null;
      try {
        if (slot.rec.state === 'recording') slot.rec.stop();
      } catch {}
    }
    this.slots.clear();
  }
}
