import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {CodexProvider} from '../server/codex-provider.js';
import {Studio} from '../server/studio.js';
import {defaults} from '../shared/defaults.js';
const base=await mkdtemp(resolve('artifacts/transcript-astra-'));
const folder=JSON.parse(await readFile('artifacts/latest-package.json','utf8')).folder;
const provider=new CodexProvider({...process.env,CODEX_BIN:join(folder,'resources/codex/bin/codex.exe'),OPENAI_MODEL:'gpt-6-astra',OPENAI_REASONING_EFFORT:'low'});
const report={base,passed:false,syntheticTranscript:true,physicalDevices:false,model:'gpt-6-astra',effort:'low',calls:[]};let s;
try{
  await provider.check();assert.equal(provider.status().configured,true);let now=Date.now();
  const original=provider.react.bind(provider);provider.react=async(args,signal)=>{const at=Date.now(),result=await original(args,signal);report.calls.push({speech:args.speech,candidates:args.transcriptCandidates,adviceRequested:args.adviceRequested,ms:Date.now()-at,observation:result.observation});return result;};
  s=new Studio({provider,now:()=>now,random:()=>.5,settings:{...defaults,mode:'live',maxCalls:2,lurkRatio:0,gameId:'synthetic',games:[{id:'synthetic',name:'몬스터 사냥 연습',genre:'합성 테스트',context:'몬스터를 잡아서 퀘스트를 완료하는 가상 테스트 게임.',popularity:.1}]}});clearInterval(s.timer);s.start();
  const raw='몬스터를 자바서 퀘스트를 끝내는 거예요.';
  const first=s.receiveSpeech({id:randomUUID(),sessionId:s.sessionId,text:raw,source:'microphone'});await s.react({});
  const entry=s.journal.data.entries.find(e=>e.id===first.messageId);assert.equal(entry.text,raw);assert.match(entry.transcription?.correction?.text||'',/잡아서/);report.annotated=entry;
  now+=20000;s.receiveSpeech({id:randomUUID(),sessionId:s.sessionId,text:'훈수는 하지 말고 그냥 봐주세요.',source:'microphone'});await s.react({});
  assert.equal(s.calls,2);assert.equal(report.calls[1].adviceRequested,false);assert.equal(s.messages.filter(m=>m.kind==='streamer').length,2);report.passed=true;report.limit='Two deterministic transcript fixtures; this does not establish accuracy for arbitrary names, accents, microphones or noisy audio.';
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{s?.close();await writeFile(join(base,'result.json'),JSON.stringify(report,null,2));await writeFile('artifacts/transcript-astra-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
