import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SubscriptionSound } from '../server/subscription-sound.js';
import { SoundScene } from '../server/sound-scene.js';
import { SpeechRecoveryStore } from '../server/speech-recovery-store.js';
import { observePcmAmplitude } from '../shared/audio-observation.js';

test('PCM amplitude measures the signal without inventing a sound class or emotion', () => {
  const pcm = Buffer.alloc(3200);
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(i % 4 ? 16384 : -16384, i);
  const value = observePcmAmplitude(pcm);
  assert.equal(value.rmsDb, -6);
  assert.equal(value.peakDb, -6);
  assert.equal(value.clippedFraction, 0);
  assert.equal(observePcmAmplitude(Buffer.alloc(3200)).rmsDb, -120);
  assert.deepEqual(Object.keys(value).sort(), [
    'clippedFraction',
    'measurement',
    'peakDb',
    'rmsDb',
  ]);
});

test('subscription system dialogue remains a separate source with witnesses, corrections and stop isolation', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'nagneon-system-subscription-'));
  let now = Date.now();
  const hosts = [],
    sessionId = randomUUID(),
    inputEpoch = randomUUID();
  const studio = {
    running: true,
    sessionId,
    settings: { mode: 'live' },
    now: () => now,
    controller: new AbortController(),
    provider: { status: () => ({ kind: 'codex' }) },
    ai: { assertAllowed() {} },
    audience: {
      data: { members: { early: { joinedAt: now - 1000 }, late: { joinedAt: now + 10000 } } },
    },
    presentWitnesses: () => ['early', 'late'],
    publish() {},
    receiveSpeech() {
      throw new Error('System dialogue must never become streamer speech');
    },
  };
  studio.sound = new SoundScene(studio);
  let config = { mode: 'remote', transport: 'subscription', consent: true };
  const recovery = new SpeechRecoveryStore(join(dir, 'raw'), { now: () => now });
  const voice = new SubscriptionSound({
    studio,
    dir,
    recovery,
    bin: 'synthetic',
    config: () => config,
    now: () => now,
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
  t.after(async () => {
    await voice.close();
    await rm(dir, { recursive: true });
  });
  await assert.rejects(voice.start({ sessionId, inputEpoch, startedAt: now }), /전송 범위/);
  assert.equal(hosts.length, 0);
  config = { ...config, consentVersion: 2 };
  await voice.start({ sessionId, inputEpoch, startedAt: now });
  const { runId } = await voice.connect({
    inputEpoch,
    sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111',
  });
  await voice.clock({ inputEpoch, runId, startedAt: now, monotonicMs: 100 });
  const original = {
    sessionId,
    inputEpoch,
    sequence: 1,
    startFrame: 0,
    frameCount: 16000,
    data: Buffer.alloc(32000, 8),
    source: 'system-output',
  };
  voice.capture(original);
  await voice.stored(original, await recovery.append(original));
  await voice.events({
    inputEpoch,
    runId,
    sequence: 1,
    events: [
      {
        type: 'input_transcript.added',
        start_ms: 100,
        end_ms: 400,
        item: { id: 'game_line', type: 'input_transcript', text: '문을 열지 마.' },
      },
    ],
  });
  now += 1500;
  await voice.pump();
  for (let i = 0; i < 100 && voice.processing; i++) await new Promise((r) => setTimeout(r, 5));
  const heard = studio.sound.context('early');
  assert.equal(heard.length, 1);
  assert.equal(heard[0].systemSpeech, '문을 열지 마.');
  assert.equal(heard[0].transcription.inputSource, 'system-output');
  assert.equal(heard[0].transcription.amplitude.measurement, 'pcm-amplitude');
  assert.deepEqual(heard[0].classes, []);
  assert.equal(studio.sound.context('late').length, 0);
  assert.equal((await recovery.list())[0].source, 'system-output');
  const oldId = heard[0].id;
  studio.sound.receiveSubscription({
    id: randomUUID(),
    sessionId,
    inputEpoch,
    text: '문을 열어도 돼.',
    capture: {
      startedAt: now - 1500,
      endedAt: now - 1000,
      voice: { ...heard[0].transcription, revises: [oldId], kind: 'correction' },
    },
    witnesses: ['early'],
  });
  assert.equal(studio.sound.context('early').length, 1);
  assert.equal(studio.sound.context('early')[0].systemSpeech, '문을 열어도 돼.');
  await voice.stop();
  assert.equal(hosts[0].closed, true);
  assert.equal(studio.sound.active, null);
  assert.throws(
    () =>
      voice.receivePlan(
        { id: randomUUID(), text: 'late', capture: {}, hearers: [] },
        { sessionId, inputEpoch },
      ),
    /만료/,
  );
});
