import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ContinuousPcmEncoder,
  ContinuousSpeechSegmenter,
  startContinuousMicrophone,
  wavFromPcm,
} from '../src/continuous-microphone.ts';

const frames = (startFrame, value) => ({
  startFrame,
  samples: Int16Array.from({ length: 1600 }, () => value),
});

test('one uninterrupted PCM stream yields ordered speech segments with no recorder restart', async () => {
  const segments = [],
    segmenter = new ContinuousSpeechSegmenter(100000, (segment) => segments.push(segment));
  for (let i = 0; i < 10; i++) segmenter.add(frames(i * 1600, 5000));
  for (let i = 10; i < 15; i++) segmenter.add(frames(i * 1600, 0));
  assert.equal(segments.length, 1);
  assert.deepEqual([segments[0].startFrame, segments[0].endFrame], [0, 24000]);
  for (let i = 15; i < 75; i++) segmenter.add(frames(i * 1600, 5000));
  segmenter.finish();
  assert.ok(segments.length >= 2);
  assert.equal(segments[1].startFrame, segments[0].endFrame);
  assert.equal(segments.at(-1).endFrame, 75 * 1600);
  assert.throws(() => segmenter.add(frames(76 * 1600, 5000)), /이어지지/);
  const bytes = Buffer.from(await segments[0].blob.arrayBuffer());
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.readUInt32LE(24), 16000);
  assert.equal(bytes.length, 44 + 24000 * 2);
});

test('WAV encoder preserves signed PCM samples', async () => {
  const bytes = Buffer.from(await wavFromPcm([Int16Array.of(-32768, 0, 32767)]).arrayBuffer());
  assert.deepEqual(
    [bytes.readInt16LE(44), bytes.readInt16LE(46), bytes.readInt16LE(48)],
    [-32768, 0, 32767],
  );
});

test('device-clock PCM encoder preserves contiguous frames and flushes the final partial batch', () => {
  const encoder = new ContinuousPcmEncoder(),
    frames = [];
  for (let i = 0; i < 3; i++)
    encoder.push(new Float32Array(48_000).fill(0.25), 48_000, (item) => frames.push(item));
  encoder.push(new Float32Array(240).fill(-0.5), 48_000, (item) => frames.push(item));
  encoder.finish((item) => frames.push(item));
  assert.equal(encoder.frame, 48_080);
  assert.equal(
    frames.reduce((total, item) => total + item.samples.length, 0),
    48_080,
  );
  for (let i = 1; i < frames.length; i++)
    assert.equal(frames[i].startFrame, frames[i - 1].startFrame + frames[i - 1].samples.length);
  assert.equal(frames.at(-1).samples.length, 80);
  assert.ok(frames[0].samples.every((sample) => sample === 8192));
  assert.ok(frames.at(-1).samples.every((sample) => sample === -16384));
  assert.throws(() => encoder.push(new Float32Array(100), 44_100, () => {}), /바뀌었습니다/);
});

test('track processor keeps the PCM source contiguous and closes the cloned track', async (t) => {
  const original = globalThis.MediaStreamTrackProcessor,
    frames = [],
    errors = [];
  let clonedStopped = false,
    streamController;
  globalThis.MediaStreamTrackProcessor = class {
    constructor(options) {
      assert.equal(options.maxBufferSize, 100);
      this.readable = new ReadableStream({
        start(controller) {
          streamController = controller;
        },
      });
    }
  };
  t.after(() => {
    globalThis.MediaStreamTrackProcessor = original;
  });
  const track = {
    clone: () => ({
      stop: () => {
        clonedStopped = true;
      },
    }),
  };
  const dispose = await startContinuousMicrophone({
    track,
    onFrames: (item) => frames.push(item),
    onFailure: (error) => errors.push(error),
  });
  for (let packet = 0; packet < 11; packet++)
    streamController.enqueue({
      timestamp: packet * 10_000,
      numberOfFrames: 480,
      numberOfChannels: 1,
      sampleRate: 48_000,
      copyTo: (destination) => destination.fill(0.25),
      close: () => {},
    });
  await new Promise((resolve) => setImmediate(resolve));
  dispose();
  assert.equal(clonedStopped, true);
  assert.deepEqual(errors, []);
  assert.deepEqual(
    frames.map((item) => item.startFrame),
    [0, 1600],
  );
  assert.deepEqual(
    frames.map((item) => item.samples.length),
    [1600, 160],
  );
});
