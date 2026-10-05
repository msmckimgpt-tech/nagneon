import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Studio} from '../server/studio.js';
import {Audience} from '../server/audience.js';
import {defaults} from '../shared/defaults.js';
import {startServer} from '../server/index.js';
import {seedMetAudience} from './helpers/met-audience.js';

const sound={source:'system-output',durationSeconds:1,volumeDb:-20,balance:0,silent:false,classes:[{id:'chime',label:'Chime',score:.6,peak:.8,offsetSeconds:0}],systemSpeech:'합성 관문 통과 안내',language:'ko',caveat:'Synthetic classifier result'};
const observation={game:'Synthetic',scene:'합성 잡담',confidence:.9,excitement:.2,messages:[]};
function fixture(t){let at=100000;const inputs=[];
 const s=new Studio({settings:{...defaults,mode:'live',category:'just-chatting',lurkRatio:0,chatPace:8,slowModeSeconds:0,communityActivityEnabled:false},audience:new Audience(undefined,()=>{},()=>.5),random:()=>.5,now:()=>at,provider:{status:()=>({configured:true}),react:async args=>{inputs.push(args);return {observation};}}});clearInterval(s.timer);t.after(()=>s.close());s.start();const epoch=randomUUID();s.sound.start(epoch);
 return {s,inputs,epoch,now:()=>at,advance:ms=>at+=ms};
}
function local(f,extra={}){f.advance(1000);const ticket=f.s.sound.begin({id:f.epoch,segmentId:randomUUID(),startedAt:f.now()-1000,endedAt:f.now()});return {ticket,event:f.s.sound.finish(ticket,{...sound,...extra})};}
function subscription(f,{text='합성 NPC 경고',revises=[],startedAt=f.now(),endedAt=f.now()+1000}={}){
 const id=randomUUID();f.s.sound.receiveSubscription({id,sessionId:f.s.sessionId,inputEpoch:f.epoch,text,capture:{startedAt,endedAt,voice:{inputSource:'system-output',sourceInputEpoch:f.epoch,revises}},witnesses:f.s.presentWitnesses()});return id;
}
function returnViewer(f){f.s.audience.setPresence('momo','away',f.now());f.advance(1000);f.s.audience.setPresence('momo','active',f.now());}

test('a returning viewer receives new local sound but no earlier-visit sound; continuous listeners keep the original',t=>{
 const f=fixture(t),{event}=local(f);const original=structuredClone(event);assert.equal(f.s.sound.context('momo').length,1);returnViewer(f);
 assert.deepEqual(f.s.sound.context('momo'),[]);assert.equal(f.s.sound.context('pop')[0].id,event.id);assert.deepEqual(event,original);
 const fresh=local(f,{systemSpeech:'재입장 이후 새 안내'}).event;assert.deepEqual(f.s.sound.context('momo').map(e=>e.id),[fresh.id]);
});

test('late classifier completion cannot give a returned viewer old audio in an actual Studio request',async t=>{
 const f=fixture(t);f.advance(1000);const ticket=f.s.sound.begin({id:f.epoch,segmentId:randomUUID(),startedAt:100000,endedAt:f.now()});returnViewer(f);const event=f.s.sound.finish(ticket,sound);assert.ok(event.witnesses.includes('momo'));
 f.advance(5000);await f.s.react({speech:'모모님 방금은 듣고 있나요'});const req=f.inputs[0];assert.ok(req.viewerContext.momo);
 assert.deepEqual(req.viewerContext.momo.heardSounds,[]);assert.equal(req.viewerContext.pop.heardSounds[0].id,event.id);assert.equal(req.speech,'모모님 방금은 듣고 있나요');
 assert.equal(f.s.messages.some(m=>m.text===sound.systemSpeech),false);
});

test('subscription dialogue and its correction respect the original visit without becoming microphone speech',t=>{
 const f=fixture(t),old=subscription(f);f.advance(1000);assert.equal(f.s.sound.context('momo')[0].systemSpeech,'합성 NPC 경고');returnViewer(f);
 assert.deepEqual(f.s.sound.context('momo'),[]);assert.equal(f.s.sound.context('pop')[0].id,old);
 const corrected=subscription(f,{text:'합성 NPC 정정',revises:[old],startedAt:100000,endedAt:101000});
 assert.deepEqual(f.s.sound.context('momo'),[]);assert.equal(f.s.sound.context('pop')[0].id,corrected);assert.equal(f.s.messages.length,0);
 const fresh=subscription(f,{text:'다시 입장한 뒤의 새 대사'});f.advance(1000);assert.equal(f.s.sound.context('momo')[0].id,fresh);
});

test('missing membership or unverifiable entry time cannot inherit retained sound',t=>{
 const f=fixture(t);local(f);for(const joinedAt of [undefined,NaN,Infinity]){f.s.audience.data.members.momo.joinedAt=joinedAt;assert.deepEqual(f.s.sound.context('momo'),[]);}
 delete f.s.audience.data.members.momo;assert.deepEqual(f.s.sound.context('momo'),[]);assert.equal(f.s.sound.context('pop').length,1);
});

test('current-visit filtering retains the four-event limit, freshness, silence and source stop boundaries',t=>{
 const f=fixture(t);for(let i=0;i<6;i++)local(f);const kept=f.s.sound.context('momo');assert.equal(kept.length,4);kept[0].classes[0].label='caller mutation';assert.equal(f.s.sound.context('momo')[0].classes[0].label,'Chime');
 local(f,{silent:true});assert.equal(f.s.sound.context('momo').length,4);f.advance(30000);assert.deepEqual(f.s.sound.context('momo'),[]);local(f);f.s.sound.stop();assert.deepEqual(f.s.sound.context('momo'),[]);
});

test('authenticated sound upload completed across a re-entry feeds only continuous listeners',async t=>{
 let resolveSound;const inputs=[];const service=await startServer({port:0,persist:false,localSpeech:false,soundWorker:{prepare:async()=>true,analyze:async()=>new Promise(resolve=>resolveSound=resolve),close(){}},provider:{status:()=>({configured:true}),react:async args=>{inputs.push(args);return {observation};}}});t.after(()=>service.close());const s=service.studio;clearInterval(s.timer);let at=100000;s.now=()=>at;seedMetAudience(s);s.configure({...s.settings,mode:'live',category:'just-chatting',lurkRatio:0,chatPace:8,slowModeSeconds:0,communityActivityEnabled:false});s.start();
 const epoch=randomUUID(),headers={'X-Backseat-Client':'studio',Authorization:'Bearer '+service.accessToken,'Content-Type':'application/json'};
 const response=await fetch(service.url+'/api/sound/connect',{method:'POST',headers,body:JSON.stringify({id:epoch})});assert.equal(response.status,200);at+=1000;
 const params=new URLSearchParams({segmentId:randomUUID(),startedAt:'100000',endedAt:'101000'});
 const pending=fetch(service.url+'/api/sound/'+epoch+'?'+params,{method:'POST',headers:{...headers,'Content-Type':'audio/webm'},body:Buffer.from('synthetic audio')});
 for(let i=0;i<200&&!resolveSound;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(resolveSound,'synthetic classifier was reached');
 s.audience.setPresence('momo','away',at);at+=1000;s.audience.setPresence('momo','active',at);resolveSound(sound);assert.equal((await pending).status,200);
 at+=5000;await s.react({speech:'모모님 다시 오셨네요'});const packet=inputs[0].viewerContext;assert.deepEqual(packet.momo.heardSounds,[]);assert.equal(packet.pop.heardSounds[0].systemSpeech,sound.systemSpeech);
 assert.equal(s.messages.some(m=>m.text===sound.systemSpeech),false);
});
