import test from 'node:test';
import assert from 'node:assert/strict';
import { createClipSource, createSeparatedClipSources } from '../src/clip-source.ts';
import { createSoundAnalysisSource } from '../src/sound-analysis-source.ts';

function track(kind = 'audio') {
  const value = {
    kind,
    readyState: 'live',
    stops: 0,
    clones: [],
    stop() {
      this.stops++;
      this.readyState = 'ended';
    },
    clone() {
      const copy = track(kind);
      this.clones.push(copy);
      return copy;
    },
  };
  return value;
}
const stream = (tracks) => ({
  getTracks: () => tracks,
  getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
  getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
});
function factory(calls) {
  return (screen, mic, system) =>
    createClipSource(screen, mic, system, {
      supported: () => true,
      makeStream: stream,
      mix: (sources) => {
        calls.push(sources);
        const copies = sources
          .flatMap((s) => s.getAudioTracks())
          .filter((t) => t.readyState === 'live')
          .map((t) => t.clone());
        return { tracks: copies, close: () => copies.forEach((t) => t.stop()) };
      },
    });
}
test('screen-shared game audio is recorded when no separate system stream was supplied; mic stays separate', () => {
  const video = track('video'),
    game = track(),
    voice = track(),
    screen = stream([video, game]),
    mic = stream([voice]),
    calls = [];
  const result = createSeparatedClipSources(screen, mic, null, factory(calls));
  assert.equal(result.base.kind, 'video');
  assert.equal(result.base.hasAudio, true);
  assert.equal(result.audioLayout, 'separate');
  assert.deepEqual(calls, [[screen], [mic]]);
  result.close();
  for (const original of [video, game, voice]) assert.equal(original.stops, 0);
});
test('explicit system source wins without double-mixing screen loopback', () => {
  const screen = stream([track('video'), track()]),
    system = stream([track('video'), track()]),
    calls = [];
  const result = factory(calls)(screen, null, system);
  assert.deepEqual(calls, [[system]]);
  assert.equal(result.stream.getVideoTracks().length, 1);
  assert.equal(system.getVideoTracks()[0].clones.length, 0);
  result.close();
});
test('ended system audio falls back to live screen-shared audio', () => {
  const ended = track();
  ended.stop();
  const screen = stream([track('video'), track()]),
    calls = [];
  const result = factory(calls)(screen, null, stream([ended]));
  assert.deepEqual(calls, [[screen]]);
  assert.equal(result.hasAudio, true);
  result.close();
});
test('audio-only shared source remains a game track, not a microphone-only capture', () => {
  const screen = stream([track()]),
    mic = stream([track()]),
    calls = [];
  const result = createSeparatedClipSources(screen, mic, null, factory(calls));
  assert.equal(result.base.kind, 'audio');
  assert.equal(result.audioLayout, 'separate');
  assert.deepEqual(calls, [[screen], [mic]]);
  result.close();
});
test('no system audio consent/source does not invent a capture or merge the microphone into video', () => {
  const calls = [],
    result = createSeparatedClipSources(
      stream([track('video')]),
      stream([track()]),
      null,
      factory(calls),
    );
  assert.equal(result.base.hasAudio, false);
  assert.equal(result.voice.hasAudio, true);
  assert.deepEqual(calls[0], []);
  result.close();
});
test('analyser teardown cannot end original game audio, picture or independently recorded audio', () => {
  const picture = track('video'),
    game = track(),
    screen = stream([picture, game]),
    calls = [];
  const recording = factory(calls)(screen, null, null);
  const analysis = createSoundAnalysisSource(screen, stream);
  assert.equal(analysis.stream.getVideoTracks().length, 0);
  analysis.stream.getTracks().forEach((t) => t.stop());
  analysis.close();
  analysis.close();
  assert.equal(game.readyState, 'live');
  assert.equal(picture.readyState, 'live');
  assert.ok(recording.stream.getTracks().every((t) => t.readyState === 'live'));
  recording.close();
  assert.equal(game.stops, 0);
  assert.equal(picture.stops, 0);
});
test('partial analyser clone failure cleans only owned clones', () => {
  const first = track(),
    second = track();
  second.clone = () => {
    throw Error('clone failure');
  };
  assert.throws(() => createSoundAnalysisSource(stream([first, second]), stream), /clone failure/);
  assert.equal(first.clones[0].stops, 1);
  assert.equal(first.stops, 0);
  assert.equal(second.stops, 0);
});
test('empty/ended input does not construct an analysis stream', () => {
  const ended = track();
  ended.stop();
  let made = 0;
  for (const source of [null, stream([track('video')]), stream([ended])]) {
    const result = createSoundAnalysisSource(source, () => {
      made++;
    });
    assert.equal(result.stream, null);
    result.close();
  }
  assert.equal(made, 0);
});
