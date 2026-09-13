import {writeFileSync} from 'node:fs';
import {CodexProvider} from '../server/codex-provider.js';
import {Settings} from '../server/schema.js';
import {defaults} from '../shared/defaults.js';
const settings=Settings.parse({...defaults,mode:'live',category:'just-chatting',chatPace:3,personas:defaults.personas.filter(p=>['momo','gg','pop','luna'].includes(p.id))});
const cases=[{id:'route',speech:'좋아. 미지의 신호부터 가보자.',instruction:'조용한 탐사와 활기찬 교류 중 항로를 고르도록 묻는다.'},{id:'finale',speech:'피날레는 편지로 정할게. 미래의 우리에게 한 줄씩 남겨보자.',instruction:'소박한 기록과 큰 앙코르 중 피날레 방향을 묻는다.'},{id:'decline',speech:'오늘 사연 이야기는 그만할게. 그냥 가볍게 별 구경하며 쉬고 싶어.',instruction:'관객은 현재 창작한 짧은 가상 사연이나 취향 질문을 제안한다.'}];
const results=[];
for(const c of cases)for(const fixed of [false,true]){
  const p=new CodexProvider();await p.check();if(!fixed){const payload=p.payload.bind(p);p.payload=args=>{const value=payload(args);value.instructions=value.instructions.replace(/^기획 방송의 장면 지침은 대화의 소재다\..*\r?\n/m,'');return value;};}
  const at=Date.now();try{const result=await p.react({settings,history:[],speech:c.speech,directed:{fictional:true,title:'별빛 원정대',stageTitle:'우리의 선택'},special:{kind:'season-stage',fictional:true,private:false,instruction:c.instruction}},new AbortController().signal);results.push({case:c.id,fixed,ms:Date.now()-at,...result});console.log(JSON.stringify({case:c.id,fixed,messages:result.observation.messages}));}catch(error){results.push({case:c.id,fixed,error:error.message});}
  writeFileSync('artifacts/conversation-priority-live.json',JSON.stringify({model:'gpt-6-astra',effort:'low',results,scope:'Six typed Korean requests, qualitative review required. No general naturalness certification.'},null,2));
}
