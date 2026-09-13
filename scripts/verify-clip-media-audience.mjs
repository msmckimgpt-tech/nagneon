// Actual file decoder + local speech/sound models + Astra, without devices/UI.
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {extractAll} from '@electron/asar';
import assert from 'node:assert/strict';

const {values}=parseArgs({options:{folder:{type:'string'},'runtime-resources':{type:'string'},fixtures:{type:'string',default:'artifacts/clip-media-fixture'}}});
await mkdir('artifacts',{recursive:true});const folder=await mkdtemp(resolve('artifacts/clip-media-astra-'));
const report={folder,synthetic:true,deviceCapture:false,nativeApp:false,passed:false,sourceHashes:{},calls:[]};const hash=b=>createHash('sha256').update(b).digest('hex');
let source=resolve('.'),runtime;
if(values.folder){report.deliveredFolder=resolve(values.folder);const archive=join(report.deliveredFolder,'resources/app.asar');source=join(folder,'source');extractAll(archive,source);report.archiveSha256=hash(await readFile(archive));const {packagedRuntime}=await import(pathToFileURL(join(source,'desktop/runtime.cjs')));runtime=packagedRuntime(join(report.deliveredFolder,'resources'));}
else{
 assert.ok(values['runtime-resources'],'Provide --folder or --runtime-resources');const resources=resolve(values['runtime-resources']);
 runtime={codexBin:join(resources,'codex/bin/codex.exe'),clips:{python:join(resources,'speech/python/python.exe')},speech:{model:join(resources,'speech/microphone-model')},sound:{model:join(resources,'sound/model')},clipPerception:{worker:resolve('scripts/clip_perception.py')}};
}
const load=p=>import(pathToFileURL(join(source,p)));
const [{startServer},{Settings},{defaults},{CodexProvider}]=await Promise.all([load('server/index.js'),load('server/schema.js'),load('shared/defaults.js'),load('server/codex-provider.js')]);
for(const f of ['server/clip-perception.js','server/clip-media-context.js','server/community-activity.js','server/clip-memory.js','server/clips.js','server/data-schema.js','server/provider.js','server/studio.js','server/index.js','desktop/runtime.cjs'])report.sourceHashes[f]=hash(await readFile(join(source,f)));
report.sourceHashes['scripts/clip_perception.py']=hash(await readFile(runtime.clipPerception.worker));
const fixture=JSON.parse(await readFile(join(values.fixtures,'fixture.json')));assert.equal(fixture.synthetic,true);assert.equal(fixture.deviceCapture,false);report.fixture=fixture;
let service;
try{
 const provider=new CodexProvider({...process.env,CODEX_BIN:runtime.codexBin,OPENAI_MODEL:'gpt-6-astra',OPENAI_REASONING_EFFORT:'low'});await provider.check();assert.ok(provider.available,provider.authMessage);
 const relay={status:()=>provider.status(),react:async(args,signal)=>{const entry={input:provider.payload(args),startedAt:Date.now()};report.calls.push(entry);const result=await provider.react(args,signal);Object.assign(entry,{ms:Date.now()-entry.startedAt,...result});return result;}};
 const profile=join(folder,'profile');service=await startServer({port:0,dataDir:profile,provider:relay,localSpeech:false,runtime});const s=service.studio;
 s.world.change(d=>{d.settings=Settings.parse({...defaults,mode:'live',personas:defaults.personas.filter(p=>['momo','luna'].includes(p.id))});for(const p of d.settings.personas){d.audience.members[p.id]={sessions:1,seconds:600,recognized:0,affinity:.5,peers:{},memories:[]};s.economy.wallet(d.economy,p.id);}});
 const now=Date.now(),clip=s.clips.create({title:'통과한 순간',game:'합성 퍼즐',scene:'파란 원이 왼쪽 끝으로 돌아갔다.',participants:[],messages:[],sessionId:randomUUID(),source:'spectator',observedAt:now-1500});
 for(const [name,kind] of [['game.webm','video'],['voice.webm','voice']]){const bytes=await readFile(join(values.fixtures,name));assert.equal(hash(bytes),fixture.files.find(f=>f.name===name).sha256);s.clips.recording(clip.id,bytes,{kind,startedAt:now-fixture.durationMs,endedAt:now,hasAudio:true,audioLayout:'separate'});}
 const started=Date.now();s.random=()=>0;s.now=()=>Date.now()+61000;
 const deadline=Date.now()+130000;
 while(Date.now()<deadline){if(report.calls.length&&!s.communityActivity.active)break;if(s.communityActivity.lastError)throw Error(s.communityActivity.lastError);await new Promise(r=>setTimeout(r,100));}
 assert.equal(report.calls.length,1);assert.equal(s.communityActivity.active,null);assert.equal(s.communityActivity.lastError,'');report.totalMs=Date.now()-started;
 const saved=s.clips.data.find(c=>c.id===clip.id);report.clip=structuredClone(saved);report.media=saved.readings[0].media;
 assert.ok(report.media.frameTimes.length>=8);assert.deepEqual(report.media.audio.map(a=>a.source),['system-output','microphone']);assert.match(report.media.audio[0].transcript,/오른쪽/);assert.match(report.media.audio[1].transcript,/드디어/);
 const observation=report.calls[0].observation;assert.match(observation.scene,/빨간|빨강|붉/);assert.match(observation.scene,/오른/);assert.doesNotMatch(observation.scene,/파란 원/);
 const headers={Authorization:'Bearer '+service.accessToken,'X-Backseat-Client':'studio'};for(const path of ['/api/state','/api/clips/'+clip.id]){const text=await(await fetch(service.url+path,{headers})).text();assert.ok(!text.includes('frameTimes')&&!text.includes('local-asr'));}
 await service.close();service=null;service=await startServer({port:0,dataDir:profile,provider:relay,localSpeech:false,runtime});clearInterval(service.studio.timer);
 const memory=service.studio.clips.recall('momo','빨간 상자',Date.now()+62000);assert.equal(memory[0].encounter,'clip-media-samples');assert.deepEqual(service.studio.clips.recall('luna','빨간 상자'),[]);report.restartedMemory=memory;
 report.passed=true;
}catch(e){report.error=e.stack;process.exitCode=1;}
finally{await service?.close();await writeFile(join(folder,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({folder,passed:report.passed,totalMs:report.totalMs,frames:report.media?.frameTimes.length,audio:report.media?.audio,observation:report.calls[0]?.observation,error:report.error}));}
