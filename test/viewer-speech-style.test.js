import test from 'node:test';
import assert from 'node:assert/strict';
import {isSpeechStyleBoundary,isSpeechStyleFeedback,isSpeechStylePreference,viewerSpeechStyle} from '../server/viewer-speech-style.js';

const persona=(id,personality='게임을 같이 보며 자기 생각을 담백하게 이야기한다.')=>({
  id,name:'관객',role:'viewer',enabled:true,system:false,personality,values:'현재 값',sociability:.5,expertise:.5
});

test('stable viewer identity keeps a speech baseline across mutable profile values',()=>{
  const p=persona('stable-viewer');
  const first=viewerSpeechStyle(p,{memories:[]});
  const changed=viewerSpeechStyle({...p,name:'바뀐별명',values:'최근 변화',sociability:.95,expertise:.1},{memories:[]});
  assert.deepEqual(changed,first);
  assert.equal(first.stability,'same-viewer-baseline');
});

test('legacy viewers receive deterministic but varied fallback speech styles',()=>{
  const styles=Array.from({length:40},(_,i)=>viewerSpeechStyle(persona('viewer-'+i),{}));
  assert.ok(new Set(styles.map(s=>s.register)).size>=3);
  assert.ok(new Set(styles.map(s=>JSON.stringify(s))).size>=12);
  assert.deepEqual(viewerSpeechStyle(persona('viewer-11'),{}),viewerSpeechStyle(persona('viewer-11'),{}));
});

test('explicit persona speech habits override fallback without inventing a new identity',()=>{
  const style=viewerSpeechStyle(persona('explicit','반말 위주로 편하게 말한다. ㅋㅋ를 자주 쓰고 초성·줄임말도 가끔 쓴다. 친한 사이에는 장난을 받아친다.'),{});
  assert.equal(style.register,'casual');
  assert.equal(style.laughter,'expressive');
  assert.equal(style.texture,'light-chat-shorthand');
  assert.equal(style.banter,'playful');
});

test('recent generated speech cannot silently retune a durable legacy baseline',()=>{
  const p=persona('legacy-neutral','게임을 보며 자기 취향을 이야기한다.');
  const polite=['오늘 재밌어요','저도 그렇게 봐요','이 장면 좋네요','다음 판도 볼게요','그건 조금 어렵겠어요','지금이 더 좋아요'];
  const casual=['오늘 재밌네','나도 그렇게 봐','이 장면 좋다','다음 판도 볼게','그건 좀 어렵지','지금이 더 좋네'];
  const baseline=viewerSpeechStyle(p,{memories:[]});
  assert.deepEqual(viewerSpeechStyle(p,{memories:polite}),baseline);
  assert.deepEqual(viewerSpeechStyle(p,{memories:casual}),baseline);
  for(const raw of [...polite,...casual])assert.ok(!JSON.stringify(baseline).includes(raw));
});

test('manager speech stays operationally neutral instead of receiving a random viewer voice',()=>{
  const p={...persona('manager'),role:'manager',system:true};
  assert.deepEqual(viewerSpeechStyle(p,{}),{
    version:1,register:'polite',messageLength:'compact',laughter:'rare',texture:'plain',banter:'restrained',stability:'same-viewer-baseline'
  });
});

test('speech-style feedback recognizes common Korean register and chat-style requests without treating ordinary topics as corrections',()=>{
  for(const text of ['존댓말로 말해줘','반말은 좀 부담스러워','ㅋㅋ 너무 많이 쓰지 마','채팅을 조금 짧게 해주세요','어투가 너무 딱딱한데 좀 편하게 해도 돼'])
    assert.equal(isSpeechStyleFeedback(text),true,text);
  for(const text of ['오늘 방송 재밌어요','이 빌드는 짧게 끝나네','질문 하나 있어요','장난감 가게가 보이네'])
    assert.equal(isSpeechStyleFeedback(text),false,text);
  assert.equal(isSpeechStylePreference('말투: 웃음표현을 조금 줄여 말하기'),true);
  assert.equal(isSpeechStylePreference('식물 이야기를 더 좋아하게 됨'),false);
  assert.equal(isSpeechStyleBoundary('비꼬는 말투는 불편하니 그만해'),true);
  assert.equal(isSpeechStyleBoundary('존댓말을 조금 줄여줘'),false);
});
