import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {createSeparatedClipSources} from '../src/clip-source.ts';
import {voicePlaybackTime} from '../src/clip-playback.ts';
import {ClipUploads} from '../src/clip-uploads.ts';
import {Clips} from '../server/clips.js';
import {ClipsData} from '../server/data-schema.js';

const stream=(video=false,audio=false)=>({getVideoTracks:()=>video?[{readyState:'live'}]:[],getAudioTracks:()=>audio?[{readyState:'live'}]:[]});
test('new video captures pass only game sound to the base recorder and isolate microphone ownership',()=>{
  const screen=stream(true),mic=stream(false,true),system=stream(false,true),calls=[];let closed=0;
  const result=createSeparatedClipSources(screen,mic,system,(...args)=>{calls.push(args);return {close:()=>closed++};});assert.deepEqual(calls,[[screen,null,system],[null,mic,null]]);assert.equal(result.audioLayout,'separate');result.close();assert.equal(closed,2);
  const only=createSeparatedClipSources(null,mic,null,()=>({close(){}}));assert.equal(only.audioLayout,'microphone-only');assert.equal(only.voice,null);
});
test('failure to create the voice recorder releases the already-created base without falling back to mixed audio',()=>{
  let calls=0,closed=0;assert.throws(()=>createSeparatedClipSources(stream(true),stream(false,true),null,()=>++calls===1?{close:()=>closed++}:null));assert.equal(closed,1);
});
test('sidecar seeking respects capture offsets and never plays before or after recorded microphone coverage',()=>{
  assert.equal(voicePlaybackTime(2,1000,1250,16000),1.75);assert.equal(voicePlaybackTime(0,1000,1250,16000),null);assert.equal(voicePlaybackTime(15,1000,1250,16000),null);assert.equal(voicePlaybackTime(1,1000,750,15000),1.25);
});
test('base and voice file saves are separate, rollback preserves video, and deletion removes both',t=>{
  const dir=mkdtempSync(join(tmpdir(),'backseat-voice-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));let fail=false;const now=100000,clips=new Clips({dir,now:()=>now,save:v=>{if(fail)throw Error('disk');ClipsData.parse(v);}}),bytes=Buffer.concat([Buffer.from('1a45dfa3','hex'),Buffer.alloc(128)]);
  const c=clips.create({scene:'synthetic',game:'Test',title:'test',participants:[],messages:[],sessionId:'synthetic',observedAt:95000});
  clips.recording(c.id,bytes,{kind:'video',hasAudio:true,audioLayout:'separate',startedAt:90000,endedAt:100000});fail=true;assert.throws(()=>clips.recording(c.id,bytes,{kind:'voice',hasAudio:true,startedAt:90020,endedAt:100020}));assert.ok(existsSync(clips.file(c.id,'webm')));assert.equal(existsSync(clips.file(c.id,'voice.webm')),false);fail=false;
  clips.recording(c.id,bytes,{kind:'voice',hasAudio:true,startedAt:90020,endedAt:100020});assert.equal(clips.get(c.id).voice,true);assert.deepEqual(readFileSync(clips.file(c.id,'voice.webm')),bytes);assert.throws(()=>clips.recording(c.id,bytes,{kind:'voice',hasAudio:true,startedAt:90020,endedAt:100020}));clips.remove(c.id);assert.equal(existsSync(clips.file(c.id,'webm')),false);assert.equal(existsSync(clips.file(c.id,'voice.webm')),false);
});
test('a lost voice POST response is checked against voice state, never mistaken for the already-saved video',async t=>{
  const calls=[],errors=[],T=100000;let voicePosts=0;const voice={kind:'audio',blob:new Blob(['mic']),hasAudio:true,sessionId:'s',startedAt:T-9000,endedAt:T};
  const recording={...voice,kind:'video',audioLayout:'separate',voice,blob:new Blob(['video'])};
  const q=new ClipUploads({sessionId:'s',now:()=>T,allowed:()=>true,takeAt:async()=>recording,onError:e=>errors.push(e),retryDelays:[0],request:async(path,init)=>{calls.push({path,init});if(!init.method)return Response.json({id:'clip',video:true,voice:voicePosts>1});if(path.includes('/voice?')){voicePosts++;if(voicePosts===1)throw Error('response lost before commit');return Response.json({id:'clip',video:true,voice:true});}return Response.json({id:'clip',video:true});}});t.after(()=>q.dispose());q.add([{id:'clip',source:'spectator',sessionId:'s',video:false,createdAt:T,observedAt:T-4000}]);for(let i=0;i<100&&voicePosts<2;i++)await delay(5);assert.equal(voicePosts,2);assert.deepEqual(errors,[]);assert.ok(calls.filter(c=>c.path.includes('/voice?')).every(c=>c.init.body===voice.blob&&c.init.headers['Content-Type']==='audio/webm'));
});
