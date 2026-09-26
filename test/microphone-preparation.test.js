import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as speechFlow from '../src/speech-flow.ts';
import {TemporalFrames} from '../src/temporal-frames.ts';
import * as capturePreparation from '../src/capture-preparation.ts';
import * as reactionSchedule from '../src/reaction-schedule.ts';
// Execute the shipped hook handlers with controlled transport/devices. This is
// file-based sequencing coverage, not a React renderer or native device test.
const compiled=ts.transpileModule(readFileSync(new URL('../src/useMedia.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function harness(fetch,getUserMedia){
  const effects=[],errors=[],listeners=[],outboxes=[],timers=new Set();let timerId=0;
  class Outbox extends speechFlow.SpeechOutbox{constructor(){super();outboxes.push(this);}}
  class Listener{constructor(options){this.options=options;this.drained=new Promise(resolve=>{this.resolveDrain=resolve;});listeners.push(this);}async start(){this.timer=++timerId;timers.add(this.timer);return this;}stopCapture(){timers.delete(this.timer);}}
  const state={running:true,sessionId:'test-session',settings:{mode:'live',maxCalls:50,intervalSeconds:5},calls:0};
  const react={useRef:value=>({current:value}),useState:value=>[value,()=>{}],useEffect:effect=>effects.push(effect)};
  const imports={react,'./useSoundAnalysisSource':{useSoundAnalysisSource:source=>{assert.equal(source,null);return null;}},'./useSystemSound':{useSystemSound:()=>({})},'./useClipBuffer':{useClipBuffer:()=>({})},'./clip-uploads':{},'./api':{api:async()=>({ok:true})},'./speech-flow':{...speechFlow,SpeechOutbox:Outbox},'./continuous-listening.ts':{ContinuousListening:Listener},'./temporal-frames':{TemporalFrames},'./temporal-capture':{},'./capture-preparation':capturePreparation,'./reaction-schedule':reactionSchedule};
  const module={exports:{}};
  class Recorder{static isTypeSupported(){return true;}constructor(){this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';this.onstop?.();}}
  class Context{resume(){return Promise.resolve();}createMediaStreamSource(){return {connect(){}};}createAnalyser(){return {fftSize:512,getFloatTimeDomainData(){}};}close(){return Promise.resolve();}}
  vm.runInNewContext(compiled,{module,exports:module.exports,require:id=>{assert.ok(id in imports,id);return imports[id];},fetch,window:{},navigator:{mediaDevices:{addEventListener(){},removeEventListener(){},getUserMedia:async()=>{const stream=await getUserMedia();if(stream&&!stream.getAudioTracks)stream.getAudioTracks=stream.getTracks;return stream;}}},MediaRecorder:Recorder,AudioContext:Context,AbortController,Error,Blob,Float32Array,performance:{now:()=>0},setInterval:()=>{timers.add(++timerId);return timerId;},clearInterval:id=>timers.delete(id),setTimeout:()=>{timers.add(++timerId);return timerId;},clearTimeout:id=>timers.delete(id)});
  return {media:module.exports.useMedia(state,error=>errors.push(error)),errors,state,timers,listeners,outboxes,effects};
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

test('recognized speech from the continuous listener enters the existing delivery outbox in order',async()=>{
  let stops=0;const h=harness(async()=>({ok:true,json:async()=>({ok:true})}),async()=>({getTracks:()=>[{stop(){stops++;}}]}));
  await h.media.startMic();h.media.say('이미 입력된 말');
  const capture={startedAt:100,endedAt:200};
  h.listeners[0].options.onTranscript('첫 발언',capture);
  h.listeners[0].options.onTranscript('둘째 발언',{startedAt:200,endedAt:300});
  await turn();
  assert.deepEqual(h.outboxes[0].items.map(i=>i.text),['이미 입력된 말','첫 발언','둘째 발언']);
  assert.equal(h.outboxes[0].items[1].capture.startedAt,100);
  assert.equal(stops,0);h.media.stopMic();assert.equal(h.timers.size,0);
});

test('speech captured before reconnect is delivered before the new microphone epoch',async()=>{
  const h=harness(async()=>({ok:true,json:async()=>({ok:true})}),async()=>({getTracks:()=>[{stop(){}}]}));
  await h.media.startMic();const first=h.listeners[0];h.media.stopMic();
  first.options.onTranscript('이전 입력',{startedAt:100,endedAt:200});
  await h.media.startMic();h.listeners[1].options.onTranscript('새 입력',{startedAt:300,endedAt:400});
  await turn();assert.deepEqual(h.outboxes[0].items.map(item=>item.text),['이전 입력']);
  first.resolveDrain();await turn();
  assert.deepEqual(h.outboxes[0].items.map(item=>item.text),['이전 입력','새 입력']);
  h.state.running=false;h.listeners[1].options.onTranscript('방송 후 입력',{startedAt:500,endedAt:600});
  await turn();assert.equal(h.outboxes[0].items.length,2);
  h.media.stopMic();
});

test('a capture processor failure releases the device and requests reconnect visibly',async()=>{
  let stops=0;const h=harness(async()=>({ok:true,json:async()=>({ok:true})}),async()=>({getTracks:()=>[{stop(){stops++;}}]}));
  await h.media.startMic();h.listeners[0].options.onCaptureFailure();
  assert.equal(stops,1);assert.match(h.errors.at(-1),/연속 캡처가 끊겼습니다/);assert.equal(h.timers.size,0);
});

 test('explicit microphone toggle off remains off through reconnect and can be enabled again',async()=>{
  let devices=0,stops=0;
  const h=harness(async()=>({ok:true,json:async()=>({ok:true})}),async()=>{devices++;return {getTracks:()=>[{stop(){stops++;}}]};});
  await h.media.startMic();h.media.toggleMic();assert.equal(stops,1);
  const reconnect=h.effects.find(effect=>String(effect).includes('const reconnect'));
  assert.ok(reconnect);const cleanup=reconnect();await turn();assert.equal(devices,1);
  h.media.toggleMic();await turn();assert.equal(devices,2);
  h.media.toggleMic();cleanup();assert.equal(stops,2);assert.equal(h.timers.size,0);
});
 test('microphone shortcut cancels pending preparation without opening a late device',async()=>{
  let release,devices=0;
  const h=harness(async()=>new Promise(resolve=>release=resolve),async()=>{devices++;});
  const start=h.media.startMic();await turn();h.media.toggleMic();
  release({ok:true,json:async()=>({ok:true})});await start;assert.equal(devices,0);
});
