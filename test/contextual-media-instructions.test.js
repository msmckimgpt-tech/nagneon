import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIProvider } from '../server/provider.js';
import { defaults } from '../shared/defaults.js';
import { temporalInstructions } from '../server/temporal-video.js';
import { speechScreenInstructions } from '../server/speech-screen.js';

const provider = new OpenAIProvider({});
const legacy = new OpenAIProvider({ BACKSEAT_CONTEXTUAL_MEDIA_INSTRUCTIONS: '0' });
const base = { settings: defaults, history: [], speech: '오늘은 이야기만 하자.' };

test('text-only requests omit unused media rules while preserving input, output and evidence boundaries', () => {
  const before = legacy.payload(base), after = provider.payload(base);
  assert.deepEqual({ ...after, instructions: '' }, { ...before, instructions: '' });
  assert.equal(after.instructions, before.instructions.replace('\n' + temporalInstructions, '').replace('\n' + speechScreenInstructions, ''));
  assert.match(after.instructions, /이미지가 없으면 화면을 보고 있다고 주장하지 않는다/);
  assert.match(after.instructions, /원래 말의 부정\/숫자/);
  assert.ok(Buffer.byteLength(before.instructions) - Buffer.byteLength(after.instructions) > 3000);
});

test('current video and microphone evidence retain their respective rules, including unavailable historical screen', () => {
  for (const screenTimeline of [undefined, { frames: [{ index: 1 }] }]) {
    for (const liveSpeech of [[], [{ source: 'keyboard', text: '이거' }], [{ source: 'microphone', text: '이거' }]]) {
      const args = { ...base, screenTimeline, liveSpeech };
      const before = legacy.payload(args), after = provider.payload(args);
      assert.equal(after.instructions.includes(temporalInstructions), !!screenTimeline);
      assert.equal(after.instructions.includes(speechScreenInstructions), liveSpeech.some(s => s.source === 'microphone'));
      assert.deepEqual(after.input, before.input);
      if (screenTimeline && liveSpeech.some(s => s.source === 'microphone')) assert.equal(after.instructions, before.instructions);
    }
  }
});

test('replacement debug prompts and actual media attachments remain unchanged', () => {
  const args = { ...base, image: 'data:image/png;base64,YQ==', liveSpeech: [{ source: 'microphone', capture: { screen: { frames: [{ image: 'data:image/png;base64,Yg==', at: 100 }] } } }], debugPrompt: { enabled: true, mode: 'replace', prompt: 'custom contract' } };
  assert.deepEqual(provider.payload(args), legacy.payload(args));
});
