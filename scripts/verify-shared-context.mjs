// Four real subscription calls against synthetic Korean text. No device capture.
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {CodexProvider} from '../server/codex-provider.js';
import {liveViewerContext} from '../server/viewer-context.js';
import {defaults} from '../shared/defaults.js';
import {Settings} from '../server/schema.js';
const folder=resolve('artifacts/shared-context-'+Date.now());await mkdir(folder,{recursive:true});
const settings=Settings.parse({...structuredClone(defaults),mode:'live',category:'just-chatting',chatPace:4,webSearch:false});
const rows=Array.from({length:35},(_,i)=>({id:randomUUID(),time:1000+i,personaId:'streamer',name:'플레이어',kind:'streamer',text:i===30?'내가 정한 정원 이름은 보라등대야.':`오늘 방송 기록 ${i}: 차 한 잔 마시면서 천천히 쉬는 중이야. 각자 취향대로 느긋하게 이야기하자. 화면은 연결하지 않았어.`}));
const report={folder,scope:'Synthetic text, real Codex subscription inference; no microphone, image or natural-session acceptance. Token counts are not subscription quota or monetary savings.',results:[]};
for(const [index,speech] of ['모모, 각보는고양이, 팝콘도둑, 오늘처음옴 각자 내가 정원 이름을 말하는 걸 직접 들었는지 짧게 말해줘. 들은 사람만 이름을 말해줘.','오늘은 게임 공략이나 해결법 말고 그냥 쉬면서 잡담만 하자. 각자 한마디씩 해줘.'].entries()){
  const context=liveViewerContext({members:settings.personas.map(p=>({id:p.id,joinedAt:p.id==='new'?2000:0,presence:'active'})),eligible:settings.personas.map(p=>p.id)},settings.personas,rows,null,{now:2000,speech});
  for(const enabled of index?[true,false]:[false,true]){
    const provider=new CodexProvider({...process.env,BACKSEAT_SHARED_VIEWER_CONTEXT:enabled?'1':'0'});await provider.check();
    if(!provider.available)throw Error(provider.authMessage);
    const args={settings,history:rows,...context,speech,adviceRequested:false,advicePolicy:{allowed:false}};
    const payload=provider.payload(args),at=Date.now(),entry={scenario:index,enabled,promptBytes:Buffer.byteLength(payload.instructions+payload.input[0].content[0].text)};
    try{Object.assign(entry,await provider.react(args,new AbortController().signal));}catch(error){entry.error=error.message;}
    entry.ms=Date.now()-at;report.results.push(entry);await writeFile(folder+'/results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(entry));
  }
}
console.log(folder);if(report.results.some(r=>r.error))process.exitCode=1;
