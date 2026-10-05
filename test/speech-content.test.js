import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleSpeech, projectSpeech, speechContent } from '../shared/speech-content.js';
import { SubscriptionTranscript, SubscriptionStopRequest } from '../shared/subscription-voice.js';
import { SpeechInbox } from '../server/speech-inbox.js';

const source = (text, index, extra = {}) => ({
  text,
  source: 'microphone',
  messageId: `m-${index}`,
  capture: {
    voice: {
      provider: 'chatgpt-subscription',
      kind: 'transcript',
      sourceInputEpoch: 'e',
      runId: 'r',
      sourceFrameStart: index * 16000,
      sourceFrameEnd: (index + 1) * 16000,
      recovered: false,
      ...extra,
    },
  },
});

test('audience projection joins a split word and keeps raw receipts and witness boundaries', () => {
  const a = source('모', 0, { providerTurnId: 'turn' }),
    b = source('험을 떠나자', 1, { providerTurnId: 'turn' });
  assert.equal(assembleSpeech([a, b]).text, '모험을 떠나자');
  assert.equal(
    assembleSpeech([a, source('험을 떠나자', 1, { sourceInputEpoch: 'other' })]).text,
    '모\n험을 떠나자',
  );
  assert.equal(assembleSpeech([source('네', 0), source('아니 기다려', 1)]).text, '네\n아니 기다려');
  assert.equal(
    assembleSpeech([source('맞아', 0), source('아니 기다려', 1)]).text,
    '맞아\n아니 기다려',
  );
  assert.equal(
    assembleSpeech([source('색이 바뀌었', 0), source('네요', 1)]).text,
    '색이 바뀌었네요',
  );
  const inbox = new SpeechInbox();
  inbox.receive('a', a.text, () => ({ id: 'a' }), a.source, a.capture, ['old']);
  inbox.receive('b', b.text, () => ({ id: 'b' }), b.source, b.capture, ['old', 'new']);
  assert.deepEqual(inbox.batch().ids, ['a']);
  assert.equal(inbox.sources(['a'])[0].text, '모');
});

test('known nonverbal annotations are separate uncertain cues, without deleting ordinary bracketed speech', () => {
  const raw = '[laughs]음, 아니 [파랑]부터. [clear throat';
  const result = speechContent(raw);
  assert.equal(result.text, '음, 아니 [파랑]부터. ');
  assert.deepEqual(
    result.nonverbal.map((c) => [c.kind, c.complete]),
    [
      ['laughter', true],
      ['throat-clear', false],
    ],
  );
  const item = source(raw, 0),
    projected = projectSpeech(item);
  assert.equal(item.text, raw);
  assert.equal(projected.nonverbal[0].source, 'provider-transcript-annotation');
  assert.equal(projectSpeech({ ...item, source: 'keyboard' }).text, raw);
  assert.equal(assembleSpeech([source('[clear', 0), source(' throat]음', 1)]).text, '음');
});

test('unfinished Korean fragments wait briefly for continuation; a complete turn uses canonical wording once', () => {
  const state = new SubscriptionTranscript();
  const add = (id, text, start, end, at) =>
    state.accept(
      {
        type: 'input_transcript.added',
        start_ms: start,
        end_ms: end,
        item: { id, type: 'input_transcript', text },
      },
      at,
    );
  add('one', '모', 0, 300, 400);
  assert.equal(state.ready(1500), null);
  add('two', '험으로 가', 300, 800, 1600);
  state.accept(
    {
      type: 'turn.done',
      turn: { id: 'turn', role: 'user', start_ms: 0, end_ms: 900, transcript: '모험으로 가.' },
    },
    1700,
  );
  const group = state.ready(1700);
  assert.equal(group.text, '모험으로 가.');
  assert.equal(group.finalFallback, true);
  assert.deepEqual([group.startMs, group.endMs, group.observedThroughAt], [0, 900, 1700]);
  assert.equal(state.fragments.get('one').text, '모');
  state.acknowledge(group.ids, group.providerTurnId);
  assert.equal(state.ready(5000), null);
  assert.deepEqual(state.canonicalChanges([]), []);
});

test('stop reasons are a bounded enum and legacy requests retain an explicit neutral cause', () => {
  const inputEpoch = '11111111-1111-4111-8111-111111111111';
  assert.equal(SubscriptionStopRequest.parse({ inputEpoch }).reason, 'capture-stopped');
  assert.equal(
    SubscriptionStopRequest.parse({ inputEpoch, reason: 'transport-failed' }).reason,
    'transport-failed',
  );
  assert.throws(() =>
    SubscriptionStopRequest.parse({ inputEpoch, reason: 'arbitrary private error' }),
  );
});

test('an empty final transcript cannot erase pending spoken words', () => {
  const state = new SubscriptionTranscript();
  state.accept(
    {
      type: 'input_transcript.added',
      start_ms: 0,
      end_ms: 100,
      item: { id: 'one', type: 'input_transcript', text: '아니' },
    },
    200,
  );
  state.accept(
    {
      type: 'turn.done',
      turn: { id: 'turn', role: 'user', start_ms: 0, end_ms: 100, transcript: '' },
    },
    300,
  );
  assert.equal(state.ready(300).text, '아니');
});
