import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {startServer} from '../server/index.js';
const service=await startServer({port:0,persist:false});
const request=async(path,body,contentType='application/json')=>{
  const r=await fetch(service.url+'/api/'+path,{method:'POST',headers:{'X-Backseat-Client':'studio','Content-Type':contentType},body:contentType==='application/json'?JSON.stringify(body):body});
  const value=await r.json();if(!r.ok)throw new Error(value.error);return value;
};
try{
  service.studio.configure({...service.studio.settings,mode:'live',category:'just-chatting',title:'오늘의 소소한 이야기',maxCalls:3,intervalSeconds:120,lurkRatio:0});
  for(let i=0;i<90&&!service.studio.state().provider.localAudio;i++)await new Promise(r=>setTimeout(r,500));
  assert.ok(service.studio.state().provider.localAudio,'local speech must be ready');
  await request('start');const start=Date.now();
  const voice=await request('audio',await readFile('artifacts/korean-fixture.wav'),'audio/wav');
  const speechMs=Date.now()-start;assert.match(voice.text,/신나|신나는/);assert.equal(service.studio.calls,0,'local speech does not use model budget');
  await request('react',{speech:voice.text});
  await new Promise(r=>setTimeout(r,6000));
  const live=structuredClone(service.studio.state());assert.equal(live.observation.game,'Just Chatting');assert.ok(live.messages.some(m=>m.kind==='chat'));assert.equal(service.studio.voiceCues.confidence,'low');
  await request('stop');await request('community/reflect');
  const result={passed:true,fixture:'synthetic Korean voice, no physical microphone',speechMs,voice,live,community:service.studio.state().audience.posts};
  assert.ok(result.community.length);await writeFile('artifacts/just-chatting-result.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify({passed:true,speechMs,voice,scene:live.observation,messages:live.messages,posts:result.community},null,2));
}finally{await service.close();}
