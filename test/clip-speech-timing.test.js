import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {VoiceBoundary,SpeechOutbox} from '../src/speech-flow.ts';
import {SpeechInbox} from '../server/speech-inbox.js';
import {Clips,ClipFeatures} from '../server/clips.js';
import {Observation} from '../server/schema.js';
import {startServer} from '../server/index.js';
import {seedMetAudience} from './helpers/met-audience.js';
import {defaults} from '../shared/defaults.js';
const T=1_000_000;

test('voice range excludes leading/trailing silence and does not use recognition completion time',()=>{
  const voice=new VoiceBoundary(1000);for(let at=1050;at<=1500;at+=50)voice.sample(0,at);for(let at=1550;at<=1900;at+=50)voice.sample(.1,at);for(let at=1950;at<=2350;at+=50)voice.sample(0,at);
  assert.equal(voice.hasSpeech,true);assert.deepEqual(voice.capture(T),{startedAt:T+500,endedAt:T+900});
  assert.equal(new VoiceBoundary(1000).capture(T),undefined);
});
test('outbox preserves captured bounds across a lost response and protects them from caller mutation',async()=>{
  const capture={startedAt:T,endedAt:T+1000},outbox=new SpeechOutbox(()=>randomUUID());outbox.add('음성 발언','a','microphone',capture);capture.endedAt=T+99999;
  let original;await assert.rejects(outbox.flush(async item=>{original=structuredClone(item);throw Error('lost');}),/lost/);
  await outbox.flush(async item=>assert.deepEqual(item,original));assert.equal(original.capture.endedAt,T+1000);assert.equal(outbox.items.length,0);
  outbox.add('키보드','a','keyboard',capture);assert.equal(outbox.items[0].capture,undefined);
});
test('capture and text share an immutable receipt, and deleted speech drops its recording reference',()=>{
  const inbox=new SpeechInbox(),id=randomUUID(),capture={startedAt:T,endedAt:T+1000};let publishes=0;
  const publish=()=>({id:'message-'+(++publishes)});
  inbox.receive(id,'발언',publish,'microphone',capture,['momo']);const sources=inbox.sources([id]);sources[0].capture.endedAt=0;sources[0].hearers.push('new');
  assert.equal(inbox.sources([id])[0].capture.endedAt,T+1000);assert.deepEqual(inbox.sources([id])[0].hearers,['momo']);
  assert.equal(inbox.receive(id,'발언',publish,'microphone',{endedAt:T+1000,startedAt:T},['new']).duplicate,true);assert.equal(publishes,1);
  assert.throws(()=>inbox.receive(id,'발언',publish,'microphone',{startedAt:T,endedAt:T+2000}),/내용이 달라/);
  inbox.forget('message-1');assert.deepEqual(inbox.sources([id]),[]);inbox.receive(id,'발언',publish,'microphone',capture);assert.deepEqual(inbox.sources([id]),[]);
});
test('explicit empty clip source fields are accepted for older and visual picks',()=>{
  const base={game:'Test',scene:'Test',confidence:.8,excitement:0,messages:[],clipPicks:[{personaId:'momo',title:'제목',reason:'이유',signature:'식별',soundId:'',speechId:''}]};
  assert.equal(Observation.parse(base).clipPicks[0].speechId,'');delete base.clipPicks[0].speechId;assert.equal(Observation.parse(base).clipPicks[0].speechId,'');
});
test('choosing one of two delayed utterances attaches that utterance and retains its late transcript',()=>{
  const clips=new Clips({now:()=>T}),personas=defaults.personas.filter(p=>['momo','new'].includes(p.id));
  const studio={settings:{...defaults,mode:'live',autoHighlights:true,personas},running:true,sessionId:'a',startedAt:T-120000,now:()=>T,messages:[{id:'first',time:T-1000,text:'먼저 한 농담'},{id:'second',time:T,text:'두 번째 발언'}],log(){},publish(){}};
  const sources=[{messageId:'first',source:'microphone',capture:{startedAt:T-90000,endedAt:T-86000},hearers:['momo']},{messageId:'second',source:'microphone',capture:{startedAt:T-10000,endedAt:T-6000},hearers:['momo','new']}];
  const observation={game:'Just Chatting',scene:'현재의 다른 화면',confidence:.8,clipPicks:[{personaId:'momo',title:'첫 농담',reason:'앞의 농담이 좋았다',signature:'first',speechId:'first'}]};
  const [clip]=new ClipFeatures(studio,clips).spectatorPicks(observation,{image:'data:image/png;base64,dGVzdA==',speech:'먼저 한 농담\n두 번째 발언',witnesses:['momo','new'],capturedAt:T,liveSpeech:sources});
  assert.equal(clip.observedAt,T-88000);assert.equal(clip.audioEligible,true);assert.deepEqual(clip.participants.map(p=>p.id),['momo']);assert.deepEqual(clip.messages.map(m=>m.id),['first']);assert.equal(clip.thumbnail,null);assert.equal(clip.scene,observation.clipPicks[0].reason);
});
test('new listeners and conflicting or missing source IDs cannot choose an old utterance',()=>{
  for(const change of [{personaId:'new'},{speechId:'missing'},{soundId:'both'}]){
    const clips=new Clips(),studio={settings:{...defaults,mode:'live',autoHighlights:true},running:true,sessionId:'a',now:()=>T,messages:[],log(){},publish(){}};
    const observation={confidence:.8,clipPicks:[{personaId:'momo',title:'선택',reason:'이유',signature:'test',speechId:'old',...change}]};
    assert.deepEqual(new ClipFeatures(studio,clips).spectatorPicks(observation,{speech:'발언',witnesses:['momo','new'],capturedAt:T,liveSpeech:[{messageId:'old',source:'microphone',capture:{startedAt:T-10000,endedAt:T-9000},hearers:['momo']}]}),[]);
  }
});
test('actual speech endpoint and Studio carry original microphone time through a delayed provider',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'backseat-clip-speech-'));let time=T,seen;
  const service=await startServer({port:0,dataDir:dir,localSpeech:false,provider:{status:()=>({configured:true}),react:async args=>{seen=args;time+=45000;return {observation:{game:'Just Chatting',scene:'나중에 본 장면',confidence:.1,excitement:.2,messages:[],clipPicks:[{personaId:'momo',title:'방금 농담',reason:'웃긴 말실수',signature:'slip',soundId:'',speechId:args.liveSpeech[0].messageId}]}};}}});
  t.after(async()=>{await service.close();await rm(dir,{recursive:true,force:true});});const s=service.studio;clearInterval(s.timer);s.now=()=>time;s.clips.now=()=>time;seedMetAudience(s);s.configure({...s.settings,mode:'live',category:'just-chatting',autoHighlights:true,lurkRatio:0});s.start();time+=40000;
  const capture={startedAt:T+5000,endedAt:T+9000};
  const headers={Authorization:'Bearer '+service.accessToken,'X-Backseat-Client':'studio','Content-Type':'application/json'};
  const body={id:randomUUID(),sessionId:s.sessionId,text:'순간 말실수했네',source:'microphone',capture};
  const response=await fetch(service.url+'/api/speech',{method:'POST',headers,body:JSON.stringify(body)});assert.equal(response.status,200);await response.arrayBuffer();
  const result=await s.react({});assert.equal(result.ok,true);assert.deepEqual(seen.liveSpeech[0].capture,capture);assert.ok(seen.liveSpeech[0].hearers.includes('momo'));
  const clip=s.clips.list()[0];assert.ok(clip);assert.equal(clip.observedAt,T+7000);assert.equal(clip.createdAt,T+85000);assert.equal(clip.audioEligible,true);assert.equal(s.clips.get(clip.id).messages[0].text,body.text);
  const invalid=await fetch(service.url+'/api/speech',{method:'POST',headers,body:JSON.stringify({...body,id:randomUUID(),capture:{startedAt:T-9000,endedAt:T-8000}})});assert.equal(invalid.status,409);await invalid.arrayBuffer();
});
test('deleting speech during model inference prevents its recording reference from making a clip',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'backseat-clip-forget-'));let time=T,release,sourceId;
  const service=await startServer({port:0,dataDir:dir,localSpeech:false,provider:{status:()=>({configured:true}),react:args=>{sourceId=args.liveSpeech[0].messageId;return new Promise(resolve=>release=resolve);}}});
  t.after(async()=>{await service.close();await rm(dir,{recursive:true,force:true});});const s=service.studio;clearInterval(s.timer);s.now=()=>time;seedMetAudience(s);s.configure({...s.settings,mode:'live',category:'just-chatting',autoHighlights:true,lurkRatio:0});s.start();time+=30000;
  s.receiveSpeech({id:randomUUID(),sessionId:s.sessionId,text:'삭제할 합성 발언',source:'microphone',capture:{startedAt:T+1000,endedAt:T+5000}});
  const pending=s.react({});assert.ok(release);s.moderate('delete',sourceId);
  release({observation:{game:'Just Chatting',scene:'삭제된 발언',confidence:.1,excitement:.1,messages:[],clipPicks:[{personaId:'momo',title:'남기기',reason:'삭제된 말',signature:'deleted',speechId:sourceId}]}});await pending;assert.deepEqual(s.clips.list(),[]);
});
