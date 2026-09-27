import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { SubscriptionVoice } from '../server/subscription-voice.js';
import { SpeechRecoveryStore } from '../server/speech-recovery-store.js';
import { SpeechCapture } from '../server/speech-screen.js';
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const fragment = (id, text, start_ms, end_ms) => ({
  type: 'input_transcript.added',
  start_ms,
  end_ms,
  item: { id, type: 'input_transcript', text },
});
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'nagneon-subscription-test-'));
  let now = 1790490000000;
  const calls = [],
    hosts = [];
  const studio = {
    running: true,
    sessionId: randomUUID(),
    settings: { mode: 'live' },
    controller: new AbortController(),
    provider: { status: () => ({ kind: 'codex' }) },
    ai: { assertAllowed() {} },
    audience: { data: { members: { viewer: { joinedAt: now - 1000 } } } },
    presentWitnesses: () => ['viewer'],
    publish() {},
    receiveSpeech(value) {
      if (!this.running || value.sessionId !== this.sessionId) throw Error('stale');
      SpeechCapture.parse(value.capture);
      calls.push(value);
      return { duplicate: false };
    },
  };
  const options = {
    dir,
    studio,
    recovery: new SpeechRecoveryStore(join(dir, 'raw'), { now: () => now }),
    bin: 'synthetic',
    config: () => ({ mode: 'remote', transport: 'subscription', consent: true }),
    now: () => now,
    hostFactory: () => {
      const host = {
        start: async () => ({ sdp: 'v=0\r\nm=audio', account: { type: 'chatgpt' } }),
        close: async () => {
          host.closed = true;
          return { exited: true };
        },
      };
      hosts.push(host);
      return host;
    },
  };
  const audio = new SubscriptionVoice(options);
  t.after(async () => {
    await audio.close();
    await rm(dir, { recursive: true, force: true });
  });
  const inputEpoch = randomUUID();
  await audio.start({ sessionId: studio.sessionId, inputEpoch, startedAt: now });
  const { runId } = await audio.connect({
    inputEpoch,
    sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111',
  });
  await audio.clock({ inputEpoch, runId, startedAt: now, monotonicMs: 1000 });
  const entry = {
    sessionId: studio.sessionId,
    inputEpoch,
    sequence: 1,
    startFrame: 0,
    frameCount: 16000,
    data: Buffer.alloc(32000),
    capture: { startedAt: now, endedAt: now + 1000 },
  };
  const waitIdle = async () => {
    for (let i = 0; i < 100 && audio.processing; i++) await tick();
    assert.equal(audio.processing, false);
  };
  return {
    audio,
    options,
    studio,
    dir,
    inputEpoch,
    runId,
    entry,
    calls,
    hosts,
    waitIdle,
    advance(ms) {
      now += ms;
    },
    now: () => now,
  };
}

test('only durable source ranges are published with capture time and provider identity kept distinct', async (t) => {
  const p = await setup(t);
  p.audio.capture(p.entry);
  await p.audio.events({
    inputEpoch: p.inputEpoch,
    runId: p.runId,
    sequence: 1,
    events: [fragment('synthetic_1', 'test phrase', 100, 400)],
  });
  p.advance(1500);
  await p.audio.pump();
  await p.waitIdle();
  assert.equal(p.calls.length, 0);
  await p.audio.stored(p.entry, { durableThrough: 16000 });
  await p.waitIdle();
  assert.equal(p.calls.length, 1);
  assert.equal(p.calls[0].text, 'test phrase');
  assert.equal(p.calls[0].capture.startedAt, p.entry.capture.startedAt);
  assert.equal(p.calls[0].capture.voice.sourceFrameStart, 1600);
  assert.equal(p.calls[0].capture.voice.receivedAt, p.entry.capture.startedAt);
  assert.equal(p.calls[0].capture.voice.timing, 'approximate-provider-interval');
  assert.equal(p.audio.applied, 1);
});
test('an HTTP retry cannot publish the same source event twice', async (t) => {
  const p = await setup(t);
  p.audio.capture(p.entry);
  await p.audio.stored(p.entry, { durableThrough: 16000 });
  const request = {
    inputEpoch: p.inputEpoch,
    runId: p.runId,
    sequence: 1,
    events: [fragment('synthetic_1', 'repeat me', 100, 400)],
  };
  await p.audio.events(request);
  p.advance(1500);
  await p.audio.pump();
  await p.waitIdle();
  assert.equal((await p.audio.events(request)).duplicate, true);
  await p.audio.pump();
  await p.waitIdle();
  assert.equal(p.calls.length, 1);
  await assert.rejects(
    p.audio.events({ ...request, events: [fragment('synthetic_1', 'different', 100, 400)] }),
    /달라/,
  );
});
test('stop cancels host and records late input without audience publication', async (t) => {
  const p = await setup(t);
  p.audio.capture(p.entry);
  await p.audio.stored(p.entry, await p.options.recovery.append(p.entry));
  await p.audio.stop();
  await p.audio.events({
    inputEpoch: p.inputEpoch,
    runId: p.runId,
    sequence: 1,
    events: [fragment('late', 'late phrase', 100, 400)],
  });
  p.advance(1500);
  await p.audio.pump();
  assert.equal(p.calls.length, 0);
  assert.equal(p.hosts[0].closed, true);
  assert.equal(p.audio.snapshot().unresolved[0].frameEnd, 16000);
});

test('a raw chunk saved after stopping becomes recoverable after an empty retention scan', async (t) => {
  const p = await setup(t);
  p.audio.capture(p.entry);
  await p.audio.stop();
  await p.audio.refreshRetainedAudio();
  assert.equal(p.audio.snapshot().pending, 0);
  await p.audio.stored(p.entry, await p.options.recovery.append(p.entry));
  assert.equal(p.audio.snapshot().unresolved[0].frameEnd, 16000);
  assert.equal(p.audio.snapshot().active, false);
  assert.equal(p.calls.length, 0);
});
test('stopping while the delivery plan is saved prevents a late audience side effect', async (t) => {
  const p = await setup(t);
  p.audio.capture(p.entry);
  await p.audio.stored(p.entry, { durableThrough: 16000 });
  await p.audio.events({
    inputEpoch: p.inputEpoch,
    runId: p.runId,
    sequence: 1,
    events: [fragment('race', 'cancel me', 100, 400)],
  });
  let release, entered;
  const gate = new Promise((resolve) => {
      release = resolve;
    }),
    started = new Promise((resolve) => {
      entered = resolve;
    });
  const original = p.audio.record.bind(p.audio);
  p.audio.record = async (s, value) => {
    if (value.type === 'delivery-plan') {
      entered();
      await gate;
    }
    return original(s, value);
  };
  p.advance(1500);
  const pumping = p.audio.pump();
  await started;
  await p.audio.stop();
  release();
  await pumping;
  assert.equal(p.calls.length, 0);
});
test('journal restoration preserves source clock and unresolved ranges without activating a device or connection', async (t) => {
  const p = await setup(t);
  p.audio.capture(p.entry);
  await p.audio.stored(p.entry, await p.options.recovery.append(p.entry));
  await p.audio.stop();
  await p.audio.close();
  const restored = new SubscriptionVoice(p.options);
  await restored.ready;
  assert.equal(restored.error, '');
  assert.equal(restored.inputs.get(p.inputEpoch).startedAt, p.entry.capture.startedAt);
  assert.equal(restored.snapshot().active, false);
  assert.equal(restored.snapshot().unresolved[0].frameEnd, 16000);
  assert.equal(p.hosts.length, 1);
  await restored.close();
});

test('deleted raw audio is not advertised as recoverable after a restart',async t=>{
  const p=await setup(t);
  p.audio.capture(p.entry);await p.audio.stored(p.entry,await p.options.recovery.append(p.entry));
  await p.audio.stop();await p.audio.close();
  await p.options.recovery.remove(p.entry.sessionId,p.inputEpoch);
  const restored=new SubscriptionVoice(p.options);await restored.ready;
  assert.equal(restored.error,'');assert.equal(restored.snapshot().pending,0);
  assert.equal(restored.snapshot().active,false);assert.equal(p.hosts.length,1);
  await restored.close();
});
test('damaged journal fails closed and preserves the original file', async (t) => {
  const p = await setup(t);
  await p.audio.close();
  const files = (await readdir(p.dir)).filter((file) => /^voice-\d+\.jsonl$/.test(file));
  const file = join(p.dir, files[0]);
  const damaged = (await readFile(file, 'utf8')) + '{incomplete\n';
  await writeFile(file, damaged);
  const restored = new SubscriptionVoice(p.options);
  await restored.ready;
  assert.equal(restored.ledgerFailed, true);
  assert.equal(await readFile(file, 'utf8'), damaged);
  await assert.rejects(
    restored.start({ sessionId: p.studio.sessionId, inputEpoch: randomUUID(), startedAt: p.now() }),
    /복구 기록/,
  );
  await restored.close();
});

async function saveSource(p) {
  p.audio.capture(p.entry);
  const result = await p.options.recovery.append(p.entry);
  await p.audio.stored(p.entry, result);
  await p.audio.stop();
}
async function restart(p) {
  p.advance(2000);
  const inputEpoch = randomUUID();
  await p.audio.start({ sessionId: p.studio.sessionId, inputEpoch, startedAt: p.now() });
  const { runId } = await p.audio.connect({
    inputEpoch,
    sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111',
  });
  await p.audio.clock({ inputEpoch, runId, startedAt: p.now(), monotonicMs: 3000 });
  return { inputEpoch, runId };
}
test('bounded recovery uses the original PCM hash, clock and witnesses while current microphone continues', async (t) => {
  const p = await setup(t);
  await saveSource(p);
  const current = await restart(p);
  const { recovery } = await p.audio.prepareRecovery({ inputEpoch: current.inputEpoch });
  assert.equal(recovery.inputEpoch, p.inputEpoch);
  assert.equal(recovery.startedAt, p.entry.capture.startedAt);
  assert.equal((await p.audio.prepareRecovery({ inputEpoch: current.inputEpoch })).recovery, null);
  const value = { inputEpoch: current.inputEpoch, runId: recovery.runId },
    source = await p.audio.recoveryAudio(value);
  assert.equal(Buffer.from(source.audio, 'base64').length, 32044);
  assert.match(source.sha256, /^[a-f0-9]{64}$/);
  await p.audio.connectRecovery({ ...value, sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111' });
  await p.audio.events({
    inputEpoch: p.inputEpoch,
    runId: recovery.runId,
    sequence: 1,
    events: [fragment('recovered', 'recovered phrase', 1100, 1400)],
  });
  await p.waitIdle();
  p.advance(1500);
  await p.audio.pump();
  await p.waitIdle();
  assert.equal(
    p.calls.length,
    1,
    JSON.stringify({
      error: p.audio.error,
      pending: p.audio.runs.get(recovery.runId)?.transcript.pending,
      active: p.audio.isRunActive(p.audio.runs.get(recovery.runId)),
      connected: p.audio.runs.get(recovery.runId)?.connectedAt,
      plan: p.audio.runs.get(recovery.runId)?.pendingPlan,
    }),
  );
  assert.equal(p.calls[0].capture.startedAt, p.entry.capture.startedAt);
  assert.equal(p.calls[0].capture.voice.sourceFrameStart, 1600);
  assert.equal(p.calls[0].capture.voice.recovered, true);
  assert.deepEqual(p.calls[0].capturedHearers, ['viewer']);
  await p.audio.finishRecovery(value);
  assert.equal(p.audio.session.active, true);
  assert.equal(p.hosts[1].closed, undefined);
  assert.equal(p.hosts[2].closed, true);
  const ranges = p.audio.inputs.get(p.inputEpoch).unresolved;
  assert.equal(
    ranges.some((r) => r.frameStart < 6400 && r.frameEnd > 1600),
    false,
  );
  assert.equal(
    ranges.every((r) => r.attempts === 1),
    true,
  );
});
test('empty recovery does not become proven silence or retry without a bound', async (t) => {
  const p = await setup(t);
  await saveSource(p);
  const current = await restart(p);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { recovery } = await p.audio.prepareRecovery({ inputEpoch: current.inputEpoch });
    assert.ok(recovery);
    await p.audio.finishRecovery({ inputEpoch: current.inputEpoch, runId: recovery.runId });
    assert.equal(p.audio.inputs.get(p.inputEpoch).unresolved[0].attempts, attempt);
  }
  assert.equal((await p.audio.prepareRecovery({ inputEpoch: current.inputEpoch })).recovery, null);
  assert.equal(p.calls.length, 0);
  assert.equal(p.audio.inputs.get(p.inputEpoch).unresolved[0].status, 'replayed-unconfirmed');
  const next = await restart(p);
  assert.equal((await p.audio.prepareRecovery({ inputEpoch: next.inputEpoch })).recovery, null);
});
test('changed original audio fails verification before opening a recovery host', async (t) => {
  const p = await setup(t);
  await saveSource(p);
  const current = await restart(p);
  const { recovery } = await p.audio.prepareRecovery({ inputEpoch: current.inputEpoch });
  const entries = await p.options.recovery.entries(p.studio.sessionId, p.inputEpoch);
  await writeFile(entries[0].path, Buffer.alloc(32000, 1));
  await assert.rejects(
    p.audio.recoveryAudio({ inputEpoch: current.inputEpoch, runId: recovery.runId }),
    /원본 해시/,
  );
  assert.equal(p.hosts.length, 2);
});
test('stop and broadcast changes prevent recovery events from becoming current audience speech', async (t) => {
  const p = await setup(t);
  await saveSource(p);
  const current = await restart(p);
  const { recovery } = await p.audio.prepareRecovery({ inputEpoch: current.inputEpoch });
  await p.audio.recoveryAudio({ inputEpoch: current.inputEpoch, runId: recovery.runId });
  await p.audio.connectRecovery({
    inputEpoch: current.inputEpoch,
    runId: recovery.runId,
    sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111',
  });
  await p.audio.stop();
  await p.audio.events({
    inputEpoch: p.inputEpoch,
    runId: recovery.runId,
    sequence: 1,
    events: [fragment('stopped-recovery', 'stopped phrase', 1100, 1400)],
  });
  p.advance(1500);
  await p.audio.pump();
  assert.equal(p.calls.length, 0);
  assert.equal(
    p.hosts.every((h) => h.closed),
    true,
  );
  p.studio.sessionId = randomUUID();
  const next = await restart(p);
  assert.equal((await p.audio.prepareRecovery({ inputEpoch: next.inputEpoch })).recovery, null);
});
test('crash-uncertain delivery plans are retained for review instead of automatically duplicated', async (t) => {
  const p = await setup(t);
  await saveSource(p);
  await p.audio.record(p.audio.inputs.get(p.inputEpoch), {
    type: 'delivery-plan',
    plan: { id: randomUUID(), frameStart: 0, frameEnd: 16000 },
  });
  await p.audio.close();
  const restored = new SubscriptionVoice(p.options);
  await restored.ready;
  assert.equal(restored.error, '');
  const ranges = restored.inputs.get(p.inputEpoch).unresolved;
  assert.equal(ranges[0].status, 'delivery-uncertain');
  assert.equal(ranges[0].attempts, 2);
  await restored.close();
});
test('connected-without-capture and changed broadcasts close the owned host', async (t) => {
  const p = await setup(t);
  p.audio.session.clock = false;
  p.advance(16000);
  await p.audio.pump();
  assert.equal(p.audio.session.active, false);
  assert.equal(p.hosts[0].closed, true);
  const current = await restart(p);
  p.studio.sessionId = randomUUID();
  await p.audio.pump();
  assert.equal(p.audio.session.active, false);
  assert.equal(p.hosts[1].closed, true);
  assert.ok(current.runId);
});
