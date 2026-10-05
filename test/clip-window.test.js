import test from 'node:test';
import assert from 'node:assert/strict';
import { Clips, ClipFeatures } from '../server/clips.js';
import { clipWindow, mergeClipWindows } from '../server/clip-window.js';
import { ClipsData } from '../server/data-schema.js';
import { defaults } from '../shared/defaults.js';

const T = 1_000_000;
function fixture() {
  let time = T,
    failSave = false,
    publishes = 0;
  const p = defaults.personas.find((p) => !p.system),
    clips = new Clips({
      now: () => time,
      save: () => {
        if (failSave) throw Error('synthetic disk failure');
      },
    });
  const studio = {
    settings: { ...defaults, mode: 'live', autoHighlights: true, personas: [p] },
    running: true,
    sessionId: 's',
    startedAt: T - 60000,
    now: () => time,
    messages: [],
    log() {},
    publish() {
      publishes++;
    },
  };
  const feature = new ClipFeatures(studio, clips);
  const pick = (at, extra = {}) => {
    time = at;
    return feature.spectatorPicks(
      {
        game: 'Test',
        scene: 'Synthetic visible event',
        confidence: 0.8,
        clipPicks: [
          {
            personaId: p.id,
            title: 'Synthetic pick',
            reason: 'Synthetic witnessed event',
            signature: 'event-' + at,
            ...extra,
          },
        ],
      },
      { image: undefined, speech: 'Synthetic keyboard note', witnesses: [p.id], capturedAt: at },
    );
  };
  return {
    clips,
    studio,
    p,
    pick,
    failSave() {
      failSave = true;
    },
    publishes: () => publishes,
  };
}

test('trusted speech/sound capture retains the whole core with setup and aftermath', () => {
  assert.deepEqual(clipWindow(T, { startedAt: T - 3000, endedAt: T + 2000 }, T - 60000), {
    startedAt: T - 11000,
    endedAt: T + 8000,
    eventStartedAt: T - 3000,
    eventEndedAt: T + 2000,
    basis: 'capture',
  });
});
test('unknown, invalid or excessively long events fall back to the picked moment', () => {
  for (const capture of [
    null,
    { startedAt: NaN, endedAt: Infinity },
    { startedAt: T + 1, endedAt: T + 2 },
    { startedAt: T - 60000, endedAt: T },
  ]) {
    const w = clipWindow(T, capture, T - 60000);
    assert.equal(w.basis, 'moment');
    assert.deepEqual([w.startedAt, w.endedAt], [T - 8000, T + 6000]);
  }
  assert.equal(clipWindow(T, null, T - 1000).startedAt, T - 1000);
});
test('overlap merging is bounded and separated events remain separate', () => {
  const a = clipWindow(T),
    b = clipWindow(T + 10000);
  assert.deepEqual(
    [mergeClipWindows(a, b).startedAt, mergeClipWindows(a, b).endedAt],
    [T - 8000, T + 16000],
  );
  assert.equal(mergeClipWindows(a, clipWindow(T + 20000)), null);
  assert.equal(
    mergeClipWindows(
      { startedAt: 0, endedAt: 30000, eventStartedAt: 1, eventEndedAt: 20000, basis: 'capture' },
      {
        startedAt: 20000,
        endedAt: 60000,
        eventStartedAt: 20001,
        eventEndedAt: 59000,
        basis: 'capture',
      },
    ),
    null,
  );
});
test('nearby nominations update one unsaved clip before cooldown; repeated state makes no new write', () => {
  const h = fixture(),
    [first] = h.pick(T),
    [second] = h.pick(T + 5000);
  assert.equal(first.id, second.id);
  assert.equal(h.clips.data.length, 1);
  assert.equal(second.observedAt, T);
  assert.equal(second.recordingWindow.endedAt, T + 11000);
  assert.equal(h.publishes(), 2);
  assert.deepEqual(h.pick(T + 5000), []);
  assert.equal(h.publishes(), 2);
  assert.equal(ClipsData.parse(h.clips.data)[0].recordingWindow.endedAt, T + 11000);
});
test('same event signature can extend context while exact duplicate nominations are ignored', () => {
  const h = fixture(),
    [first] = h.pick(T, { signature: 'same-event' }),
    [next] = h.pick(T + 5000, { signature: 'same-event' });
  assert.equal(first.id, next.id);
  assert.deepEqual(h.pick(T + 5000, { signature: 'same-event' }), []);
});
test('saved, legacy, other-session and other-game clips are never rewritten by overlap merging', () => {
  for (const change of [
    (c) => (c.video = true),
    (c) => delete c.recordingWindow,
    (c) => (c.sessionId = 'old'),
    (c) => (c.game = 'Other game'),
  ]) {
    const h = fixture();
    h.pick(T);
    change(h.clips.data[0]);
    const before = structuredClone(h.clips.data);
    assert.deepEqual(h.pick(T + 5000), []);
    assert.deepEqual(h.clips.data, before);
  }
});
test('merge persistence failure retains the original selection and context', () => {
  const h = fixture();
  h.pick(T);
  const before = structuredClone(h.clips.data);
  h.failSave();
  assert.throws(() => h.pick(T + 5000), /synthetic disk failure/);
  assert.deepEqual(h.clips.data, before);
});
test('a nearby new viewer is not promoted to an original event witness', () => {
  const h = fixture(),
    [clip] = h.pick(T);
  const original = structuredClone(clip.participants);
  const p = { ...h.p, id: 'new', name: 'Synthetic newcomer' };
  h.studio.settings.personas.push(p);
  h.clips.mergePending(clip.id, clipWindow(T + 5000), []);
  assert.deepEqual(h.clips.get(clip.id).participants, original);
});
test('future or previous-session capture cannot create a clip', () => {
  for (const capture of [
    { startedAt: T - 1000, endedAt: T + 1000 },
    { startedAt: T - 70000, endedAt: T - 65000 },
  ]) {
    const h = fixture();
    const result = new ClipFeatures(h.studio, h.clips).spectatorPicks(
      {
        confidence: 0.9,
        clipPicks: [
          {
            personaId: h.p.id,
            title: 'Synthetic',
            reason: 'Synthetic',
            signature: 'bad',
            speechId: 'speech',
          },
        ],
      },
      {
        speech: 'Synthetic',
        witnesses: [h.p.id],
        capturedAt: T,
        liveSpeech: [{ messageId: 'speech', source: 'microphone', capture, hearers: [h.p.id] }],
      },
    );
    assert.deepEqual(result, []);
  }
});
