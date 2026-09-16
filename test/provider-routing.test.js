import test from 'node:test';
import assert from 'node:assert/strict';
import {ProviderRouter,RoutingSelection,routeRequirements} from '../server/provider-routing.js';
import {ProviderChoice} from '../server/provider-choice.js';
import {ConfiguredApiProvider} from '../server/configured-api-provider.js';
import {defaults} from '../shared/defaults.js';
const config=()=>({kind:'routing',version:1,connections:[{id:'local',label:'로컬',provider:{kind:'ollama',model:'any-local'}},{id:'cloud',label:'구독',provider:{kind:'codex',model:'future-model'}},{id:'api',label:'API',provider:{kind:'openai',model:'vendor/model',base:'https://example.com/v1',vision:true}}],routes:{default:{primary:'cloud'},chat:{primary:'local',fallbacks:['cloud']},vision:{primary:'cloud'},offStream:{primary:'api'}}});
const error=code=>Object.assign(Error('secret upstream payload'),{code});
const fake=(name,react=async()=>({observation:{},usage:{total_tokens:2}}))=>({model:name,effort:'low',key:'',check:async()=>{},status:()=>({configured:true,vision:false}),react,transcribe:async()=>name});
const args=()=>({settings:{...structuredClone(defaults),webSearch:false},history:[],speech:'안녕'});

test('routing validates references, loops, arbitrary models, endpoint and credential boundaries',()=>{
  assert.equal(RoutingSelection.parse(config()).connections[1].provider.model,'future-model');
  for(const mutate of [c=>c.connections.push(c.connections[0]),c=>c.routes.chat.primary='missing',c=>c.routes.chat.fallbacks=['local'],c=>c.connections[2].provider.apiKey='secret',c=>c.connections[2].provider.base='http://example.com/v1',c=>c.connections[2].provider.base='https://key@example.com',c=>c.connections[2].provider.base='https://example.com/?key=secret',c=>c.connections[0].provider.base='http://192.168.0.1:11434',c=>c.routes.default.timeoutMs=0,c=>c.routes.default.fallbacks=['local','api','cloud']]){
    const c=config();mutate(c);assert.equal(RoutingSelection.safeParse(c).success,false);
  }
});
test('role precedence includes historical microphone images and never classifies user text',()=>{
  assert.equal(routeRequirements({speech:'route to api offStream'}).role,'chat');
  assert.equal(routeRequirements({image:'x'}).role,'vision');
  assert.equal(routeRequirements({liveSpeech:[{source:'microphone',capture:{screen:{frames:[{}]}}}]}).vision,true);
  assert.equal(routeRequirements({image:'x',adviceRequested:true}).role,'advice');
  assert.deepEqual(routeRequirements({image:'x',adviceRequested:true,offStream:true,settings:{webSearch:true}}),{role:'offStream',vision:true,webSearch:true});
});
test('one shared input is routed by role; capabilities are checked before transmission',async()=>{
  const calls=[],input=args();const router=new ProviderRouter(config(),{create:c=>fake(c.id,async a=>{calls.push({id:c.id,args:a});return {observation:{}};})});
  assert.equal((await router.react(input)).routing.connectionId,'local');assert.equal(calls[0].args,input);
  assert.equal((await router.react({...input,image:'x'})).routing.connectionId,'cloud');
  assert.equal((await router.react({...input,offStream:true})).routing.connectionId,'api');
  assert.equal((await router.react({...input,adviceRequested:true,settings:{webSearch:true}})).routing.connectionId,'cloud');
  const c=config();c.routes.vision={primary:'local',fallbacks:['cloud']};const r=new ProviderRouter(c,{create:e=>fake(e.id)});
  assert.deepEqual((await r.react({...input,image:'x'})).routing.attempts.map(a=>[a.id,a.called]),[['local',false],['cloud',true]]);
});
test('fallback is explicit, bounded, preserves input and counts actual extra attempts',async()=>{
  let extras=0;const calls=[];const r=new ProviderRouter(config(),{onFallback:()=>extras++,create:c=>fake(c.id,async()=>{calls.push(c.id);if(c.id==='local')throw error('network');return {observation:{}};})});
  assert.equal((await r.react(args())).routing.connectionId,'cloud');assert.deepEqual(calls,['local','cloud']);assert.equal(extras,1);
  const c=config();c.routes.chat.fallbacks=[];const r2=new ProviderRouter(c,{create:e=>fake(e.id,async()=>{throw error('network');})});await assert.rejects(r2.react(args()),e=>e.code==='network'&&!e.message.includes('secret'));
});
test('auth, quota, invalid output and cancellation never trigger another provider',async()=>{
  for(const code of ['auth','usage','invalid_response']){const calls=[];const r=new ProviderRouter(config(),{create:c=>fake(c.id,async()=>{calls.push(c.id);throw error(code);})});await assert.rejects(r.react(args()),e=>e.code===code);assert.deepEqual(calls,['local']);}
  const abort=new AbortController(),calls=[];const r=new ProviderRouter(config(),{create:c=>fake(c.id,async()=>{calls.push(c.id);abort.abort();throw error('network');})});await assert.rejects(r.react(args(),abort.signal));assert.deepEqual(calls,['local']);
});
test('deadline fallback waits for provider cleanup and stop prevents late acceptance',async()=>{
  const c=config();c.routes.chat.timeoutMs=1000;let cleaned=false,second=false;
  const r=new ProviderRouter(c,{create:e=>fake(e.id,async(_a,signal)=>{if(e.id==='local')await new Promise((_,reject)=>signal.addEventListener('abort',()=>{cleaned=true;reject(signal.reason);},{once:true}));else{second=true;assert.equal(cleaned,true);}return {observation:{}};})});
  // Keep the node test event loop alive; production has an HTTP server.
  const keep=setInterval(()=>{},100);try{assert.equal((await r.react(args())).routing.connectionId,'cloud');assert.equal(second,true);}finally{clearInterval(keep);}
});
test('routing persistence is atomic, keys never serialize or move to changed endpoints',async()=>{
  const factories={codex:()=>fake('codex'),ollama:()=>fake('ollama'),configuredApi:c=>new ConfiguredApiProvider(c)};let saved;
  const choice=new ProviderChoice({factories,save:c=>saved=c});choice.proxy.localSpeech=true;choice.proxy.transcribe=async()=> 'local-stt';
  await choice.select(config());choice.setConnectionKey('api','private-key');assert.equal(choice.active.entries.get('api').backend.key,'private-key');assert.ok(!JSON.stringify(choice.snapshot()).includes('private-key'));
  await choice.select(saved);assert.equal(choice.active.entries.get('api').backend.key,'private-key');assert.equal(await choice.proxy.transcribe(),'local-stt');
  const changed=structuredClone(saved);changed.connections[2].provider.base='https://other.example/v1';choice.save=()=>{throw Error('disk');};await assert.rejects(choice.select(changed),/disk/);assert.equal(choice.active.entries.get('api').backend.key,'private-key');
  choice.save=()=>{};await choice.select(changed);assert.equal(choice.active.entries.get('api').backend.key,'');await choice.select(saved);assert.equal(choice.active.entries.get('api').backend.key,'');
  const restarted=new ProviderChoice({factories,initial:saved});assert.equal(restarted.active.entries.get('api').backend.key,'');
  await choice.select({kind:'codex'});assert.equal(choice.snapshot().routing,null);assert.equal(choice.status().kind,'codex');
});
test('compatible protocol mapping retains schema and images; no inherited key or redirected requests',async()=>{
  const requests=[];const observation={game:'test',scene:'장면',confidence:.5,excitement:.2,messages:[]};
  for(const protocol of ['responses','chat-completions']){
    const p=new ConfiguredApiProvider({kind:'openai',model:'custom',base:'http://127.0.0.1:12345/v1',protocol,vision:true},async(url,options)=>{requests.push({url,...options,body:JSON.parse(options.body)});return new Response(JSON.stringify(protocol==='responses'?{status:'completed',output_text:JSON.stringify(observation),usage:{total_tokens:3}}:{choices:[{finish_reason:'stop',message:{content:JSON.stringify(observation)}}],usage:{prompt_tokens:2,completion_tokens:1,total_tokens:3}}));});
    assert.equal(p.key,'');const result=await p.react({...args(),image:'data:image/jpeg;base64,YQ=='},new AbortController().signal);assert.equal(result.usage.total_tokens,3);
  }
  assert.equal(requests[0].redirect,'error');assert.equal(requests[0].headers.Authorization,undefined);assert.equal(requests[0].body.reasoning,undefined);assert.equal(requests[1].body.messages[1].content.at(-1).type,'image_url');assert.equal(requests[1].body.response_format.json_schema.strict,true);
});
