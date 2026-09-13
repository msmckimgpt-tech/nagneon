import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationRhythm} from '../server/conversation-rhythm.js';
import {liveViewerContext} from '../server/viewer-context.js';
import {Studio} from '../server/studio.js';
import {Audience} from '../server/audience.js';
import {OpenAIProvider} from '../server/provider.js';
import {Settings} from '../server/schema.js';
import {defaults} from '../shared/defaults.js';

const message=(id,text,time,personaId='new')=>({id,text,time,personaId,kind:personaId==='streamer'?'streamer':'chat'});
const history=()=>[message('q','여기서는 어떤 게 완료 조건인가요?',1000),message('a','게이지를 끝까지 채우면 돼요.',2000,'streamer'),message('feedback','질문을 연속해서 받으니 부담스러워요.',3000,'streamer'),...Array.from({length:50},(_,i)=>message('later-'+i,'새로운 화제 '+i,10000+i*1000,'momo'))];

test('witnessed questions and nearby speech survive the 35-message view without becoming declared facts',()=>{
  const seen=history(),rhythm=conversationRhythm(seen,'new',{now:70000});
  assert.equal(rhythm.questionThreads[0].question.id,'q');assert.equal(rhythm.questionThreads[0].followingStreamerSpeech[0].id,'a');assert.equal(rhythm.styleFeedback[0].id,'feedback');
  assert.equal(rhythm.questionThreads[0].answered,undefined);assert.equal(rhythm.questionThreads[0].fact,undefined);
  assert.equal(rhythm.ownRecent.questions,1);assert.equal(rhythm.turn,'watching');
});

test('new arrivals and source deletion cannot inherit questions, feedback, or automatic corrections',()=>{
  const rows=history(),audience={members:[{id:'new',joinedAt:0},{id:'late',joinedAt:5000}]},people=[{id:'new',name:'새싹'},{id:'late',name:'나중'}];
  rows[1].transcription={source:'microphone',correction:{text:'게이지가 가득 차면 돼요.'}};
  const build=rows=>liveViewerContext(audience,people,rows,null,{now:70000});
  const first=build(rows);assert.equal(first.viewerContext.new.chatHistory.length,35);
  assert.equal(first.viewerContext.new.conversationRhythm.questionThreads[0].followingStreamerSpeech[0].text,rows[1].text);
  assert.equal(first.viewerContext.new.conversationRhythm.questionThreads[0].followingStreamerSpeech[0].transcriptionCorrection.source,'contextual-stt');
  assert.deepEqual(first.viewerContext.late.conversationRhythm.questionThreads,[]);assert.deepEqual(first.viewerContext.late.conversationRhythm.styleFeedback,[]);
  const deleted=build(rows.filter(m=>!['q','a','feedback'].includes(m.id)));assert.deepEqual(deleted.viewerContext.new.conversationRhythm.questionThreads,[]);assert.deepEqual(deleted.viewerContext.new.conversationRhythm.styleFeedback,[]);
  first.viewerContext.new.conversationRhythm.questionThreads[0].followingStreamerSpeech[0].text='MUTATED';assert.notEqual(rows[1].text,'MUTATED');
});

test('nearby speech is bounded and future or distant replies are not attributed to a question',()=>{
  const rows=[message('q','어떤 순서인가요?',1000),message('distant','관계없는 나중 발언',100000,'streamer'),message('future','아직 하지 않은 말',200000,'streamer')];
  const result=conversationRhythm(rows,'new',{now:110000});assert.deepEqual(result.questionThreads,[]);
  const many=Array.from({length:12},(_,i)=>[message('q'+i,'용어'+i+' 뜻은 뭔가요?',i*10000),message('a'+i,'설명'+i,i*10000+1000,'streamer')]).flat();
  assert.equal(conversationRhythm(many,'new',{now:200000}).questionThreads.length,3);
});

test('connected speech is a tentative listening cue and complete questions still invite replies',()=>{
  for(const speech of ['제가 생각한 건 이제','친구랑 같이 하면서','그런데…'])assert.equal(conversationRhythm([],'new',{speech}).turn,'possibly-continuing');
  for(const speech of ['같이 하면서?','설명해 주세요.','저는 그게 좋아요.'])assert.equal(conversationRhythm([],'new',{speech}).turn,'spoken');
  assert.equal(conversationRhythm([],'new',{speech:'새싹님은 어때요?',name:'새싹'}).addressed,true);
});

test('tone pressure describes each individual without rewriting text or enforcing a laughter quota',()=>{
  const rows=Array.from({length:10},(_,i)=>message('v'+i,'그런 재미겠네요 ㅋㅋ',1000+i,'new'));rows.push(message('other','ㅋㅋㅋ',2000,'momo'));
  const r=conversationRhythm(rows,'new',{now:3000});assert.deepEqual(r.ownRecent,{messages:8,laughter:8,questions:0,reflectiveEndings:8});assert.deepEqual(r.recentRoom,{messages:11,ownMessages:10});
  assert.equal(conversationRhythm(rows,'momo',{now:3000}).ownRecent.laughter,1);assert.equal(rows[0].text,'그런 재미겠네요 ㅋㅋ');
});

test('fictional questions keep provenance and do not assign subsequent real speech or channel preferences',()=>{
  const rows=[{...message('q','설정상 우리는 왕족인가요?',1000),fictional:true},{...message('f','극에서는 더 과장된 말투가 좋아요.',2000,'streamer'),fictional:true},message('r','현실 얘기로 돌아가죠.',3000,'streamer')];
  const r=conversationRhythm(rows,'new',{now:4000});assert.equal(r.questionThreads[0].question.fictional,true);assert.deepEqual(r.questionThreads[0].followingStreamerSpeech.map(m=>m.id),['f']);assert.deepEqual(r.styleFeedback,[]);
});

test('real Studio assembles the new listening context and provider keeps it separate from special responses',async t=>{
  // Studio and Audience have independent random sources. Keep this viewer
  // present for a context-assembly test even if ambient randomness selects away.
  const audience=new Audience(undefined,()=>{},()=>.5);
  let now=100000,args;const s=new Studio({audience,settings:{...defaults,mode:'live',lurkRatio:0,chatPace:8},now:()=>now,random:()=>.5,provider:{status:()=>({configured:true}),react:async request=>{args=request;return {observation:{game:'Synthetic',scene:'',confidence:0,excitement:0,messages:[]}};}}});clearInterval(s.timer);t.after(()=>s.close());s.start();
  s.addMessage('new','어떤 목표인가요?');now+=1000;s.addMessage('streamer','깃발에 도착하면 돼요.','streamer');now+=20000;await s.react({speech:'제가 이어서 이야기하자면 이제'});
  assert.equal(args.viewerContext.new.conversationRhythm.questionThreads[0].followingStreamerSpeech[0].text,'깃발에 도착하면 돼요.');assert.equal(args.viewerContext.new.conversationRhythm.turn,'possibly-continuing');assert.equal(s.queue.length,0);
  const p=new OpenAIProvider({}),live=p.payload(args),special=p.payload({...args,special:{kind:'interview'}}),off=p.payload({...args,offStream:true});
  assert.match(live.instructions,/성격은 관심의 차이/);assert.ok(!special.instructions.includes('성격은 관심의 차이'));assert.ok(!off.instructions.includes('성격은 관심의 차이'));assert.equal(live.reasoning.effort,'low');
  assert.equal(JSON.parse(live.input[0].content[0].text).chatHistory,undefined);assert.equal(Settings.parse(defaults).contextualTranscription,true);
});
