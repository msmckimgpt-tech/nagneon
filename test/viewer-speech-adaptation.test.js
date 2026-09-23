import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adoptStyle, playfulPushbackAllowed, recordStyleTrial, requestStyleTrial, styleIntent,
  violatesStyleBoundary, witnessedStyleScene,
} from '../server/viewer-speech-adaptation.js';
import { viewerSpeechStyle } from '../server/viewer-speech-style.js';

test('quoted requests, other viewers and an old visit cannot create a durable correction', () => {
  assert.equal(styleIntent('관객이 “반말로 말해줘”라고 했어'), null);
  const feedback = styleIntent('새싹님 반말로 말해줘');
  assert.deepEqual(feedback, { axis: 'register', target: 'casual', boundary: false });
  assert.equal(witnessedStyleScene(undefined, { id: 'r1', at: 200, visitJoinedAt: 100,
    feedback, directlyAddressed: false }), undefined);
  assert.equal(witnessedStyleScene(undefined, { id: 'old', at: 99, visitJoinedAt: 100,
    feedback, directlyAddressed: true }), undefined);
  const heard = witnessedStyleScene(undefined, { id: 'r1', at: 200, visitJoinedAt: 100,
    feedback, directlyAddressed: true });
  assert.equal(heard.stage, 'heard');
  assert.equal(witnessedStyleScene(heard, { id: 'r1', at: 200, visitJoinedAt: 100 }), heard);
  assert.equal(witnessedStyleScene(heard, { id: 'r2', at: 201, visitJoinedAt: 300 }), heard);
});

test('one follow-up cannot adopt; an actual trial, separate result and viewer choice can', () => {
  const heard = witnessedStyleScene(undefined, { id: 'r1', at: 100, visitJoinedAt: 1,
    feedback: styleIntent('새싹님 반말로 말해줘'), directlyAddressed: true });
  const considering = witnessedStyleScene(heard, { id: 'r2', at: 200, visitJoinedAt: 1 });
  const requested = requestStyleTrial(considering, '말투: 반말을 조금 써 보는 편');
  const member = { sessions: 2, seconds: 1800, affinity: .6, memories: ['나 직접 말해 봤어'] };
  const early = adoptStyle(requested, { sourceId: 'r2', at: 201,
    preference: '말투: 반말을 조금 써 보는 편', reason: '직접 해 보니 편함', resultSpeech: '아까 말한 게 자연스럽네', member });
  assert.equal(early.stage, 'considering');
  const trial = recordStyleTrial(requested, { id: 'message-1', at: 300, text: '나 이게 편하네' });
  assert.equal(trial.stage, 'trial');
  assert.equal(recordStyleTrial(trial, { id: 'message-1', at: 300, text: '나 이게 편하네' }), trial);
  assert.equal(adoptStyle(trial, { sourceId: 'r2', at: 400,
    preference: '말투: 반말을 조금 써 보는 편', reason: '직접 해 보니 편함', resultSpeech: '아까 말한 게 자연스럽네', member }), trial);
  assert.equal(adoptStyle(trial, { sourceId: 'r3', at: 400,
    preference: '말투: 반말을 조금 써 보는 편', reason: '스트리머가 시켜서', resultSpeech: '아까 말한 게 자연스럽네', member }), trial);
  assert.equal(adoptStyle(trial, { sourceId: 'r3', at: 400,
    preference: '말투: 반말을 조금 써 보는 편', reason: '직접 해 보니 편함', resultSpeech: '게임 시작', member }), trial);
  const adopted = adoptStyle(trial, { sourceId: 'r3', at: 400,
    preference: '말투: 반말을 조금 써 보는 편', reason: '직접 해 보니 내 방식에 맞음', resultSpeech: '아까 말한 게 자연스럽네', member });
  assert.equal(adopted.stage, 'adopted');
  const persona = { id: 'same-person', personality: '오늘의 게임을 조용히 본다.' };
  const baseline = viewerSpeechStyle(persona, {});
  assert.deepEqual(viewerSpeechStyle(persona, { speechStyleAdaptation: adopted }), baseline);
  const changed = viewerSpeechStyle(persona, { speechStyleOverlay: { [adopted.axis]: adopted.target } });
  assert.equal(changed.register, 'casual');
  for (const key of ['messageLength', 'laughter', 'texture', 'banter'])
    assert.equal(changed[key], baseline[key]);
});

test('clear behavior boundaries take effect without pretending the viewer agrees', () => {
  const noLaughter = styleIntent('ㅋㅋ 너무 많이 쓰지 마, 불편해');
  assert.equal(noLaughter.boundary, true);
  assert.equal(violatesStyleBoundary('ㅋㅋ 또 그랬네', { ...noLaughter, sourceId: 'r1' }), true);
  assert.equal(violatesStyleBoundary('알겠어요.', { ...noLaughter, sourceId: 'r1' }), false);
  const noBanter = styleIntent('비꼬는 말투 불편하니 그만해');
  assert.equal(noBanter.boundary, true);
  assert.equal(violatesStyleBoundary('또 놀리려는 거야?', { ...noBanter, sourceId: 'r2' }), true);
});

test('playful pushback needs reciprocal witnessed banter and expires with cooldown or discomfort', () => {
  const address = (text) => new Set(text.includes('새싹님') ? ['viewer-1'] : []);
  const history = [
    { personaId: 'viewer-1', kind: 'chat', text: 'ㅋㅋ 그건 재밌네', time: 1000 },
    { personaId: 'streamer', kind: 'streamer', text: '새싹님 ㅋㅋ 농담 받아줘서 고마워', time: 2000 },
  ];
  assert.equal(playfulPushbackAllowed(history, 'viewer-1', address, 3000, {}), true);
  assert.equal(playfulPushbackAllowed(history, 'viewer-2', address, 3000, {}), false);
  assert.equal(playfulPushbackAllowed(history, 'viewer-1', address, 50000, {}), false);
  assert.equal(playfulPushbackAllowed(history, 'viewer-1', address, 3000, { lastBanterAt: 2500 }), false);
  assert.equal(playfulPushbackAllowed(history, 'viewer-1', address, 3000, { speechStyleBoundary: { axis: 'banter' } }), false);
  assert.equal(playfulPushbackAllowed([...history, { personaId: 'streamer', kind: 'streamer', text: '이제 진지하게 얘기하자', time: 2500 }], 'viewer-1', address, 3000, {}), false);
});
