// Opt-in real Astra acceptance. Isolated synthetic conversation; no microphone,
// game/device capture, original user data, account files, or GUI automation.
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {crc32,deflateSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {Studio} from '../server/studio.js';
import {CodexProvider} from '../server/codex-provider.js';
import {defaults} from '../shared/defaults.js';

// Valid blank images keep the production frame path active. They provide no
// game knowledge: all card values in this test are supplied in typed speech.
function blank(value){
  const chunk=(type,data)=>{const tag=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([tag,data])));return Buffer.concat([size,tag,data,crc]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(32,0);header.writeUInt32BE(32,4);header[8]=8;header[9]=2;
  const rows=Buffer.alloc(32*(1+32*3),value);for(let y=0;y<32;y++)rows[y*(1+32*3)]=0;
  return 'data:image/png;base64,'+Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}
await mkdir(resolve('artifacts'),{recursive:true});const base=await mkdtemp(resolve('artifacts/advice-continuity-'));
const report={base,model:'gpt-6-astra',effort:'low',structuralPassed:false,reviewRequired:true,calls:[],delivered:[],scope:'Synthetic typed card scenario and blank images, real production Studio/provider. Not a live-game, physical voice, general naturalness, or latency benchmark.'};
const provider=new CodexProvider({...process.env,OPENAI_MODEL:report.model,OPENAI_REASONING_EFFORT:report.effort});
const original=provider.react.bind(provider);let s,now=Date.now();
provider.react=async(args,signal)=>{
  const started=Date.now(),result=await original(args,signal);
  report.calls.push({speech:args.speech,policy:args.advicePolicy,latencyMs:Date.now()-started,context:args.viewerContext,observation:result.observation,usage:result.usage});
  console.log(JSON.stringify({call:report.calls.length,speech:args.speech,policy:args.advicePolicy,messages:result.observation.messages,latencyMs:Date.now()-started}));
  await writeFile(join(base,'result.json'),JSON.stringify(report,null,2));return result;
};
try{
  await provider.check();assert.equal(provider.status().configured,true,'Official ChatGPT login must be available');
  s=new Studio({provider,settings:{...defaults,mode:'live',lurkRatio:0,slowModeSeconds:0,chatPace:8,maxCalls:6,personas:defaults.personas.filter(p=>['gg','pop','luna'].includes(p.id))},now:()=>now,random:()=>.5});clearInterval(s.timer);s.audience.random=()=>.5;s.start();
  const step=async(speech,value)=>{
    now+=20000;if(speech)s.receiveSpeech({id:randomUUID(),sessionId:s.sessionId,text:speech});
    const before=s.messages.length;await s.react({image:blank(value)});
    for(let i=0;i<10&&s.queue.length;i++){now+=3000;s.pump();}
    const displayed=s.messages.slice(before).filter(m=>m.kind==='chat');report.delivered.push(displayed);return displayed;
  };
  const first=await step('각보는고양이, 지금 카드를 고민 중이야. 적은 공격 6, 나는 방어도 0이고 에너지는 3이야. 손에는 방어도 5를 얻는 수비 두 장, 공격 6의 타격 세 장이 있어. 모두 비용 1이야. 피해 없이 넘기고 싶은데 힌트 딱 하나만 부탁해.',40);
  assert.equal(first.filter(m=>m.advice).length,1,'One requested hint must actually be delivered');
  assert.ok(first.length<=3,'No crowd lecture');
  const second=await step('',42);assert.equal(second.some(m=>m.advice),false);
  const third=await step('',44);assert.equal(third.some(m=>m.advice),false);
  const explanation=await step('각보는고양이, 아까 말한 이유가 뭐야? 새로운 행동은 권하지 말고 이유만 얘기해 줘.',46);
  assert.ok(explanation.length>0,'Clarification must still receive a reply');assert.equal(explanation.some(m=>m.advice),false);
  const renewed=await step('이제 다음 턴이야. 적 체력 6, 공격 예정은 10이고 내 에너지는 1이야. 손패는 비용 1에 공격 6인 타격이랑 비용 1에 방어 5인 수비야. 이번에도 힌트 하나만 부탁해.',48);
  assert.equal(renewed.filter(m=>m.advice).length,1,'New request must reopen permission');
  const refused=await step('훈수는 그만. 이제 내가 해볼게 ㅋㅋ',50);assert.equal(refused.some(m=>m.advice),false);
  assert.equal(report.calls.length,6);assert.equal(s.speechInbox.pending.length,0);report.structuralPassed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{s?.close();await writeFile(join(base,'result.json'),JSON.stringify(report,null,2));await writeFile(resolve('artifacts/advice-continuity-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({base,structuralPassed:report.structuralPassed,error:report.error}));}
