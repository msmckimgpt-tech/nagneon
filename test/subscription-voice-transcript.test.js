import test from 'node:test';
import assert from 'node:assert/strict';
import { SubscriptionTranscript } from '../shared/subscription-voice.js';
const fragment = (id, text, start_ms, end_ms) => ({
  type: 'input_transcript.added',
  start_ms,
  end_ms,
  item: { id, type: 'input_transcript', text },
});
const final = (id, transcript, start_ms, end_ms) => ({
  type: 'turn.done',
  turn: { id, role: 'user', transcript, start_ms, end_ms },
});

test('repeated words with different original intervals are preserved, retries are deduplicated by provider identity', () => {
  const state = new SubscriptionTranscript({ now: () => 5000 });
  const a = fragment('first', 'go', 100, 300),
    b = fragment('repeat', ' go', 800, 1000);
  state.accept(a, 500);
  state.accept(b, 1200);
  assert.equal(state.accept(a, 2000).duplicate, true);
  assert.equal(state.ready().text, 'go go');
  assert.deepEqual(state.ready().ids, ['first', 'repeat']);
  assert.throws(() => state.accept(fragment('first', 'changed', 100, 300)), /달라/);
});
test('negation and correction fragments retain spaces and source order despite delivery order', () => {
  const state = new SubscriptionTranscript({ now: () => 6000 });
  state.accept(fragment('end', ' right', 1200, 1400), 2300);
  state.accept(fragment('begin', 'left', 500, 700), 2200);
  state.accept(fragment('correction', ', no,', 900, 1100), 2250);
  const group = state.ready();
  assert.equal(group.text, 'left, no, right');
  assert.equal(group.startMs, 500);
  assert.equal(group.observedAt, 2200);
  state.acknowledge(group.ids);
  assert.equal(state.ready(), null);
});
test('completed turn confirms existing fragments without publishing the same utterance again', () => {
  const state = new SubscriptionTranscript({ now: () => 4000 });
  state.accept(fragment('a', 'Hello', 0, 200), 300);
  const first = state.ready();
  state.acknowledge(first.ids);
  state.accept(final('turn', 'Hello.', 0, 1800), 2000);
  assert.deepEqual(state.canonicalChanges([{ id: 'delivery', fragmentIds: first.ids }]), []);
  assert.equal(state.ready(), null);
});
test('a substantive canonical correction refers to prior publications and is emitted once', () => {
  const state = new SubscriptionTranscript({ now: () => 4000 });
  state.accept(fragment('a', 'left', 0, 200), 300);
  const first = state.ready();
  state.acknowledge(first.ids);
  state.accept(final('turn', 'right', 0, 1800), 2000);
  const updates = state.canonicalChanges([{ id: 'delivery', fragmentIds: first.ids }]);
  assert.equal(updates[0].text, 'right');
  assert.deepEqual(updates[0].revises, ['delivery']);
  assert.equal(state.canonicalChanges([]).length, 0);
});
test('continuous input has bounded batches without waiting for voice session end', () => {
  const state = new SubscriptionTranscript({ now: () => 5000 });
  for (let i = 0; i < 26; i++)
    state.accept(fragment('part_' + i, ' word', i * 200, (i + 1) * 200), i * 200 + 500);
  const group = state.ready();
  assert.ok(group);
  assert.ok(group.endMs - group.startMs <= 6000);
});
test('invalid timestamps, non-user turns and capacity overflow fail explicitly', () => {
  const state = new SubscriptionTranscript({ maxFragments: 1 });
  assert.throws(() => state.accept(fragment('bad', 'x', 100, 50)));
  assert.throws(() =>
    state.accept({
      type: 'turn.done',
      turn: {
        id: 'assistant',
        role: 'assistant',
        start_ms: 0,
        end_ms: 1,
        transcript: 'do not forward',
      },
    }),
  );
  state.accept(fragment('one', 'x', 0, 200));
  assert.throws(() => state.accept(fragment('two', 'y', 200, 400)), /한도/);
});

test('a final-only provider turn remains deliverable and late fragments do not duplicate it', () => {
  const transcript = new SubscriptionTranscript({ now: () => 1000 });
  transcript.accept(
    {
      type: 'turn.done',
      turn: {
        id: 'final_only',
        role: 'user',
        start_ms: 100,
        end_ms: 300,
        transcript: 'not left, right',
      },
    },
    1000,
  );
  assert.equal(transcript.ready(1500), null);
  const group = transcript.ready(2200);
  assert.equal(group.finalFallback, true);
  assert.equal(group.text, 'not left, right');
  assert.deepEqual(group.ids, []);
  transcript.acknowledge(group.ids, group.providerTurnId);
  assert.equal(transcript.ready(2300), null);
  assert.equal(
    transcript.accept({
      type: 'turn.done',
      turn: {
        id: 'final_only',
        role: 'user',
        start_ms: 100,
        end_ms: 300,
        transcript: 'not left, right',
      },
    }, 2400).duplicate,
    true,
  );
  assert.equal(transcript.ready(3500), null);
  transcript.accept(
    {
      type: 'input_transcript.added',
      start_ms: 100,
      end_ms: 300,
      item: { id: 'late_fragment', type: 'input_transcript', text: 'not left, right' },
    },
    2300,
  );
  assert.equal(transcript.ready(3500), null);
  assert.equal(transcript.fragments.size, 1);
});
