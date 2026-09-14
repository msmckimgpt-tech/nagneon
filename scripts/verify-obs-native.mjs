// Opt-in real OBS + real model acceptance against an isolated portable OBS.
// The setup creates only two synthetic image inputs; never captures devices.
import OBSWebSocket from 'obs-websocket-js/json';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {startServer} from '../server/index.js';
import {seedMetAudience} from '../test/helpers/met-audience.js';
const connection=JSON.parse(await readFile('artifacts/obs-test-connection.json','utf8'));
const folder=await mkdtemp(resolve('artifacts/obs-native-')),obs=new OBSWebSocket();let service;
const report={folder,syntheticScenes:true,realOBS:true,realModel:true,turns:[],passed:false};
try{
  await obs.connect('ws://127.0.0.1:'+connection.port,connection.password);
  const version=await obs.call('GetVersion');report.obsVersion=version.obsVersion;report.websocketVersion=version.obsWebSocketVersion;
  assert.equal((await obs.call('GetSceneCollectionList')).currentSceneCollectionName,'Benchmark');
  assert.equal((await obs.call('GetInputList')).inputs.length,0,'must start with an empty isolated collection');
  assert.equal((await obs.call('GetStreamStatus')).outputActive,false);assert.equal((await obs.call('GetRecordStatus')).outputActive,false);
  const inputName='Benchmark generated image';
  await obs.call('CreateInput',{sceneName:'Benchmark',inputName,inputKind:'image_source',inputSettings:{file:resolve('artifacts/obs-scene-1.png')},sceneItemEnabled:true});
  service=await startServer({port:0,persist:false,localSpeech:false});seedMetAudience(service.studio);
  service.studio.configure({...service.studio.settings,mode:'live',category:'just-chatting',lurkRatio:0,slowModeSeconds:0,chatPace:8,intervalSeconds:5,webSearch:false});
  const api=async(path,body)=>{const response=await fetch(service.url+'/api/'+path,{method:'POST',headers:{Authorization:'Bearer '+service.accessToken,'Content-Type':'application/json','X-Backseat-Client':'studio'},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw Error(result.error);return result;};
  await api('obs/connect',connection);const selected=await api('obs/select',{scene:'Benchmark'});await api('start',{});
  for(const n of [1,2]){
    if(n===2)await obs.call('SetInputSettings',{inputName,inputSettings:{file:resolve('artifacts/obs-scene-2.png')},overlay:true});
    await new Promise(r=>setTimeout(r,300));
    const frame=await api('obs/frame',{sourceId:selected.sourceId}),bytes=Buffer.from(frame.image.split(',')[1],'base64');await writeFile(join(folder,`obs-frame-${n}.jpg`),bytes);
    const started=Date.now(),before=service.studio.messages.length;
    await api('react',{obsSourceId:selected.sourceId,speech:n===1?'모모, 지금 공유한 화면에 있는 도형과 색, 위치를 짧게 알려줘.':'모모, 화면이 바뀌었어. 지금 있는 도형과 색, 위치를 다시 알려줘.'});
    const until=Date.now()+6000;while(service.studio.queue.length&&Date.now()<until){service.studio.pump();await new Promise(r=>setTimeout(r,100));}
    report.turns.push({frame:n,sha256:createHash('sha256').update(bytes).digest('hex'),sourceId:frame.sourceId,latencyMs:Date.now()-started,observation:service.studio.observation,messages:service.studio.messages.slice(before).filter(m=>m.kind==='chat').map(m=>({name:m.name,text:m.text}))});
    await writeFile(join(folder,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report.turns.at(-1)));
  }
  assert.notEqual(report.turns[0].sha256,report.turns[1].sha256);assert.ok(report.turns.every(t=>t.messages.length));
  await api('obs/disconnect',{});assert.equal(service.obsInput.phase,'disconnected');assert.equal(service.obsInput.sourceId,'');
  await api('obs/connect',connection);const again=await api('obs/select',{scene:'Benchmark'});assert.notEqual(again.sourceId,selected.sourceId);
  await api('stop',{});assert.equal(service.obsInput.phase,'disconnected');
  assert.equal((await obs.call('GetStreamStatus')).outputActive,false);assert.equal((await obs.call('GetRecordStatus')).outputActive,false);
  assert.deepEqual((await obs.call('GetInputList')).inputs.map(i=>i.inputKind),['image_source']);report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{await service?.close();await obs.disconnect();await writeFile(join(folder,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({folder,passed:report.passed,error:report.error}));}
