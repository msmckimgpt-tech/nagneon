import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {ClipInspector} from '../server/clip-inspector.js';
import {spawn} from 'node:child_process';

const buffer=Buffer.concat([Buffer.from('1a45dfa3','hex'),Buffer.alloc(120)]);
const meta={kind:'audio',hasAudio:true,startedAt:0,endedAt:15000};
const valid={ok:true,kind:'audio',hasAudio:true,durationMs:15000};
function harness(timeoutMs=1000){
  const launches=[];
  const inspector=new ClipInspector({python:process.execPath,worker:fileURLToPath(import.meta.url),timeoutMs,launch:(...args)=>{
    const c=new EventEmitter();Object.assign(c,{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kills:0,kill(){this.kills++;}});launches.push({args,child:c});return c;
  }});
  return {inspector,launches,get child(){return launches.at(-1)?.child;},finish(value=valid,code=0){this.child.stdout.emit('data',Buffer.from(JSON.stringify(value)));this.child.emit('close',code);}};
}

test('decoder runs hidden with binary input and fixed arguments; successful process exits before reuse',async()=>{
  const h=harness();const result=h.inspector.inspect(buffer,meta);const [bin,args,options]=h.launches[0].args;
  assert.equal(bin,process.execPath);assert.deepEqual(args.slice(0,3),['-X','utf8','-B']);assert.deepEqual(args.slice(-3),['audio','true','15000']);assert.equal(options.windowsHide,true);assert.deepEqual(options.stdio,['pipe','pipe','pipe']);assert.deepEqual(h.child.stdin.read(),buffer);
  await assert.rejects(h.inspector.inspect(buffer,meta),{code:'clip-busy'});h.finish();assert.deepEqual(await result,valid);
  const second=h.inspector.inspect(buffer,meta);h.finish();await second;await h.inspector.close();
});
test('invalid input and unavailable runtime fail without starting a decoder',async()=>{
  const h=harness();for(const [bytes,metadata] of [[Buffer.alloc(150),meta],[buffer,{...meta,kind:'other'}],[buffer,{...meta,endedAt:Infinity}],[buffer,{...meta,hasAudio:'true'}],[buffer,{...meta,endedAt:46000}]])await assert.rejects(h.inspector.inspect(bytes,metadata),{code:'clip-invalid'});
  assert.equal(h.launches.length,0);await assert.rejects(new ClipInspector({python:fileURLToPath(new URL('./missing-python.exe',import.meta.url))}).inspect(buffer,meta),{code:'clip-unavailable'});
});
test('abort kills only the owned child and retains the slot until its close event',async()=>{
  const h=harness(),controller=new AbortController();const result=h.inspector.inspect(buffer,meta,controller.signal);const rejected=assert.rejects(result,{code:'clip-cancelled'});controller.abort();assert.equal(h.child.kills,1);
  await assert.rejects(h.inspector.inspect(buffer,meta),{code:'clip-busy'});h.finish();await rejected;assert.equal(h.inspector.active,null);
});
test('timeout kills a stalled decoder and never accepts its later success',async()=>{
  const h=harness(10);const result=h.inspector.inspect(buffer,meta),rejected=assert.rejects(result,{code:'clip-timeout'});
  await new Promise(resolve=>setTimeout(resolve,25));assert.equal(h.child.kills,1);h.finish();await rejected;
});
test('decoder output bounds, malformed result, wrong media type and nonzero exit reject',async()=>{
  for(const [result,code] of [[{},0],[{...valid,kind:'video'},0],[{...valid,hasAudio:false},0],[{...valid,durationMs:0},0],[valid,1]]){const h=harness(),p=h.inspector.inspect(buffer,meta);h.finish(result,code);await assert.rejects(p,{code:'clip-invalid'});}
  const h=harness(),p=h.inspector.inspect(buffer,meta);h.child.stderr.emit('data',Buffer.alloc(8193));assert.equal(h.child.kills,1);h.finish();await assert.rejects(p,{code:'clip-invalid'});
});
test('spawn and stdin failures reject; service close waits for owned child and forbids more work',async()=>{
  for(const target of ['child','stdin']){const h=harness(),p=h.inspector.inspect(buffer,meta);
    (target==='child'?h.child:h.child.stdin).emit('error',Error('private runtime detail'));h.finish();await assert.rejects(p,{code:target==='child'?'clip-unavailable':'clip-invalid'});}
  const h=harness(),p=h.inspector.inspect(buffer,meta),rejected=assert.rejects(p,{code:'clip-cancelled'});let closed=false;const closing=h.inspector.close().then(()=>{closed=true;});await Promise.resolve();assert.equal(closed,false);h.finish();await closing;await rejected;assert.equal(closed,true);await assert.rejects(h.inspector.inspect(buffer,meta),{code:'clip-cancelled'});
});
test('timeout and explicit close terminate actual owned child processes',async()=>{
  for(const mode of ['timeout','close']){
    let child;
    const inspector=new ClipInspector({python:process.execPath,worker:fileURLToPath(import.meta.url),timeoutMs:mode==='timeout'?100:5000,
      launch:(_bin,_args,options)=>child=spawn(process.execPath,['-e','process.stdin.resume();setInterval(()=>{},1000);'],options)});
    const p=inspector.inspect(buffer,meta),rejected=assert.rejects(p,{code:mode==='timeout'?'clip-timeout':'clip-cancelled'});
    if(mode==='close')await inspector.close();await rejected;
    assert.equal(inspector.active,null);assert.ok(child.exitCode!==null||child.signalCode!==null);await inspector.close();
  }
});
