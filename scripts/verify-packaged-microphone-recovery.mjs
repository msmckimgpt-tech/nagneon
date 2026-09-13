// Delivered ASAR modules + bundled real Whisper/YAMNet. Only synthetic files;
// no Electron launch, microphone/loopback capture, account or game interaction.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {extractAll} from '@electron/asar';
import {verifyMicrophoneModel} from './lib/microphone-model.mjs';
const {values}=parseArgs({options:{folder:{type:'string'},corpus:{type:'string'},sound:{type:'string'},audio:{type:'string'},output:{type:'string'}}});
for(const name of ['folder','corpus','sound','audio','output'])assert.ok(values[name],'Missing --'+name);
const folder=resolve(values.folder),output=resolve(values.output);await mkdir(output,{recursive:true});assert.equal((await readdir(output)).length,0,'Use a new output directory');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),archive=join(folder,'resources/app.asar');
const archiveSha256=hash(await readFile(archive)),source=join(output,'source');extractAll(archive,source);
const load=path=>import(pathToFileURL(join(source,path)));
const [{LocalSpeech},{LocalSound},{startServer},{packagedRuntime}]=await Promise.all([load('server/local-speech.js'),load('server/local-sound.js'),load('server/index.js'),load('desktop/runtime.cjs')]);
const runtime=packagedRuntime(join(folder,'resources'));
assert.equal(runtime.speech.modelName,'medium');await verifyMicrophoneModel(runtime.speech.model);assert.notEqual(runtime.speech.model,runtime.sound.speechModel);
process.env.PATH=join(process.env.SystemRoot,'System32')+';'+process.env.SystemRoot;
delete process.env.PYTHONHOME;delete process.env.PYTHONPATH;process.env.HF_HOME=join(output,'cache');process.env.PYTHONDONTWRITEBYTECODE='1';
const runs=[],children=[];
function ownSpawn(kind){return (executable,args,options)=>{
  assert.equal(resolve(executable),resolve(runtime.speech.python));assert.equal(resolve(args[3]),resolve(kind==='microphone'?runtime.speech.worker:runtime.sound.worker));assert.equal(options.windowsHide,true);assert.ok(args.includes('-B'));
  const child=spawn(executable,args,options),run={kind,pid:child.pid,executable,args,startedAt:new Date().toISOString()};runs.push(run);children.push(child);
  child.on('close',(code,signal)=>Object.assign(run,{closedAt:new Date().toISOString(),code,signal}));return child;
};}
const speech=new LocalSpeech(runtime.speech,ownSpawn('microphone')),sound=new LocalSound(runtime.sound,ownSpawn('sound'));
const corpus=JSON.parse((await readFile(resolve(values.corpus),'utf8')).replace(/^\uFEFF/,''));assert.equal(corpus.synthetic,true);assert.equal(corpus.deviceCapture,false);
const audio=await readFile(resolve(values.audio)),soundAudio=await readFile(resolve(values.sound));
const result={passed:false,folder,archiveSha256,extractedDeliveredArchive:true,restrictedPath:true,physicalCapture:false,nativeApp:false,realWhisper:true,realYamnet:true,modelCalls:0,runtime:{microphoneModel:'medium',soundSpeechModel:'small'},runs,checks:[],utterances:[],inputs:{audioSha256:hash(audio),soundSha256:hash(soundAudio),voice:corpus.voice}};
let service;
async function until(predicate,label,ms=10000){const end=Date.now()+ms;while(!predicate()){if(Date.now()>end)throw Error(label);await new Promise(r=>setTimeout(r,10));}}
const normalized=value=>value.normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu,'');
try{
  service=await startServer({port:0,dataDir:join(output,'profile'),runtime,speechWorker:speech,soundWorker:sound,provider:{status:()=>({configured:true,kind:'synthetic'})}});
  clearInterval(service.studio.timer);const s=service.studio;s.configure({...s.settings,mode:'live',category:'just-chatting'});s.start();
  const headers={Authorization:'Bearer '+service.accessToken,'X-Backseat-Client':'studio'};
  const post=async(path,body)=>{const response=await fetch(service.url+'/api/'+path,{method:'POST',headers:{...headers,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,body:await response.json()};};
  const transcribe=async(bytes,label)=>{const at=Date.now(),response=await fetch(service.url+'/api/audio',{method:'POST',headers:{...headers,'Content-Type':'audio/wav'},body:bytes});const data={label,status:response.status,ms:Date.now()-at,body:await response.json()};result.utterances.push(data);return data;};
  let at=Date.now();assert.equal((await post('audio/prepare')).status,200);result.readyMs=Date.now()-at;assert.equal(speech.model,'medium');
  await sound.prepare(new AbortController().signal);const soundChild=sound.child;
  const first=await transcribe(audio,'before-crash');assert.equal(first.status,200);assert.match(first.body.text,/오늘|게임|이야기/);
  assert.equal((await post('speech',{id:randomUUID(),sessionId:s.sessionId,text:first.body.text,source:'microphone'})).status,200);
  const session=s.sessionId,settings=JSON.stringify(s.settings),balance=s.economy.data.balance;assert.ok(Number.isFinite(balance));
  const soundJob=sound.analyze(soundAudio,new AbortController().signal);const soundResult=soundJob.then(value=>({value}),error=>({error:error.message}));
  const damaged=transcribe(audio,'interrupted-mid-recognition');await until(()=>!!speech.pending,'real Whisper request did not begin');
  const old=speech.child;assert.ok(children.includes(old));assert.equal(old.exitCode,null);assert.equal(old.killed,false);result.interruption={pid:old.pid,at:new Date().toISOString(),ownedChild:true};assert.equal(old.kill(),true);
  const failure=await damaged;assert.equal(failure.status,409);assert.equal(failure.body.needsPreparation,true);await until(()=>speech.child===null,'interrupted Whisper did not close');
  at=Date.now();assert.equal((await post('audio/prepare')).status,200);result.recoveryReadyMs=Date.now()-at;assert.notEqual(speech.child,old);assert.equal(speech.model,'medium');
  assert.equal(s.running,true);assert.equal(s.sessionId,session);assert.equal(JSON.stringify(s.settings),settings);assert.equal(s.economy.data.balance,balance);assert.equal(s.messages.filter(m=>m.text===first.body.text).length,1);
  result.checks.push('real medium worker interrupted during recognition and replaced without restarting the session or losing accepted speech');
  const heard=await soundResult;assert.equal(heard.error,undefined);assert.equal(sound.child,soundChild);assert.equal(heard.value.source,'system-output');assert.ok(heard.value.classes.some(c=>c.label==='Speech'));assert.match(heard.value.systemSpeech,/안녕|오늘|게임/);result.heard=heard.value;result.checks.push('independent bundled YAMNet and small dialogue decoder complete while microphone recovers');
  const invalid=await transcribe(Buffer.from('not a wav file'),'invalid-audio');assert.equal(invalid.status,409);assert.equal(invalid.body.needsPreparation,undefined);const healthy=speech.child;
  for(const item of corpus.items){const bytes=await readFile(item.file);assert.equal(hash(bytes),item.sha256);const current=await transcribe(bytes,item.id);assert.equal(current.status,200);assert.equal(normalized(current.body.text),normalized(item.text));assert.equal(speech.child,healthy);
    assert.equal((await post('speech',{id:randomUUID(),sessionId:session,text:current.body.text,source:'microphone'})).status,200);}
  assert.equal(s.messages.filter(message=>message.personaId==='streamer').length,1+corpus.items.length);
  result.checks.push('invalid audio does not restart the worker; four synthetic short Korean replies transcribe and deliver after recovery');
  assert.equal(s.calls,0);assert.equal(s.audioBusy,false);result.sessionPreserved=true;result.passed=true;
}catch(error){result.error=error.stack;process.exitCode=1;}
finally{
  try{if(service)await service.close();else{await speech.close();sound.close();}await until(()=>runs.every(run=>run.closedAt),'a verification-owned worker is still running',7000);result.ownedWorkersClosed=true;}
  catch(error){result.passed=false;result.shutdownError=error.stack;process.exitCode=1;}
  assert.equal(hash(await readFile(archive)),archiveSha256);await writeFile(join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}
