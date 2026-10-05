import test from 'node:test';
import assert from 'node:assert/strict';
import { Ambient } from '../server/ambient.js';

function fixture() {
  let now = 100000;
  const ambient = new Ambient({ now: () => now });
  return { ambient, advance: value => { now += value; } };
}

for (const speech of [
  '잠깐 조용히 봐주세요', '조용히 해줘', '조용히', '채팅은 그만 해줘',
  '질문 그만해요', '말 걸지 마', '말 좀 걸지 말아 주세요', '그만하고 쉬고 싶어',
]) test('explicit quiet request: ' + speech, () => {
  const { ambient, advance } = fixture();
  ambient.context('오늘은 보스를 해냈어요');
  assert.equal(ambient.context(speech)?.quiet, true);
  assert.equal(ambient.snapshot().active, null);
  advance(599999);assert.equal(ambient.snapshot().quiet, true);
  advance(1);assert.equal(ambient.snapshot().quiet, false);
});

for (const speech of [
  '조용히 하지 말고 같이 얘기해',
  '말 걸지 말라는 게 아니라 같이 얘기하자는 거야',
  '그만 해달라는 뜻이 아니라 다시 얘기하자',
  '다시 같이 얘기해요', '말 걸어줘', '심심해 같이 얘기하자',
]) test('conversation request clears an existing quiet period: ' + speech, () => {
  const { ambient } = fixture();
  ambient.context('잠깐 조용히 봐주세요');
  assert.notEqual(ambient.context(speech)?.quiet, true);
  assert.equal(ambient.snapshot().quiet, false);
});

for (const speech of [
  '그만큼 재밌어요', '조용히 보는 퍼즐이 좋아요',
  '게임에서 "조용히 해"라는 대사가 나왔어요',
  'NPC가 조용히 하라고 했어요',
  '채팅에서 말 걸지 마라고 했어요',
  '어제 그만해 달라고 했었지',
  '그 얘기가 싫지 않아', '쉬고 싶지 않아',
  '"다시 같이 얘기해요"라는 댓글을 읽었어요',
  '조용히 해줘서 고마워', '같이 얘기해서 재밌었어', '말 걸어서 놀랐어',
  '다시 같이 얘기하자는 댓글이었어', 'NPC가 말 걸어 달래',
  'NPC가 조용히 해달래', 'NPC가 조용히 좀 해달래', 'NPC가 조용히 하래',
  '모모가 말 걸지 마래', 'NPC가 쉬고 싶대', 'NPC가 그 얘기가 싫대',
  '모모가 다시 같이 얘기하래',
  '채팅 그만해주지 마', '다시 말해주지 마', '같이 얘기하고 싶지 않아',
  '다시 얘기하지 마', '같이 얘기하지 말고 화면만 봐', '심심하지 않아',
]) test('mention, report or negation does not start or clear quiet: ' + speech, () => {
  const { ambient, advance } = fixture();
  assert.equal(ambient.context(speech)?.quiet ?? false, false);
  ambient.context('잠깐 조용히 봐주세요');
  const until = ambient.quietUntil;
  advance(1000);assert.equal(ambient.context(speech)?.quiet, true);
  assert.equal(ambient.quietUntil, until, 'neutral words must not extend or end the period');
});

for (const [speech, quiet] of [
  ['다시 같이 얘기하자, 아니 잠깐 조용히 봐주세요', true],
  ['같이 얘기하지 말고 잠깐 조용히 봐주세요', true],
  ['잠깐 조용히 봐주세요. 이제 다시 같이 얘기해요', false],
  ['조용히 해줘, 다시 같이 얘기하자, 아니 조용히 봐주세요', true],
]) test('last direct request wins without reversing a refusal: ' + speech, () => {
  const { ambient } = fixture();
  ambient.context('잠깐 조용히 봐주세요');
  ambient.context(speech);
  assert.equal(ambient.snapshot().quiet, quiet);
});

test('a named question preserves quiet deadline and later ordinary topics resume after expiry', () => {
  const { ambient, advance } = fixture();
  ambient.context('잠깐 조용히 봐주세요');
  const until = ambient.quietUntil;
  advance(1000);
  assert.equal(ambient.context('모모는 조용히 보는 게임 중 뭐가 좋아요?')?.quiet, true);
  assert.equal(ambient.quietUntil, until);
  advance(599000);
  assert.equal(ambient.context('만약에 내가 마법사라면?').id, 'improv');
});

for (const [speech, initialQuiet, expectedQuiet] of [
  ['지금은 조용히 봐줘, 끝나면 다시 얘기하자', false, true],
  ['지금은 다시 얘기하자, 나중에는 조용히 보자', true, false],
  ['내일 다시 같이 얘기하자', true, true],
  ['보스 잡으면 다시 같이 얘기하자', true, true],
  ['이따 조용히 봐줘', false, false],
  ['다음 방송에 조용히 봐주세요', false, false],
  ['내일 말고 지금 다시 같이 얘기하자', true, false],
  ['나중에 말고 지금은 조용히 봐주세요', false, true],
  ['화면 보고 다시 같이 얘기하자', true, false],
  ['심심하면 말 걸어', true, true],
]) test('future or conditional request cannot override current intent: ' + speech, () => {
  const { ambient, advance } = fixture();
  if (initialQuiet) ambient.context('잠깐 조용히 봐주세요');
  const until = ambient.quietUntil;
  advance(1000);ambient.context(speech);
  assert.equal(ambient.snapshot().quiet, expectedQuiet);
  if (initialQuiet && expectedQuiet) assert.equal(ambient.quietUntil, until);
});
