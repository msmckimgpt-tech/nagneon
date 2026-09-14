import {enablePreview} from './helpers/preview.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {WebSocketServer} from 'ws';
import {ObsInput} from '../server/obs-input.js';
import {startServer} from '../server/index.js';
const image='data:image/jpg;base64,YQ==';
class Client extends EventEmitter{
  calls=[];async connect(url,password,options){this.connection={url,password,options};}
  async disconnect(){this.emit('ConnectionClosed');}
  async call(type,data){this.calls.push({type,data});return type==='GetSceneList'?{scenes:[{sceneName:'게임'},{sceneName:'대기'}]}:{imageData:image};}
}
test('OBS input only reads selected scenes, normalizes JPEG, never exposes password',async()=>{
  const client=new Client(),ended=[],input=new ObsInput({createClient:()=>client,onEnd:id=>ended.push(id)});
  await input.connect({password:'synthetic-secret'});assert.equal(input.snapshot().phase,'connected');assert.ok(!JSON.stringify(input.snapshot()).includes('synthetic-secret'));
  assert.throws(()=>input.select('unknown'));
  const {sourceId}=input.select('게임');const frame=await input.frame(sourceId);assert.equal(frame.image,'data:image/jpeg;base64,YQ==');assert.equal(client.calls.at(-1).data.sourceName,'게임');
  input.select('대기');assert.deepEqual(ended,[sourceId]);await assert.rejects(input.frame(sourceId));input.disconnect();
  assert.deepEqual(client.calls.map(c=>c.type),['GetSceneList','GetSourceScreenshot']);
});
test('disconnect rejects pending screenshot and stale responses cannot cross scene boundaries',async()=>{
  const client=new Client(),input=new ObsInput({createClient:()=>client});await input.connect();const old=input.select('게임').sourceId;
  let resolve;client.call=()=>new Promise(r=>resolve=r);const request=input.frame(old);await assert.rejects(input.frame(old),/읽고/);
  const next=input.select('대기').sourceId;resolve({imageData:image});await assert.rejects(request);assert.equal(input.sourceId,next);
  const other=input.frame(next);input.disconnect();await assert.rejects(other);assert.equal(input.phase,'disconnected');
});
test('cancelled handshake and late close cannot replace a new connection',async()=>{
  const old=new Client(),next=new Client();let finish;old.connect=()=>new Promise(r=>finish=r);
  let calls=0;const input=new ObsInput({createClient:()=>calls++?next:old});
  const pending=input.connect({password:'old'});input.disconnect();await assert.rejects(pending);
  await input.connect({password:'new'});finish();old.emit('ConnectionClosed');
  assert.equal(input.client,next);assert.equal(input.phase,'connected');input.disconnect();
});
test('authentication errors never echo a supplied secret into state or API errors',async()=>{
  const client=new Client();client.connect=async()=>{throw Error('password=synthetic-private');};const input=new ObsInput({createClient:()=>client});
  await assert.rejects(input.connect({password:'synthetic-private'}),error=>!error.message.includes('synthetic-private'));
  assert.equal(input.phase,'disconnected');assert.ok(!JSON.stringify(input.snapshot()).includes('synthetic-private'));
});
test('slow or oversized frames end the selected source and never reach model input',async()=>{
  let now=1000;const client=new Client(),input=new ObsInput({createClient:()=>client,now:()=>now});await input.connect();let source=input.select('게임').sourceId;
  client.call=async()=>{now+=3000;return {imageData:image};};await assert.rejects(input.frame(source));assert.equal(input.sourceId,'');
  source=input.select('게임').sourceId;client.call=async()=>({imageData:'data:image/jpeg;base64,'+'a'.repeat(320000)});await assert.rejects(input.frame(source));input.disconnect();
});
test('real OBS v5 client completes challenge auth and read-only JSON requests',{timeout:8000},async t=>{
  const server=new WebSocketServer({port:0,host:'127.0.0.1'});await new Promise(r=>server.once('listening',r));t.after(()=>{for(const c of server.clients)c.terminate();server.close();});
  const hash=v=>createHash('sha256').update(v).digest('base64'),calls=[];let authentication;
  server.on('connection',socket=>{
    socket.send(JSON.stringify({op:0,d:{obsWebSocketVersion:'5.5.0',rpcVersion:1,authentication:{salt:'salt',challenge:'challenge'}}}));
    socket.on('message',raw=>{const {op,d}=JSON.parse(raw);if(op===1){authentication=d.authentication;socket.send(JSON.stringify({op:2,d:{negotiatedRpcVersion:1}}));}else if(op===6){calls.push(d.requestType);socket.send(JSON.stringify({op:7,d:{requestType:d.requestType,requestId:d.requestId,requestStatus:{result:true,code:100},responseData:d.requestType==='GetSceneList'?{scenes:[{sceneName:'시험'}]}:{imageData:image}}}));}});
  });
  const input=new ObsInput();t.after(()=>input.disconnect());await input.connect({port:server.address().port,password:'synthetic'});await input.frame(input.select('시험').sourceId);
  assert.equal(authentication,hash(hash('synthetic'+'salt')+'challenge'));assert.deepEqual(calls,['GetSceneList','GetSourceScreenshot']);
});
test('authenticated API feeds OBS image to real reaction path; stop disconnects and excludes credentials',{timeout:15000},async t=>{
  let received;const client=new Client(),service=await startServer({port:0,persist:false,localSpeech:false,obsClientFactory:()=>client,provider:{status:()=>({configured:true}),react:async input=>{received=input;return {observation:{game:'test',scene:'test',confidence:.9,excitement:0,messages:[]},usage:{total_tokens:1}};}}});t.after(()=>service.close());await enablePreview(service);
  const post=async(path,body)=>{const r=await fetch(service.url+'/api/'+path,{method:'POST',headers:{Authorization:'Bearer '+service.accessToken,'Content-Type':'application/json','X-Backseat-Client':'studio'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  assert.equal((await post('obs/connect',{port:4455,password:'private-fixture'})).status,200);const selected=await post('obs/select',{scene:'게임'});
  service.studio.configure({...service.studio.settings,mode:'live'});service.studio.start();
  assert.equal((await post('react',{obsSourceId:selected.body.sourceId})).status,200);assert.ok(received);assert.ok(JSON.stringify(received).includes('data:image/jpeg;base64,YQ=='));
  assert.equal((await post('react',{obsSourceId:selected.body.sourceId,image:'data:image/jpeg;base64,YQ=='})).status,400);
  assert.ok(!JSON.stringify(service.studio.state()).includes('private-fixture'));
  await post('stop',{});assert.equal(service.obsInput.phase,'disconnected');assert.equal((await post('obs/frame',{sourceId:selected.body.sourceId})).status,409);
  await post('obs/connect',{port:4455,password:''});await post('obs/select',{scene:'대기'});service.studio.start();service.studio.stop();assert.equal(service.obsInput.phase,'disconnected','desktop emergency stop uses the same lifecycle');
});
