import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as speechFlow from '../src/speech-flow.ts';
import * as reactionSchedule from '../src/reaction-schedule.ts';

const compiled=ts.transpileModule(readFileSync(new URL('../src/useMedia.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const turn=()=>new Promise(resolve=>setImmediate(resolve));

function harness({fetch,reactApi}){
  const effects=[],errors=[];
  const react={
    useRef:value=>({current:value}),
    useState:value=>[value,()=>{}],
    useEffect:effect=>{effects.push(effect);}
  };
  class TemporalFrames{
    constructor(){this.sessionId=null;this.sourceId=null;}
    reset(sessionId=null,sourceId=null){this.sessionId=sessionId;this.sourceId=sourceId;}
    window(){return undefined;}speechWindow(){return undefined;}acknowledge(){}
  }
  class ClipUploads{dispose(){}add(){}}
  const imports={
    react,
    './useSystemSound':{useSystemSound:()=>({status:'idle',level:0})},
    './useSoundAnalysisSource':{useSoundAnalysisSource:source=>{assert.equal(source,null);return null;}},
    './useClipBuffer':{useClipBuffer:()=>({buffering:false,takeAt:async()=>null})},
    './clip-uploads':{ClipUploads},
    './api':{api:reactApi},
    './speech-flow':speechFlow,
    './continuous-listening.ts':{ContinuousListening:class{}},
    './temporal-frames':{TemporalFrames},
    './temporal-capture':{startTemporalCapture:()=>()=>{}},
    './reaction-schedule':reactionSchedule,
    './capture-preparation':{prepareCapture:async()=>{throw new Error('not used');},releaseCapture:()=>{}}
  };
  const module={exports:{}};
  const mediaDevices={addEventListener(){},removeEventListener(){},getUserMedia:async()=>{throw new Error('not used');},getDisplayMedia:async()=>{throw new Error('not used');}};
  vm.runInNewContext(compiled,{module,exports:module.exports,require:id=>{assert.ok(id in imports,`unexpected import ${id}`);return imports[id];},fetch,navigator:{mediaDevices},window:{},MediaRecorder:{isTypeSupported:()=>true},AudioContext:class{},AbortController,DOMException,Error,Blob,Float32Array,Date,crypto,structuredClone,setInterval,clearInterval,setTimeout,clearTimeout});
  const state={running:true,sessionId:'live-session',settings:{mode:'live',intervalSeconds:5,autoHighlights:false,clipBufferEnabled:false,speechDevice:'cpu'},busy:false,clips:[]};
  const media=module.exports.useMedia(state,message=>errors.push(message));
  const deliveryEffect=effects.find(effect=>String(effect).includes('startReactionSchedule')&&String(effect).includes('pendingSpeech'));
  assert.ok(deliveryEffect,'delivery effect not found');
  return {media,deliveryEffect,errors};
}

test('failed speech delivery still lets the audience consume already accepted pending speech',async()=>{
  let speechAttempts=0,reactCalls=0;
  const h=harness({
    fetch:async url=>{assert.equal(url,'/api/speech');speechAttempts++;return {ok:false,json:async()=>({error:'speech inbox full'})};},
    reactApi:async path=>{assert.equal(path,'react');reactCalls++;return {ok:true};}
  });
  h.media.say('밀린 발언');
  const cleanup=h.deliveryEffect();
  for(let i=0;i<6&&reactCalls===0;i++)await turn();
  cleanup?.();
  assert.equal(speechAttempts,1);
  assert.equal(reactCalls,1);
  assert.ok(h.errors.some(message=>/speech inbox full/.test(message)));
});

test('a successful delivery and reaction still use the normal single-cycle path',async()=>{
  let speechAttempts=0,reactCalls=0;
  const h=harness({
    fetch:async url=>{assert.equal(url,'/api/speech');speechAttempts++;return {ok:true,json:async()=>({ok:true})};},
    reactApi:async path=>{assert.equal(path,'react');reactCalls++;return {ok:true};}
  });
  h.media.say('정상 발언');
  const cleanup=h.deliveryEffect();
  for(let i=0;i<6&&reactCalls===0;i++)await turn();
  cleanup?.();
  assert.equal(speechAttempts,1);
  assert.equal(reactCalls,1);
  assert.deepEqual(h.errors,[]);
});
