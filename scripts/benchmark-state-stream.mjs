import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { StateStream } from '../server/state-stream.js';
import { Studio } from '../server/studio.js';
import { defaults } from '../shared/defaults.js';

// Synthetic snapshots only. No account, screen capture, persistence or model call.
const message = (i) => ({
  id: String(i),
  personaId: 'fixture',
  text: '합성 채팅 기록 '.repeat(30),
  time: i,
});
function measure(Encoder, kind) {
  const state = {
    messages: Array.from({ length: 500 }, (_, i) => message(i)),
    calls: 0,
    audience: {
      members: Array.from({ length: 40 }, (_, i) => ({
        id: String(i),
        memories: ['함께 본 합성 장면 '.repeat(30)],
      })),
    },
    economy: {
      ledger: Array.from({ length: 300 }, (_, i) => ({
        id: String(i),
        amount: 1,
        text: '합성 포인트',
      })),
    },
  };
  const encoders = [new Encoder(), new Encoder()];
  for (const encoder of encoders) encoder.encode(state);
  let bytes = 0;
  const started = performance.now();
  for (let i = 0; i < 300; i++) {
    if (kind === 'counter') state.calls++;
    if (kind === 'rollover') state.messages = [...state.messages.slice(1), message(i + 500)];
    for (const encoder of encoders) bytes += Buffer.byteLength(encoder.encode(state));
  }
  return { ms: performance.now() - started, bytes, updates: 300, windows: 2 };
}
const baseline = process.argv[2]
  ? (await import(pathToFileURL(resolve(process.argv[2])))).StateStream
  : null;
const results = { synthetic: true, node: process.version, scenarios: {} };
for (const kind of ['unchanged', 'counter', 'rollover']) {
  measure(StateStream, kind);
  results.scenarios[kind] = {
    current: measure(StateStream, kind),
    ...(baseline ? { baseline: measure(baseline, kind) } : {}),
  };
}
let at = 100000,
  published = 0;
const studio = new Studio({
  settings: { ...defaults, mode: 'rehearsal' },
  now: () => at,
  provider: { status: () => ({ configured: false }) },
  random: () => 0.5,
});
clearInterval(studio.timer);
try {
  studio.start();
  studio.on('state', () => published++);
  for (let i = 0; i < 40; i++) {
    at += 250;
    studio.pump();
  }
  results.idlePump = {
    pumps: 40,
    simulatedMs: 10000,
    published,
    scope: 'direct Studio, rehearsal, empty queue; server health timer excluded',
  };
} finally {
  studio.close();
}
console.log(JSON.stringify(results, null, 2));
