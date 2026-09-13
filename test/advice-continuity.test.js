import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Studio} from '../server/studio.js';
import {defaults} from '../shared/defaults.js';
import {adviceIntent,liveAdvicePolicy} from '../server/advice-intent.js';
import {liveViewerContext} from '../server/viewer-context.js';
import {OpenAIProvider,format} from '../server/provider.js';

const chat=(text,advice=false,personaId='momo')=>({personaId,text,advice,kind:'chat',spoiler:false});
const observation=messages=>({game:'Synthetic',scene:'합성 전투',confidence:.8,excitement:0,messages});
function setup(t,react){
  let now=100000;
  const s=new Studio({settings:{...defaults,mode:'live',lurkRatio:0,slowModeSeconds:0,chatPace:8},now:()=>now,random:()=>.5,provider:{status:()=>({configured:true}),react}});
  clearInterval(s.timer);s.audience.random=()=>.5;s.start();t.after(()=>s.close());
  return {s,advance:()=>now+=20000,send:text=>s.receiveSpeech({id:randomUUID(),sessionId:s.sessionId,text})};
}

test('one-hint policy follows the current request and its final correction',()=>{
  for(const text of ['힌트 딱 하나만 부탁해','피해 없이 넘기고 싶은데 힌트 딱 하나만 부탁해.','힌트 한 가지만 주세요','힌트 하나만 부탁해. 화면은 추측하지 말고.','give me one hint'])assert.equal(liveAdvicePolicy(text).maxMessages,1,text);
  assert.equal(liveAdvicePolicy('"힌트 하나만 부탁해"라고 말했던 게 생각나네').allowed,false);
  assert.equal(liveAdvicePolicy('힌트 하나만 부탁해. 아니, 힌트는 그만').allowed,false);
  assert.equal(liveAdvicePolicy('힌트는 그만. 대신 힌트 하나만 부탁해').maxMessages,1);
  assert.equal(liveAdvicePolicy('훈수 좀 해줘').maxMessages,null);
  assert.equal(liveAdvicePolicy('').allowed,false);
  assert.equal(liveAdvicePolicy('', 'always').allowed,true);
  assert.equal(liveAdvicePolicy('힌트 하나만 주세요','never').allowed,false);
  assert.equal(adviceIntent('훈수 없이 같이 보자').refused,true);
  const history=[{kind:'streamer',text:'힌트 하나만 주세요'}];
  assert.equal(liveAdvicePolicy('', 'always',history).allowed,false);
  assert.equal(liveAdvicePolicy('계속 보고 있어요','always',history).allowed,false);
  assert.equal(liveAdvicePolicy('이제 훈수 좀 해줘','always',history).allowed,true);
  assert.equal(liveAdvicePolicy('', 'always',[{...history[0],fictional:true}]).allowed,true);
});

test('one admitted hint across viewers, next screen cannot add advice, fresh request reopens',async t=>{
  const calls=[];
  const {s,send,advance}=setup(t,async args=>{calls.push(args);return {observation:observation([
    chat('수비 두 장이면 공격 6을 막을 수 있어요!',true),
    chat('수비 한 장을 쓰면 5는 막겠어요!',true,'pop'),
    chat('이번엔 어떤 선택일지 궁금하다',false,'gg')
  ])};});
  send('이번 손패에서 힌트 딱 하나만 부탁해');await s.react({image:'frame-a'});
  assert.equal(s.queue.filter(m=>m.advice).length,1);assert.equal(s.queue.length,2);
  assert.equal(s.messages.some(m=>m.advice),false);
  assert.deepEqual(calls[0].viewerContext.momo.conversationRhythm.deliveredAdvice,[]);
  advance();s.pump();s.pump();assert.equal(s.messages.filter(m=>m.advice).length,1);
  advance();await s.react({image:'frame-b'});
  assert.equal(calls[1].advicePolicy.allowed,false);assert.equal(s.queue.some(m=>m.advice),false);
  assert.equal(calls[1].viewerContext.momo.conversationRhythm.deliveredAdvice.length,1);
  // The wording is different enough that the general duplicate guard alone
  // would let the second hint through, as in the real card-game test.
  advance();send('다음 턴도 힌트 하나만 주세요');await s.react({image:'frame-c'});
  assert.equal(calls[2].advicePolicy.allowed,true);assert.equal(s.queue.filter(m=>m.advice).length,1);
});

test('natural Korean choices admit the requested scope without requiring the word hint',()=>{
  for(const text of ['뭉칫, 이번엔 셋 중에 뭐 골라볼까? 한 장만 같이 골라줘. 이유는 짧게 ㅋㅋ','한 장만 추천해 주세요','카드 딱 한 장 선택해 줄래?']){
    assert.deepEqual(liveAdvicePolicy(text),{allowed:true,scope:'current-speech',maxMessages:1},text);
    assert.equal(liveAdvicePolicy(text,'never').allowed,false,text);
    assert.equal(liveAdvicePolicy('','always',[{kind:'streamer',text}]).allowed,false,text);
  }
  for(const text of ['뭐 고를까?','어느 거 골라 볼까?','같이 골라줘 ㅋㅋ','추천해 줄 수 있어?'])assert.equal(liveAdvicePolicy(text).allowed,true,text);
});

test('choice refusals, quotations, recollection and narration never renew advice',()=>{
  for(const text of ['골라주지 마','추천하지 마','선택해 주지 말아줘','골라주지는 말고 같이 봐','추천은 필요 없어','한 장 골라줘. 아니 추천은 그만']){
    assert.equal(adviceIntent(text).refused,true,text);
    assert.equal(liveAdvicePolicy(text,'always').allowed,false,text);
  }
  for(const text of ['"한 장만 골라줘"라고 했던 거 기억나?','한 장만 골라달라고 했었지','추천해줘라고 말했던 거야','골라줘서 고마워','네가 골라주는 카드도 재미있네','뭐 고를지 고민 중이야','카드를 골라봤어','아까 뭐 고를까라고 했잖아','뭐 고를까 생각 중이야'])assert.equal(liveAdvicePolicy(text).allowed,false,text);
  assert.equal(liveAdvicePolicy('골라주지 마. 대신 한 장만 추천해줘').maxMessages,1);
});

test('a natural one-card request reaches the provider and permits only one delivered hint',async t=>{
  const calls=[];
  const {s,send,advance}=setup(t,async args=>{calls.push(args);return {observation:observation([chat('왼쪽 공격 카드에 한 표요',true),chat('가운데 취약 카드도 괜찮아요',true,'pop')])};});
  send('뭉칫, 이번엔 셋 중에 뭐 골라볼까? 한 장만 같이 골라줘. 이유는 짧게 ㅋㅋ');
  await s.react({image:'synthetic-card-reward'});
  assert.equal(calls[0].adviceRequested,true);assert.equal(calls[0].advicePolicy.maxMessages,1);
  assert.equal(s.queue.filter(m=>m.advice).length,1);
  advance();s.pump();assert.equal(s.messages.filter(m=>m.advice).length,1);
  advance();await s.react({image:'same-reward-next-frame'});
  assert.equal(calls[1].advicePolicy.allowed,false);assert.equal(s.queue.length,0);
});

test('moderated hints do not spend the limit, explanations and reactions stay possible',async t=>{
  const {s,send,advance}=setup(t,async args=>({observation:observation(args.speech.includes('왜')?
    [chat('한 장의 방어도가 5라서 6보다 작았거든요.'),chat('이번에는 공격 카드부터 써요',true,'pop')]:
    [{...chat('차단단어 포함 힌트',true),spoiler:true},chat('허용된 한 가지 힌트',true,'pop'),chat('천천히 해봐요',false,'gg')])}));
  send('힌트 하나만 주세요');await s.react({});assert.deepEqual(s.queue.filter(m=>m.advice).map(m=>m.personaId),['pop']);
  advance();s.pump();s.pump();advance();send('왜 한 장으로는 부족한 거야?');await s.react({});
  assert.deepEqual(s.queue.map(m=>m.text),['한 장의 방어도가 5라서 6보다 작았거든요.']);
});

test('refusal cancels an in-flight hint even when the provider returns after abort',async t=>{
  let resolve,signal;
  const {s,send}=setup(t,(_args,sig)=>{signal=sig;return new Promise(r=>resolve=r);});
  send('힌트 하나만 주세요');const pending=s.react({});send('훈수는 그만');assert.equal(signal.aborted,true);
  resolve({observation:observation([chat('늦게 도착한 힌트',true)])});assert.deepEqual(await pending,{skipped:'superseded'});
  assert.equal(s.queue.length,0);assert.equal(s.messages.some(m=>m.advice),false);
});

test('cancelled queue, late arrivals and deletion never become delivered advice memories',async t=>{
  const {s,send,advance}=setup(t,async()=>({observation:observation([chat('첫 힌트',true)])}));
  send('힌트 하나만 주세요');await s.react({});send('잠시만요');assert.equal(s.queue.length,0);
  const context=()=>liveViewerContext({members:[{id:'momo',joinedAt:0},{id:'late',joinedAt:200000}]},[{id:'momo',name:'모모'},{id:'late',name:'나중'}],s.messages,null,{now:210000}).viewerContext;
  assert.deepEqual(context().momo.conversationRhythm.deliveredAdvice,[]);
  advance();send('힌트 하나만 부탁해');await s.react({});advance();s.pump();
  assert.equal(context().momo.conversationRhythm.deliveredAdvice.length,1);
  assert.deepEqual(context().late.conversationRhythm.deliveredAdvice,[]);
  s.moderate('delete',s.messages.find(m=>m.advice).id);
  assert.deepEqual(context().momo.conversationRhythm.deliveredAdvice,[]);
});

test('both provider paths receive hint scope and required content classification',async t=>{
  let args;const {s,send}=setup(t,async a=>{args=a;return {observation:observation([])};});
  send('힌트 하나만 주세요');await s.react({});
  const payload=new OpenAIProvider().payload(args),input=JSON.parse(payload.input[0].content[0].text);
  assert.equal(input.advicePolicy.maxMessages,1);
  assert.ok(format.schema.properties.messages.items.required.includes('advice'));
  assert.equal(format.schema.properties.messages.items.properties.advice.type,'boolean');
});

test('retry after downstream failure cannot spend a one-hint request twice',async t=>{
  let attempt=0;const policies=[];
  const {s,send,advance}=setup(t,async args=>{policies.push(args.advicePolicy);return {observation:observation([chat(++attempt===1?'수비 두 장으로 방어 10을 쌓아요':'공격 카드로 남은 적 체력 6을 깎아 봐요',true)])};});
  s.knowledge.observe=()=>{throw Error('synthetic storage failure after acceptance');};
  send('힌트 하나만 부탁해');await assert.rejects(s.react({image:'first'}),/synthetic storage/);
  assert.equal(s.queue.filter(m=>m.advice).length,1);assert.equal(s.speechInbox.pending.length,1);
  // Retry once while the first hint is queued, then once after it is shown.
  advance();await assert.rejects(s.react({image:'retry-queued'}),/synthetic storage/);
  assert.equal(s.queue.filter(m=>m.advice).length,1);s.pump();assert.equal(s.messages.filter(m=>m.advice).length,1);
  advance();s.knowledge.observe=()=>{};await s.react({image:'retry-shown'});
  assert.equal(s.queue.some(m=>m.advice),false);assert.equal(s.speechInbox.pending.length,0);
  assert.deepEqual(policies.map(p=>p.allowed),[true,false,false]);
});
