import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,link,symlink} from 'node:fs/promises';
import {resolve,join,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {Clips} from '../server/clips.js';
import {ClipPerception} from '../server/clip-perception.js';
import {ClipMediaReading} from '../server/clip-media-context.js';
import {clipTextSnapshot} from '../server/clip-memory.js';
import {ClipsData} from '../server/data-schema.js';

const image='data:image/jpeg;base64,AA==',turn=()=>new Promise(r=>setImmediate(r));
const bytes=Buffer.concat([Buffer.from('1a45dfa3','hex'),Buffer.alloc(196)]);
const decoded=(input)=>({ok:true,sources:input.sources.map(s=>({role:s.role,durationMs:3000,frames:s.kind==='video'?[{offsetMs:0,image},{offsetMs:1500,image},{offsetMs:2800,image}]:[],audioStartMs:0,...(s.hasAudio?{audio:{durationMs:3000,silent:false,volumeDb:-20,balance:0,classes:[],transcript:s.audioSource==='microphone'?'드디어 들어갔다':'문이 열렸습니다',cues:s.audioSource==='microphone'?{delivery:'큰 음량'}:null}}:{})}))});
async function fixture(t,{layout='separate',voice=true,kind='video',manual=false,result=decoded,timeoutMs=75000}={}){
 await mkdir('artifacts',{recursive:true});const folder=await mkdtemp(resolve('artifacts/clip-perception-test-')),now=Date.now(),clips=new Clips({dir:join(folder,'media')});
 const c=clips.create({title:'caption',game:'synthetic',scene:'caption',participants:[],messages:[],sessionId:randomUUID(),observedAt:now-1000,source:'spectator'});
 clips.recording(c.id,bytes,{kind,startedAt:now-3000,endedAt:now,hasAudio:true,audioLayout:layout});
 if(voice)clips.recording(c.id,bytes,{kind:'voice',startedAt:now-2800,endedAt:now+200,hasAudio:true,audioLayout:'separate'});
 const executable=join(folder,'fake-runtime');await writeFile(executable,'fixture');
 const calls=[];
 const launch=(bin,args,options)=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>{child.kills=(child.kills||0)+1;return true;};
  let payload='';child.stdin.on('data',b=>payload+=b.toString());child.stdin.on('finish',()=>{child.input=JSON.parse(payload);if(!manual){child.stdout.emit('data',Buffer.from(JSON.stringify(result(child.input))));child.emit('close',0);}});
  calls.push({bin,args,options,child});return child;
 };
 const reader=new ClipPerception({clips:{python:executable},clipPerception:{worker:executable,timeoutMs}},launch);
 t.after(async()=>{for(const c of calls)c.child.emit('close',1);await reader.close();});
 return {reader,calls,clips,clip:clips.get(c.id),folder};
}
test('stored media yields ordered frames, separate audio identities, timestamps and private source hashes',async t=>{
 const f=await fixture(t),signal=new AbortController().signal,r=await f.reader.read(f.clips,f.clip,signal);
 assert.equal(r.frames.length,3);assert.deepEqual(r.context.audio.map(a=>a.source),['system-output','microphone']);assert.equal(r.context.audio[1].startedAt-r.context.audio[0].startedAt,200);assert.equal(r.context.audio[1].transcript,'드디어 들어갔다');assert.ok(!JSON.stringify(r.context).includes(f.folder));
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.windowsHide,true);assert.ok(f.calls[0].args.includes('-B'));assert.equal(f.calls[0].options.env.HF_HUB_OFFLINE,'1');await f.reader.assertCurrent(f.clips,f.clip.id,r,signal);
 const changed=Buffer.from(await readFile(f.clips.file(f.clip.id,'webm')));changed[20]=1;await writeFile(f.clips.file(f.clip.id,'webm'),changed);await assert.rejects(f.reader.assertCurrent(f.clips,f.clip.id,r,signal),/파일이 바뀌/);
});
test('legacy mixed audio is never labeled as the streamer and audio-only microphone recordings contain no frames',async t=>{
 const mixed=await fixture(t,{layout:'mixed',voice:false}),m=await mixed.reader.read(mixed.clips,mixed.clip,new AbortController().signal);assert.equal(m.context.audio[0].source,'mixed-audio');
 const mic=await fixture(t,{layout:'microphone-only',voice:false,kind:'audio'}),v=await mic.reader.read(mic.clips,mic.clip,new AbortController().signal);assert.deepEqual(v.frames,[]);assert.equal(v.context.audio[0].source,'microphone');
});

test('Korean transcription survives pipe chunks split inside a UTF-8 character',async t=>{
 const f=await fixture(t,{manual:true}),job=f.reader.read(f.clips,f.clip,new AbortController().signal);
 while(!f.calls[0]?.child.input)await turn();const child=f.calls[0].child,encoded=Buffer.from(JSON.stringify(decoded(child.input)));
 for(let i=0;i<encoded.length;i++)child.stdout.emit('data',encoded.subarray(i,i+1));child.emit('close',0);
 const result=await job;assert.equal(result.context.audio[1].transcript,'드디어 들어갔다');assert.equal(result.context.audio[1].delivery,'큰 음량');
});
test('cancellation retains the file reader slot and close awaits the owned decoder exit',async t=>{
 const f=await fixture(t,{manual:true}),controller=new AbortController(),job=f.reader.read(f.clips,f.clip,controller.signal);let settled=false;const rejected=assert.rejects(job,/취소/).then(()=>settled=true);
 while(!f.calls.length)await turn();controller.abort();assert.equal(f.calls[0].child.kills,1);await assert.rejects(f.reader.read(f.clips,f.clip,new AbortController().signal),/이전 감상/);
 const closed=f.reader.close();await turn();assert.equal(settled,false);f.calls[0].child.emit('close',1);await rejected;await closed;assert.equal(f.reader.active,null);
});
test('invalid, mismatched and oversized decoder results fail without granting any media experience',async t=>{
 for(const result of [()=>({ok:false}),input=>({...decoded(input),sources:decoded(input).sources.slice(0,1)}),input=>{const r=decoded(input);r.sources[0].frames[1].offsetMs=0;return r;},input=>{const r=decoded(input);r.sources[0].frames[0].image='x'.repeat(4*1024*1024+1);return r;}]){
  const f=await fixture(t,{result});await assert.rejects(f.reader.read(f.clips,f.clip,new AbortController().signal));assert.equal(f.clips.data[0].readings,undefined);assert.equal(f.reader.active,null);
 }
});
test('no recording, pre-aborted input and a linked source do not start a decoder',async t=>{
 const f=await fixture(t);assert.equal(await f.reader.read(f.clips,{video:false,audio:false},new AbortController().signal),null);
 const controller=new AbortController();controller.abort();await assert.rejects(f.reader.read(f.clips,f.clip,controller.signal));assert.equal(f.calls.length,0);
 const linked=join(f.folder,'linked.webm');await link(f.clips.file(f.clip.id,'webm'),linked);await assert.rejects(f.reader.bytes(linked),/경로/);assert.equal(f.calls.length,0);
 const alias=join(f.folder,'alias');await symlink(f.clips.dir,alias,'junction');await assert.rejects(f.reader.bytes(join(alias,basename(f.clips.file(f.clip.id,'webm')))),/경로/);
});
test('media memory is durable, author-specific and distinct from caption reading; failed save grants neither',async t=>{
 const f=await fixture(t),r=await f.reader.read(f.clips,f.clip,new AbortController().signal),snapshot=clipTextSnapshot(f.clip);
 const media=ClipMediaReading.parse({version:1,signature:r.signature,readAt:Date.now(),frameTimes:r.context.frameTimes,audio:r.context.audio,scene:'빨간 상자가 오른쪽으로 움직였다'}),old=structuredClone(f.clips.data);
 f.clips.save=()=>{throw Error('synthetic disk failure');};assert.throws(()=>f.clips.commentBatch(f.clip.id,[],{reading:snapshot,readers:['momo'],mediaReading:media}),/disk failure/);assert.deepEqual(f.clips.data,old);
 f.clips.save=next=>ClipsData.parse(next);f.clips.commentBatch(f.clip.id,[],{reading:snapshot,readers:['momo'],mediaReading:media});
 const restored=new Clips({data:ClipsData.parse(structuredClone(f.clips.data)),dir:f.clips.dir}),known=restored.recall('momo','빨간 상자',Date.now()+1000);
 assert.equal(known[0].encounter,'clip-media-samples');assert.equal(known[0].media.audio[1].transcriptSource,'local-asr');assert.deepEqual(restored.recall('gg','빨간 상자'),[]);assert.ok(!JSON.stringify(restored.get(f.clip.id)).includes('signature'));assert.ok(!JSON.stringify(restored.list()).includes('frameTimes'));
 restored.remove(f.clip.id);assert.deepEqual(restored.recall('momo','빨간 상자'),[]);
});
