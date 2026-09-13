import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {ClipUploads} from '../src/clip-uploads.ts';

const T=1_000_000;
const candidate=(id='clip-1',extra={})=>({id,source:'spectator',sessionId:'a',video:false,createdAt:T,observedAt:T-5000,...extra});
const recording={blob:new Blob(['self-contained recording']),startedAt:T-10_000,endedAt:T,hasAudio:true,sessionId:'a'};
const ok=(id='clip-1',video=true)=>Response.json({id,video});
async function until(predicate){for(let n=0;n<150;n++){if(predicate())return;await delay(5);}assert.ok(predicate(),'condition did not complete');}
function make(options={}){const errors=[],calls=[];const q=new ClipUploads({sessionId:'a',now:()=>T,takeAt:async()=>recording,allowed:()=>true,onError:m=>errors.push(m),retryDelays:[0,0],request:async(path,init)=>{calls.push({path,init});return ok();},...options});return {q,errors,calls};}

test('repeat state publications and simultaneous candidates upload each clip once',async t=>{
  let resolveFirst;const first=new Promise(r=>resolveFirst=r);const calls=[];
  const {q}=make({request:async(path,init)=>{calls.push({path,init});if(calls.length===1)await first;return ok(path.split('/')[3]);}});t.after(()=>q.dispose());
  const list=[candidate(),candidate('clip-2')];q.add(list);q.add(list);await until(()=>calls.length===1);
  resolveFirst();await until(()=>calls.length===2);q.add(list);await delay(15);
  assert.equal(calls.length,2);assert.ok(calls.every(c=>c.init.body===recording.blob));
});
test('failed transport retries the same recording after confirming it is not saved',async t=>{
  const methods=[],bodies=[];let posts=0;
  const {q,errors}=make({request:async(_path,init)=>{methods.push(init.method||'GET');if(!init.method)return ok('clip-1',false);bodies.push(init.body);if(++posts===1)throw new Error('connection reset');return ok();}});t.after(()=>q.dispose());
  q.add([candidate()]);await until(()=>posts===2);assert.deepEqual(methods,['POST','GET','POST']);assert.equal(bodies[0],bodies[1]);assert.deepEqual(errors,[]);
});
test('lost response after server commit is confirmed without a duplicate POST',async t=>{
  const methods=[];const {q,errors}=make({request:async(_path,init)=>{methods.push(init.method||'GET');if(init.method)throw new Error('response lost');return ok();}});t.after(()=>q.dispose());
  q.add([candidate()]);await until(()=>methods.length===2);await delay(15);
  assert.deepEqual(methods,['POST','GET']);assert.deepEqual(errors,[]);
});
test('permanent failure has bounded retries and one error, not an SSE retry storm',async t=>{
  let posts=0;const {q,errors}=make({request:async(_path,init)=>{if(init.method)posts++;return Response.json({error:'disk full'},{status:409});}});t.after(()=>q.dispose());
  q.add([candidate()]);await until(()=>errors.length===1);for(let i=0;i<10;i++)q.add([candidate()]);await delay(15);
  assert.equal(posts,3);assert.equal(errors.length,1);assert.match(errors[0],/장면 기록은 저장/);
});
test('revoking consent while waiting for the segment sends nothing',async t=>{
  let allowed=true,resolve;const waiting=new Promise(r=>resolve=r);
  const {q,calls,errors}=make({allowed:()=>allowed,takeAt:()=>waiting});t.after(()=>q.dispose());
  q.add([candidate()]);allowed=false;resolve(recording);await delay(15);assert.equal(calls.length,0);assert.deepEqual(errors,[]);
});
test('dispose aborts in-flight transport and prevents retry or obsolete errors',async()=>{
  let signal;const {q,errors}=make({request:(_path,init)=>{signal=init.signal;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));}});
  q.add([candidate()]);await until(()=>signal);q.dispose();await delay(15);assert.equal(signal.aborted,true);assert.deepEqual(errors,[]);
});
test('hung transport times out and bounded retry settles with one error',async t=>{
  let aborted=0;const {q,errors}=make({timeoutMs:5,request:(_path,init)=>new Promise((_,reject)=>init.signal.addEventListener('abort',()=>{aborted++;reject(new Error('timeout'));},{once:true}))});t.after(()=>q.dispose());
  q.add([candidate()]);await until(()=>errors.length===1);assert.equal(aborted,6);assert.equal(errors.length,1);
});
test('missing, expired and different-session media cannot be uploaded',async t=>{
  for(const value of [null,{...recording,sessionId:'other'},{...recording,endedAt:T-120001}]){
    const {q,calls}=make({takeAt:async()=>value});t.after(()=>q.dispose());q.add([candidate()]);await delay(10);assert.equal(calls.length,0);
  }
});
test('only recent unsaved spectator picks in this session are eligible',async t=>{
  const {q,calls}=make();t.after(()=>q.dispose());q.add([candidate('manual',{source:'manual'}),candidate('other',{sessionId:'b'}),candidate('saved',{video:true}),candidate('old',{createdAt:T-120001})]);await delay(10);assert.equal(calls.length,0);
});
test('deleting a pick while awaiting its segment cancels its eventual upload',async t=>{
  let resolve;const {q,calls}=make({takeAt:()=>new Promise(r=>resolve=r)});t.after(()=>q.dispose());
  q.add([candidate()]);q.add([]);resolve(recording);await delay(15);assert.equal(calls.length,0);
});
test('a saved queued pick is removed when the server publishes its newer state',async t=>{
  let resolve;const first=new Promise(r=>resolve=r);let takes=0;
  const {q,calls}=make({takeAt:async()=>{takes++;if(takes===1)await first;return recording;}});t.after(()=>q.dispose());
  q.add([candidate(),candidate('clip-2')]);q.add([candidate(),candidate('clip-2',{video:true})]);resolve();await until(()=>calls.length===1);await delay(15);assert.equal(takes,1);assert.equal(calls.length,1);
});
