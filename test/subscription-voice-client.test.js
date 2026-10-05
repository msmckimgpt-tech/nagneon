import test from 'node:test';
import assert from 'node:assert/strict';
import { SubscriptionVoiceStream } from '../src/subscription-voice.ts';
import { ContinuousListening } from '../src/continuous-listening.ts';
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
function setup(t, handle) {
  const original = { pc: globalThis.RTCPeerConnection, fetch: globalThis.fetch };
  const peers = [],
    requests = [],
    errors = [],
    tracks = [];
  class Peer {
    constructor() {
      this.iceGatheringState = 'complete';
      this.connectionState = 'new';
      peers.push(this);
      this.sender = {
        track: null,
        replaceTrack: async (track) => {
          this.sender.track = track;
        },
      };
    }
    addTransceiver(_kind, options) {
      this.direction = options.direction;
      return { sender: this.sender };
    }
    createDataChannel() {
      return (this.channel = {
        readyState: 'connecting',
        close() {
          this.readyState = 'closed';
          this.onclose?.();
        },
      });
    }
    createOffer() {
      return { type: 'offer', sdp: 'v=0 synthetic m=audio' };
    }
    setLocalDescription(value) {
      this.localDescription = value;
    }
    setRemoteDescription() {
      this.channel.readyState = 'open';
      this.connectionState = 'connected';
    }
    close() {
      this.connectionState = 'closed';
    }
    getReceivers() {
      return [];
    }
  }
  globalThis.RTCPeerConnection = Peer;
  globalThis.fetch = async (path, options) => {
    const body = JSON.parse(options.body);
    requests.push({ path, body });
    const result = await handle?.(path, body, options);
    if (result) return result;
    if (path.endsWith('/connection'))
      return Response.json({
        runId: '11111111-1111-4111-8111-111111111111',
        sdp: 'v=0 answer m=audio',
      });
    if (path.endsWith('/recovery')) return Response.json({ recovery: null });
    return Response.json({ active: true, accepted: true });
  };
  const controller = new AbortController(),
    client = new SubscriptionVoiceStream({
      inputEpoch: '22222222-2222-4222-8222-222222222222',
      signal: controller.signal,
      onError: (e) => errors.push(e),
    });
  const source = {
    readyState: 'live',
    clone() {
      const child = {
        readyState: 'live',
        stop() {
          this.readyState = 'ended';
        },
      };
      tracks.push(child);
      return child;
    },
  };
  t.after(() => {
    client.close();
    globalThis.RTCPeerConnection = original.pc;
    globalThis.fetch = original.fetch;
  });
  return { client, controller, source, tracks, peers, requests, errors };
}
test('subscription client sends input events automatically and never forwards assistant replies', async (t) => {
  const p = setup(t);
  await p.client.connect();
  await p.client.attach(p.source);
  await p.client.registerClock(Date.now());
  const peer = p.peers[0];
  assert.equal(peer.direction, 'sendrecv');
  let stopped = false;
  const remote = {
    enabled: true,
    stop() {
      stopped = true;
    },
  };
  peer.ontrack({ track: remote });
  assert.equal(remote.enabled, false);
  assert.equal(stopped, true);
  peer.channel.onmessage({
    data: JSON.stringify({
      type: 'turn.done',
      turn: { role: 'assistant', transcript: 'must not forward' },
    }),
  });
  peer.channel.onmessage({
    data: JSON.stringify({
      type: 'input_transcript.added',
      start_ms: 0,
      end_ms: 100,
      item: { id: 'synthetic', type: 'input_transcript', text: 'repeat' },
    }),
  });
  await tick(160);
  const batches = p.requests.filter((r) => r.path.endsWith('/events'));
  assert.equal(batches.length, 1);
  assert.equal(batches[0].body.events.length, 1);
  assert.equal(batches[0].body.events[0].item.text, 'repeat');
  p.client.close();
  assert.equal(p.tracks[0].readyState, 'ended');
  assert.equal(p.source.readyState, 'live');
  assert.equal(peer.connectionState, 'closed');
  assert.equal(p.errors.length, 0);
});
test('HTTP retry keeps the same sequence and payload, rather than repeating provider audio', async (t) => {
  let attempts = 0;
  const p = setup(t, (path) => {
    if (path.endsWith('/events') && ++attempts === 1) throw Error('synthetic transport failure');
  });
  await p.client.connect();
  p.peers[0].channel.onmessage({
    data: JSON.stringify({
      type: 'input_transcript.added',
      start_ms: 0,
      end_ms: 100,
      item: { id: 'synthetic', type: 'input_transcript', text: 'repeat' },
    }),
  });
  await tick(600);
  const batches = p.requests.filter((r) => r.path.endsWith('/events'));
  assert.equal(batches.length, 2);
  assert.deepEqual(batches[0].body, batches[1].body);
  assert.equal(p.peers.length, 1);
});
test('cancellation during connection prevents a late ready state and closes owned resources', async (t) => {
  let entered;
  const waiting = new Promise((r) => {
    entered = r;
  });
  const p = setup(t, (path, _body, options) => {
    if (path.endsWith('/connection')) {
      entered();
      return new Promise((_resolve, reject) =>
        options.signal.addEventListener('abort', () => reject(options.signal.reason), {
          once: true,
        }),
      );
    }
  });
  const pending = p.client.connect();
  await waiting;
  p.controller.abort();
  await assert.rejects(pending);
  assert.equal(p.peers[0].connectionState, 'closed');
  assert.equal(p.tracks.length, 0);
});
test('input source ending and transport failure retain distinct stop causes', async (t) => {
  const p = setup(t);
  await p.client.connect();
  await p.client.attach(p.source);
  p.tracks[0].onended();
  assert.equal(p.requests.findLast((r) => r.path.endsWith('/stop')).body.reason, 'source-ended');
  assert.equal(p.errors.length, 1);
  const listener = new ContinuousListening({
    sessionId: '11111111-1111-4111-8111-111111111111',
    remote: true,
    track: {},
    onLevel() {},
    onTranscript() {},
    onError() {},
  });
  listener.inputEpoch = '22222222-2222-4222-8222-222222222222';
  listener.subscription = p.client;
  listener.captureFailure = new Error('input ended');
  try {
    listener.stopCapture();
    assert.deepEqual(
      p.requests.filter((r) => r.path.endsWith('/stop')).map((r) => r.body.reason),
      ['source-ended', 'source-ended'],
    );
  } finally {
    listener.close();
  }
});

test('input backlog stops the connection and reports a recoverable failure once', async (t) => {
  const p = setup(t);
  await p.client.connect();
  await p.client.attach(p.source);
  for (let i = 0; i < 150; i++)
    p.peers[0].channel.onmessage({
      data: JSON.stringify({
        type: 'input_transcript.added',
        start_ms: i,
        end_ms: i + 1,
        item: { id: 'synthetic_' + i, type: 'input_transcript', text: 'queue' },
      }),
    });
  assert.equal(p.errors.length, 1);
  assert.equal(p.peers[0].connectionState, 'closed');
  assert.equal(p.tracks[0].readyState, 'ended');
  assert.equal(
    p.requests.findLast((r) => r.path.endsWith('/stop')).body.reason,
    'transport-failed',
  );
});
