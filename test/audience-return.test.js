import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Audience} from '../server/audience.js';
import {Studio} from '../server/studio.js';
import {Settings} from '../server/schema.js';
import {defaults} from '../shared/defaults.js';
import {temporalVideo} from '../server/temporal-video.js';
import {retainPresentReactions} from '../server/live-presence.js';
import {SpeechInbox} from '../server/speech-inbox.js';
import {startServer} from '../server/index.js';
import {seedMetAudience} from './helpers/met-audience.js';
import {mkdir,mkdtemp} from 'node:fs/promises';
import {join,resolve} from 'node:path';

const settings=()=>Settings.parse({...defaults,mode:'live',lurkRatio:0,slowModeSeconds:0,intervalSeconds:5,chatPace:3,personas:defaults.personas.filter(p=>['momo','new','luna'].includes(p.id))});
const obs=(extra={})=>({game:'Test',scene:'합성 장면',confidence:.9,excitement:.3,messages:[],...extra});
function randoms(a,values){let i=0;a.random=()=>values[i++]??.5;}
function fixture(t,react){let at=100000;const inputs=[];const s=new Studio({settings:settings(),now:()=>at,random:()=>.5,audience:new Audience(undefined,()=>{},()=>.5),provider:{status:()=>({configured:true}),react:async(args,signal)=>{inputs.push(args);return react?react(args,signal):{observation:obs()};}}});clearInterval(s.timer);s.start();t.after(()=>s.close());return {s,inputs,advance:ms=>at+=ms,at:()=>at};}
function returnNew(f){f.advance(10000);randoms(f.s.audience,[.5,0,.5,.5]);f.s.tickAudience();assert.equal(f.s.audience.presence.new,'active');}

test('calling an absent viewer does not wake them or improve a relationship; a lurker can hear their name',()=>{
 const a=new Audience(undefined,()=>{},()=>.5),cfg=settings();a.start(cfg,100000);a.presence.momo='away';const before=structuredClone(a.data.members.momo);
 assert.ok(!a.context(cfg,'모모님 계세요?').eligible.includes('momo'));assert.equal(a.presence.momo,'away');assert.deepEqual(a.data.members.momo,before);
 a.presence.momo='lurking';assert.ok(a.context(cfg,'모모님 계세요?').eligible.includes('momo'));assert.equal(a.presence.momo,'active');assert.equal(a.data.members.momo.joinedAt,100000);
});

test('natural return starts a new viewing interval without counting the same broadcast twice',()=>{
 const a=new Audience(undefined,()=>{},()=>.5),cfg=settings();a.start(cfg,100000);const sessions=a.data.members.new.sessions;
 a.presence.new='away';randoms(a,[.5,0,.5,.5]);a.tick(cfg,120000);
 assert.equal(a.presence.new,'active');assert.equal(a.data.members.new.joinedAt,120000);assert.equal(a.data.members.new.sessions,sessions);assert.equal(a.data.members.new.seconds,0);
 const sessionId=randomUUID(),sourceId=randomUUID();const video={sessionId,sourceId,frames:[{at:119500,image:'before'},{at:120000,image:'after'}]};
 assert.deepEqual(temporalVideo(video,{now:120000,sessionId,startedAt:100000,joinedAt:[a.data.members.new.joinedAt]}).frames.map(f=>f.image),['after']);
});

test('a known viewer arriving later in a new broadcast gains that visit and becomes a valid witness',()=>{
 const a=new Audience(undefined,()=>{},()=>.5),cfg=settings();a.start(cfg,100000);a.stop();a.autonomous=true;a.random=()=>.99;a.start(cfg,200000);
 assert.equal(a.presence.new,'away');randoms(a,[.5,0,.5,.5]);a.tick(cfg,210000);
 assert.equal(a.presence.new,'active');assert.equal(a.data.members.new.joinedAt,210000);assert.equal(a.data.members.new.sessions,2);
});

test('unban during a live broadcast does not restore the blocked viewing interval',t=>{
 const f=fixture(t);f.s.moderate('ban','new');f.advance(5000);f.s.addMessage('streamer','부재중 비밀');f.advance(5000);f.s.moderate('unban','new');
 assert.equal(f.s.audience.presence.new,'active');assert.equal(f.s.audience.data.members.new.joinedAt,f.at());
});

test('an absent viewer cannot publish an earlier queued reaction, even after returning',async t=>{
 const f=fixture(t,async()=>({observation:obs({messages:[{personaId:'new',text:'지금 그거다',kind:'chat',spoiler:false}]})}));await f.s.react({speech:'지금 보세요'});assert.equal(f.s.queue.length,1);
 f.s.audience.presence.new='away';returnNew(f);f.s.pump();assert.equal(f.s.messages.some(m=>m.personaId==='new'),false);assert.equal(f.s.queue.length,0);
});

test('departing during inference revokes social actions but preserves the actual captured scene witness',async t=>{
 let release;const f=fixture(t,()=>new Promise(r=>release=r));const pending=f.s.react({image:'image',speech:'지금 보세요'});
 f.s.audience.presence.new='away';f.advance(1000);
 release({observation:obs({messages:[{personaId:'new',text:'돌아왔어요!',kind:'chat',spoiler:false}],positiveMoment:{positive:true,impact:1,reason:'순간',signature:'moment',supporters:['new'],donations:[{personaId:'new',message:'응원',anonymous:false}]},clipPicks:[{personaId:'new',title:'고른 장면',reason:'개인 선택',signature:'pick'}]})});
 await pending;assert.equal(f.s.queue.length,0);assert.equal(f.s.observation.positiveMoment.positive,false);assert.equal(f.s.clips.list().length,0);
 assert.ok(f.s.knowledge.get('Test').observations[0].witnesses.includes('new'));
});

test('queued speech is sent only to people who received it, including keyboard speech',async t=>{
 const f=fixture(t);f.s.audience.presence.new='away';const id=randomUUID();f.s.receiveSpeech({id,sessionId:f.s.sessionId,text:'대기 중인 질문',source:'keyboard'});
 returnNew(f);await f.s.react({});assert.ok(!f.inputs[0].settings.personas.some(p=>p.id==='new'));assert.ok(f.inputs[0].settings.personas.some(p=>p.id==='momo'));
 assert.deepEqual(f.inputs[0].liveSpeech[0].hearers,['momo','luna']);assert.equal(f.s.speechInbox.pending.length,0);
});

test('late transcription cannot give a returned viewer an unheard line in live history or durable recall',async t=>{
 const f=fixture(t);f.s.audience.presence.new='away';const capture={startedAt:f.at()+1000,endedAt:f.at()+2000};returnNew(f);f.advance(1000);
 f.s.receiveSpeech({id:randomUUID(),sessionId:f.s.sessionId,text:'합성 암호는 초록피아노예요',source:'microphone',capture});
 assert.ok(!f.s.journal.data.entries[0].witnesses.includes('new'));
 await f.s.react({});f.advance(6000);await f.s.react({speech:'오늘처음옴님, 방금 암호 들었어요?'});
 const packet=f.inputs.at(-1).viewerContext.new;assert.ok(packet);assert.ok(!JSON.stringify(packet).includes('초록피아노'));assert.ok(!f.s.journal.recall('new','초록피아노').some(e=>e.text.includes('초록피아노')));
});

test('continuous listeners keep pre-absence witnessed memories and lurking does not reset entry',async t=>{
 const f=fixture(t);f.s.addMessage('streamer','우리 정원의 이름은 구름정원');f.s.audience.presence.new='away';returnNew(f);f.advance(6000);
 await f.s.react({speech:'오늘처음옴님, 정원 이름 기억해요?'});const packet=f.inputs[0].viewerContext.new;
 assert.equal(packet.chatHistory.some(m=>m.text.includes('구름정원')),false);assert.ok(packet.recollections.some(m=>m.text.includes('구름정원')));
 const joined=f.s.audience.data.members.new.joinedAt;f.s.audience.presence.new='lurking';f.advance(6000);await f.s.react({speech:'오늘처음옴님, 듣고 있죠?'});assert.equal(f.s.audience.data.members.new.joinedAt,joined);
});

test('presence transitions publish state even when they produce no notice chat',t=>{
 const f=fixture(t);let published=0;f.s.on('state',()=>published++);f.advance(10000);randoms(f.s.audience,[.5,0,.5,0]);f.s.tickAudience();
 assert.equal(f.s.audience.presence.new,'away');assert.ok(published>0);assert.equal(f.s.messages.length,0);
});

test('a queued message is dropped while away, before any return',async t=>{
 const f=fixture(t,async()=>({observation:obs({messages:[{personaId:'new',text:'바로 이거',kind:'chat',spoiler:false}]})}));await f.s.react({speech:'지금 보세요'});
 f.s.audience.presence.new='away';f.advance(3000);f.s.pump();assert.equal(f.s.queue.length,0);assert.ok(!f.s.messages.some(m=>m.personaId==='new'));
});

test('returning during inference cannot restore an earlier visit but other viewers keep their reactions',t=>{
 const f=fixture(t),visits=new Map(['momo','new'].map(id=>[id,f.s.audience.data.members[id].joinedAt]));f.s.audience.presence.new='away';returnNew(f);
 const value=obs({messages:['momo','new'].map(personaId=>({personaId,text:'오오',kind:'chat',spoiler:false})),clipPicks:['momo','new'].map(personaId=>({personaId,title:'제목',reason:'개인 선택',signature:'pick'})),positiveMoment:{positive:true,impact:.9,reason:'성공',signature:'win',supporters:['momo','new'],donations:['momo','new'].map(personaId=>({personaId,message:'응원',anonymous:true}))}});
 const kept=retainPresentReactions(value,visits,f.s.audience);assert.deepEqual(kept.messages.map(m=>m.personaId),['momo']);assert.deepEqual(kept.clipPicks.map(m=>m.personaId),['momo']);assert.deepEqual(kept.positiveMoment.supporters,['momo']);assert.equal(kept.positiveMoment.positive,true);assert.equal(value.messages.length,2);
});

test('old and newly heard questions keep separate ordered batches across an arrival',async t=>{
 const f=fixture(t);f.s.audience.presence.new='away';
 f.s.receiveSpeech({id:randomUUID(),sessionId:f.s.sessionId,text:'먼저 계셨던 분들에게 하는 질문'});returnNew(f);
 f.s.receiveSpeech({id:randomUUID(),sessionId:f.s.sessionId,text:'오늘처음옴님, 지금은 들려요?'});
 await f.s.react({});assert.equal(f.inputs[0].speech,'먼저 계셨던 분들에게 하는 질문');assert.ok(!f.inputs[0].settings.personas.some(p=>p.id==='new'));assert.equal(f.s.speechInbox.pending.length,1);
 f.advance(6000);await f.s.react({});assert.equal(f.inputs[1].speech,'오늘처음옴님, 지금은 들려요?');assert.ok(f.inputs[1].settings.personas.some(p=>p.id==='new'));assert.equal(f.s.speechInbox.pending.length,0);
});

test('speech retries retain original hearers and batching ignores ordering of the same set',()=>{
 const inbox=new SpeechInbox();let count=0;const publish=()=>({id:'m'+count++}),id=randomUUID();inbox.receive(id,'먼저',publish,'keyboard',undefined,['momo','new']);
 inbox.receive(id,'먼저',publish,'keyboard',undefined,['new']);const second=randomUUID();inbox.receive(second,'다음',publish,'keyboard',undefined,['new','momo']);
 assert.deepEqual(inbox.batch().ids,[id,second]);assert.deepEqual(inbox.sources([id])[0].hearers,['momo','new']);assert.equal(count,2);
 const source=inbox.sources([id]);source[0].hearers.push('unheard');assert.ok(!inbox.hearers([id]).includes('unheard'));
});

test('returning after a system sound segment began does not add the viewer as a listener',t=>{
 const f=fixture(t),id=randomUUID();f.s.sound.start(id);f.s.audience.presence.new='away';returnNew(f);
 const ticket=f.s.sound.begin({id,segmentId:randomUUID(),startedAt:100500,endedAt:108000});assert.ok(!ticket.witnesses.includes('new'));assert.ok(ticket.witnesses.includes('momo'));
});

test('HTTP unban and delayed microphone receipt preserve hearing bounds after a disk restart',async t=>{
 await mkdir('artifacts',{recursive:true});const dataDir=await mkdtemp(join(resolve('artifacts'),'return-http-'));let at=100000,packet;
 const provider={status:()=>({configured:true}),react:async args=>{packet=args;return {observation:obs()};}};let service=await startServer({port:0,dataDir,provider,localSpeech:false});t.after(()=>service?.close());
 const setup=s=>{clearInterval(s.timer);s.now=()=>at;s.audience.random=()=>0;s.start();s.audience.random=()=>.5;s.autonomy.nextCheck=Infinity;};
 const s=service.studio;seedMetAudience(s);s.configure({...s.settings,mode:'live',category:'just-chatting',lurkRatio:0});setup(s);
 const post=async(path,body)=>{const response=await fetch(service.url+'/api/'+path,{method:'POST',headers:{Authorization:'Bearer '+service.accessToken,'Content-Type':'application/json','X-Backseat-Client':'studio'},body:JSON.stringify(body)});assert.equal(response.status,200);return response.json();};
 await post('moderate',{action:'ban',id:'new'});at+=10000;await post('moderate',{action:'unban',id:'new'});assert.equal(s.audience.data.members.new.joinedAt,110000);
 at+=1000;await post('speech',{id:randomUUID(),sessionId:s.sessionId,text:'합성 암호는 보라다람쥐',source:'microphone',capture:{startedAt:101000,endedAt:102000}});
 assert.ok(!s.journal.data.entries[0].witnesses.includes('new'));assert.ok(s.journal.data.entries[0].witnesses.includes('momo'));
 await service.close();service=await startServer({port:0,dataDir,provider,localSpeech:false});at+=10000;setup(service.studio);
 await post('react',{speech:'오늘처음옴님, 부재중에 나온 암호 알아요?'});assert.ok(packet.viewerContext.new);assert.ok(!JSON.stringify(packet.viewerContext.new).includes('보라다람쥐'));assert.ok(service.studio.journal.recall('momo','보라다람쥐').some(e=>e.text.includes('보라다람쥐')));
});
