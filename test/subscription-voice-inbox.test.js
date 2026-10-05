import test from 'node:test';
import assert from 'node:assert/strict';
import { SpeechInbox } from '../server/speech-inbox.js';

function add(inbox, index, { voice = {}, sourceId = 'game-window', hearers = ['viewer'] } = {}) {
  const capture = {
    startedAt: 100000 + index * 4000,
    endedAt: 104000 + index * 4000,
    screen: { sessionId: 'broadcast', sourceId, frames: [{ at: 100000 + index * 4000, image: 'synthetic-frame-' + index }] },
    voice: { provider: 'chatgpt-subscription', kind: 'transcript', sourceInputEpoch: 'input-one', sourceFrameStart: index * 64000, sourceFrameEnd: (index + 1) * 64000, recovered: false, ...voice },
  };
  inbox.receive('source-' + index, 'phrase-' + index, () => ({ id: 'message-' + index }), 'microphone', capture, hearers);
  return capture;
}

test('a slower audience call consumes four continuous fragments in order with individual screen evidence', () => {
  const inbox = new SpeechInbox();
  const captures = Array.from({ length: 6 }, (_, i) => add(inbox, i));
  const first = inbox.batch();
  assert.deepEqual(first.ids, ['source-0', 'source-1', 'source-2', 'source-3']);
  assert.equal(first.text, 'phrase-0\nphrase-1\nphrase-2\nphrase-3');
  assert.deepEqual(inbox.sources(first.ids).map(entry => entry.capture), captures.slice(0, 4));
  inbox.acknowledge(first.ids);
  assert.deepEqual(inbox.batch().ids, ['source-4', 'source-5']);
});

test('subscription batching preserves capture, correction, recovery, screen and audience boundaries', () => {
  for (const change of [
    { voice: { sourceInputEpoch: 'new-input' } },
    { voice: { kind: 'correction' } },
    { voice: { recovered: true } },
    { voice: { sourceFrameStart: 63000 } },
    { voice: { sourceFrameStart: 250000, sourceFrameEnd: 300000 } },
    { sourceId: 'other-window' },
    { hearers: ['new-viewer'] },
  ]) {
    const inbox = new SpeechInbox();
    add(inbox, 0);
    add(inbox, 1, change);
    assert.deepEqual(inbox.batch().ids, ['source-0'], JSON.stringify(change));
    inbox.acknowledge(['source-0']);
    assert.deepEqual(inbox.batch().ids, ['source-1']);
  }
});

test('a correction and legacy microphone capture remain separate from following subscription input', () => {
  for (const voice of [{ kind: 'correction' }, { provider: 'legacy' }]) {
    const inbox = new SpeechInbox();
    add(inbox, 0, { voice });
    add(inbox, 1);
    assert.deepEqual(inbox.batch().ids, ['source-0']);
  }
});
