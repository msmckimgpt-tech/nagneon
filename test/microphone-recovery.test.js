import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {LocalSpeech} from '../server/local-speech.js';

function rig(t){
  let at=0,serial=0;const tasks=new Map(),children=[];
  const clock={setTimeout(fn,ms){const id=++serial;tasks.set(id,{fn,at:at+ms});return id;},clearTimeout(id){tasks.delete(id);}};
  const advance=ms=>{at+=ms;for(const [id,task] of [...tasks])if(task.at<=at){tasks.delete(id);task.fn();}};
  const worker=new LocalSpeech({python:process.execPath},()=>{
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.sent=[];child.kills=0;
    child.stdin.on('data',data=>child.sent.push(JSON.parse(String(data))));child.kill=()=>{child.kills++;return true;};
    child.emitValue=value=>child.stdout.write(JSON.stringify(value)+'\n');children.push(child);return child;
  },{clock,startupTimeoutMs:50,requestTimeoutMs:100});
  t.after(()=>{for(const child of children)child.emit('close');worker.close();});
  const start=()=>{worker.start();const child=children.at(-1);child.emitValue({ready:true,model:'test-medium'});return child;};
  return {worker,children,start,advance,tasks};
}

test('starting an already ready microphone does not leak a second process',t=>{
  const {worker,children,start}=rig(t);const first=start();worker.start();
  assert.equal(children.length,1);assert.equal(worker.child,first);assert.equal(worker.ready,true);
});

test('old process close and output cannot invalidate a recovered microphone',async t=>{
  const {worker,start}=rig(t);const old=start();old.emit('close');const current=start();
  const promise=worker.transcribe(Buffer.from('new'),new AbortController().signal);
  old.emit('close');old.emitValue({error:'old startup failure'});old.emitValue({ready:true,model:'old-model'});
  current.emitValue({id:current.sent[0].id,text:'새 발언'});
  assert.equal((await promise).text,'새 발언');assert.equal(worker.ready,true);assert.equal(worker.model,'test-medium');assert.equal(worker.error,'');
});

test('closing releases a pending request before delayed OS process close',async t=>{
  const {worker,start}=rig(t);const child=start();
  const promise=worker.transcribe(Buffer.from('pending'),new AbortController().signal);const rejected=assert.rejects(promise,/종료|취소/);
  worker.close();assert.equal(worker.ready,false);assert.equal(worker.pending,null);assert.equal(child.kills,1);
  child.emit('close');await rejected;worker.start();assert.equal(worker.child,null);
});

test('preparation waits once for readiness and caller cancellation does not cancel other listeners',async t=>{
  const {worker,children}=rig(t);const a=new AbortController(),b=new AbortController();
  const first=worker.prepare(a.signal);const rejected=assert.rejects(first,/취소|abort/i);const second=worker.prepare(b.signal);
  a.abort();await rejected;assert.equal(children.length,1);assert.equal(children[0].kills,0);
  children[0].emitValue({ready:true,model:'ready-model'});assert.equal(await second,true);assert.equal(worker.error,'');
});

test('startup timeout retires only its worker and prevents overlap until process closure',async t=>{
  const {worker,children,advance}=rig(t);const p=worker.prepare(new AbortController().signal);const rejected=assert.rejects(p,/준비.*초과/);
  advance(50);await rejected;assert.equal(children[0].kills,1);assert.equal(worker.ready,false);
  await assert.rejects(worker.prepare(new AbortController().signal),/종료.*기다|정리/);assert.equal(children.length,1);
  children[0].emit('close');const next=worker.prepare(new AbortController().signal);children[1].emitValue({ready:true});assert.equal(await next,true);
});

test('recognition timeout terminates stuck work and recovery accepts the next utterance',async t=>{
  const {worker,start,advance,children}=rig(t);const first=start();const p=worker.transcribe(Buffer.from('stuck'),new AbortController().signal);
  const rejected=assert.rejects(p,/인식.*초과/);advance(100);await rejected;assert.equal(first.kills,1);assert.equal(worker.ready,false);
  first.emit('close');const prepared=worker.prepare(new AbortController().signal);const next=children[1];next.emitValue({ready:true});await prepared;
  const answer=worker.transcribe(Buffer.from('new'),new AbortController().signal);first.emitValue({id:first.sent[0].id,text:'late stale'});next.emitValue({id:next.sent[0].id,text:'복구 후 발언'});assert.equal((await answer).text,'복구 후 발언');
});

test('cancelled physical work retains a deadline while late completed work releases it',async t=>{
  const {worker,start,advance}=rig(t);const child=start(),controller=new AbortController();
  const first=worker.transcribe(Buffer.from('cancelled'),controller.signal);const rejected=assert.rejects(first,/취소/);controller.abort();await rejected;
  advance(80);child.emitValue({id:child.sent[0].id,text:'ignored'});advance(20);assert.equal(child.kills,0);
  const other=new AbortController(),second=worker.transcribe(Buffer.from('never-finishes'),other.signal);const rejected2=assert.rejects(second,/취소/);other.abort();await rejected2;advance(100);
  assert.equal(child.kills,1);assert.equal(worker.ready,false);assert.match(worker.error,/초과/);
});

test('startup protocol failure, spawn error and malformed oversize output are recoverable failures',async t=>{
  const {worker,children}=rig(t);let p=worker.prepare(new AbortController().signal),bad=assert.rejects(p,/missing model/);children[0].emitValue({error:'missing model'});await bad;assert.equal(children[0].kills,1);children[0].emit('close');
  p=worker.prepare(new AbortController().signal);bad=assert.rejects(p,/시작/);children[1].emit('error',Error('synthetic spawn error'));await bad;children[1].emit('close');
  p=worker.prepare(new AbortController().signal);bad=assert.rejects(p,/응답.*너무/);children[2].stdout.write('x'.repeat(1_000_001));await bad;assert.equal(children[2].kills,1);
});

test('synchronous spawn failure and missing executable remain retryable without throwing from startup',async t=>{
  const worker=new LocalSpeech({python:process.execPath},()=>{throw Error('synthetic spawn failed');});t.after(()=>worker.close());
  assert.doesNotThrow(()=>worker.start());assert.equal(worker.ready,false);await assert.rejects(worker.prepare(new AbortController().signal),/시작/);
  const missing=new LocalSpeech({python:'G:/nonexistent-backseat-test-python.exe'});t.after(()=>missing.close());await assert.rejects(missing.prepare(new AbortController().signal),/설치/);
});
