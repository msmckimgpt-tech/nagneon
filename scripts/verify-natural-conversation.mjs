// Device-free acceptance: saved synthetic voice, real local STT and two Astra
// low requests. No user test recordings, GUI, capture or microphone access.
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {LocalSpeech} from '../server/local-speech.js';
import {CodexProvider} from '../server/codex-provider.js';
import {Studio} from '../server/studio.js';
import {defaults} from '../shared/defaults.js';
import {VOICE_MAX_MS} from '../src/speech-flow.ts';

const base=await mkdtemp(resolve('artifacts/natural-conversation-'));
const folder=JSON.parse(await readFile('artifacts/latest-package.json','utf8')).folder;
const python=join(folder,'resources/speech/python/python.exe');
const worker=new LocalSpeech({python,worker:resolve('scripts/speech_worker.py'),model:join(folder,'resources/speech/model')});
const provider=new CodexProvider({...process.env,CODEX_BIN:join(folder,'resources/codex/bin/codex.exe'),OPENAI_MODEL:'gpt-6-astra',OPENAI_REASONING_EFFORT:'low'});
const report={base,passed:false,model:'gpt-6-astra',effort:'low',syntheticInput:true,physicalDevices:false,screen:false,ui:false,segments:[],calls:[]};let s;
try{
  const cutter="import sys,wave,pathlib\nsource=wave.open(sys.argv[1],'rb')\nparams=source.getparams(); rate=source.getframerate(); frames=source.readframes(source.getnframes()); width=source.getsampwidth()*source.getnchannels(); step=int(float(sys.argv[3])*rate)*width\nfor i,start in enumerate(range(0,len(frames),step)):\n out=wave.open(str(pathlib.Path(sys.argv[2])/('part-'+str(i)+'.wav')),'wb');out.setparams(params);out.writeframes(frames[start:start+step]);out.close()\nprint((len(frames)+step-1)//step)\nsource.close()";
  let count=0;await new Promise((done,fail)=>{const p=spawn(python,['-c',cutter,resolve('artifacts/korean-fixture.wav'),base,String(VOICE_MAX_MS/1000)],{windowsHide:true});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',fail);p.on('exit',code=>{count=Number(out.trim());code===0&&count>0?done():fail(new Error('Synthetic WAV split failed: '+err));});});
  const readyAt=Date.now();worker.start();while(!worker.ready){if(worker.error||Date.now()-readyAt>30000)throw Error(worker.error||'STT readiness timed out');await new Promise(r=>setTimeout(r,100));}report.speechReadyMs=Date.now()-readyAt;
  for(let i=0;i<count;i++){const at=Date.now(),result=await worker.transcribe(await readFile(join(base,'part-'+i+'.wav')),AbortSignal.timeout(60000));report.segments.push({durationSeconds:result.cues?.durationSeconds,recognitionMs:Date.now()-at,text:result.text});}
  assert.match(report.segments.map(s=>s.text).join(' '),/안녕|오늘|게임/);assert.ok(report.segments.every(s=>s.durationSeconds<=6.1));
  worker.close();await provider.check();assert.equal(provider.status().configured,true);
  let now=Date.now();const original=provider.react.bind(provider);provider.react=async(args,signal)=>{const at=Date.now(),result=await original(args,signal);report.calls.push({speech:args.speech,latencyMs:Date.now()-at,observation:result.observation,usage:result.usage});return result;};
  s=new Studio({settings:{...defaults,mode:'live',category:'just-chatting',lurkRatio:0,chatPace:3,maxCalls:2},provider,now:()=>now,random:()=>.5});clearInterval(s.timer);s.start();
  // The prompt comes from a fixed synthetic scenario, not a copied personal log.
  s.addMessage('momo','화면 왼쪽 아래에 나무가 있고 오른쪽에는 눈이 쌓였네요.');
  s.addMessage('pop','나무 주변에 눈이 꽤 쌓여 있는 모습이네요.');
  const feedback={id:randomUUID(),sessionId:s.sessionId,text:'장면을 하나하나 설명하는 것보다는 그냥 편하게 같이 보고 싶어요.'};
  const received=Date.now();s.receiveSpeech(feedback);report.speechReceiptMs=Date.now()-received;
  await s.react({});for(let i=0;i<24&&s.queue.length;i++){now+=5000;s.pump();}assert.equal(s.queue.length,0);
  s.receiveSpeech({id:randomUUID(),sessionId:s.sessionId,text:'음, 잠깐 물 좀 마실게요.'});await s.react({});
  assert.equal(report.calls.length,2);assert.equal(s.messages.filter(m=>m.kind==='streamer').length,2);assert.equal(s.speechInbox.pending.length,0);
  assert.ok(report.calls.every(c=>c.observation.messages.length<=3));report.passed=true;report.limit='Two synthetic cases validate delivery and output shape; naturalness still requires user listening and longer sessions.';
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{s?.close();worker.close();await writeFile(join(base,'result.json'),JSON.stringify(report,null,2));await writeFile('artifacts/natural-conversation-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
