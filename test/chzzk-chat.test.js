import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import WebSocket,{WebSocketServer} from 'ws';
import {ChzzkChat,ChzzkSocket,chzzkItem} from '../server/chzzk-chat.js';

const until=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}throw Error('timeout');};
const response=content=>new Response(JSON.stringify({code:200,content}));
test('CHZZK reads actual Engine.IO 3 socket events, subscribes once, handles ping and revocation',async t=>{
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');t.after(()=>server.close());let socket,pings=0,target;const requests=[],batches=[],states=[];
  const event=(type,data)=>socket.send('42'+JSON.stringify([type,JSON.stringify(data)]));
  server.on('connection',ws=>{socket=ws;ws.send('0'+JSON.stringify({sid:'fixture',pingInterval:20,pingTimeout:100}));ws.send('40');event('SYSTEM',{type:'connected',data:{sessionKey:'session-key'}});event('SYSTEM',{type:'connected',data:{sessionKey:'session-key'}});ws.on('message',raw=>{if(raw.toString()==='2'){pings++;ws.send('3');}});});
  const chat=new ChzzkChat({onState:s=>states.push(s),onBatch:b=>batches.push(b),socketFactory:url=>new ChzzkSocket(url,{webSocketFactory:(url,options)=>{target=new URL(url);return new WebSocket(`ws://127.0.0.1:${server.address().port}`,options);}}),fetchImpl:async(url,options)=>{
    requests.push({url,options});if(options.method==='GET')return response({url:'https://ssio08.nchat.naver.com:443?auth=socket-secret'});
    event('SYSTEM',{type:'subscribed',data:{eventType:'CHAT',channelId:'channel'}});return response(null);
  }});t.after(()=>chat.disconnect());await chat.connect({accessToken:'private-token',expiresAt:Date.now()+60000});
  assert.equal(target.searchParams.get('EIO'),'3');assert.equal(target.pathname,'/socket.io/');assert.equal(requests.length,2);assert.ok(requests[1].url.endsWith('/subscribe/chat?sessionKey=session-key'));assert.equal(requests[1].options.headers.Authorization,'Bearer private-token');
  event('CHAT',{channelId:'channel',senderChannelId:'human',profile:{nickname:'시청자'},content:'안녕하세요',messageTime:Date.now()});await until(()=>batches.length===1&&pings>0);assert.equal(batches[0].items[0].text,'안녕하세요');
  event('CHAT',{channelId:'other',senderChannelId:'human',profile:{nickname:'시청자'},content:'누출',messageTime:Date.now()});event('SYSTEM',{type:'revoked',data:{eventType:'CHAT',channelId:'channel'}});await until(()=>chat.active===null);assert.equal(batches.length,1);assert.equal(states.at(-1).phase,'failed');assert.ok(!JSON.stringify({states,batches}).includes('private-token'));assert.ok(!JSON.stringify({states,batches}).includes('socket-secret'));
});

test('CHZZK session URL cannot redirect token-bearing socket to arbitrary hosts',async()=>{
  let created=false;const states=[];const chat=new ChzzkChat({fetchImpl:async()=>response({url:'https://evil.test/?auth=secret'}),socketFactory:()=>{created=true;},onState:s=>states.push(s)});
  await assert.rejects(chat.connect({accessToken:'private-token',expiresAt:Date.now()+60000}));assert.equal(created,false);assert.equal(chat.active,null);assert.ok(!JSON.stringify(states).includes('private-token'));
});

test('CHZZK identity is deterministic across reconnects and excludes unrelated channels',()=>{
  const message={channelId:'one',senderChannelId:'human',content:'같은 원문',messageTime:100,profile:{nickname:'viewer'}};
  assert.deepEqual(chzzkItem(message,'one'),chzzkItem({...message},'one'));assert.equal(chzzkItem(message,'two'),null);assert.notEqual(chzzkItem({...message,messageTime:101},'one').id,chzzkItem(message,'one').id);
});
