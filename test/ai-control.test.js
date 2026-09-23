import test from 'node:test';
import assert from 'node:assert/strict';
import {AiControl,AI_FEATURES,normalizeUsage,emptyAiControl} from '../server/ai-control.js';
import {ProviderRouter} from '../server/provider-routing.js';
import {OpenAIProvider} from '../server/provider.js';
import {startServer} from '../server/index.js';
import {Studio} from '../server/studio.js';
import {defaults} from '../shared/defaults.js';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {ProviderChoice} from '../server/provider-choice.js';

const response=(usage)=>({observation:{messages:[]},usage});
const fake=(react=async()=>response())=>({model:'synthetic',status:()=>({kind:'openai',configured:true}),react});
const request=(feature='probe')=>({aiFeature:feature,settings:defaults,history:[]});
const fixture=()=>{let now=Date.parse('2026-09-23T14:59:00Z'),saved;const ai=new AiControl({now:()=>now,save:d=>saved=structuredClone(d)});return {ai,advance:ms=>now+=ms,get saved(){return saved;}};};

test('all registered background paths default to blocked; unknown feature fails closed without contacting provider',async()=>{
 const {ai}=fixture();let calls=0;const p=ai.wrap(fake(async()=>{calls++;return response();}));
 for(const f of AI_FEATURES.filter(f=>f.scope==='background'))await assert.rejects(p.react(request(f.id)),e=>e.code==='ai_blocked');
 await assert.rejects(p.react({}),e=>e.code==='ai_blocked');await assert.rejects(p.react(request('future-unregistered')),e=>e.code==='ai_blocked');
 assert.equal(calls,0);assert.equal(ai.snapshot().recent.length,0);assert.equal('dailyLimit' in ai.snapshot().policy,false);
 assert.throws(()=>ai.update({features:{'future-unregistered':true}}));for(const dailyLimit of [null,0,1,100000])assert.throws(()=>ai.update({dailyLimit}));
});
test('old background-enabled setting cannot cause calls just by leaving app open',t=>{
 let at=1000000,calls=0;const s=new Studio({now:()=>at,settings:{...defaults,mode:'live',communityActivityEnabled:true,cultureDomains:['https://example.org']},provider:fake(async()=>{calls++;return response();})});clearInterval(s.timer);t.after(()=>s.close());
 s.culture.collect=()=>{throw Error('background collection must also remain blocked');};
 for(let i=0;i<20;i++){at+=3600000;s.pump();}
 assert.equal(calls,0);assert.equal(s.culture.active,null);assert.equal(s.communityActivity.active,null);
});
test('legacy cap is discarded while concurrent usage, policies and restart history are preserved',async()=>{
 const data=emptyAiControl();data.policy.dailyLimit=1;data.policy.background=true;data.policy.features.interview=false;
 let now=Date.parse('2026-09-23T14:59:00Z'),saved;
 const ai=new AiControl({data,now:()=>now,save:d=>saved=structuredClone(d)}),finish=[];
 const p=ai.wrap(fake(()=>new Promise(r=>finish.push(r))));
 const jobs=[p.react(request()),p.react(request()),p.react(request())];assert.equal(finish.length,3);
 for(const resolve of finish)resolve(response({total_tokens:7}));await Promise.all(jobs);
 assert.equal(ai.snapshot().usage.today.probe.calls,3);assert.equal(ai.snapshot().usage.today.probe.total,21);
 assert.equal('dailyLimit' in saved.policy,false);assert.equal(saved.policy.background,true);assert.equal(saved.policy.features.interview,false);
 const restored=new AiControl({data:saved,now:()=>now});assert.equal(restored.allowed('probe'),true);assert.equal(restored.allowed('interview'),false);
 await restored.wrap(fake()).react(request());assert.equal(restored.snapshot().usage.today.probe.calls,4);
 now+=60001;assert.equal(ai.allowed('probe'),true);assert.equal(ai.snapshot().usage.week.probe.calls,3);assert.equal(ai.snapshot().usage.today.probe,undefined);
});
test('pause persists, aborts inflight, retains reported usage and rejects late response after resume',async()=>{
 const f=fixture();let finish,signal;const p=f.ai.wrap(fake((args,s)=>{signal=s;args.onAiUsage({input_tokens:10,output_tokens:2});return new Promise(r=>finish=r);}));
 const job=p.react(request('interview'));f.ai.update({paused:true});assert.equal(signal.aborted,true);assert.equal(new AiControl({data:f.saved}).data.policy.paused,true);
 f.ai.update({paused:false});finish(response({input_tokens:10,output_tokens:2}));await assert.rejects(job);const r=f.ai.snapshot().recent[0];assert.equal(r.status,'cancelled');assert.equal(r.usage.total,12);assert.equal(r.application,'unconfirmed');
 const good=await f.ai.wrap(fake(async()=>response({total_tokens:3}))).react(request());f.ai.update({features:{probe:false}});assert.throws(()=>f.ai.assertCurrent(good),e=>e.code==='ai_cancelled');
});
test('fallback attempts exceed a legacy cap but still respect manual pause',async()=>{
 const config={kind:'routing',version:1,connections:['first','second'].map(id=>({id,label:id,provider:{kind:'codex',model:id}})),routes:{default:{primary:'first',fallbacks:['second']}}};
 for(const pause of [false,true]){
  const data=emptyAiControl();data.policy.dailyLimit=1;const ai=new AiControl({data}),called=[];
  const p=ai.wrap(new ProviderRouter(config,{create:c=>({...fake(async()=>{called.push(c.id);if(c.id==='first'){if(pause)ai.update({paused:true});throw Object.assign(Error('network'),{code:'network'});}return response({total_tokens:4});}),model:c.id})}));
  if(pause)await assert.rejects(p.react(request()));else await p.react(request());
  assert.deepEqual(called,pause?['first']:['first','second']);assert.equal(ai.snapshot().usage.today.probe.calls,pause?1:2);
  assert.equal(ai.snapshot().recent[0].connection,pause?'first':'second');
 }
});
test('attempt instrumentation preserves prepared culture and debug context through the stable provider facade',async()=>{
 const f=fixture();let received;
 const choice=new ProviderChoice({factories:{codex:()=>fake(async a=>{received=a;return response();})},initial:{kind:'codex'}});
 const prepared=new Proxy(choice,{get(target,key,receiver){if(key==='react')return (args,signal)=>target.react({...args,culture:{enabled:true},debugPrompt:'synthetic prepared prompt'},signal);return Reflect.get(target,key,receiver);}});
 await f.ai.wrap(prepared).react(request());assert.deepEqual(received.culture,{enabled:true});assert.equal(received.debugPrompt,'synthetic prepared prompt');assert.equal(f.ai.data.recent.length,1);
 assert.ok(!JSON.stringify(f.saved).includes('synthetic prepared prompt'));
});
test('partial/missing usage stays unknown and cached tokens are not counted twice in estimated cost',async()=>{
 assert.equal(normalizeUsage({}),null);assert.deepEqual(normalizeUsage({input_tokens:9}),{input:9,cached:null,output:null,total:null});
 const f=fixture();f.ai.update({rates:[{connection:'',model:'synthetic',input:2,cached:.5,output:4}]});
 const p=f.ai.wrap(fake(async()=>response({input_tokens:100,cached_input_tokens:20,output_tokens:10,total_tokens:110})));
 await p.react(request());const r=f.ai.snapshot().recent[0];assert.equal(r.usage.total,110);assert.equal(r.estimatedUsd,(80*2+20*.5+10*4)/1e6);
 await f.ai.wrap(fake()).react(request());assert.equal(f.ai.snapshot().recent[0].usage,null);assert.equal(f.ai.snapshot().recent[0].estimatedUsd,null);assert.equal(f.ai.snapshot().usage.today.probe.unknown,1);
});
test('usage is retained even when provider response parsing fails',async()=>{
 const f=fixture();const backend=new OpenAIProvider({OPENAI_API_KEY:'synthetic-test-key'},async()=>({ok:true,json:async()=>({status:'completed',output_text:'invalid-json',usage:{input_tokens:5,output_tokens:3}})}));
 await assert.rejects(f.ai.wrap(backend).react(request()));assert.equal(f.ai.snapshot().recent[0].status,'failed');assert.equal(f.ai.snapshot().recent[0].usage.total,8);
 assert.ok(!JSON.stringify(f.saved).includes('synthetic-test-key'));assert.ok(!JSON.stringify(f.saved).includes('invalid-json'));
});
test('storage failure prevents dispatch and process recovery distinguishes unknown interrupted usage',async()=>{
 let calls=0;const ai=new AiControl({save:()=>{throw Error('disk full');}});await assert.rejects(ai.wrap(fake(async()=>{calls++;return response();})).react(request()),e=>e.code==='ai_blocked');assert.equal(calls,0);assert.ok(ai.storageError);
 const f=fixture();let finish;const job=f.ai.wrap(fake(()=>new Promise(r=>finish=r))).react(request());const recovered=new AiControl({data:f.saved});assert.equal(recovered.snapshot().recent[0].status,'interrupted');assert.equal(recovered.snapshot().usage.today.probe?.unknown??recovered.data.days[0].features.probe.unknown,1);finish(response());await job;
});
test('local speech bypasses external AI controls while remote transcription has its own recorded model and provider',async()=>{
 const f=fixture();f.ai.update({paused:true});const local=f.ai.wrap({localSpeech:true,transcribe:async()=>({text:'synthetic'})});assert.equal((await local.transcribe(Buffer.alloc(1),'audio/wav')).text,'synthetic');assert.equal(f.ai.data.recent.length,0);
 f.ai.update({paused:false});const remote=f.ai.wrap({...fake(),transcriptionModel:'transcription-test',transcribe:async(_b,_m,_s,usage)=>{usage({total_tokens:9});return 'synthetic';}});await remote.transcribe(Buffer.alloc(1),'audio/wav');const row=f.ai.data.recent[0];assert.equal(row.featureId,'remote-stt');assert.equal(row.model,'transcription-test');assert.equal(row.provider,'openai');assert.equal(row.usage.total,9);
});
test('pausing a paid interview refunds held points and discards late output',async t=>{
 let finish;const s=new Studio({settings:{...defaults,mode:'live'},provider:fake(()=>new Promise(r=>finish=r))});clearInterval(s.timer);t.after(()=>s.close());s.start();const id=randomUUID(),before=s.economy.data.balance;const job=s.special.generate({kind:'interview',personaId:'momo',question:'좋아하는 게임은?',requestId:id});assert.ok(s.economy.data.balance<before);s.ai.update({paused:true});finish(response({total_tokens:8}));await assert.rejects(job);assert.equal(s.economy.data.balance,before);assert.equal(s.ai.data.recent[0].usage.total,8);assert.equal(s.economy.data.purchases.find(p=>p.id===id).status,'failed');
});
test('authenticated policy API and connection probe use the same controller; dashboard reads do not invoke AI',async t=>{
 let calls=0;const service=await startServer({port:0,persist:false,localSpeech:false,provider:fake(async()=>{calls++;return {observation:{messages:[{personaId:'probe',text:'연결됨'}]},usage:{total_tokens:4}};})});t.after(()=>service.close());
 const headers={Authorization:'Bearer '+service.accessToken,'X-Backseat-Client':'studio','Content-Type':'application/json'};
 const req=(path,body,method=body?'PATCH':'GET')=>fetch(service.url+'/api/'+path,{headers,method,...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await fetch(service.url+'/api/ai')).status,401);assert.equal((await req('ai')).status,200);assert.equal(calls,0);
 assert.equal((await req('ai/policy',{dailyLimit:1})).status,400);
 assert.equal((await req('ai/policy',{paused:true})).status,200);await req('connection/probe',{},'POST');assert.equal(calls,0);
 await req('ai/policy',{paused:false});await req('connection/probe',{},'POST');assert.equal(calls,1);const snapshot=await(await req('ai')).json();assert.equal(snapshot.usage.today.probe.calls,1);assert.equal(snapshot.recent[0].application,'accepted');
});
test('policy and usage survive actual server/profile restart without changing saved world or balance',async t=>{
 await mkdir(resolve('artifacts'),{recursive:true});
 const dir=await mkdtemp(resolve('artifacts/ai-profile-'));let service;let calls=0;
 const options={port:0,dataDir:dir,localSpeech:false,provider:fake(async()=>{calls++;return response({total_tokens:5});})};
 t.after(async()=>service?.close());service=await startServer(options);const world=JSON.stringify(service.studio.world.data);
 service.studio.ai.update({background:true});await service.studio.provider.react(request());service.studio.ai.update({paused:true});await service.close();
 const stored=JSON.parse(await readFile(resolve(dir,'ai-control.json'),'utf8'));assert.equal(stored.policy.paused,true);assert.equal(stored.recent[0].usage.total,5);
 stored.policy.dailyLimit=1;await writeFile(resolve(dir,'ai-control.json'),JSON.stringify(stored));
 service=await startServer(options);assert.equal('dailyLimit' in service.studio.ai.data.policy,false);assert.equal(JSON.stringify(service.studio.world.data),world);assert.equal(service.studio.ai.data.policy.background,true);assert.equal(service.studio.ai.data.policy.paused,true);await assert.rejects(service.studio.provider.react(request()));assert.equal(calls,1);
 service.studio.ai.update({paused:false});await service.studio.provider.react(request());assert.equal(calls,2);assert.equal(service.studio.ai.data.days[0].features.probe.calls,2);assert.equal('dailyLimit' in JSON.parse(await readFile(resolve(dir,'ai-control.json'),'utf8')).policy,false);
});

test('community request kind and committed outcome persist separately from provider completion',async()=>{
 const {ai}=fixture();ai.update({background:true});const provider=ai.wrap(fake());
 const result=await provider.react({...request('community'),special:{kind:'social-daily'}},new AbortController().signal);
 let row=ai.snapshot().recent[0];assert.equal(row.status,'completed');assert.equal(row.activityKind,'social-daily');assert.equal(row.application,'unconfirmed');assert.equal(row.activityResult,undefined);
 ai.accepted(result,'post-created');row=ai.snapshot().recent[0];assert.equal(row.activityResult,'post-created');const restored=new AiControl({data:structuredClone(ai.data)});assert.equal(restored.snapshot().recent[0].activityResult,'post-created');
 const legacy=structuredClone(ai.data);delete legacy.recent[0].activityKind;delete legacy.recent[0].activityResult;const old=new AiControl({data:legacy});assert.equal(old.snapshot().recent[0].activityKind,undefined);assert.equal(old.snapshot().recent[0].activityResult,undefined);
});
