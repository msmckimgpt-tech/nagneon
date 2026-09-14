// Optional, isolated legacy-server compatibility check. Install the reference
// server under artifacts/socketio-compat with --ignore-scripts, never in product.
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {ChzzkSocket} from '../server/chzzk-chat.js';
const require=createRequire(import.meta.url),ioFactory=require(resolve('artifacts/socketio-compat/node_modules/socket.io'));
const http=createServer(),io=ioFactory(http,{transports:['websocket'],pingInterval:30,pingTimeout:300});
let pings=0,client;const events=[];
io.on('connection',socket=>{socket.conn.on('packet',p=>{if(p.type==='ping')pings++;});socket.emit('SYSTEM',JSON.stringify({type:'connected',data:{sessionKey:'synthetic'}}));socket.emit('CHAT',JSON.stringify({content:'실제 Socket.IO 2.0.3 서버'}));});
http.listen(0,'127.0.0.1');await once(http,'listening');
try{
  client=new ChzzkSocket('https://ssio08.nchat.naver.com?auth=synthetic',{webSocketFactory:(url,options)=>{const local=new URL(url);local.protocol='ws:';local.hostname='127.0.0.1';local.port=String(http.address().port);return new WebSocket(local,options);}});
  client.on('SYSTEM',data=>events.push(data));client.on('CHAT',data=>events.push(data));let faults=0;client.on('fault',()=>faults++);
  for(let i=0;i<200&&(pings<2||events.length<2);i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(faults,0);assert.equal(events[0].data.sessionKey,'synthetic');assert.equal(events[1].content,'실제 Socket.IO 2.0.3 서버');assert.ok(pings>=2);
  console.log(JSON.stringify({passed:true,referenceVersion:require(resolve('artifacts/socketio-compat/node_modules/socket.io/package.json')).version,events:events.length,pings,synthetic:true}));
}finally{client?.close();await new Promise(r=>io.close(r));}
