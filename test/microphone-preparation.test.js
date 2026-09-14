import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as speechFlow from '../src/speech-flow.ts';
import {TemporalFrames} from '../src/temporal-frames.ts';
import * as capturePreparation from '../src/capture-preparation.ts';
// Execute the shipped hook handlers with controlled transport/devices. This is
// file-based sequencing coverage, not a React renderer or native device test.
const compiled=ts.transpileModule(readFileSync(new URL('../src/useMedia.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function harness(fetch,getUserMedia){
  const errors=[],queues=[],outboxes=[],timers=new Set();let timerId=0;
  class Queue extends speechFlow.SpeechQueue{constructor(options){super(options);queues.push(this);}}
  class Outbox extends speechFlow.SpeechOutbox{constructor(){super();outboxes.push(this);}}
  const state={running:true,sessionId:'test-session',settings:{mode:'live',maxCalls:50,intervalSeconds:5},calls:0};
  const react={useRef:value=>({current:value}),useState:value=>[value,()=>{}],useEffect:()=>{}};
  const imports={react,'./useSystemSound':{useSystemSound:()=>({})},'./useClipBuffer':{useClipBuffer:()=>({})},'./clip-uploads':{},'./api':{api:async()=>({ok:true})},'./speech-flow':{...speechFlow,SpeechQueue:Queue,SpeechOutbox:Outbox},'./temporal-frames':{TemporalFrames},'./temporal-capture':{},'./capture-preparation':capturePreparation};
  const module={exports:{}};
  class Recorder{static isTypeSupported(){return true;}constructor(){this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';this.onstop?.();}}
  class Context{resume(){return Promise.resolve();}createMediaStreamSource(){return {connect(){}};}createAnalyser(){return {fftSize:512,getFloatTimeDomainData(){}};}close(){return Promise.resolve();}}
  vm.runInNewContext(compiled,{module,exports:module.exports,require:id=>{assert.ok(id in imports,id);return imports[id];},fetch,navigator:{mediaDevices:{getUserMedia:async()=>{const stream=await getUserMedia();if(stream&&!stream.getAudioTracks)stream.getAudioTracks=stream.getTracks;return stream;}}},MediaRecorder:Recorder,AudioContext:Context,AbortController,Error,Blob,Float32Array,performance:{now:()=>0},setInterval:()=>{timers.add(++timerId);return timerId;},clearInterval:id=>timers.delete(id),setTimeout:()=>{timers.add(++timerId);return timerId;},clearTimeout:id=>timers.delete(id)});
  return {media:module.exports.useMedia(state,error=>errors.push(error)),errors,state,timers,queues,outboxes};
}

test('microphone device acquisition waits for the recognizer handshake',async()=>{
  let resolve,devices=0,stops=0;const prepared=new Promise(r=>resolve=r);
  const h=harness(async(url,options)=>{assert.equal(url,'/api/audio/prepare');assert.equal(options.method,'POST');return prepared;},async()=>{devices++;return {getTracks:()=>[{stop(){stops++;}}]};});
  const start=h.media.startMic();await turn();assert.equal(devices,0);
  resolve({ok:true,json:async()=>({ok:true})});await start;assert.equal(devices,1);h.media.stopMic();assert.equal(stops,1);assert.equal(h.timers.size,0);
});

test('failed preparation never opens a device and the same microphone control can retry',async()=>{
  let attempts=0,devices=0;const h=harness(async()=>({ok:++attempts!==1,json:async()=>({error:'준비 실패'})}),async()=>{devices++;return {getTracks:()=>[{stop(){}}]};});
  await h.media.startMic();assert.equal(devices,0);assert.match(h.errors[0],/준비 실패.*자동으로 다시 연결/);
  await h.media.startMic();assert.equal(devices,1);h.media.stopMic();assert.equal(h.timers.size,0);
});

test('cancelling preparation aborts transport and even a late successful response cannot open the microphone',async()=>{
  let release,signal,devices=0;const h=harness(async(_url,options)=>{signal=options.signal;return new Promise(r=>release=r);},async()=>{devices++;});
  const start=h.media.startMic();await turn();h.media.stopMic();assert.equal(signal.aborted,true);release({ok:true,json:async()=>({ok:true})});await start;
  assert.equal(devices,0);assert.deepEqual(h.errors,[]);assert.equal(h.timers.size,0);
});

test('broadcast stop while permission is pending stops the late stream without recording',async()=>{
  let release,stops=0;const h=harness(async()=>({ok:true,json:async()=>({ok:true})}),()=>new Promise(r=>release=r));
  const start=h.media.startMic();await turn();h.state.running=false;h.media.stopMic();release({getTracks:()=>[{stop(){stops++;}}]});await start;
  assert.equal(stops,1);assert.deepEqual(h.errors,[]);assert.equal(h.timers.size,0);
});

test('worker preparation failure recovers the same audio without stopping capture or discarding queued speech',async()=>{
  let stops=0,audio=0,prepares=0;const h=harness(async url=>url==='/api/audio/prepare'?{ok:true,json:async()=>{prepares++;return {ok:true};}}:++audio===1?{ok:false,json:async()=>({error:'인식기 종료',needsPreparation:true})}:{ok:true,json:async()=>({text:'복구된 발언'+audio})},async()=>({getTracks:()=>[{stop(){stops++;}}]}));
  await h.media.startMic();h.media.say('이미 인식된 말');h.queues[0].enqueue({blob:new Blob(['failed'])});h.queues[0].enqueue({blob:new Blob(['queued'])});await turn();
  assert.equal(audio,3);assert.equal(prepares,2);assert.equal(stops,0);assert.equal(h.queues[0].pending.length,0);assert.ok(h.timers.size>0);
  assert.deepEqual(h.outboxes[0].items.map(i=>i.text),['이미 인식된 말','복구된 발언2','복구된 발언3']);assert.equal(h.state.running,true);assert.equal(h.errors.length,0);h.media.stopMic();assert.equal(h.timers.size,0);
});

test('an invalid segment keeps capture active and the next recorded utterance is delivered',async()=>{
  let stops=0,audio=0;const h=harness(async url=>url==='/api/audio/prepare'?{ok:true,json:async()=>({ok:true})}:++audio===1?{ok:false,json:async()=>({error:'잘못된 음성 구간'})}:{ok:true,json:async()=>({text:'다음 정상 발언'})},async()=>({getTracks:()=>[{stop(){stops++;}}]}));
  await h.media.startMic();h.queues[0].enqueue({blob:new Blob(['invalid'])});h.queues[0].enqueue({blob:new Blob(['valid'])});await turn();
  assert.equal(stops,0);assert.equal(audio,2);assert.match(h.errors[0],/잘못된 음성 구간.*마이크는 켜져/);assert.equal(h.outboxes[0].items[0].text,'다음 정상 발언');h.media.stopMic();assert.equal(h.timers.size,0);
});
