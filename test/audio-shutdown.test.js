import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SubscriptionVoice } from '../server/subscription-voice.js';
import { SubscriptionSound } from '../server/subscription-sound.js';
import { NativeAudio } from '../server/native-audio.js';
import { SpeechRecoveryStore } from '../server/speech-recovery-store.js';
import { startServer } from '../server/index.js';

const turn = () => new Promise(setImmediate);
function barrier() {
  let release, enter;
  return {
    gate: new Promise((r) => {
      release = r;
    }),
    entered: new Promise((r) => {
      enter = r;
    }),
    release: () => release(),
    enter: () => enter(),
  };
}
async function directory(t) {
  const parent = resolve('artifacts', 'audio-shutdown-tests');
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, 'owned-'));
  t.after(() => rm(dir, { recursive: true }));
  return dir;
}
async function voice(t, Voice = SubscriptionVoice, { periodic = false } = {}) {
  const dir = await directory(t);
  let now = 1791190000000;
  const deliveries = [],
    hosts = [];
  const studio = {
    running: true,
    settings: { mode: 'live' },
    sessionId: randomUUID(),
    controller: new AbortController(),
    provider: { status: () => ({ kind: 'codex' }) },
    ai: { assertAllowed() {} },
    presentWitnesses: () => ['viewer'],
    audience: { data: { members: { viewer: { joinedAt: now - 1000 } } } },
    publish() {},
    receiveSpeech(value) {
      deliveries.push(value);
      return { duplicate: false };
    },
    sound: {
      start() {},
      stop() {},
      receiveSubscription(value) {
        deliveries.push(value);
      },
    },
  };
  const recovery = new SpeechRecoveryStore(join(dir, 'raw'), { now: () => now });
  const audio = new Voice({
    dir: join(dir, 'voice'),
    recovery,
    studio,
    now: () => now,
    config: () => ({ mode: 'remote', transport: 'subscription', consent: true, consentVersion: 2 }),
    hostFactory: () => {
      const host = {
        start: async () => ({ sdp: 'v=0\r\nm=audio' }),
        close: async () => {
          host.closed = true;
          return { exited: true };
        },
      };
      hosts.push(host);
      return host;
    },
  });
  // Gates own their operation scheduling. Real periodic work is enabled only
  // by the test that checks the production timer's cancellation.
  if (!periodic) clearInterval(audio.timer);
  let expectedClose;
  t.after(async () => {
    if (expectedClose) await assert.rejects(audio.close(), expectedClose);
    else await audio.close();
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
  return {
    audio,
    recovery,
    dir,
    studio,
    entry,
    inputEpoch,
    runId,
    deliveries,
    hosts,
    advance: (ms) => {
      now += ms;
    },
    expectClose: (predicate) => {
      expectedClose = predicate;
    },
  };
}
async function journals(dir) {
  const names = await readdir(join(dir, 'voice'));
  return (
    await Promise.all(
      names
        .filter((n) => /^voice-\d+\.jsonl$/.test(n))
        .map((n) => readFile(join(dir, 'voice', n), 'utf8')),
    )
  ).flatMap((text) => text.trim().split('\n').filter(Boolean).map(JSON.parse));
}

test('stopped journal failure is preserved while closing admission and periodic work', async (t) => {
  const p = await voice(t, SubscriptionVoice, { periodic: true }),
    failure = new Error('synthetic stopped journal failure');
  const record = p.audio.record.bind(p.audio);
  p.audio.record = (s, value) =>
    value.type === 'stopped' ? Promise.reject(failure) : record(s, value);
  p.expectClose((e) => e === failure);
  await assert.rejects(p.audio.close(), (e) => e === failure);
  assert.equal(p.hosts[0].closed, true);
  assert.equal(p.audio.closed, true);
  assert.equal(p.audio.timer._destroyed, true);
  await assert.rejects(
    p.audio.start({
      sessionId: p.studio.sessionId,
      inputEpoch: randomUUID(),
      startedAt: p.entry.capture.startedAt,
    }),
    /종료/,
  );
});

test('accepted raw context persistence finishes before close and remains in the durable journal', async (t) => {
  const p = await voice(t),
    gate = barrier();
  p.audio.capture(p.entry);
  const persist = p.audio.persistContext.bind(p.audio);
  p.audio.persistContext = async (value) => {
    gate.enter();
    await gate.gate;
    return persist(value);
  };
  const storing = p.audio.stored(p.entry, { durableThrough: 16000 });
  await gate.entered;
  await p.audio.stop();
  const closing = p.audio.close();
  let done = false;
  void closing.then(() => {
    done = true;
  });
  try {
    await turn();
    await turn();
    assert.equal(done, false);
  } finally {
    gate.release();
    await Promise.allSettled([storing, closing]);
  }
  await storing;
  await closing;
  assert.equal((await journals(p.dir)).find((r) => r.type === 'raw').durableThrough, 16000);
  assert.equal(p.deliveries.length, 0);
});

test('accepted late event recording drains during close without publishing to an audience', async (t) => {
  const p = await voice(t),
    gate = barrier();
  await p.audio.stop();
  const record = p.audio.record.bind(p.audio);
  p.audio.record = async (s, value) => {
    if (value.type === 'event') {
      gate.enter();
      await gate.gate;
    }
    return record(s, value);
  };
  const events = p.audio.events({
    inputEpoch: p.inputEpoch,
    runId: p.runId,
    sequence: 1,
    events: [
      {
        type: 'input_transcript.added',
        start_ms: 100,
        end_ms: 400,
        item: { id: 'synthetic-late', type: 'input_transcript', text: 'late input' },
      },
    ],
  });
  await gate.entered;
  const closing = p.audio.close();
  let done = false;
  void closing.then(() => {
    done = true;
  });
  try {
    await turn();
    await turn();
    assert.equal(done, false);
  } finally {
    gate.release();
    await Promise.allSettled([events, closing]);
  }
  await events;
  await closing;
  assert.equal((await journals(p.dir)).find((r) => r.type === 'event').late, true);
  assert.equal(p.deliveries.length, 0);
  await assert.rejects(p.audio.events({}), /종료/);
});

test('close waits for retention work that was already scanning raw records', async (t) => {
  const p = await voice(t),
    gate = barrier();
  await p.audio.stop();
  await Promise.allSettled([...p.audio.lifetime.pending]);
  assert.equal(!!p.audio.sweeping, false);
  p.audio.lastSweep = 0;
  const entries = p.recovery.entries.bind(p.recovery);
  p.recovery.entries = async (...args) => {
    gate.enter();
    await gate.gate;
    return entries(...args);
  };
  const scanning = p.audio.expire();
  await gate.entered;
  const closing = p.audio.close();
  let done = false;
  void closing.then(() => {
    done = true;
  });
  try {
    await turn();
    await turn();
    assert.equal(done, false);
  } finally {
    gate.release();
    await Promise.allSettled([scanning, closing]);
  }
  await scanning;
  await closing;
  assert.equal(p.audio.sweeping, false);
});

test('recovery preparation held on a record cannot install a deadline after close', async (t) => {
  const p = await voice(t),
    gate = barrier();
  p.audio.capture(p.entry);
  await p.audio.stored(p.entry, await p.recovery.append(p.entry));
  await p.audio.stop();
  const inputEpoch = randomUUID();
  await p.audio.start({
    inputEpoch,
    sessionId: p.studio.sessionId,
    startedAt: p.entry.capture.startedAt,
  });
  const { runId } = await p.audio.connect({
    inputEpoch,
    sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111',
  });
  await p.audio.clock({
    inputEpoch,
    runId,
    startedAt: p.entry.capture.startedAt,
    monotonicMs: 2000,
  });
  const record = p.audio.record.bind(p.audio);
  p.audio.record = async (s, value) => {
    if (value.type === 'recovery-lease') {
      gate.enter();
      await gate.gate;
    }
    return record(s, value);
  };
  const preparing = p.audio.prepareRecovery({ inputEpoch });
  await gate.entered;
  const run = [...p.audio.runs.values()].find((r) => r.kind === 'recovery');
  assert.ok(run);
  await p.audio.stop();
  const closing = p.audio.close();
  let done = false;
  void closing.then(() => {
    done = true;
  });
  try {
    await turn();
    await turn();
    assert.equal(done, false);
  } finally {
    gate.release();
    await Promise.allSettled([preparing, closing]);
  }
  assert.deepEqual(await preparing, { recovery: null });
  await closing;
  assert.equal(run.deadline, undefined);
  assert.equal(run.active, false);
});

test('unconfirmed host exit is retained even when a recovery journal fails first', async (t) => {
  const p = await voice(t),
    failure = new Error('synthetic recovery journal failure');
  const s = p.audio.session;
  const recovery = {
    id: randomUUID(),
    input: s,
    owner: s,
    kind: 'recovery',
    active: true,
    host: { close: async () => ({ exited: false }) },
  };
  p.audio.runs.set(recovery.id, recovery);
  const record = p.audio.record.bind(p.audio);
  p.audio.record = (input, value) =>
    value.type === 'unresolved' ? Promise.reject(failure) : record(input, value);
  let observed;
  try {
    await p.audio.close();
    assert.fail('close must report both failures');
  } catch (error) {
    observed = error;
  }
  p.expectClose((e) => e === observed);
  assert.ok(observed instanceof AggregateError);
  assert.ok(observed.errors.includes(failure));
  assert.equal(observed.errors.filter((e) => e.code === 'AUDIO_STOP_UNCONFIRMED').length, 1);
  assert.equal(p.audio.stopUnconfirmed, true);
  assert.equal(p.hosts[0].closed, true);
});

test('actual journal filesystem failure survives the internally handled write tail', async (t) => {
  const p = await voice(t),
    obstacle = join(p.dir, 'owned-file');
  await writeFile(obstacle, 'synthetic unchanged bytes');
  p.audio.dir = obstacle;
  let original;
  await assert.rejects(p.audio.record(p.audio.session, { type: 'synthetic-io-failure' }), (e) => {
    original = e;
    return ['EEXIST', 'ENOTDIR'].includes(e.code);
  });
  await p.audio.writes;
  p.expectClose((e) => e === original);
  await assert.rejects(p.audio.close(), (e) => e === original);
  assert.equal(await readFile(obstacle, 'utf8'), 'synthetic unchanged bytes');
  assert.equal(p.audio.closed, true);
});

test('a parent native close keeps the accepted subscription raw receipt alive through its child owner', async (t) => {
  const p = await voice(t),
    gate = barrier();
  const native = new NativeAudio({
    dir: join(p.dir, 'native'),
    studio: p.studio,
    config: { mode: 'remote', transport: 'subscription', consent: true },
  });
  await native.subscription.ready;
  await native.subscription.close();
  native.subscription = p.audio;
  t.after(() => native.close());
  const storing = native.acceptInput(p.entry, async () => {
    native.capture(p.entry);
    gate.enter();
    await gate.gate;
    await native.stored(p.entry, { durableThrough: 16000 });
  });
  await gate.entered;
  const closing = native.close();
  let done = false;
  void closing.then(() => {
    done = true;
  });
  try {
    await turn();
    await turn();
    assert.equal(done, false);
  } finally {
    gate.release();
    await Promise.allSettled([storing, closing]);
  }
  await storing;
  await closing;
  assert.equal((await journals(p.dir)).find((r) => r.type === 'raw').durableThrough, 16000);
  assert.equal(p.deliveries.length, 0);
});

test('system sound shutdown still closes its host if sound bookkeeping throws synchronously', async (t) => {
  const p = await voice(t, SubscriptionSound),
    failure = new Error('synthetic sound bookkeeping failure');
  p.studio.sound.stop = () => {
    throw failure;
  };
  p.expectClose((e) => e === failure);
  await assert.rejects(p.audio.close(), (e) => e === failure);
  assert.equal(p.hosts[0].closed, true);
  assert.equal(p.audio.session.active, false);
  assert.equal(p.audio.session.controller.signal.aborted, true);
  assert.equal(p.audio.timer._destroyed, true);
});

test('repeated close shares the complete pending write drain', async (t) => {
  const p = await voice(t),
    gate = barrier();
  await p.audio.stop();
  p.audio.writes = gate.gate;
  const first = p.audio.close();
  await turn();
  const second = p.audio.close();
  let secondDone = false;
  void second.then(() => {
    secondDone = true;
  });
  try {
    await turn();
    assert.equal(secondDone, false);
    assert.equal(first, second);
  } finally {
    gate.release();
    await Promise.allSettled([first, second]);
  }
});

test('close waits for an accepted delivery plan and its journal without late audience output', async (t) => {
  const p = await voice(t),
    gate = barrier();
  p.audio.capture(p.entry);
  await p.audio.stored(p.entry, { durableThrough: 16000 });
  await p.audio.events({
    inputEpoch: p.inputEpoch,
    runId: p.runId,
    sequence: 1,
    events: [
      {
        type: 'input_transcript.added',
        start_ms: 100,
        end_ms: 400,
        item: { id: 'synthetic-race', type: 'input_transcript', text: '합성 종료 경합' },
      },
    ],
  });
  const record = p.audio.record.bind(p.audio);
  p.audio.record = async (s, value) => {
    if (value.type === 'delivery-plan') {
      gate.enter();
      await gate.gate;
    }
    return record(s, value);
  };
  p.advance(2500);
  const pumping = p.audio.pump();
  await gate.entered;
  await p.audio.stop();
  const closing = p.audio.close();
  let done = false;
  void closing.then(() => {
    done = true;
  });
  try {
    await turn();
    await turn();
    assert.equal(done, false);
  } finally {
    gate.release();
    await Promise.allSettled([pumping, closing]);
  }
  await closing;
  assert.equal(p.deliveries.length, 0);
  assert.equal((await journals(p.dir)).filter((r) => r.type === 'delivery-plan').length, 1);
});

test('native shutdown attempts independent cleanup and waits for local processing after stop rejection', async (t) => {
  const dir = await directory(t),
    gate = barrier();
  const failure = new Error('synthetic stop failure'),
    childFailure = new Error('synthetic child failure');
  const audio = new NativeAudio({ dir, studio: { publish() {} }, key: 'synthetic-only' });
  t.after(() => {
    clearInterval(audio.timer);
    clearInterval(audio.subscription.timer);
  });
  await audio.subscription.ready;
  const controller = new AbortController();
  let providerClosed = false,
    childClosed = false;
  audio.context = {
    controller,
    provider: {
      close() {
        providerClosed = true;
      },
    },
  };
  audio.stop = () => Promise.reject(failure);
  audio.subscription.close = () => {
    childClosed = true;
    return Promise.reject(childFailure);
  };
  audio.pendingCleanup = gate.gate;
  const closing = audio.close();
  let done = false;
  void closing.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  try {
    await turn();
    assert.equal(controller.signal.aborted, true);
    assert.equal(providerClosed, true);
    assert.equal(childClosed, true);
    assert.equal(audio.key, '');
    assert.equal(done, false);
  } finally {
    gate.release();
  }
  await assert.rejects(
    closing,
    (e) =>
      e instanceof AggregateError && e.errors.includes(failure) && e.errors.includes(childFailure),
  );
  assert.equal(audio.inputs.size, 0);
  assert.equal(audio.session, null);
  assert.equal(audio.timer._destroyed, true);
  clearInterval(audio.subscription.timer);
});

test('server shutdown owns already accepted raw append through storage completion', async (t) => {
  const dir = await directory(t),
    gate = barrier();
  const inputEpoch = randomUUID(),
    sessionId = randomUUID();
  const append = SpeechRecoveryStore.prototype.append;
  SpeechRecoveryStore.prototype.append = async function (entry) {
    if (entry.inputEpoch === inputEpoch) {
      gate.enter();
      await gate.gate;
    }
    return append.call(this, entry);
  };
  t.after(() => {
    SpeechRecoveryStore.prototype.append = append;
  });
  const service = await startServer({
    port: 0,
    dataDir: dir,
    persist: true,
    localSpeech: false,
    provider: { status: () => ({ configured: true }) },
  });
  clearInterval(service.studio.timer);
  t.after(() => service.close());
  const entry = {
    inputEpoch,
    sessionId,
    sequence: 1,
    startFrame: 0,
    frameCount: 1600,
    data: Buffer.alloc(3200, 3),
  };
  const writing = service.appendSpeechRaw(entry);
  await gate.entered;
  const closing = service.close();
  let done = false;
  void closing.then(() => {
    done = true;
  });
  try {
    await turn();
    await turn();
    assert.equal(done, false);
  } finally {
    gate.release();
    await Promise.allSettled([writing, closing]);
  }
  const stored = await writing;
  assert.equal(stored.durableThrough, 1600);
  await closing;
  await assert.rejects(service.appendSpeechRaw({ ...entry, inputEpoch: randomUUID() }), /종료/);
});

for (const Voice of [SubscriptionVoice, SubscriptionSound]) {
  test(`accepted ${Voice.name} raw storage AbortError is not mistaken for provider cancellation`, async (t) => {
    const p = await voice(t, Voice),
      gate = barrier(),
      failure = new DOMException('synthetic raw storage failure', 'AbortError');
    p.expectClose((e) => e === failure);
    const writing = p.audio.acceptInput(p.entry, async () => {
      gate.enter();
      await gate.gate;
      throw failure;
    });
    await gate.entered;
    const closing = p.audio.close();
    const results = [
      assert.rejects(writing, (e) => e === failure),
      assert.rejects(closing, (e) => e === failure),
    ];
    const outcomes = Promise.allSettled(results);
    gate.release();
    await outcomes;
    await Promise.all(results);
    assert.equal(p.hosts[0].closed, true);
  });
}

for (const withStopFailures of [true, false]) {
  test(
    withStopFailures
      ? 'raw storage failure attempts both stops and preserves the three original errors through close'
      : 'raw storage AbortError remains a storage failure through close',
    async (t) => {
      const dir = await directory(t),
        gate = barrier(),
        inputEpoch = randomUUID();
      const raw = withStopFailures
          ? new Error('synthetic raw storage failure')
          : new DOMException('synthetic raw storage failure', 'AbortError'),
        native = new Error('synthetic native stop failure'),
        sound = new Error('synthetic system stop failure');
      const append = SpeechRecoveryStore.prototype.append;
      SpeechRecoveryStore.prototype.append = async function (entry) {
        if (entry.inputEpoch !== inputEpoch) return append.call(this, entry);
        gate.enter();
        await gate.gate;
        throw raw;
      };
      t.after(() => {
        SpeechRecoveryStore.prototype.append = append;
      });
      const service = await startServer({
        port: 0,
        dataDir: dir,
        persist: true,
        localSpeech: false,
        provider: { status: () => ({ configured: true }) },
      });
      clearInterval(service.studio.timer);
      // Capture has its own validation regressions. Isolate a storage failure
      // here without triggering the earlier capture-invalid stop.
      service.nativeAudio.capture = () => {};
      const stopped = [];
      for (const [name, owner, failure] of [
        ['native', service.nativeAudio, native],
        ['sound', service.subscriptionSound, sound],
      ]) {
        const stop = owner.stop.bind(owner);
        owner.stop = (reason) => {
          if (reason !== 'storage-error') return stop(reason);
          stopped.push(name);
          if (withStopFailures) throw failure;
          return Promise.resolve();
        };
      }
      let closed;
      t.after(() => closed || service.close());
      const writing = service.appendSpeechRaw({
        inputEpoch,
        sessionId: randomUUID(),
        sequence: 1,
        startFrame: 0,
        frameCount: 1600,
        data: Buffer.alloc(3200, 4),
      });
      const expected = withStopFailures ? [raw, native, sound] : [raw];
      const flatten = (e) => (e instanceof AggregateError ? e.errors.flatMap(flatten) : [e]);
      const containsOriginals = (e) => {
        const errors = flatten(e);
        return expected.every((original) => errors.includes(original));
      };
      await gate.entered;
      const closing = service.close();
      // Attach rejection handlers before releasing the operation.
      const rawResult = assert.rejects(writing, containsOriginals);
      const closeResult = assert.rejects(closing, containsOriginals);
      const outcomes = Promise.allSettled([rawResult, closeResult]);
      closed = closing.catch(() => {});
      let done = false;
      void closed.then(() => {
        done = true;
      });
      try {
        await turn();
        assert.equal(done, false);
      } finally {
        gate.release();
        await Promise.allSettled([writing, closing]);
        await outcomes;
      }
      await rawResult;
      await closeResult;
      assert.deepEqual(stopped, ['native', 'sound']);
      assert.equal(service.nativeAudio.closed, true);
      assert.equal(service.subscriptionSound.closed, true);
    },
  );
}

test('capture validation and stop failures do not prevent accepted raw storage', async (t) => {
  const dir = await directory(t),
    gate = barrier(),
    inputEpoch = randomUUID(),
    sessionId = randomUUID(),
    bytes = Buffer.alloc(3200, 5),
    captureFailure = new Error('synthetic capture validation failure'),
    nativeFailure = new Error('synthetic capture native stop failure'),
    soundFailure = new Error('synthetic capture system stop failure');
  const append = SpeechRecoveryStore.prototype.append;
  SpeechRecoveryStore.prototype.append = async function (entry) {
    if (entry.inputEpoch === inputEpoch) {
      gate.enter();
      await gate.gate;
    }
    return append.call(this, entry);
  };
  t.after(() => {
    SpeechRecoveryStore.prototype.append = append;
  });
  const service = await startServer({
    port: 0,
    dataDir: dir,
    persist: true,
    localSpeech: false,
    provider: { status: () => ({ configured: true }) },
  });
  clearInterval(service.studio.timer);
  service.nativeAudio.capture = () => {
    throw captureFailure;
  };
  const stopped = [];
  for (const [name, owner, failure] of [
    ['native', service.nativeAudio, nativeFailure],
    ['sound', service.subscriptionSound, soundFailure],
  ]) {
    const stop = owner.stop.bind(owner);
    owner.stop = (reason) => {
      if (reason !== 'capture-invalid') return stop(reason);
      stopped.push(name);
      throw failure;
    };
  }
  let closed;
  t.after(() => closed || service.close());
  const writing = service.appendSpeechRaw({
    sessionId,
    inputEpoch,
    sequence: 1,
    startFrame: 0,
    frameCount: 1600,
    data: bytes,
  });
  // Fail directly if capture cleanup prevents append, rather than waiting on a
  // gate that cannot be reached by the broken implementation.
  await Promise.race([gate.entered, writing.then(() => assert.fail('raw gate was not entered'))]);
  const closing = service.close();
  const flatten = (e) => (e instanceof AggregateError ? e.errors.flatMap(flatten) : [e]);
  const originals = (e) => {
    const errors = flatten(e);
    return (
      errors.includes(nativeFailure) &&
      errors.includes(soundFailure) &&
      !errors.includes(captureFailure)
    );
  };
  const results = [assert.rejects(writing, originals), assert.rejects(closing, originals)];
  const outcomes = Promise.allSettled(results);
  closed = closing.catch(() => {});
  gate.release();
  await outcomes;
  await Promise.all(results);
  assert.deepEqual(stopped, ['native', 'sound']);
  const saved = await service.nativeAudio.recovery.readRange(sessionId, inputEpoch, 0, 1600);
  assert.equal(saved.length, bytes.length + 44);
  assert.equal(saved.toString('ascii', 0, 4), 'RIFF');
  assert.equal(saved.toString('ascii', 8, 12), 'WAVE');
  assert.deepEqual(saved.subarray(44), bytes);
});

test('server state observers reenter the same shutdown without starting cleanup twice', async (t) => {
  const service = await startServer({
    port: 0,
    dataDir: await directory(t),
    persist: true,
    localSpeech: false,
    provider: { status: () => ({ configured: true }) },
  });
  clearInterval(service.studio.timer);
  let reentrant,
    nativeCloses = 0;
  const close = service.nativeAudio.close.bind(service.nativeAudio);
  service.nativeAudio.close = () => {
    nativeCloses++;
    return close();
  };
  service.studio.once('state', () => {
    reentrant = service.close();
  });
  const first = service.close();
  const outcomes = await Promise.allSettled([first, reentrant]);
  assert.ok(reentrant);
  assert.equal(reentrant, first);
  assert.equal(nativeCloses, 1);
  assert.ok(outcomes.every((result) => result.status === 'fulfilled'));
});

test('profile release failure retains the original cleanup error and preserves a changed owner', async (t) => {
  const dir = await directory(t);
  const service = await startServer({
    port: 0,
    dataDir: dir,
    persist: true,
    localSpeech: false,
    provider: { status: () => ({ configured: true }) },
  });
  clearInterval(service.studio.timer);
  const original = new Error('synthetic native cleanup failure'),
    ownerFile = join(dir, '.nagneon-writer', 'owner.json'),
    changedOwner = JSON.stringify({ pid: process.pid, nonce: randomUUID(), at: 'synthetic' }),
    nativeClose = service.nativeAudio.close.bind(service.nativeAudio);
  let nativeCloses = 0;
  service.nativeAudio.close = async () => {
    nativeCloses++;
    await nativeClose();
    throw original;
  };
  await writeFile(ownerFile, changedOwner);
  const first = service.close(),
    second = service.close();
  const result = await Promise.allSettled([first, second]);
  assert.equal(first, second);
  assert.equal(result[0].status, 'rejected');
  const error = result[0].reason;
  const flatten = (e) => (e instanceof AggregateError ? e.errors.flatMap(flatten) : [e]);
  const errors = flatten(error);
  assert.ok(errors.includes(original), 'profile release must not mask native cleanup failure');
  assert.equal(errors.filter((e) => e.message === '프로필 잠금 소유권이 바뀌었습니다.').length, 1);
  assert.equal(nativeCloses, 1);
  assert.equal(await readFile(ownerFile, 'utf8'), changedOwner);
});
