// Synthetic recreations of first-test failure patterns. No actual user's
// conversation, microphone, screen, or app profile is sent to the provider.
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {CodexProvider} from '../server/codex-provider.js';
import {Studio} from '../server/studio.js';
import {defaults} from '../shared/defaults.js';

const base=await mkdtemp(resolve('artifacts/chat-culture-'));
const folder=JSON.parse(await readFile('artifacts/latest-package.json','utf8')).folder;
const provider=new CodexProvider({...process.env,CODEX_BIN:join(folder,'resources/codex/bin/codex.exe'),OPENAI_MODEL:'gpt-6-astra',OPENAI_REASONING_EFFORT:'low'});
const cases=[
  {id:'listen-to-fragment',speech:'이 퍼즐에서 제가 먼저 확인하는 건 이제',seed(s,advance){s.addMessage('new','어디부터 확인하세요?');advance();},check:ms=>ms.length===0||ms.length===1&&ms[0].text.length<=15&&!/[?？]/.test(ms[0].text)},
  {id:'remember-answer-beyond-recent-chat',speech:'다음 구역도 같은 규칙이네요. 다시 게이지 채우는 중이에요.',seed(s,advance){s.addMessage('new','어떻게 하면 이 구역이 끝나나요?');advance();s.addMessage('streamer','게이지를 끝까지 채우면 완료되고 다음 구역으로 넘어가요.','streamer');for(let i=0;i<40;i++){advance();s.addMessage('pop',i%2?'이 길은 돌아가네':'조금 쉬엄쉬엄 가도 되죠');}},check:ms=>!ms.some(m=>/[?？]/.test(m.text)&&/게이지|조건|목표|완료|끝나/.test(m.text))},
  {id:'less-analysis-after-feedback',speech:'네.',seed(s,advance){s.addMessage('streamer','화면 설명이 계속 이어지니 부담스러워요. 조금 편하게 보고 싶어요.','streamer');advance();s.addMessage('pop','알겠어요');for(let i=0;i<40;i++){advance();s.addMessage(i%2?'momo':'pop',i%2?'차분히 가죠':'아하 그렇구나');}},check:ms=>ms.length<=1&&!ms.some(m=>/미안|죄송|[?？]/.test(m.text))},
  {id:'addressed-viewer-preference',speech:'오늘처음옴님은 퍼즐이랑 탐험 중에 어느 쪽이 더 끌리세요?',check:ms=>ms.some(m=>m.personaId==='new')&&ms.length<=2},
  {id:'shared-success',speech:'와 됐다! 열 번 실패했는데 드디어 풀었어요! 진짜 기분 좋다!',check:ms=>ms.length>=1&&ms.length<=3},
  {id:'ordinary-watching',speech:'',seed(s,advance){s.addMessage('streamer','잠깐 생각 좀 해볼게요.','streamer');advance();s.addMessage('momo','천천히 해요');advance();},check:ms=>ms.length===0},
  {id:'contextual-transcript-still-works',speech:'퍼즐에서 몬스터를 자바서 문을 여는 거예요.',source:'microphone',check:(ms,o)=>o.transcriptCorrections.some(c=>c.text.includes('잡아서'))}
];
const report={at:new Date().toISOString(),base,model:'gpt-6-astra',effort:'low',synthetic:true,devices:false,userData:false,results:[],passed:false};
try{
  await provider.check();if(!provider.status().configured)throw new Error('Official CLI account is unavailable');
  for(const scenario of cases){
    let now=Date.now()-180000,s;const advance=()=>now+=3000;
    try{
      s=new Studio({provider,settings:{...defaults,mode:'live',gameId:'auto',category:'just-chatting',lurkRatio:0,chatPace:3,maxCalls:1},now:()=>now,random:()=>.5});clearInterval(s.timer);s.start();
      scenario.seed?.(s,advance);advance();if(scenario.speech)s.receiveSpeech({id:randomUUID(),sessionId:s.sessionId,text:scenario.speech,source:scenario.source||'keyboard'});
      let output,input;const wrapper={status:()=>provider.status(),react:async(args,signal)=>{input=args;output=await provider.react(args,signal);return output;}};s.provider=wrapper;
      const began=Date.now();await s.react({});const messages=output.observation.messages,passed=scenario.check(messages,output.observation);
      report.results.push({id:scenario.id,passed,ms:Date.now()-began,speech:scenario.speech,observation:output.observation,usage:output.usage,rhythm:Object.fromEntries(Object.entries(input.viewerContext).map(([id,p])=>[id,p.conversationRhythm]))});
      console.log(JSON.stringify({id:scenario.id,passed,ms:Date.now()-began,messages}));
    }catch(error){report.results.push({id:scenario.id,passed:false,error:error.stack});console.log(JSON.stringify({id:scenario.id,error:error.message}));}
    finally{s?.close();await writeFile(join(base,'result.json'),JSON.stringify(report,null,2));}
  }
  report.passed=report.results.length===cases.length&&report.results.every(r=>r.passed);
  report.limit='Seven synthetic cases, one call each. Mechanical criteria and manual output review are not a measured user-session improvement or a universal Korean style score.';
}catch(error){report.error=error.stack;}
await writeFile(join(base,'result.json'),JSON.stringify(report,null,2));await writeFile('artifacts/chat-culture-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,base,cases:report.results.length}));if(!report.passed)process.exitCode=1;
