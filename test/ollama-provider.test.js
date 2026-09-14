import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {OllamaProvider} from '../server/ollama-provider.js';
import {defaults} from '../shared/defaults.js';
const info={details:{format:'gguf'},capabilities:['completion','vision'],model_info:{'model.context_length':131072}};
const observation={game:'test',scene:'장면',confidence:.5,excitement:.2,messages:[]};
const args=()=>({settings:{...structuredClone(defaults),webSearch:false},history:[],speech:'안녕',adviceRequested:false});
test('Ollama real HTTP request keeps instructions, ordered frames and schema, parses usage',async t=>{
  const requests=[];const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;requests.push({path:req.url,body:JSON.parse(raw),headers:req.headers});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url==='/api/show'?info:{done:true,message:{content:JSON.stringify(observation)},prompt_eval_count:100,eval_count:10}));});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.close();server.closeAllConnections();});
  const provider=new OllamaProvider({OLLAMA_BASE_URL:`http://127.0.0.1:${server.address().port}`,OLLAMA_MODEL:'fixture:local'});
  const result=await provider.react({...args(),frames:[{image:'data:image/jpeg;base64,YQ=='},{image:'data:image/jpeg;base64,Yg=='}],screenTimeline:{sourceId:'one',through:200}});
  assert.equal(result.usage.total_tokens,110);const payload=requests[1].body;assert.equal(payload.stream,false);assert.equal(payload.format.type,'object');assert.deepEqual(payload.messages[1].images,['YQ==','Yg==']);assert.ok(payload.messages[0].content.includes('훈수 정책'));assert.ok(payload.messages[1].content.includes('screenTimeline'));assert.equal(requests[1].headers.authorization,undefined);assert.equal(provider.status().kind,'ollama');
  // Real local inference emitted speech text as replyTo when the generation
  // schema omitted the UUID constraint, although acceptance required it.
  const message=payload.format.properties.messages.items.properties;
  assert.equal(message.replyTo.anyOf[0].format,'uuid');
  assert.equal(message.text.maxLength,240);
  assert.equal(payload.format.properties.confidence.maximum,1);
});
test('Ollama rejects cloud, remote hosts, and images for text-only models',async()=>{
  assert.throws(()=>new OllamaProvider({OLLAMA_BASE_URL:'https://ollama.com'}));
  let chats=0;const provider=new OllamaProvider({OLLAMA_MODEL:'text'},async(url)=>{if(url.endsWith('/chat'))chats++;return new Response(JSON.stringify({...info,capabilities:['completion']}));});
  await assert.rejects(provider.react({...args(),image:'data:image/jpeg;base64,YQ=='}),/화면 입력/);assert.equal(chats,0);
  provider.fetcher=async()=>new Response(JSON.stringify({...info,remote_host:'ollama.com'}));await provider.check();assert.equal(provider.status().configured,false);
});
test('Ollama rejects truncated, invalid, tool-call responses and unsupported search',async()=>{
  for(const reply of [{done:false},{done:true,done_reason:'length'},{done:true,message:{tool_calls:[{}]}},{done:true,message:{content:'invalid'}}]){
    const provider=new OllamaProvider({OLLAMA_MODEL:'test'},async url=>new Response(JSON.stringify(url.endsWith('/show')?info:reply)));await assert.rejects(provider.react(args()));
  }
  const provider=new OllamaProvider({OLLAMA_MODEL:'test'},async()=>new Response(JSON.stringify(info)));await assert.rejects(provider.react({...args(),settings:{...args().settings,webSearch:true},adviceRequested:true}),/웹 검색/);
});
test('Ollama honors cancellation and response size bounds without exposing raw errors',async()=>{
  const provider=new OllamaProvider({OLLAMA_MODEL:'test'},async()=>new Response('x'.repeat(2*1024*1024+1)));await assert.rejects(provider.localRequest('show',{}),/응답을 받지/);
  const controller=new AbortController();controller.abort();await assert.rejects(provider.react(args(),controller.signal));
  provider.fetcher=async()=>{throw Error('private upstream payload');};await provider.check();assert.ok(!JSON.stringify(provider.status()).includes('private'));
});
