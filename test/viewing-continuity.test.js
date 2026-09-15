import test from 'node:test';
import assert from 'node:assert/strict';
import {Studio} from '../server/studio.js';
import {Audience} from '../server/audience.js';
import {defaults} from '../shared/defaults.js';
import {ViewingContinuity,SCREEN_REACTION_TTL_MS} from '../server/viewing-continuity.js';
import {liveViewerContext} from '../server/viewer-context.js';

const obs=(text='첫 관문 끝!')=>({game:'Synthetic',scene:'ROUND 1 CLEAR 결과창',confidence:.9,excitement:.5,messages:text?[{personaId:'pop',text,kind:'chat',spoiler:false}]:[]});
function studio(t,{settings={},react}={}){
  let at=100000;const requests=[];
  const s=new Studio({settings:{...defaults,mode:'live',lurkRatio:0,chatPace:8,intervalSeconds:5,slowModeSeconds:0,...settings},audience:new Audience(undefined,()=>{},()=>.5),now:()=>at,random:()=>.5,provider:{status:()=>({configured:true}),react:async args=>{requests.push(args);return react?react(args):{observation:obs()};}}});
  clearInterval(s.timer);t.after(()=>s.close());s.start();
  return {s,requests,now:()=>at,advance:ms=>{at+=ms;}};
}

test('identical input does not spend another model call or replay cheers while witnessed viewing time still grows',async t=>{
  const f=studio(t);await f.s.react({image:'round-one-image'});f.advance(2000);f.s.pump();assert.equal(f.s.messages.filter(m=>m.kind==='chat').length,1);
  for(let i=0;i<12;i++){f.advance(10000);assert.deepEqual(await f.s.react({image:'round-one-image'}),{skipped:'unchanged-input'});f.s.pump();}
  assert.equal(f.requests.length,1);assert.equal(f.s.calls,1);assert.equal(f.s.messages.filter(m=>m.kind==='chat').length,1);
  const knowledge=f.s.knowledge.get('Synthetic');assert.equal(knowledge.observations.length,1);assert.equal(knowledge.watched.pop,122);
  f.s.knowledge.forget('Synthetic');f.advance(6000);await f.s.react({image:'round-one-image'});assert.equal(f.s.knowledge.get('Synthetic').observations.length,0,'idle tracking must not resurrect forgotten memory');
});

test('a changed round and a new spoken question on the same screen both reach the model',async t=>{
  const f=studio(t);await f.s.react({image:'round-one-image'});f.advance(20000);await f.s.react({image:'round-two-image'});
  f.advance(6000);assert.equal((await f.s.react({image:'round-two-image'})).skipped,'unchanged-input');
  f.advance(1);await f.s.react({image:'round-two-image',speech:'아까 두 번째 관문은 어땠어요?'});
  assert.equal(f.requests.length,3);assert.equal(f.requests.at(-1).speech,'아까 두 번째 관문은 어땠어요?');assert.equal(f.requests.at(-1).viewerContext.pop.watchTiming.sameImageAsPreviousSample,true);
});

test('new heard output wakes the audience once and expiry of an old sound does not create a new event',async t=>{
  const f=studio(t);await f.s.react({image:'same'});f.advance(6000);
  f.s.sound.events=[{id:'new-sound',startedAt:f.now()-1000,endedAt:f.now(),silent:false,witnesses:['pop'],classes:[],systemSpeech:'합성 게임 대사'}];
  await f.s.react({image:'same'});assert.equal(f.requests.length,2);assert.equal(f.requests[1].viewerContext.pop.heardSounds[0].id,'new-sound');
  f.advance(6000);assert.equal((await f.s.react({image:'same'})).skipped,'unchanged-input');
  f.advance(30000);assert.equal((await f.s.react({image:'same'})).skipped,'unchanged-input');assert.equal(f.requests.length,2);
});

test('a new address between viewers can continue on a paused screen without an endless self-reaction',async t=>{
  const f=studio(t,{react:async()=>({observation:obs('')})});await f.s.react({image:'paused'});f.advance(6000);
  f.s.addMessage('pop','모모님은 퍼즐이랑 탐험 중에 뭐가 좋아요?');await f.s.react({image:'paused'});assert.equal(f.requests.length,2);
  f.advance(6000);assert.equal((await f.s.react({image:'paused'})).skipped,'unchanged-input');
  f.advance(60000);assert.equal((await f.s.react({image:'paused'})).skipped,'unchanged-input','expiry is not a new conversational event');
});

test('idle knowledge save failures retain prior time, report the error and back off without model calls',async t=>{
  const f=studio(t);await f.s.react({image:'same'});const lastSeen=structuredClone(f.s.knowledge.lastSeen);f.advance(6000);
  f.s.knowledge.save=()=>{throw Error('synthetic storage unavailable');};
  await assert.rejects(f.s.react({image:'same'}),/synthetic storage/);assert.deepEqual(f.s.knowledge.lastSeen,lastSeen);assert.equal(f.s.lastError,'synthetic storage unavailable');
  assert.equal((await f.s.react({image:'same'})).skipped,'backoff');assert.equal(f.requests.length,1);
  f.s.knowledge.save=()=>{};f.advance(6000);assert.equal((await f.s.react({image:'same'})).skipped,'unchanged-input');assert.equal(f.s.failures,0);
});

test('a late viewer gets a fresh input turn without inheriting the earlier event or reaction',async t=>{
  const f=studio(t,{settings:{personas:defaults.personas.map(p=>({...p,enabled:p.id==='new'?false:p.enabled}))}});
  await f.s.react({image:'same'});f.advance(2000);f.s.pump();f.advance(30000);
  const newcomer=f.s.settings.personas.find(p=>p.id==='new');newcomer.enabled=true;f.s.audience.join(newcomer,f.s.settings,f.now());
  await f.s.react({image:'same'});const packet=f.requests[1].viewerContext.new;
  assert.equal(packet.previous,null);assert.equal(packet.watchTiming.previousAnalysisAgeSeconds,null);assert.equal(packet.watchTiming.imageUnchangedSeconds,0);assert.deepEqual(packet.conversationRhythm.recentReactions,[]);
  assert.equal(f.requests[1].viewerContext.pop.watchTiming.imageUnchangedSeconds,32);
});

test('screen-only replies expire both during model latency and while queued behind slow mode',async t=>{
  let release;const f=studio(t,{react:()=>new Promise(r=>release=r)});
  const job=f.s.react({image:'late-image'});f.advance(SCREEN_REACTION_TTL_MS+1);release({observation:obs()});await job;assert.equal(f.s.queue.length,0);
  const g=studio(t,{settings:{slowModeSeconds:60}});g.s.lastSpeaker.set('pop',g.now());await g.s.react({image:'slow-mode-image'});g.advance(10000);g.s.pump();assert.equal(g.s.queue.length,1);
  g.advance(SCREEN_REACTION_TTL_MS);g.s.pump();assert.equal(g.s.queue.length,0);assert.equal(g.s.messages.filter(m=>m.kind==='chat').length,0);
});

test('spoken answers are not expired as screen-only reactions',async t=>{
  let release;const f=studio(t,{react:()=>new Promise(r=>release=r)});const job=f.s.react({image:'same',speech:'이 장면에 대해 자세히 설명해 주세요.'});
  f.advance(SCREEN_REACTION_TTL_MS+1);release({observation:obs('질문에 대한 답이에요.')});await job;f.advance(2000);f.s.pump();assert.ok(f.s.messages.some(m=>m.text==='질문에 대한 답이에요.'));
});

test('requested ambient turns bypass an unchanged image',async t=>{
  const f=studio(t);await f.s.react({image:'same'});f.advance(6000);
  f.s.autonomy={tick:()=>{},evolve:()=>{},snapshot:()=>({}),stop:()=>{}};f.s.ambient.context('서로의 취향 얘기를 해봐요.');
  await f.s.react({image:'same'});assert.equal(f.requests.length,2);assert.equal(f.requests[1].ambient.id,'taste');
});

test('failed inference does not acknowledge input, and a new session starts fresh',async t=>{
  let fail=true;const f=studio(t,{react:async()=>{if(fail)throw Error('synthetic failure');return {observation:obs()};}});
  await assert.rejects(f.s.react({image:'same'}),/synthetic failure/);f.advance(10000);fail=false;await f.s.react({image:'same'});assert.equal(f.requests.length,2);
  f.s.stop();f.s.start();f.advance(6000);await f.s.react({image:'same'});assert.equal(f.requests.length,3);
});

test('speech that supersedes a screen request leaves the unprocessed image eligible for retry',async t=>{
  let release;const f=studio(t,{react:()=>new Promise(r=>release=r)});
  const job=f.s.react({image:'unprocessed'});
  f.s.receiveSpeech({id:'utterance-one',sessionId:f.s.sessionId,text:'잠깐 다음 장면을 봐 주세요.'});
  release({observation:obs()});assert.deepEqual(await job,{skipped:'superseded'});assert.equal(f.s.viewing.last,null);
  f.advance(3000);const retry=f.s.react({image:'unprocessed'});release({observation:obs('여기 보고 있어요')});await retry;
  assert.equal(f.requests.length,2);assert.equal(f.requests[1].speech,'잠깐 다음 장면을 봐 주세요.');assert.equal(f.s.speechInbox.pending.length,0);
});

test('no image cannot silently continue game viewing credits while spoken Just Chatting remains responsive',async t=>{
  const f=studio(t);await f.s.react({image:'game'});f.advance(10000);await f.s.react({speech:'화면은 잠시 껐어요.'});assert.equal(f.s.knowledge.lastSeen,null);
  f.advance(6000);assert.equal((await f.s.react({})).skipped,'unchanged-input');f.advance(100000);await f.s.react({image:'game'});assert.equal(f.s.knowledge.get('Synthetic').seconds,0);
  const g=studio(t,{settings:{category:'just-chatting'}});await g.s.react({speech:'오늘 점심 얘기 좀 해요.'});g.advance(6000);await g.s.react({speech:'저는 국수를 먹었어요.'});assert.equal(g.requests.length,2);
});

test('reaction history outlives 35 lines, uses relative ages, respects deletion and excludes fiction',()=>{
  const history=[{id:'cheer',personaId:'pop',kind:'chat',time:1000,text:'첫 관문 해냈네요'},...Array.from({length:50},(_,i)=>({id:'voice'+i,personaId:'streamer',kind:'streamer',time:2000+i*1000,text:'합성 진행 설명'})),{id:'fiction',personaId:'pop',kind:'chat',time:53000,text:'가상 우승 축하',fictional:true}];
  const people=[{id:'pop',name:'팝콘'},{id:'late',name:'나중'}],audience={members:[{id:'pop',joinedAt:0},{id:'late',joinedAt:54000}]};
  const context=rows=>liveViewerContext(audience,people,rows,null,{now:60000}).viewerContext;
  const result=context(history);assert.ok(!result.pop.chatHistory.some(m=>m.id==='cheer'));assert.equal(result.pop.conversationRhythm.recentReactions[0].id,'cheer');assert.equal(result.pop.conversationRhythm.recentReactions[0].ageSeconds,59);assert.equal(result.pop.conversationRhythm.recentReactions.length,1);assert.deepEqual(result.late.conversationRhythm.recentReactions,[]);
  assert.deepEqual(context(history.filter(m=>m.id!=='cheer')).pop.conversationRhythm.recentReactions,[]);
});

test('input history is bounded and returning viewers cannot inherit an unseen unchanged interval',()=>{
  const v=new ViewingContinuity();let ticket=v.observe({image:'same',people:[{id:'a',joinedAt:1}],at:10});v.acknowledge(ticket);
  v.observe({image:'same',people:[],at:20});ticket=v.observe({image:'same',people:[{id:'a',joinedAt:1}],at:30000});assert.equal(ticket.timing.a.imageUnchangedSeconds,0);
  for(let i=0;i<100;i++){ticket=v.observe({image:'same',people:[{id:'a',joinedAt:1}],soundIds:['sound'+i],at:40000+i});v.acknowledge(ticket);}assert.equal(v.heard.size,40);assert.equal(v.viewers.size,1);
  assert.equal(v.unchanged(v.observe({image:'same',people:[{id:'a',joinedAt:1}],at:5})),false);v.reset();assert.equal(v.last,null);assert.equal(v.viewers.size,0);
});
