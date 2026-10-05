import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {startServer} from '../server/index.js';
import {hostedModelEnv} from '../server/provider-choice.js';
import {OpenAIProvider} from '../server/provider.js';

test('provider API persists nonsecret choice, keeps audio, and rejects unsafe transitions',async()=>{
  const folder=await mkdtemp(resolve('artifacts/provider-selection-'));
  let release,checking,gate=true,service;
  const fake=kind=>({model:kind,effort:'low',bin:'official-cli',env:{},status:()=>({configured:true,model:kind}),check:async()=>{},react:async()=>({}),transcribe:async()=>kind});
  const local=fake('ollama');
  const options={port:0,dataDir:folder,providerFactories:{codex:()=>fake('codex'),openai:()=>fake('openai'),ollama:()=>local},providerSwitchAllowed:()=>gate,speechWorker:{ready:true,model:'local',start(){},close(){},transcribe:async()=> 'local-stt'}};
  const post=async(path,body)=>{const r=await fetch(service.url+'/api/'+path,{method:'POST',headers:{Authorization:'Bearer '+service.accessToken,'Content-Type':'application/json','X-Backseat-Client':'studio'},body:JSON.stringify(body)});return {ok:r.ok,value:await r.json()};};
  const config={kind:'ollama',model:'fixture',base:'http://127.0.0.1:11434',contextSize:65536};
  try{
    service=await startServer(options);assert.equal(service.studio.provider.status().kind,'codex');
    gate=false;assert.equal((await post('connection/provider',config)).ok,false);gate=true;
    service.studio.busy=true;assert.equal((await post('connection/provider',config)).ok,false);service.studio.busy=false;
    assert.equal((await post('connection/provider',{...config,apiKey:'secret'})).ok,false);
    assert.equal((await post('connection/provider',config)).ok,true);
    assert.equal(service.studio.provider.status().kind,'ollama');assert.equal(await service.studio.provider.transcribe(Buffer.alloc(0),'audio/test'),'local-stt');
    assert.equal(service.studio.state().providerChoice.changing,false);assert.equal(service.studio.state().connectionProbe.status,'untested');
    assert.deepEqual(JSON.parse(await readFile(resolve(folder,'provider-choice.json'),'utf8')),config);
    await service.close();service=await startServer(options);assert.equal(service.studio.provider.status().kind,'ollama');
    assert.equal((await post('connection/provider',{kind:'codex'})).ok,true);
    const entered=new Promise(r=>checking=r);local.check=()=>{checking();return new Promise(r=>release=r);};
    const pending=post('connection/provider',config);await entered;
    assert.equal((await post('start',{})).ok,false);
    await post('stop',{});release();assert.equal((await pending).ok,false);assert.equal(service.studio.provider.status().kind,'codex');
    assert.deepEqual(JSON.parse(await readFile(resolve(folder,'provider-choice.json'),'utf8')),{kind:'codex'});
  }finally{release?.();await service?.close();await rm(folder,{recursive:true,force:true});}
});

for(const model of ['gpt-5.4-mini','gpt-5.6-luna','gpt-6-sol','gpt-6-luna'])test(`hosted model API restores ${model} and resets stale probes`,async()=>{
  const folder=await mkdtemp(resolve('artifacts/hosted-selection-'));let service;
  const fake=config=>new OpenAIProvider({OPENAI_API_KEY:'fixture-secret',...hostedModelEnv(config)});
  const options={port:0,dataDir:folder,localSpeech:false,providerFactories:{codex:fake,openai:fake}};
  const config={kind:'codex',model,effort:'none'};
  const post=async body=>fetch(service.url+'/api/connection/provider',{method:'POST',headers:{Authorization:'Bearer '+service.accessToken,'Content-Type':'application/json','X-Backseat-Client':'studio'},body:JSON.stringify(body)});
  try{
    service=await startServer(options);const response=await post(config);assert.equal(response.ok,true);assert.deepEqual((await response.json()).config,config);
    assert.equal(service.studio.provider.model,config.model);assert.equal(service.studio.provider.effort,'none');
    assert.deepEqual(JSON.parse(await readFile(resolve(folder,'provider-choice.json'),'utf8')),config);
    await service.close();service=await startServer(options);assert.equal(service.studio.provider.model,config.model);assert.equal(service.studio.provider.effort,'none');
    assert.equal(service.studio.state().connectionProbe.status,'untested');
    assert.equal((await post({...config,effort:'invalid'})).ok,false);assert.equal(service.studio.provider.effort,'none');
    service.studio.running=true;assert.equal((await post({kind:'codex'})).ok,false);service.studio.running=false;
    assert.equal((await post({kind:'codex'})).ok,true);assert.equal(service.studio.provider.model,'gpt-6-astra');
  }finally{await service?.close();await rm(folder,{recursive:true,force:true});}
});
