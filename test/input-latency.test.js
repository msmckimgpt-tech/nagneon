import test from 'node:test';
import assert from 'node:assert/strict';
import { InputLatency } from '../server/input-latency.js';

test('latency preserves stage clocks and separates approximate capture from renderer observation', () => {
  let now = 1100;
  const meter = new InputLatency(() => now);
  meter.receive('utterance', {
    startedAt: 100,
    endedAt: 800,
    voice: {
      receivedAt: 500,
      transcriptObservedAt: 1000,
      sourceEndedAt: 800,
      timing: 'approximate-provider-interval',
    },
    text: 'private',
  });
  now = 1200;
  meter.receive('utterance', { startedAt: 900, endedAt: 1100 });
  now = 1600;
  meter.request(1, ['utterance'], { screenThrough: 750 });
  now = 3600;
  meter.response(1);
  now = 4100;
  meter.publish(1, 'chat-id');
  meter.rendered(['chat-id'], 4000);
  assert.equal(meter.snapshot().samples[0].rendererObservedAt, null);
  now = 4300;
  meter.rendered(['chat-id'], 4200);
  const result = meter.snapshot();
  assert.equal(result.approximateCaptureSamples, 1);
  for (const [name, ms] of Object.entries({
    captureToTranscript: 200,
    transcriptAssembly: 500,
    transcriptToReceipt: 100,
    receiptToRequest: 500,
    model: 2000,
    responseToPublish: 500,
    publishToRenderer: 100,
    captureToRenderer: 3400,
  }))
    assert.equal(result.stages[name].p50Ms, ms);
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal(JSON.stringify(result).includes('utterance'), false);
  meter.rendered(['chat-id'], 4250);
  assert.equal(meter.snapshot().samples[0].rendererObservedAt, 4200);
});
test('missing observations are not zero latency; bounds and new broadcast clear all joins', () => {
  let now = 100;
  const meter = new InputLatency(() => now);
  for (let n = 0; n < 300; n++) meter.receive('source-' + n, { startedAt: 10, endedAt: 50 });
  assert.equal(meter.rows.size, 240);
  assert.equal(meter.snapshot().stages.captureToTranscript.samples, 0);
  meter.receive('old-first-fragment', { startedAt: 1, endedAt: 20, voice: { receivedAt: 10 } });
  assert.equal(
    meter.snapshot().stages.transcriptToReceipt.samples,
    0,
    'old first-fragment clocks must not be relabeled as complete transcript observations',
  );
  meter.request(1, ['source-299']);
  now = 110;
  meter.response(1);
  meter.publish(1, 'message');
  now = 120;
  meter.rendered(['message'], 9999999);
  assert.equal(meter.snapshot().stages.publishToRenderer.samples, 0);
  meter.reset();
  meter.rendered(['message'], now);
  assert.equal(meter.snapshot().retained, 0);
  assert.equal(meter.messages.size, 0);
});
