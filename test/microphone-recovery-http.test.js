import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {LocalSpeech} from '../server/local-speech.js';
import {startServer} from '../server/index.js';
import {seedMetAudience} from './helpers/met-audience.js';
const fixture=resolve('test/helpers/speech-recovery-process.cjs');
async function until(predicate,label){const deadline=Date.now()+4000;while(!predicate()){if(Date.now()>deadline)throw Error(label);await new Promise(r=>setTimeout(r,10));}}
async function open(t,{manual=false,timeout=2000}={}){
  const children=[],runs=[];
  const speech=new LocalSpeech({python:process.execPath},(_python,_args,options)=>{
    const child=spawn(process.execPath,[fixture],{...options,env:{...options.env,BACKSEAT_TEST_MANUAL_READY:manual?'1':'0'}});
    const run={pid:child.pid,startedAt:new Date().toISOString(),executable:process.execPath,fixture};runs.push(run);child.on('close',(code,signal)=>Object.assign(run,{code,signal,closedAt:new Date().toISOString()}));children.push(child);return child;
  },{startupTimeoutMs:5000,requestTimeoutMs:timeout});
  const service=await startServer({port:0,persist:false,speechWorker:speech,provider:{status:()=>({configured:true,kind:'synthetic'})}});
  let closed=false;const close=async()=>{if(!closed){closed=true;await service.close();}await until(()=>runs.every(r=>r.closedAt),'owned child remained alive');};t.after(close);
  clearInterval(service.studio.timer);seedMetAudience(service.studio);service.studio.configure({...service.studio.settings,mode:'live',category:'just-chatting'});service.studio.start();
  const headers={Authorization:'Bearer '+service.accessToken,'X-Backseat-Client':'studio'};
  const post=async(path,body,extra={})=>{const response=await fetch(service.url+'/api/'+path,{method:'POST',headers:{...headers,'Content-Type':'application/json',...extra.headers},...(body===undefined?{}:{body:JSON.stringify(body)}),...(extra.signal?{signal:extra.signal}:{})});return {status:response.status,body:await response.json()};};
  const audio=async text=>{const response=await fetch(service.url+'/api/audio',{method:'POST',headers:{...headers,'Content-Type':'audio/wav'},body:Buffer.from(text)});return {status:response.status,body:await response.json()};};
  return {...service,speech,children,runs,post,audio,close};
}

test('actual child crash and recovery preserve the live session, accepted speech and viewer state',{timeout:20000},async t=>{
  const s=await open(t);assert.equal((await s.post('audio/prepare')).status,200);
  const session=s.studio.sessionId,settings=structuredClone(s.studio.settings),wallet=s.studio.economy.data.balance;
  const first=await s.audio('첫 번째 합성 발언');assert.equal(first.body.text,'첫 번째 합성 발언');
  await s.post('speech',{id:randomUUID(),sessionId:session,text:first.body.text,source:'microphone'});
  const failed=await s.audio('crash');assert.equal(failed.status,409);assert.equal(failed.body.needsPreparation,true);assert.match(failed.body.error,/종료/);
  assert.equal(s.runs[0].code,17);assert.equal(s.speech.child,null);assert.equal(s.studio.audioBusy,false);assert.equal(s.studio.running,true);
  assert.equal((await s.post('audio/prepare')).status,200);assert.equal(s.children.length,2);assert.equal(s.studio.sessionId,session);
  assert.deepEqual(s.studio.settings,settings);assert.equal(s.studio.economy.data.balance,wallet);assert.equal(s.studio.messages.filter(m=>m.text==='첫 번째 합성 발언').length,1);
  const next=await s.audio('복구 후 합성 발언');assert.equal(next.status,200);assert.equal(next.body.text,'복구 후 합성 발언');
  const invalid=await s.audio('invalid');assert.equal(invalid.status,409);assert.equal(invalid.body.needsPreparation,undefined);assert.equal(s.speech.ready,true);
  assert.equal((await s.audio('잘못된 구간 다음 발언')).body.text,'잘못된 구간 다음 발언');assert.equal(s.children.length,2);
  await s.close();await mkdir('artifacts',{recursive:true});const folder=await mkdtemp(resolve('artifacts/microphone-process-'));
  await writeFile(resolve(folder,'result.json'),JSON.stringify({passed:true,synthetic:true,devices:false,model:false,runs:s.runs,sessionPreserved:true,invalidSegmentDidNotRestart:true},null,2));
});

test('HTTP preparation cancellation detaches only its caller and shared preparation spawns once',{timeout:15000},async t=>{
  const s=await open(t,{manual:true}),controller=new AbortController();
  const cancelled=s.post('audio/prepare',undefined,{signal:controller.signal}).then(()=>({unexpected:true}),error=>({error:error.name}));
  await until(()=>s.speech.waiters.size===1,'preparation request did not reach worker');controller.abort();assert.equal((await cancelled).error,'AbortError');
  await until(()=>s.speech.waiters.size===0,'cancelled waiter retained');assert.equal(s.children.length,1);assert.equal(s.children[0].exitCode,null);
  const first=s.post('audio/prepare'),second=s.post('audio/prepare');await until(()=>s.speech.waiters.size===2,'shared waiters not ready');
  s.children[0].stdin.write('{"control":"ready"}\n');assert.equal((await first).status,200);assert.equal((await second).status,200);assert.equal(s.children.length,1);
  const denied=await fetch(s.url+'/api/audio/prepare',{method:'POST',headers:{'X-Backseat-Client':'studio'}});assert.equal(denied.status,401);assert.equal(s.children.length,1);
});

test('hung real child is terminated and a replacement handles a new HTTP utterance',{timeout:15000},async t=>{
  const s=await open(t,{timeout:200});await s.post('audio/prepare');const session=s.studio.sessionId;
  const failure=await s.audio('hang');assert.equal(failure.status,409);assert.equal(failure.body.needsPreparation,true);assert.match(failure.body.error,/시간.*초과/);
  await until(()=>s.speech.child===null,'timed out child remained owned');await s.post('audio/prepare');assert.equal(s.children.length,2);
  assert.equal((await s.audio('시간 초과 복구')).body.text,'시간 초과 복구');assert.equal(s.studio.sessionId,session);assert.equal(s.studio.calls,0);
});
