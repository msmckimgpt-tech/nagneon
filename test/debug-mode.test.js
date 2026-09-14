import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {startServer} from '../server/index.js';
import {OpenAIProvider} from '../server/provider.js';
import {defaults} from '../shared/defaults.js';

test('debug prompts append, fully replace and restore the generated provider instructions',()=>{
  const provider=new OpenAIProvider({}),args={settings:structuredClone(defaults),history:[],speech:'안녕'};
  const normal=provider.payload(args);
  assert.equal(provider.payload({...args,debugPrompt:{enabled:false,mode:'replace',prompt:'ignored'}}).instructions,normal.instructions);
  const changed=provider.payload({...args,debugPrompt:{enabled:true,mode:'replace',prompt:'사용자 지침'}});
  assert.equal(changed.instructions,'사용자 지침');assert.deepEqual(changed.input,normal.input);assert.deepEqual(changed.text,normal.text);
  assert.equal(provider.payload({...args,debugPrompt:{enabled:true,mode:'append',prompt:'추가 지침'}}).instructions,normal.instructions+'\n\n추가 지침');
});

test('authenticated debug settings persist, override provider requests and unlock existing roster fields only',async()=>{
  const folder=await mkdtemp(resolve('artifacts/debug-mode-'));let service,received;
  const provider=()=>({status:()=>({configured:true}),react:async args=>{received=args;return {observation:{messages:[{personaId:'probe',text:'시험 응답'}]}};}});
  const run=()=>startServer({port:0,dataDir:folder,localSpeech:false,provider:provider()});
  const req=async(path,body,method='PUT')=>{const r=await fetch(service.url+'/api/'+path,{method,headers:{Authorization:'Bearer '+service.accessToken,'Content-Type':'application/json','X-Backseat-Client':'studio'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {ok:r.ok,status:r.status,data:await r.json()};};
  try{
    service=await run();assert.equal((await fetch(service.url+'/api/debug')).status,401);
    assert.equal((await req('debug',undefined,'GET')).data.settings,undefined);
    assert.equal((await req('debug/settings',service.studio.settings)).ok,false);
    const config={enabled:true,mode:'replace',prompt:'사용자가 수정한 시스템 지침'};
    assert.equal((await req('debug',config)).ok,true);
    const view=(await req('debug',undefined,'GET')).data;assert.ok(view.basePrompt.length>100);assert.ok(view.settings.personas[0].personality);
    const privateSettings=structuredClone(view.settings);privateSettings.personas[0].name='새 이름';privateSettings.personas[0].personality='수정된 성격';privateSettings.discovery.arrivalSeconds=99;
    assert.equal((await req('settings',privateSettings)).ok,false);
    assert.equal((await req('debug/settings',{settings:privateSettings,revision:view.revision})).ok,true);assert.equal(service.studio.settings.personas[0].name,'새 이름');
    assert.equal((await req('debug/settings',{settings:privateSettings,revision:view.revision})).ok,false,'stale draft rejected');
    const bad=structuredClone(privateSettings);bad.personas[0].id='changed';assert.equal((await req('debug/settings',{settings:bad,revision:(await req('debug',undefined,'GET')).data.revision})).ok,false);
    service.studio.busy=true;assert.equal((await req('debug',{...config,enabled:false})).ok,false);service.studio.busy=false;
    assert.equal((await req('connection/probe',{},'POST')).ok,true);assert.deepEqual(received.debugPrompt,config);
    await service.close();service=await run();assert.equal(service.studio.settings.personas[0].personality,'수정된 성격');assert.deepEqual((await req('debug',undefined,'GET')).data.config,config);
    await req('debug',{...config,enabled:false});assert.equal((await req('debug',undefined,'GET')).data.settings,undefined);
    await req('connection/probe',{},'POST');assert.equal(received.debugPrompt.enabled,false);
  }finally{await service?.close();await rm(folder,{recursive:true,force:true});}
});

// A previously shipped preview wrote this field into every debug configuration.
// Valid profile data must never be treated as corrupt or rolled back to a backup.
import {readFile,writeFile} from 'node:fs/promises';
import {DebugConfig} from '../server/debug-mode.js';
test('preview debug flags load unchanged and survive stable-client saves and restarts',async()=>{
  const folder=await mkdtemp(resolve('artifacts/debug-preview-'));let service;
  const config={enabled:true,tryNewFeatures:true,mode:'append',prompt:''};
  const original=JSON.stringify(config,null,2);
  const run=()=>startServer({port:0,dataDir:folder,localSpeech:false,provider:{status:()=>({configured:false})}});
  const req=async(body)=>{
    const response=await fetch(service.url+'/api/debug',{method:body?'PUT':'GET',headers:{Authorization:'Bearer '+service.accessToken,'Content-Type':'application/json','X-Backseat-Client':'studio'},...(body?{body:JSON.stringify(body)}:{})});
    assert.equal(response.status,200);return (await response.json()).config;
  };
  try{
    await writeFile(resolve(folder,'debug.json'),original);
    service=await run();assert.deepEqual(await req(),config);
    assert.equal(await readFile(resolve(folder,'debug.json'),'utf8'),original);
    assert.deepEqual(await req({enabled:false,mode:'append',prompt:'keep prompt'}),{...config,enabled:false,prompt:'keep prompt'});
    await service.close();service=await run();assert.equal((await req()).tryNewFeatures,true);
    assert.equal(await readFile(resolve(folder,'debug.json.bak.1'),'utf8'),original);
  }finally{await service?.close();await rm(folder,{recursive:true,force:true});}
});
test('debug compatibility remains typed and does not allow arbitrary keys',()=>{
  const base={enabled:false,mode:'append',prompt:''};
  assert.deepEqual(DebugConfig.parse(base),base);
  assert.equal(DebugConfig.parse({...base,tryNewFeatures:false}).tryNewFeatures,false);
  assert.throws(()=>DebugConfig.parse({...base,tryNewFeatures:'true'}));
  assert.throws(()=>DebugConfig.parse({...base,unknown:true}));
});
