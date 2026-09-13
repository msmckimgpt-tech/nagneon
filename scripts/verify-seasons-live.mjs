// Real Astra / low sample, isolated data. This is not a long-term naturalness certification.
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {startServer} from '../server/index.js';
import {CodexProvider} from '../server/codex-provider.js';
const folder=resolve('artifacts/seasons-live-'+Date.now());mkdirSync(folder,{recursive:true});
const provider=new CodexProvider(process.env);const service=await startServer({port:0,dataDir:resolve(folder,'data'),provider,localSpeech:false});const s=service.studio;const calls=[];
const record=async(label,fn)=>{const at=Date.now();const result=await fn();calls.push({label,latencyMs:Date.now()-at,result});writeFileSync(resolve(folder,'calls.json'),JSON.stringify(calls,null,2));console.log(label+': '+(Date.now()-at)+'ms');};
try{
  if(!provider.status().configured)throw new Error('Actual ChatGPT connection required');
  s.configure({...s.settings,mode:'live',category:'just-chatting',lurkRatio:0,intervalSeconds:120,discovery:{...s.settings.discovery,enabled:false},maxCalls:20});s.start();
  const a=s.seasons.create({templateId:'starlight-v1',title:'말랑 선장의 별빛 원정',premise:'나는 실수 많은 선장. 관객들은 서로 성격이 다른 우주선 크루. 모모는 편안한 여행, 각보는고양이는 도전을 좋아한다. 실제 우주 여행이나 게임 실적이 아닌 우리끼리 만드는 설정이다.'});
  const lines=[['오늘은 내가 선장이야. 길을 좀 헤매도 같이 가줄래?','모모는 조용한 별, 각보는고양이는 위험한 신호가 끌릴 것 같은데 각자 이유가 뭐야?','좋아. 미지의 신호부터 가보자.'],['지난 회차에 신호를 따라가기로 했지. 도서관엔 어떤 책이 있을까?','나는 실수해도 다시 시도할 수 있다는 책이 좋아. 너희는?','다음엔 크게 축하하고 싶어. 은하의 마지막 앙코르로 가자.'],['오늘은 우리가 주인공인 큰 무대야. 각자 어떤 자리를 맡고 싶어?','완벽한 선장은 아니었지만, 너희랑 같이 골라서 즐거웠어.','고마워. 마지막에 각자 간직할 한마디씩만 해줄래?']];
  for(let chapter=0;chapter<3;chapter++){
    s.seasons.resume({id:a.id,targets:['momo','gg','pop']});
    for(let stage=0;stage<3;stage++)await record(`chapter ${chapter+1} act ${stage+1}`,()=>s.seasons.advance({text:lines[chapter][stage]}));
    s.seasons.choose({id:a.id,...(chapter<2?{choiceId:chapter===0?'signal':'gala'}:{})});
    if(chapter<2){s.stop();s.start();}
  }
  s.addMessage('momo','이번 별빛 여행처럼 다음엔 관객들과 각자의 취향을 더 이야기하고 싶어요.');await record('audience invitation',()=>s.seasons.propose());
  const report={passed:s.seasons.get(a.id).status==='completed',model:provider.status(),calls: calls.length,folder,season:s.seasons.get(a.id),proposals:s.seasons.data.proposals,latenciesMs:calls.map(c=>c.latencyMs),balance:s.economy.data.balance,knowledge:s.knowledge.entries,observation:s.observation,scope:'Real model sample with typed Korean dialogue, no physical microphone/gameplay; quality requires separate human assessment.'};
  writeFileSync('artifacts/seasons-live-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,calls:report.calls,folder}));
}finally{await service.close();}
