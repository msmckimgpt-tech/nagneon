import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {LocalSpeech} from '../server/local-speech.js';
function setup(runtime={}){const c=new EventEmitter();c.stdin=new PassThrough();c.stdout=new PassThrough();c.stderr=new PassThrough();c.kill=()=>c.emit('close');const sent=[];let launch;c.stdin.on('data',b=>sent.push(JSON.parse(String(b))));const speech=new LocalSpeech({python:process.execPath,...runtime},(python,args,options)=>{launch={python,args,options};return c;});speech.start();c.stdout.write('{"ready":true}\n');return {speech,c,sent,launch,emit:value=>c.stdout.write(JSON.stringify(value)+'\n')};}
test('explicit runtime model wins over the installed default and launches offline',()=>{
  const {speech,launch,emit}=setup({model:'explicit-small-model',modelName:'small'});
  assert.equal(launch.args[launch.args.indexOf('--model-path')+1],'explicit-small-model');
  assert.equal(launch.args[launch.args.indexOf('--model-name')+1],'small');assert.ok(launch.args.includes('--offline'));assert.equal(launch.options.env.HF_HUB_OFFLINE,'1');
  emit({ready:true,model:'small'});assert.equal(speech.model,'small');speech.close();
});
test('a cancelled recognition error cannot reject a newer request',async()=>{
  const {speech,sent,emit}=setup();const old=new AbortController();const first=speech.transcribe(Buffer.from('first'),old.signal);old.abort();await assert.rejects(first,/취소/);
  const second=speech.transcribe(Buffer.from('second'),new AbortController().signal);emit({id:sent[0].id,error:'late failure of cancelled audio'});assert.equal(speech.pending.id,sent[1].id);emit({id:sent[1].id,text:'두 번째 음성'});assert.equal((await second).text,'두 번째 음성');speech.close();
});
test('old successful audio and unknown IDs do not resolve the current recognizer request',async()=>{
  const {speech,sent,emit}=setup();const job=speech.transcribe(Buffer.from('current'),new AbortController().signal);emit({id:'old',text:'wrong speech'});assert.equal(speech.pending.id,sent[0].id);emit({id:sent[0].id,text:'올바른 음성'});assert.equal((await job).text,'올바른 음성');speech.close();
});
test('worker startup failures invalidate readiness and reject the pending request',async()=>{const {speech,emit}=setup();const job=speech.transcribe(Buffer.from('current'),new AbortController().signal);emit({error:'model unavailable'});await assert.rejects(job,/model unavailable/);assert.equal(speech.ready,false);assert.throws(()=>speech.transcribe(Buffer.from('next'),new AbortController().signal),/model unavailable/);speech.close();});
test('worker close releases pending request without leaving a timeout rejection',async()=>{const {speech,c}=setup();const job=speech.transcribe(Buffer.from('current'),new AbortController().signal);c.emit('close');await assert.rejects(job,/종료/);assert.equal(speech.pending,null);assert.equal(speech.ready,false);});
test('a failed audio job keeps the worker ready and the next result includes latency evidence',async()=>{
  const {speech,sent,emit}=setup();
  const failed=speech.transcribe(Buffer.from('invalid'),new AbortController().signal);
  emit({id:sent[0].id,error:'로컬 음성 인식에 실패했습니다.'});await assert.rejects(failed,/실패/);
  assert.equal(speech.ready,true);assert.equal(speech.pending,null);
  const next=speech.transcribe(Buffer.from('valid'),new AbortController().signal);
  const timing={encoderWindowMs:8000,fallback:false,decodeMs:10,recognitionMs:1200,cuesMs:5,processingMs:1215};
  emit({id:sent[1].id,text:'다음 발언',timing});assert.deepEqual(await next,{text:'다음 발언',cues:undefined,timing});speech.close();
});
import {defaults} from '../shared/defaults.js';
import {Settings} from '../server/schema.js';
test('GPU is the persisted default for both new and existing settings',()=>{
  assert.equal(defaults.speechDevice,'gpu');const old={...defaults};delete old.speechDevice;
  assert.equal(Settings.parse(old).speechDevice,'gpu');
  assert.equal(Settings.parse({...old,speechDevice:'cpu'}).speechDevice,'cpu');
  assert.throws(()=>Settings.parse({...old,speechDevice:'automatic'}));
});
test('GPU launch and fallback status remain distinct from readiness errors',()=>{
  const {speech,launch,emit}=setup();assert.equal(launch.args[launch.args.indexOf('--device')+1],'gpu');
  emit({ready:true,device:'CPU / int8',fallback:true});
  assert.equal(speech.ready,true);assert.equal(speech.device,'CPU / int8');assert.equal(speech.fallback,true);assert.equal(speech.error,'');speech.close();
});
test('CPU selection restarts only an idle worker and passes the chosen device',async()=>{
  const children=[],launches=[];
  const speech=new LocalSpeech({python:process.execPath},(_python,args)=>{
    const c=new EventEmitter();c.stdin=new PassThrough();c.stdout=new PassThrough();c.stderr=new PassThrough();c.kill=()=>setImmediate(()=>c.emit('close'));
    children.push(c);launches.push(args);setImmediate(()=>c.stdout.write('{"ready":true}\n'));return c;
  });
  await speech.prepare();await speech.prepare(undefined,'cpu');
  assert.equal(children.length,2);assert.equal(launches[1][launches[1].indexOf('--device')+1],'cpu');
  await speech.prepare(undefined,'cpu');assert.equal(children.length,2);
  const job=speech.transcribe(Buffer.from('voice'),new AbortController().signal);
  await assert.rejects(speech.prepare(undefined,'gpu'),/이전 음성/);
  children[1].stdout.write(JSON.stringify({id:speech.pending.id,text:'인식 유지'})+'\n');assert.equal((await job).text,'인식 유지');await speech.close();
});
import {startServer} from '../server/index.js';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('service startup stays idle and on-demand audio preparation honors the stored CPU selection',async()=>{
 const dataDir=mkdtempSync(join(tmpdir(),'nagneon-gpu-settings-'));
 const provider=()=>({status:()=>({configured:false,model:'test',effort:'low'})});
 let service=await startServer({port:0,dataDir,provider:provider(),localSpeech:false});
 service.studio.configure({...service.studio.settings,speechDevice:'cpu'});await service.close();
 const calls=[];const speech={start:device=>calls.push(['start',device]),prepare:async(_signal,device)=>calls.push(['prepare',device]),close:async()=>{}};
 service=await startServer({port:0,dataDir,provider:provider(),speechWorker:speech});
 try{
  assert.deepEqual(calls,[]);
  const response=await fetch(service.url+'/api/audio/prepare',{method:'POST',headers:{Authorization:'Bearer '+service.accessToken,Origin:service.url,'X-Backseat-Client':'studio'}});
  assert.equal(response.status,200);assert.deepEqual(calls.at(-1),['prepare','cpu']);
 }finally{await service.close();}
});

 test('confirmed non-speech marker survives the worker boundary', async()=>{
 const {speech,sent,emit}=setup();const job=speech.transcribe(Buffer.from('noise'),new AbortController().signal);
 emit({id:sent[0].id,text:'',noSpeech:true});assert.equal((await job).noSpeech,true);await speech.close();
 });
