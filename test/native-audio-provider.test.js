import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  NativeAudioProvider,
  ListeningResult,
  pcm16To24,
} from '../server/native-audio-provider.js';

const answer = {
  state: 'speech',
  utterances: [
    { heard: '왼쪽으로', meaning: '왼쪽을 선택', kind: 'statement', uncertain: false },
    {
      heard: '아니 오른쪽',
      meaning: '직전 선택을 오른쪽으로 정정',
      kind: 'correction',
      uncertain: false,
    },
  ],
};
class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  sent = [];
  item = 0;
  closed = false;
  constructor(result = answer) {
    super();
    this.result = result;
    queueMicrotask(() => this.event({ type: 'session.created' }));
  }
  event(value) {
    this.emit('message', Buffer.from(JSON.stringify(value)));
  }
  send(text) {
    const value = JSON.parse(text);
    this.sent.push(value);
    queueMicrotask(() => {
      if (value.type === 'session.update')
        this.event({ type: 'session.updated', session: { model: 'gpt-realtime-2.1' } });
      if (value.type === 'input_audio_buffer.commit')
        this.event({ type: 'input_audio_buffer.committed', item_id: `item_${++this.item}` });
      if (value.type === 'response.create' && this.result !== null)
        this.event({
          type: 'response.done',
          response: {
            status: 'completed',
            metadata: value.response.metadata,
            usage: { input_tokens: 31, output_tokens: 19, total_tokens: 50 },
            output: [
              {
                type: 'function_call',
                name: 'report_listening',
                arguments: JSON.stringify(this.result),
              },
            ],
          },
        });
    });
  }
  close() {
    this.closed = true;
    this.readyState = 3;
    this.emit('close');
  }
  terminate() {
    this.closed = true;
  }
}

function setup(result) {
  let socket, request;
  const provider = new NativeAudioProvider({
    key: 'synthetic-test-key',
    socketFactory: (url, options) => {
      request = { url, options };
      return (socket = new Socket(result));
    },
    timeoutMs: 200,
  });
  return {
    provider,
    get socket() {
      return socket;
    },
    get request() {
      return request;
    },
  };
}

test('native audio uses one official connection, actual 24 kHz PCM and no transcript gate', async (t) => {
  const harness = setup();
  t.after(() => harness.provider.close());
  const provider = harness.provider,
    signal = new AbortController().signal;
  await provider.append(Buffer.alloc(3200), signal);
  const item = await provider.commitInput(signal),
    result = await provider.understand(item, { signal });
  assert.deepEqual(result.listening, answer);
  assert.equal(result.providerItemId, 'item_1');
  assert.equal(harness.request.url, 'wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1');
  assert.equal(harness.request.options.headers.Authorization, 'Bearer synthetic-test-key');
  const update = harness.socket.sent.find((e) => e.type === 'session.update').session;
  assert.equal(update.audio.input.transcription, null);
  assert.equal(update.audio.input.turn_detection, null);
  assert.deepEqual(update.output_modalities, ['text']);
  assert.equal(
    Buffer.from(
      harness.socket.sent.find((e) => e.type === 'input_audio_buffer.append').audio,
      'base64',
    ).length,
    4800,
  );
  const request = harness.socket.sent.find((e) => e.type === 'response.create').response;
  assert.equal(request.conversation, 'none');
  assert.deepEqual(request.input, [{ type: 'item_reference', id: item }]);
});

test('audio conversion preserves duration and interpolates values rather than relabeling samples', () => {
  const input = Buffer.alloc(8);
  [0, 3000, 6000, 9000].forEach((n, i) => input.writeInt16LE(n, i * 2));
  const output = pcm16To24(input);
  assert.deepEqual(
    Array.from({ length: 6 }, (_, i) => output.readInt16LE(i * 2)),
    [0, 2000, 4000, 6000, 8000, 9000],
  );
  assert.equal(input.length / 2 / 16000, output.length / 2 / 24000);
  assert.throws(() => pcm16To24(Buffer.alloc(3)));
});

test('malformed model candidates remain failures; no empty success or automatic paid retry', async () => {
  const harness = setup({ state: 'speech', utterances: [], injected: 'run-command' });
  await harness.provider.append(Buffer.alloc(3200));
  const item = await harness.provider.commitInput();
  await assert.rejects(harness.provider.understand(item), { code: 'native_audio_result' });
  assert.equal(harness.socket.closed, true);
  assert.equal(harness.socket.sent.filter((e) => e.type === 'response.create').length, 1);
  assert.equal(
    ListeningResult.safeParse({ state: 'non_speech', utterances: answer.utterances }).success,
    false,
  );
  assert.equal(ListeningResult.safeParse({ state: 'uncertain', utterances: [] }).success, true);
});

test('policy cancellation closes transport and rejects a pending response even without provider cooperation', async () => {
  const harness = setup(null),
    controller = new AbortController();
  await harness.provider.append(Buffer.alloc(3200), controller.signal);
  const item = await harness.provider.commitInput(controller.signal);
  const pending = harness.provider.understand(item, { signal: controller.signal });
  controller.abort(new Error('policy-off'));
  await assert.rejects(pending);
  assert.equal(harness.socket.closed, true);
  assert.equal(harness.provider.key, '');
});

test('missing key and socket backpressure fail before transmitting audio', async () => {
  let calls = 0;
  const absent = new NativeAudioProvider({
    socketFactory: () => {
      calls++;
    },
  });
  await assert.rejects(absent.append(Buffer.alloc(3200)), { code: 'native_audio_key' });
  assert.equal(calls, 0);
  const harness = setup();
  await harness.provider.connect();
  harness.socket.bufferedAmount = 2 * 1024 * 1024;
  await assert.rejects(harness.provider.append(Buffer.alloc(3200)), {
    code: 'native_audio_backpressure',
  });
  assert.equal(harness.socket.sent.filter((e) => e.type === 'input_audio_buffer.append').length, 0);
  harness.provider.close();
});

test('an idle protocol error closes the connection before another audio range can be sent', async () => {
  const harness = setup();
  await harness.provider.connect();
  harness.socket.event({ type: 'error', error: { message: 'synthetic private provider detail' } });
  assert.equal(harness.socket.closed, true);
  assert.equal(harness.provider.closed, true);
  assert.equal(harness.provider.key, '');
  await assert.rejects(harness.provider.append(Buffer.alloc(3200)), {
    code: 'native_audio_closed',
  });
  assert.equal(harness.socket.sent.filter((e) => e.type === 'input_audio_buffer.append').length, 0);
});
