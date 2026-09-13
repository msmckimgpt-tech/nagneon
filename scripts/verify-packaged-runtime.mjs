// Developer acceptance: synthetic Korean audio, optionally one real Astra call.
// Never reads account credentials; the bundled official CLI owns login.
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {extractAll} from '@electron/asar';
import assert from 'node:assert/strict';
const option=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const folder=option('folder')||JSON.parse(await readFile(resolve('artifacts/latest-package.json'),'utf8')).folder;
const reportPath=resolve(option('report')||'artifacts/packaged-runtime-test.json');
let appRoot=join(folder,'resources/app'),archiveSha256=null;
// Plain Node cannot resolve modules inside Electron's ASAR. Extract that exact
// delivered archive into a fresh evidence folder; native launch is tested
// separately against the original installed archive and enabled ASAR fuses.
if(!existsSync(appRoot)){
  const archive=join(folder,'resources/app.asar');
  archiveSha256=createHash('sha256').update(await readFile(archive)).digest('hex');
  appRoot=await mkdtemp(join(dirname(reportPath),'runtime-modules-'));
  extractAll(archive,appRoot);
  assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'),archiveSha256);
}
const load=path=>import(pathToFileURL(join(appRoot,path)));
// Exercise the delivered application modules, not similarly named source files
// in the development checkout.
const [{LocalSpeech},{LocalSound},{CodexProvider},{defaults},{Settings}]=await Promise.all([
  load('server/local-speech.js'),load('server/local-sound.js'),load('server/codex-provider.js'),load('shared/defaults.js'),load('server/schema.js')
]);
const require=createRequire(pathToFileURL(join(appRoot,'package.json')));
const {packagedRuntime}=require(join(appRoot,'desktop/runtime.cjs'));
const runtime=packagedRuntime(join(folder,'resources'));
// Child processes cannot find the development Node/Python/Codex through PATH.
process.env.PATH=join(process.env.SystemRoot,'System32')+';'+process.env.SystemRoot;
delete process.env.PYTHONHOME;delete process.env.PYTHONPATH;
const speech=new LocalSpeech(runtime.speech);
const sound=new LocalSound(runtime.sound);
const report={folder,appRoot,archiveSha256,extractedDeliveredArchive:!!archiveSha256,checkedAt:new Date().toISOString(),restrictedPath:true,deliveredModules:true,syntheticAudio:true,liveModel:false,checks:[]};
try{
  speech.start();const start=Date.now();
  while(!speech.ready&&Date.now()-start<30000){if(speech.error)throw new Error(speech.error);await new Promise(r=>setTimeout(r,100));}
  assert.equal(speech.ready,true);report.speechReadyMs=Date.now()-start;
  const audio=await readFile(resolve('artifacts/korean-fixture.wav')),transcribedAt=Date.now();
  const transcript=await speech.transcribe(audio,new AbortController().signal);
  assert.match(transcript.text,/오늘|게임|이야기/);assert.equal(transcript.cues.confidence,'low');
  report.transcript=transcript;report.transcriptionMs=Date.now()-transcribedAt;report.checks.push('bundled embedded Python, offline model, worker JSONL and Korean transcription');
  const soundStart=Date.now();await sound.prepare(new AbortController().signal);report.soundReadyMs=Date.now()-soundStart;
  const short=await readFile(resolve('artifacts/sound-dialogue-fixture.wav'));
  const heardAt=Date.now();report.heard=await sound.analyze(short,new AbortController().signal);report.soundMs=Date.now()-heardAt;
  assert.equal(report.heard.source,'system-output');assert.ok(report.heard.classes.some(c=>c.label==='Speech'));assert.match(report.heard.systemSpeech,/안녕|오늘|게임/);report.checks.push('bundled offline YAMNet and separate system-dialogue transcription');
  const provider=new CodexProvider({...process.env,CODEX_BIN:runtime.codexBin});await provider.check();
  assert.equal(provider.available,true);assert.equal(provider.model,'gpt-6-astra');assert.equal(provider.effort,'low');report.checks.push('bundled official CLI recognizes existing ChatGPT subscription login');
  if(process.argv.includes('--live')){
    const settings=Settings.parse({...defaults,mode:'live',category:'just-chatting'});
    const started=Date.now();const result=await provider.react({settings,history:[],speech:transcript.text,voiceCues:transcript.cues,adviceRequested:false},new AbortController().signal);
    assert.ok(result.observation.messages.length>0);assert.ok(result.observation.messages.every(m=>settings.personas.some(p=>p.id===m.personaId)));
    report.liveModel=true;report.modelMs=Date.now()-started;report.result=result;report.checks.push('real Astra low conversation through bundled CLI');
  }
  if(process.argv.includes('--sound-live')){
    const {Studio}=await load('server/studio.js');
    let clock=Date.now();const studio=new Studio({provider,now:()=>clock,settings:{...defaults,mode:'live',category:'just-chatting',chatPace:3,lurkRatio:0}});
    try{
      studio.start();const id=randomUUID();studio.sound.start(id);const startedAt=clock;
      clock+=Math.round(report.heard.durationSeconds*1000);
      const ticket=studio.sound.begin({id,segmentId:randomUUID(),startedAt,endedAt:clock});
      assert.ok(ticket.witnesses.length);studio.sound.finish(ticket,report.heard);
      const started=Date.now();await studio.react({speech:'지금 공유되는 소리에 자연스럽게 반응해 줘. 화면은 공유하지 않았어.'});
      assert.equal(studio.calls,1);assert.equal(studio.lastError,'');assert.ok(studio.observation);
      report.soundLive={ms:Date.now()-started,virtualCaptureClock:true,rawAudioSentToAstra:false,witnesses:ticket.witnesses,observation:studio.observation,queued:studio.queue.map(q=>({personaId:q.personaId,text:q.text}))};
      assert.ok(report.soundLive.queued.length);report.liveModel=true;
      report.checks.push('installed sound classification and system dialogue reach installed Studio and real Astra low through per-viewer sound context');
    }finally{studio.close();}
  }
  report.passed=true;
}catch(error){report.passed=false;report.error=error.message;process.exitCode=1;}
finally{speech.close();sound.close();await writeFile(reportPath,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
