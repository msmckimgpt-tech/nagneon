import test from 'node:test';
import assert from 'node:assert/strict';
import {ClipBuffer} from '../src/clip-buffer.ts';

test('default clock never invokes browser timers with a foreign receiver',async t=>{
  const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout;
  t.mock.method(globalThis,'setTimeout',function(...args){
    assert.ok(this===undefined||this===globalThis,'browser setTimeout rejects foreign receiver');return originalSet(...args);
  });
  t.mock.method(globalThis,'clearTimeout',function(...args){
    assert.ok(this===undefined||this===globalThis,'browser clearTimeout rejects foreign receiver');return originalClear(...args);
  });
  const {ClipBuffer:BrowserBuffer}=await import('../src/clip-buffer.ts?browser-clock');
  let failures=0;
  const recorder={state:'inactive',start(){this.state='recording';},stop(){this.state='inactive';}};
  const buffer=new BrowserBuffer({sessionId:'browser',hasAudio:true,create:()=>recorder,onFailure:()=>failures++});
  try{buffer.start();assert.equal(recorder.state,'recording');assert.equal(failures,0);}
  finally{buffer.dispose();}
  assert.equal(recorder.state,'inactive');
});

function harness({bytes=120,delay=0,failStart=0}={}){
  let time=1_000_000,id=0,failures=0;const timers=new Map(),recorders=[];
  const clock={now:()=>time,set:(fn,ms)=>{timers.set(++id,{at:time+ms,fn});return id;},clear:id=>timers.delete(id)};
  function tick(ms){const end=time+ms;for(;;){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;timers.delete(next[0]);next[1].fn();}time=end;}
  function create(){
    if(failStart===recorders.length+1)throw new Error('encoder failed');
    const rec={state:'inactive',stops:0,start(){this.state='recording';},
      stop(){this.stops++;this.state='inactive';clock.set(()=>{this.ondataavailable?.({data:new Blob([new Uint8Array(bytes).fill(recorders.indexOf(this)+1)])});this.onstop?.();},delay);}};
    recorders.push(rec);return rec;
  }
  const buffer=new ClipBuffer({sessionId:'session-a',hasAudio:true,create,clock,onFailure:()=>failures++});buffer.start();
  return {buffer,clock,tick,recorders,timers,failures:()=>failures};
}

test('delayed viewer pick retrieves its original segment after six later rotations',async t=>{
  const h=harness();t.after(()=>h.buffer.dispose());h.tick(105_000);
  const old=await h.buffer.takeAt(1_005_000);assert.ok(old);
  assert.deepEqual([old.startedAt,old.endedAt,old.sessionId,old.hasAudio],[1_000_000,1_015_000,'session-a',true]);
  assert.equal(new Uint8Array(await old.blob.arrayBuffer())[0],1,'must not substitute latest scene');
  assert.equal(new Uint8Array(await(await h.buffer.takeAt(1_095_001)).blob.arrayBuffer())[0],7);
});
test('concurrent picks including the first second share a full playable-recording unit',async t=>{
  const h=harness();t.after(()=>h.buffer.dispose());h.tick(400);
  const a=h.buffer.takeAt(1_000_200),b=h.buffer.takeAt(1_000_300);
  assert.equal(h.recorders[0].stops,0);h.tick(14_600);
  const [first,second]=await Promise.all([a,b]);assert.ok(first);assert.equal(first,second);
  assert.equal(first.endedAt-first.startedAt,15_000);assert.equal(h.recorders[0].stops,1);
});
test('last data event is included with every earlier chunk from the same recorder',async t=>{
  const h=harness();t.after(()=>h.buffer.dispose());h.recorders[0].ondataavailable({data:new Blob(['header'])});h.tick(15_000);
  const saved=await h.buffer.takeAt(1_003_000);assert.equal(saved.blob.size,126);
  assert.equal((await saved.blob.text()).slice(0,6),'header');
});
test('delayed onstop never claims footage in the recorder restart gap',async t=>{
  const h=harness({delay:1000});t.after(()=>h.buffer.dispose());h.tick(15_500);
  assert.equal(await h.buffer.takeAt(1_015_200),null);const waiting=h.buffer.takeAt(1_014_000);h.tick(500);
  assert.equal((await waiting).endedAt,1_015_000);
  assert.equal(await h.buffer.takeAt(1_015_500),null);
});
test('expired and future timestamps cannot borrow another scene',async t=>{
  const h=harness();t.after(()=>h.buffer.dispose());h.tick(136_000);
  assert.equal(await h.buffer.takeAt(1_005_000),null);
  for(const at of [NaN,Infinity,999_999,1_140_000])assert.equal(await h.buffer.takeAt(at),null);
});
test('completed buffer evicts oldest media at 24 MiB even within the time window',async t=>{
  const h=harness({bytes:9*1024*1024});t.after(()=>h.buffer.dispose());h.tick(45_000);
  assert.equal(await h.buffer.takeAt(1_005_000),null);assert.ok(await h.buffer.takeAt(1_020_000));assert.ok(await h.buffer.takeAt(1_040_000));
});
test('oversized active recording fails closed and resolves all pending picks',async()=>{
  const h=harness({bytes:20*1024*1024+1});h.tick(1000);const pending=h.buffer.takeAt(1_000_500);h.tick(14_000);
  assert.equal(await pending,null);assert.equal(h.failures(),1);assert.equal(h.timers.size,0);
  assert.equal(await h.buffer.takeAt(1_000_500),null);
});
test('dispose cancels pending picks, clears retention and ignores queued stop events',async()=>{
  const h=harness({delay:1000});h.tick(15_000);const pending=h.buffer.takeAt(1_002_000);
  h.buffer.dispose();h.buffer.dispose();h.tick(1000);
  assert.equal(await pending,null);assert.equal(await h.buffer.takeAt(1_002_000),null);assert.equal(h.recorders.length,1);assert.equal(h.timers.size,0);
});
test('missing stop event is bounded and releases encoder ownership',async()=>{
  const h=harness({delay:50_000});h.tick(1000);const pending=h.buffer.takeAt(1_000_100);h.tick(18_000);
  assert.equal(await pending,null);assert.equal(h.failures(),1);h.tick(50_000);assert.equal(h.recorders.length,1);
});
test('encoder construction failure on rotation is handled like initial failure',async()=>{
  for(const failStart of [1,2]){const h=harness({failStart});h.tick(15_000);assert.equal(h.failures(),1);assert.equal(await h.buffer.takeAt(1_001_000),null);assert.equal(h.timers.size,0);}
});
test('error releases active encoder and suppresses its final partial data',async()=>{
  const h=harness();h.tick(1000);const pending=h.buffer.takeAt(1_000_100);h.recorders[0].onerror();h.tick(0);
  assert.equal(await pending,null);assert.equal(h.recorders[0].stops,1);assert.equal(h.failures(),1);assert.equal(h.recorders.length,1);
});
