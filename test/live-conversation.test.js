import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Studio} from '../server/studio.js';
import {Audience} from '../server/audience.js';
import {startServer} from '../server/index.js';
import {defaults} from '../shared/defaults.js';
import {Settings} from '../server/schema.js';
import {repeatedChat} from '../server/chat-quality.js';
import {SpeechOutbox} from '../src/speech-flow.ts';

const observation=(messages=[])=>({game:'Synthetic',scene:'합성 장면',confidence:.8,excitement:.2,messages});
const chat=(text,personaId='momo')=>({personaId,text,kind:'chat',spoiler:false});
const input=(s,text,id=randomUUID())=>({id,sessionId:s.sessionId,text});
function studio(t,react){let now=100000;const s=new Studio({settings:{...defaults,mode:'live',lurkRatio:0,slowModeSeconds:0,chatPace:8},audience:new Audience(undefined,()=>{},()=>.5),now:()=>now,random:()=>.5,provider:{status:()=>({configured:true}),react}});clearInterval(s.timer);s.start();t.after(()=>s.close());return {s,advance:()=>{now+=20000;}};}

test('punctuation, laughter and minor ending changes cannot repeat a recent long observation',()=>{
  const at=100000,history=[{...chat('눈이 정말 많이 쌓였네요 ㅋㅋ'),time:at}];
  for(const text of ['눈이 정말 많이 쌓였네요!','눈이 정말 많이 쌓였네요 ㅎㅎ','눈이 정말 많이 쌓였네'])assert.equal(repeatedChat(chat(text,'pop'),history,at+12000),true,text);
  assert.equal(repeatedChat(chat('눈이 정말 많이 쌓였네요!'),history,at+46000),false);
  assert.equal(repeatedChat(chat('보스 체력이 20까지 내려갔네요'),[{...chat('보스 체력이 30까지 내려갔네요'),time:at}],at+1000),false);
  assert.equal(repeatedChat(chat('이번에는 성공한 게 아니네요'),[{...chat('이번에는 성공한 게 맞네요'),time:at}],at+1000),false);
  assert.equal(repeatedChat(chat('전 저쪽 나무 색이 더 좋아요'),history,at+1000),false);
});

test('shared short cheers remain possible, while one person cannot spam the same cheer',()=>{
  const history=[{...chat('ㅋㅋㅋ'),time:100000}];assert.equal(repeatedChat(chat('ㅋㅋㅋ','pop'),history,101000),false);assert.equal(repeatedChat(chat('ㅋㅋㅋ'),history,101000),true);assert.equal(repeatedChat(chat('ㅋㅋㅋ'),history,109000),false);
  assert.equal(repeatedChat(chat('축하해요!','pop'),[{...chat('축하해요!'),time:100000}],101000),false);
});

test('live acceptance filters paraphrases in the same batch and across frames',async t=>{
  const {s,advance}=studio(t,async()=>({observation:observation([chat('눈이 정말 많이 쌓였네요 ㅋㅋ'),chat('눈이 정말 많이 쌓였네!','pop'),chat('ㅋㅋㅋ','gg')])}));
  // This checks repetition while the same viewers stay; departures have their
  // own coverage and must not randomly remove this test's second-frame speaker.
  await s.react({image:'snow-frame-one'});assert.equal(s.queue.length,2);advance();s.pump();s.pump();advance();await s.react({image:'snow-frame-two'});assert.equal(s.queue.filter(m=>m.text.startsWith('눈이')).length,0);assert.ok(s.queue.some(m=>m.text==='ㅋㅋㅋ'));
});

test('HTTP speech arrives while visual AI is blocked, cancels stale analysis and retries exactly once',async t=>{
  let rejectVisual,signalSeen;
  const service=await startServer({port:0,persist:false,localSpeech:false,provider:{status:()=>({configured:true}),react:(_args,signal)=>{signalSeen=signal;return new Promise((_resolve,reject)=>{rejectVisual=reject;signal.addEventListener('abort',()=>reject(new Error('cancelled visual request')),{once:true});});}}});t.after(()=>service.close());
  const s=service.studio;clearInterval(s.timer);s.configure({...s.settings,mode:'live'});s.start();
  const job=s.react({});assert.ok(rejectVisual);s.accept(observation([chat('이전 화면 설명')]),Date.now(),false,'live');s.queue.push({...chat('합의된 관객 행동'),origin:'contract',due:Date.now()+5000});
  const headers={'Content-Type':'application/json','X-Backseat-Client':'studio',Authorization:'Bearer '+service.accessToken},body=input(s,'조금 편하게 같이 보고 싶어요.');
  const send=body=>fetch(service.url+'/api/speech',{method:'POST',headers,body:JSON.stringify(body)});
  const first=await send(body);assert.equal(first.status,200);const receipt=await first.json();
  assert.equal(s.messages.filter(m=>m.kind==='streamer').length,1);assert.equal(s.journal.data.entries[0].text,body.text);assert.equal(signalSeen.aborted,true);
  assert.deepEqual(await job,{skipped:'superseded'});assert.equal(s.failures,0);assert.equal(s.retryAt,0);assert.equal(s.calls,1);assert.equal(s.speechInbox.pending.length,1);
  assert.deepEqual(s.queue.map(m=>m.text),['합의된 관객 행동']);
  assert.equal((await(await send(body)).json()).messageId,receipt.messageId);assert.equal(s.messages.filter(m=>m.kind==='streamer').length,1);
  assert.equal((await send({...body,text:'ID를 재사용한 다른 발언'})).status,409);
  assert.equal((await send({...body,id:randomUUID(),sessionId:randomUUID()})).status,409);
});

test('speech arriving during a spoken response is not lost or duplicated and does not starve responses',async t=>{
  const jobs=[],calls=[],{s,advance}=studio(t,(args,signal)=>new Promise(resolve=>{calls.push(args.speech);jobs.push({resolve,signal});}));
  const first=input(s,'첫 번째 이야기');s.receiveSpeech(first);const job=s.react({});assert.equal(calls[0],first.text);
  const second=input(s,'다음 이야기');s.receiveSpeech(second);assert.equal(jobs[0].signal.aborted,false);assert.equal(s.messages.filter(m=>m.kind==='streamer').length,2);
  jobs.shift().resolve({observation:observation([chat('첫 이야기를 들은 반응')])});await job;assert.deepEqual(s.speechInbox.pending.map(m=>m.text),[second.text]);
  advance();const next=s.react({});assert.equal(calls[1],second.text);jobs.shift().resolve({observation:observation()});await next;
  assert.equal(s.speechInbox.pending.length,0);s.receiveSpeech(first);assert.equal(s.messages.filter(m=>m.kind==='streamer').length,2);
});

test('failed responses retain pending speech, and deleting a pending utterance cannot resurrect it',async t=>{
  const {s,advance}=studio(t,async()=>{throw new Error('synthetic provider failure');});const body=input(s,'전달된 원문');const receipt=s.receiveSpeech(body);
  await assert.rejects(s.react({}),/synthetic/);assert.equal(s.speechInbox.pending.length,1);advance();await assert.rejects(s.react({}),/synthetic/);assert.equal(s.messages.filter(m=>m.kind==='streamer').length,1);
  s.moderate('delete',receipt.messageId);s.receiveSpeech(body);assert.equal(s.speechInbox.pending.length,0);assert.equal(s.journal.data.entries.length,0);
  s.stop();assert.throws(()=>s.receiveSpeech(input(s,'종료 후 발언')),/끝난 방송/);
});

test('speech outbox transmits independently, preserves retry identity and clears late session work',async()=>{
  let serial=0;const box=new SpeechOutbox(()=>String(++serial));box.add('먼저 전달','session');let release;
  const sent=[],first=box.flush(async item=>{sent.push({...item});await new Promise(resolve=>release=resolve);throw new Error('uncertain receipt');});box.add('뒤에 전달','session');
  assert.equal(sent[0].text,'먼저 전달');release();await assert.rejects(first,/uncertain/);assert.equal(box.items.length,2);
  await box.flush(async item=>sent.push({...item}));assert.deepEqual(sent.map(e=>e.id),['1','1','2']);assert.equal(box.items.length,0);
  box.add('이전 방송','old');let staleSignal;const old=box.flush(async(_item,signal)=>{staleSignal=signal;await new Promise(resolve=>release=resolve);});box.clear();box.add('새 방송','new');assert.equal(staleSignal.aborted,true);release();await old;assert.equal(box.items[0].text,'새 방송');
  await box.flush(async()=>{});box.add('😀'.repeat(1600),'new');assert.equal(box.items.length,2);assert.ok(box.items.every(e=>e.text.length<=3000&&e.text.isWellFormed()));
});

test('display preference changes while live and busy, survives restart, and never deletes speech',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'backseat-display-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const boot=()=>startServer({port:0,dataDir:dir,localSpeech:false,provider:{status:()=>({configured:true})}});
  let service=await boot();t.after(()=>service.close());const s=service.studio;s.configure({...s.settings,mode:'live'});s.start();s.receiveSpeech(input(s,'화면에서 숨길 원문'));const original=s.journal.data.entries.map(e=>e.text);s.busy=true;
  const headers={'Content-Type':'application/json','X-Backseat-Client':'studio',Authorization:'Bearer '+service.accessToken};
  const response=await fetch(service.url+'/api/chat/display',{method:'POST',headers,body:JSON.stringify({showStreamerMessages:false})});assert.equal(response.status,200);assert.equal(s.settings.showStreamerMessages,false);assert.equal(s.running,true);assert.equal(s.calls,0);assert.deepEqual(s.journal.data.entries.map(e=>e.text),original);assert.equal(s.speechInbox.pending.length,1);
  const invalid=await fetch(service.url+'/api/chat/display',{method:'POST',headers,body:JSON.stringify({showStreamerMessages:true,mode:'rehearsal'})});assert.equal(invalid.status,400);assert.equal(s.settings.showStreamerMessages,false);
  await service.close();service=await boot();assert.equal(service.studio.settings.showStreamerMessages,false);assert.deepEqual(service.studio.journal.data.entries.map(e=>e.text),original);
  const legacy={...defaults};delete legacy.showStreamerMessages;assert.equal(Settings.parse(legacy).showStreamerMessages,true);
});

test('failed display save leaves the visible preference and conversation unchanged',t=>{
  const {s}=studio(t,async()=>({observation:observation()}));s.persist=()=>{throw new Error('disk full');};s.receiveSpeech(input(s,'보존할 발언'));assert.throws(()=>s.setChatDisplay(false),/disk full/);assert.equal(s.settings.showStreamerMessages,true);assert.equal(s.messages[0].text,'보존할 발언');
});
