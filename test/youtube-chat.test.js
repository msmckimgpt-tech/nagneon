import test from 'node:test';
import assert from 'node:assert/strict';
import grpc from '@grpc/grpc-js';
import {YoutubeChat,youtubeDefinition,youtubeVideoId} from '../server/youtube-chat.js';

const Service=grpc.loadPackageDefinition(youtubeDefinition).youtube.api.v3.V3DataLiveChatMessageService;
const waitFor=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}throw Error('timed out');};
const fetchImpl=async()=>new Response(JSON.stringify({items:[{liveStreamingDetails:{activeLiveChatId:'live'}}]}));

test('YouTube URL parser accepts official video URLs and rejects lookalikes',()=>{
  for(const url of ['abcdefghijk','https://www.youtube.com/watch?v=abcdefghijk','https://youtu.be/abcdefghijk','https://youtube.com/live/abcdefghijk'])assert.equal(youtubeVideoId(url),'abcdefghijk');
  for(const url of ['https://youtube.com.evil/watch?v=abcdefghijk','https://user@youtube.com/watch?v=abcdefghijk','http://youtu.be/abcdefghijk','https://youtu.be/abcdefghijk/more'])assert.throws(()=>youtubeVideoId(url));
});

test('actual gRPC stream resumes with token, passes credentials only as metadata, and cancels',async()=>{
  const server=new grpc.Server();const requests=[],batches=[],states=[];let active;
  server.addService(Service.service,{streamList(call){requests.push({request:call.request,keys:call.metadata.get('x-goog-api-key')});active=call;
    call.write({next_page_token:'resume',items:[{id:'one',snippet:{type:1,display_message:'실제 소켓',published_at:new Date().toISOString()},author_details:{display_name:'시청자'}}]});if(requests.length===1)call.end();
  }});
  const port=await new Promise((resolve,reject)=>server.bindAsync('127.0.0.1:0',grpc.ServerCredentials.createInsecure(),(e,p)=>e?reject(e):resolve(p)));
  const chat=new YoutubeChat({fetchImpl,clientFactory:()=>new Service(`127.0.0.1:${port}`,grpc.credentials.createInsecure()),sleep:async()=>{},onBatch:b=>batches.push(b),onState:s=>states.push(s)});
  try{await chat.connect({video:'abcdefghijk',apiKey:'test-api-key'});await waitFor(()=>requests.length===2&&batches.length===2);
    assert.equal(requests[1].request.page_token,'resume');assert.deepEqual(requests[0].keys,['test-api-key']);assert.equal(batches[0].items[0].snippet.display_message,'실제 소켓');
    assert.ok(!JSON.stringify({batches,states}).includes('test-api-key'));
    const done=chat.connection.done;chat.disconnect();await done;await waitFor(()=>active.cancelled);assert.equal(states.at(-1).phase,'disconnected');
  }finally{chat.disconnect();server.forceShutdown();}
});

test('lookup cancellation and errors cannot expose key or replace newer connection',async()=>{
  let resolve;const states=[];const chat=new YoutubeChat({fetchImpl:()=>new Promise(r=>{resolve=r;}),onState:s=>states.push(s),clientFactory:()=>{throw Error('must not connect');}});
  const pending=chat.connect({video:'abcdefghijk',apiKey:'private-key'});chat.disconnect();resolve(await fetchImpl());await pending;assert.equal(states.at(-1).phase,'disconnected');
  const failed=new YoutubeChat({fetchImpl:async()=>{throw Error('private-key');},onState:s=>states.push(s)});
  await assert.rejects(failed.connect({video:'abcdefghijk',apiKey:'private-key'}),/완료하지/);assert.ok(!JSON.stringify(states).includes('private-key'));
});

test('transient stream failures retry only three times; permission errors never retry',async()=>{
  for(const code of [grpc.status.UNAVAILABLE,grpc.status.PERMISSION_DENIED]){
    let calls=0;const server=new grpc.Server(),states=[];
    server.addService(Service.service,{streamList(call){calls++;call.emit('error',Object.assign(Error('private-key'),{code}));}});
    const port=await new Promise((resolve,reject)=>server.bindAsync('127.0.0.1:0',grpc.ServerCredentials.createInsecure(),(e,p)=>e?reject(e):resolve(p)));
    const chat=new YoutubeChat({fetchImpl,clientFactory:()=>new Service(`127.0.0.1:${port}`,grpc.credentials.createInsecure()),sleep:async()=>{},onState:s=>states.push(s)});
    try{await chat.connect({video:'abcdefghijk',apiKey:'private-key'});await waitFor(()=>states.at(-1)?.phase==='failed');
      assert.equal(calls,code===grpc.status.UNAVAILABLE?4:1);assert.ok(!JSON.stringify(states).includes('private-key'));
    }finally{chat.disconnect();server.forceShutdown();}
  }
});

test('metadata lookup rejects large bodies and does not follow redirects with the key',async()=>{
  let options;const chat=new YoutubeChat({fetchImpl:async(_url,opts)=>{options=opts;return new Response('x'.repeat(65537));}});
  await assert.rejects(chat.connect({video:'abcdefghijk',apiKey:'private-key'}));assert.equal(options.redirect,'error');assert.equal(chat.connection,null);
});
