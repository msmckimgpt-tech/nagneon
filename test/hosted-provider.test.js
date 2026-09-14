import test from 'node:test';
import assert from 'node:assert/strict';
import {HostedProvider} from '../server/hosted-provider.js';
import {ProviderSelection,ProviderChoice} from '../server/provider-choice.js';
import {defaults} from '../shared/defaults.js';

const args=()=>({settings:{...structuredClone(defaults),webSearch:false},history:[],speech:'안녕',image:'data:image/png;base64,aGVsbG8='});
const observation={game:'fixture',scene:'fixture',confidence:.8,excitement:.1,messages:[]};
for(const kind of ['claude','gemini'])test(kind+' translates the common multimodal prompt and validates completed output',async()=>{
  let sent;const result=kind==='claude'?{stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(observation)}],usage:{input_tokens:10,output_tokens:20}}:{candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(observation)}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:20}};
  const p=new HostedProvider({kind,model:'fixture-model'},{},async(url,request)=>{sent={url,...request,body:JSON.parse(request.body)};return new Response(JSON.stringify(result));});p.key='private-test-key';
  const response=await p.react({...args(),debugPrompt:{enabled:true,tryNewFeatures:true,mode:'replace',prompt:'custom'}});
  assert.equal(response.observation.scene,'fixture');assert.equal(response.usage.total_tokens,30);assert.equal(sent.redirect,'error');assert.equal(sent.url.includes(p.key),false);
  if(kind==='claude'){assert.equal(sent.body.system,'custom');assert.equal(sent.body.messages[0].content[1].source.media_type,'image/png');assert.equal(sent.body.output_config.format.type,'json_schema');}
  else{assert.equal(sent.body.systemInstruction.parts[0].text,'custom');assert.equal(sent.body.contents[0].parts[1].inlineData.mimeType,'image/png');assert.equal(sent.body.generationConfig.responseMimeType,'application/json');}
  assert.equal(JSON.stringify(p.status()).includes(p.key),false);
  if(kind==='claude')result.stop_reason='max_tokens';else result.candidates[0].finishReason='MAX_TOKENS';
  await assert.rejects(p.react(args()),/완료|완전/);
});

test('hosted failures do not expose credentials or accept malformed chat',async()=>{
  const p=new HostedProvider({kind:'claude',model:'fixture'},{},async()=>{throw Error('secret from provider');});
  p.key='private';await assert.rejects(p.react(args()),e=>!e.message.includes('secret')&&e.message.includes('API'));
  p.fetcher=async()=>new Response(JSON.stringify({stop_reason:'end_turn',content:[{type:'text',text:'{}'}]}));await assert.rejects(p.react(args()),/형식/);
  const c=new AbortController();c.abort();await assert.rejects(p.react(args(),c.signal),/취소/);
});

test('model and effort selections are validated and remain behind the preview gate',async()=>{
  assert.throws(()=>ProviderSelection.parse({kind:'codex',model:'x',effort:'low";evil'}));
  assert.throws(()=>ProviderSelection.parse({kind:'gemini',model:'x?key=secret'}));
  const created=[];const factory=config=>{created.push(config);return {status:()=>({configured:true}),check:async()=>{}};};
  const c=new ProviderChoice({factories:{codex:factory,claude:factory},preview:false});
  await assert.rejects(c.select({kind:'claude',model:'custom-model'}));
  c.setPreview(true);await c.select({kind:'codex',model:'custom-gpt',effort:'high'});assert.equal(c.snapshot().config.effort,'high');
  await c.select({kind:'claude',model:'custom-model'});assert.equal(c.status().kind,'claude');
  c.setPreview(false);assert.equal(c.status().kind,'codex');assert.equal(c.snapshot().config.model,undefined);
  assert.ok(created.some(c=>c?.model==='custom-gpt'));
});
