import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startServer} from '../server/index.js';
import {Settings} from '../server/schema.js';
import {defaults} from '../shared/defaults.js';
import {finishOnboarding} from '../server/onboarding.js';
import {JsonStore} from '../server/storage.js';

const provider={model:'gpt-6-astra',effort:'low',status:()=>({configured:true,model:'gpt-6-astra',effort:'low',kind:'codex'})};
function request(service,path,body){return fetch(service.url+'/api/'+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+service.accessToken,'Content-Type':'application/json','X-Backseat-Client':'studio'},...(body===undefined?{}:{body:JSON.stringify(body)})});}
const welcome={streamer:'하늘',title:'첫 방송',category:'just-chatting',crowdStyle:'lively',streamerStyle:'유쾌한 티키타카',adviceMode:'on-request',mode:'live'};

test('first-run completion persists without resetting unrelated settings, audiences or points',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'backseat-onboarding-'));let service;
  try{
    service=await startServer({port:0,dataDir:dir,provider:{...provider},localSpeech:false});assert.equal(service.studio.state().onboarding.status,'new');
    const original=structuredClone(service.studio.settings);const balance=service.studio.economy.data.balance;
    const response=await request(service,'onboarding',welcome);assert.equal(response.status,200);assert.equal((await response.json()).status,'completed');assert.equal(service.studio.settings.streamer,'하늘');assert.deepEqual(service.studio.settings.personas,original.personas);assert.equal(service.studio.economy.data.balance,balance);assert.equal(service.studio.running,false);assert.equal(service.studio.calls,0);
    await service.close();service=await startServer({port:0,dataDir:dir,provider:{...provider},localSpeech:false});assert.equal(service.studio.state().onboarding.status,'completed');assert.equal(service.studio.settings.category,'just-chatting');assert.equal(service.studio.settings.title,'첫 방송');
    service.studio.start();const denied=await request(service,'onboarding',{skip:true});assert.equal(denied.status,409);service.studio.stop();
  }finally{await service?.close();await rm(dir,{recursive:true,force:true});}
});
test('existing profiles bypass first-run guide; invalid payloads cannot mark completion',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'backseat-onboarding-'));let service;
  try{
    await writeFile(join(dir,'settings.json'),JSON.stringify({...defaults,title:'기존 제목'}));service=await startServer({port:0,dataDir:dir,provider:{...provider},localSpeech:false});assert.equal(service.studio.state().onboarding.status,'existing');
    assert.equal((await request(service,'onboarding',{...welcome,streamer:' '})).status,400);assert.equal((await request(service,'onboarding',{...welcome,personas:[]})).status,400);assert.equal(service.studio.settings.title,'기존 제목');
    assert.equal((await request(service,'onboarding',{skip:true})).status,200);assert.equal(service.studio.state().onboarding.status,'skipped');assert.equal(service.studio.settings.title,'기존 제목');
  }finally{await service?.close();await rm(dir,{recursive:true,force:true});}
});
test('completion storage failure stays retryable and never reports completion',()=>{
  let settings=Settings.parse(defaults);const studio={running:false,training:{active:null},busy:false,get settings(){return settings;},configure:value=>settings=value,publish:()=>{}};
  const store={data:{version:1,status:'new',completedAt:null},save:()=>{throw new Error('disk full');}};
  assert.throws(()=>finishOnboarding(studio,store,welcome),/disk full/);assert.equal(store.data.status,'new');assert.equal(settings.streamer,'하늘');
});
test('failed completion stays a new profile after restart even when settings were saved',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'backseat-onboarding-'));let service;const save=JsonStore.prototype.save;
  try{
    service=await startServer({port:0,dataDir:dir,provider:{...provider},localSpeech:false});
    assert.equal(JSON.parse(await readFile(join(dir,'onboarding.json'),'utf8')).status,'new');
    JsonStore.prototype.save=function(value){if(this.file===join(dir,'onboarding.json')&&value.status==='completed')throw new Error('simulated disk full');return save.call(this,value);};
    const response=await request(service,'onboarding',welcome);assert.equal(response.status,409);assert.equal(service.studio.settings.streamer,'하늘');assert.equal(service.studio.state().onboarding.status,'new');
    JsonStore.prototype.save=save;await service.close();service=await startServer({port:0,dataDir:dir,provider:{...provider},localSpeech:false});assert.equal(service.studio.state().onboarding.status,'new');assert.equal(service.studio.settings.streamer,'하늘');
    assert.equal((await request(service,'onboarding',welcome)).status,200);assert.equal(service.studio.state().onboarding.status,'completed');
  }finally{JsonStore.prototype.save=save;await service?.close();await rm(dir,{recursive:true,force:true});}
});
test('one-call probe is synthetic, serialized, cancellable and never awards points or saves chat',async()=>{
  let observed,resolve;const p={...provider,react:async(args,signal)=>{observed=args;return await new Promise((r,j)=>{resolve=r;signal.addEventListener('abort',()=>j(new Error('cancelled')),{once:true});});}};
  const service=await startServer({port:0,persist:false,provider:p,localSpeech:false});
  try{
    service.studio.configure({...service.studio.settings,title:'PRIVATE_TITLE',streamer:'PRIVATE_STREAMER'});const balance=service.studio.economy.data.balance;
    const first=request(service,'connection/probe',{});while(!observed)await new Promise(r=>setTimeout(r,5));assert.equal(service.studio.state().connectionProbe.status,'checking');
    assert.ok(!JSON.stringify(observed).includes('PRIVATE'));assert.equal(observed.image,undefined);assert.deepEqual(observed.history,[]);assert.equal((await request(service,'connection/probe',{})).status,409);assert.equal((await request(service,'start',{})).status,409);
    assert.equal((await request(service,'connection/probe/cancel',{})).status,200);assert.equal((await(await first).json()).status,'cancelled');assert.equal(service.studio.busy,false);
    observed=null;const again=request(service,'connection/probe',{});while(!observed)await new Promise(r=>setTimeout(r,5));resolve({observation:{messages:[{personaId:'probe',text:'안녕하세요!'}]},usage:{total_tokens:99}});const ready=await(await again).json();assert.equal(ready.status,'ready');assert.equal(ready.tokens,99);assert.equal(service.studio.economy.data.balance,balance);assert.equal(service.studio.calls,0);assert.equal(service.studio.messages.length,0);assert.equal(service.studio.running,false);
  }finally{await service.close();}
});
