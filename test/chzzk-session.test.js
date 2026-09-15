import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer} from '../server/index.js';
import {ChzzkAuth} from '../server/chzzk-auth.js';
const until=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}throw Error('timeout');};

test('app authorization opens only its CHZZK URL, completes callback, and separates external source',async t=>{
  let received,callbacks,disconnected=false;const opened=[];
  const service=await startServer({port:0,persist:false,localSpeech:false,openExternalAuth:async url=>opened.push(url),authFactory:options=>new ChzzkAuth({...options,port:0,fetchImpl:async()=>new Response(JSON.stringify({code:200,content:{accessToken:'private-token',tokenType:'Bearer',expiresIn:86400}}))}),chzzkFactory:options=>{callbacks=options;return {async connect(token){assert.equal(token.accessToken,'private-token');options.onState({phase:'receiving',channelId:'my-channel'});},disconnect(){disconnected=true;}};},provider:{status:()=>({configured:true}),react:async input=>{received=input;return {observation:{game:'test',scene:'test',confidence:0,excitement:0,messages:[]},usage:{total_tokens:0}};}}});t.after(()=>service.close());
  const post=async(path,body,auth=true)=>{const r=await fetch(service.url+'/api/'+path,{method:'POST',headers:{...(auth?{Authorization:'Bearer '+service.accessToken}:{}),'Content-Type':'application/json','X-Backseat-Client':'studio'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  const input={clientId:'test-client',clientSecret:'private-client-secret',acknowledgeAiTransfer:true};
  assert.equal((await post('external/chzzk/start',input,false)).status,401);assert.equal((await post('external/chzzk/start',input)).status,409);
  service.studio.configure({...service.studio.settings,mode:'live'});service.studio.start();
  const result=await post('external/chzzk/start',input);assert.equal(result.status,200);assert.equal(opened.length,1);const authorization=new URL(opened[0]);assert.equal(authorization.origin,'https://chzzk.naver.com');assert.equal(authorization.pathname,'/account-interlock');assert.ok(!opened[0].includes(input.clientSecret));
  assert.equal((await post('external/chzzk/open',{url:'https://evil.test/'})).status,200);assert.equal(opened[1],opened[0]);
  const callback=new URL(result.body.redirectUri);callback.searchParams.set('state',authorization.searchParams.get('state'));callback.searchParams.set('code','auth-code');assert.equal((await fetch(callback)).status,200);
  await until(()=>service.studio.state().externalChat.phase==='receiving');assert.equal(service.studio.state().externalChat.source.platform,'chzzk');
  callbacks.onBatch({channelId:'other',items:[{id:'leak',name:'viewer',text:'wrong',publishedAt:Date.now()}]});assert.equal(service.studio.state().externalChat.messages.length,0);
  callbacks.onBatch({channelId:'my-channel',items:[{id:'one',name:'시청자',text:'함께 보고 있어요',publishedAt:Date.now()}]});assert.equal((await post('react',{})).status,200);assert.ok(Object.values(received.viewerContext).some(p=>p.externalChat.some(m=>m.platform==='chzzk')));
  assert.ok(!JSON.stringify(service.studio.state()).includes('private-token'));assert.ok(!JSON.stringify(service.studio.state()).includes(input.clientSecret));
  service.studio.stop();assert.equal(disconnected,true);assert.equal(service.studio.state().externalChat.source,null);
});

test('app cancellation releases callback listener and late approval cannot start chat',async t=>{
  let started=0;const service=await startServer({port:0,persist:false,localSpeech:false,authFactory:options=>new ChzzkAuth({...options,port:0}),chzzkFactory:()=>{started++;throw Error('must not start');},provider:{status:()=>({configured:true})}});t.after(()=>service.close());
  const post=async(path,body)=>{const r=await fetch(service.url+'/api/'+path,{method:'POST',headers:{Authorization:'Bearer '+service.accessToken,'Content-Type':'application/json','X-Backseat-Client':'studio'},body:JSON.stringify(body)});return r.json();};
  service.studio.configure({...service.studio.settings,mode:'live'});service.studio.start();const result=await post('external/chzzk/start',{clientId:'test-client',clientSecret:'private-secret',acknowledgeAiTransfer:true});
  await post('external/disconnect',{});assert.equal(service.studio.state().externalChat.phase,'disconnected');await assert.rejects(fetch(result.redirectUri));assert.equal(started,0);
});
