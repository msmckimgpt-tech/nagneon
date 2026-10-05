import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireMicrophone, MicrophoneRetry, microphoneFailure } from '../src/microphone-device.ts';
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function stream(id = 'usb-headset') {
  const track = {
    label: 'Test headset',
    readyState: 'live',
    stops: 0,
    getSettings: () => ({ deviceId: id, groupId: 'usb' }),
    stop() {
      this.stops++;
      this.readyState = 'ended';
    },
  };
  return { track, getTracks: () => [track], getAudioTracks: () => [track] };
}
test('microphone uses exact saved input; mismatch cannot silently become a different microphone', async () => {
  const value = stream();
  let constraint;
  const mediaDevices = {
    getUserMedia: async (options) => {
      constraint = options;
      return value;
    },
    enumerateDevices: async () => [],
  };
  const signal = new AbortController().signal;
  const result = await acquireMicrophone({ deviceId: 'usb-headset', signal, mediaDevices });
  assert.deepEqual(constraint.audio.deviceId, { exact: 'usb-headset' });
  assert.equal(result.choice.deviceId, 'usb-headset');
  const wrong = stream('other-mic');
  mediaDevices.getUserMedia = async () => wrong;
  await assert.rejects(acquireMicrophone({ deviceId: 'usb-headset', signal, mediaDevices }), {
    name: 'NotFoundError',
  });
  assert.equal(wrong.track.stops, 1);
});
test('first start resolves a moving default alias to a concrete device; ambiguous input stops', async () => {
  const signal = new AbortController().signal;
  const mediaDevices = {
    getUserMedia: async () => stream('default'),
    enumerateDevices: async () => [
      { kind: 'audioinput', deviceId: 'default', groupId: 'usb', label: 'Default' },
      { kind: 'audioinput', deviceId: 'usb-headset', groupId: 'usb', label: 'Test headset' },
    ],
  };
  assert.equal(
    (await acquireMicrophone({ deviceId: '', signal, mediaDevices })).choice.deviceId,
    'usb-headset',
  );
  const lost = stream('default');
  mediaDevices.getUserMedia = async () => lost;
  mediaDevices.enumerateDevices = async () => [];
  await assert.rejects(acquireMicrophone({ deviceId: '', signal, mediaDevices }), {
    name: 'NotFoundError',
  });
  assert.equal(lost.track.stops, 1);
});
test('stop and timeout settle promptly and release devices that permission UI returns later', async () => {
  for (const timeout of [false, true]) {
    const gate = deferred(),
      controller = new AbortController(),
      value = stream();
    const attempt = acquireMicrophone({
      deviceId: 'usb-headset',
      signal: controller.signal,
      timeoutMs: timeout ? 10 : 5000,
      mediaDevices: { getUserMedia: () => gate.promise, enumerateDevices: async () => [] },
    });
    const rejected = assert.rejects(attempt, { name: timeout ? 'TimeoutError' : 'AbortError' });
    if (!timeout) controller.abort();
    await rejected;
    gate.resolve(value);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(value.track.stops, 1);
  }
});
test('automatic retries are bounded across reconnects and user stop cannot reactivate input', () => {
  const retry = new MicrophoneRetry();
  assert.equal(retry.ready(0), false);
  retry.request();
  assert.equal(retry.ready(0), true);
  for (let n = 1; n <= 3; n++) {
    assert.equal(retry.fail(true, n * 10000), true);
    assert.equal(retry.ready(n * 10000), false);
    assert.equal(retry.ready(n * 10000 + n * 1000), true);
  }
  assert.equal(retry.fail(true, 40000), false);
  assert.equal(retry.ready(90000), false);
  retry.request();
  retry.stop();
  assert.equal(retry.fail(true), false);
  assert.equal(retry.ready(Date.now() + 100000), false);
  for (const name of [
    'NotAllowedError',
    'NotFoundError',
    'OverconstrainedError',
    'SecurityError',
    'TimeoutError',
  ]) {
    retry.request();
    assert.equal(retry.fail(microphoneFailure(new DOMException('test', name)).retryable), false);
  }
});
