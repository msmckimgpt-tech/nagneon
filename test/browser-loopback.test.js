import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Server} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {startServer} from '../server/index.js';
import {browserPortAllowed,listenBrowserLoopback} from '../server/browser-loopback.js';
import {ChzzkAuth} from '../server/chzzk-auth.js';

async function unusedRestrictedPort(){
  for(const port of [6000,6667,10080]){
    const s=createServer();
    try{
      await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(port,'127.0.0.1',resolve);});
      return port;
    }catch(error){if(error.code!=='EADDRINUSE')throw error;}
    finally{if(s.listening)await new Promise(resolve=>s.close(resolve));}
  }
  throw Error('No restricted fixture port available');
}

test('desktop startup replaces a browser-restricted OS assignment before exposing its URL',async t=>{
  const blocked=await unusedRestrictedPort(),original=Server.prototype.listen;
  let injected=false;
  t.mock.method(Server.prototype,'listen',function(...args){
    const port=typeof args[0]==='object'?args[0].port:args[0];
    if(port===0&&!injected){
      injected=true;
      args[0]=typeof args[0]==='object'?{...args[0],port:blocked}:blocked;
    }
    return original.apply(this,args);
  });
  const service=await startServer({port:0,persist:false,localSpeech:false,provider:{status:()=>({configured:true})}});
  t.after(()=>service.close());
  assert.equal(injected,true);
  assert.notEqual(Number(new URL(service.url).port),blocked);
  const response=await fetch(service.url+'/api/state',{headers:{Authorization:'Bearer '+service.accessToken}});
  assert.equal(response.status,200);
  await response.json();
  const denied=await fetch(service.url+'/api/state');
  assert.equal(denied.status,401);await denied.text();
});

test('explicit restricted ports fail before provider or profile initialization',async()=>{
  for(const port of [6000,1719,4190,6679,10080,-1,65536,'4318',NaN]){
    let initialized=false;
    await assert.rejects(startServer({port,persist:false,provider:{check:async()=>{initialized=true;},status:()=>({})}}),{code:'ERR_BROWSER_PORT'});
    assert.equal(initialized,false);
    assert.equal(browserPortAllowed(port),false);
  }
  for(const port of [80,443,4318,4319,49152,65535])assert.equal(browserPortAllowed(port),true);
  assert.equal(browserPortAllowed(0),false);
});

test('restricted automatic bindings have a finite budget and leave no listening socket',async()=>{
  const server=createServer();let attempts=0;
  server.on('listening',()=>attempts++);
  server.address=()=>({port:6000,address:'127.0.0.1',family:'IPv4'});
  await assert.rejects(listenBrowserLoopback(server,{maxAttempts:3}),{code:'ERR_BROWSER_PORT'});
  assert.equal(attempts,3);
  assert.equal(server.listening,false);
  assert.equal(server.listenerCount('error'),0);
  assert.equal(server.listenerCount('close'),0);
});

test('cancellation during binding cannot reopen or leave a listener',async()=>{
  const server=createServer(),controller=new AbortController();
  const originalListeners=server.listeners('listening');
  const pending=listenBrowserLoopback(server,{signal:controller.signal});
  const rejected=assert.rejects(pending,{name:'AbortError'});
  controller.abort();await rejected;await delay(10);
  assert.equal(server.listening,false);
  assert.equal(server.listenerCount('error'),0);
  assert.deepEqual(server.listeners('listening'),originalListeners);
});

test('cancellation between rejected bindings stops before a second bind',async()=>{
  const server=createServer(),controller=new AbortController();let attempts=0;
  server.address=()=>({port:6000});
  server.on('listening',()=>attempts++);
  server.once('close',()=>controller.abort());
  await assert.rejects(listenBrowserLoopback(server,{signal:controller.signal}),{name:'AbortError'});
  assert.equal(attempts,1);assert.equal(server.listening,false);
});

test('busy fixed ports do not silently move and startup failure closes initialized workers',async t=>{
  const occupied=await listenBrowserLoopback(createServer());
  t.after(()=>new Promise(resolve=>occupied.close(resolve)));
  const closed=[];
  await assert.rejects(startServer({port:occupied.address().port,persist:false,localSpeech:false,
    provider:{status:()=>({configured:true})},
    speechWorker:{close:()=>closed.push('speech')},soundWorker:{close:()=>closed.push('sound')},
  }),{code:'EADDRINUSE'});
  assert.deepEqual(closed.sort(),['sound','speech']);
  assert.equal(occupied.listening,true);
});

test('temporary authorization callbacks also replace restricted OS assignments',async t=>{
  const blocked=await unusedRestrictedPort(),original=Server.prototype.listen;
  let injected=false;
  t.mock.method(Server.prototype,'listen',function(...args){
    const port=typeof args[0]==='object'?args[0].port:args[0];
    if(port===0&&!injected){injected=true;args[0]=typeof args[0]==='object'?{...args[0],port:blocked}:blocked;}
    return original.apply(this,args);
  });
  const auth=new ChzzkAuth({port:0});t.after(()=>auth.cancel());
  const result=await auth.begin({clientId:'synthetic-client',clientSecret:'synthetic-secret'});
  assert.equal(injected,true);assert.notEqual(Number(new URL(result.redirectUri).port),blocked);
  const denied=await fetch(result.redirectUri);assert.equal(denied.status,400);await denied.text();
  auth.cancel();assert.equal(auth.active,null);
});
