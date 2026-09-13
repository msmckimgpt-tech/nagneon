// Opt-in real-model check: synthetic typed card choices, no device or user data.
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {Studio} from '../server/studio.js';
import {CodexProvider} from '../server/codex-provider.js';
import {Audience} from '../server/audience.js';
import {defaults} from '../shared/defaults.js';

if(!process.argv.includes('--live'))throw Error('Use --live to spend subscription usage on three synthetic conversations.');
await mkdir('artifacts',{recursive:true});
const folder=await mkdtemp(resolve('artifacts/choice-request-'));
const report={folder,model:'gpt-6-astra',effort:'low',passed:false,reviewRequired:true,sourceHashes:{},calls:[],scope:'Synthetic typed card choices through production Studio and official CLI. Not a physical microphone or captured game test.'};
for(const path of ['server/advice-intent.js','server/studio.js','server/provider.js','server/codex-provider.js','scripts/verify-choice-request.mjs'])report.sourceHashes[path]=createHash('sha256').update(await readFile(path)).digest('hex');
const provider=new CodexProvider({...process.env,OPENAI_MODEL:report.model,OPENAI_REASONING_EFFORT:report.effort});
const react=provider.react.bind(provider);let current,studio;
provider.react=async(args,signal)=>{
  current.policy=args.advicePolicy;current.adviceRequested=args.adviceRequested;
  const start=Date.now(),result=await react(args,signal);
  current.modelMs=Date.now()-start;current.observation=result.observation;current.usage=result.usage;
  return result;
};
try{
  await provider.check();assert.equal(provider.available,true);
  studio=new Studio({provider,audience:new Audience(undefined,()=>{},()=>.5),random:()=>.5,settings:{...defaults,mode:'live',category:'gaming',lurkRatio:0,slowModeSeconds:0,chatPace:3,maxCalls:3,autoHighlights:false,personas:defaults.personas.filter(p=>p.id==='momo'||p.id===defaults.managerId).map(p=>p.id==='momo'?{...p,name:'뭉칫'}:p)}});
  studio.start();
  const speeches=[
    '뭉칫, 지금 카드 보상은 왼쪽이 피해 7에 이번 턴 힘 3, 가운데가 취약 3, 오른쪽이 체력 2를 잃고 방어 16이야. 이번엔 셋 중에 뭐 골라볼까? 한 장만 같이 골라줘. 이유는 짧게 ㅋㅋ',
    '고마워 ㅋㅋ 골라줘서 도움이 됐어. 다음 선택은 내가 해볼게. 이제 추천하지 마.',
    '아까 뭐 고를까라고 했잖아. 지금 또 부탁하는 건 아니고 그때 얘기야. 그냥 같이 보자 ㅋㅋ',
  ];
  for(const [index,speech] of speeches.entries()){
    current={index,speech,startedAt:Date.now()};report.calls.push(current);
    studio.receiveSpeech({id:randomUUID(),sessionId:studio.sessionId,text:speech});const before=studio.messages.length;
    await studio.react({});assert.ok(current.observation,'Requires a real provider response');
    const deadline=Date.now()+10000;
    while(studio.queue.length&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
    assert.equal(studio.queue.length,0);
    current.delivered=studio.messages.slice(before).filter(m=>m.kind==='chat').map(m=>({text:m.text,advice:m.advice,time:m.time}));
    current.diagnostic=studio.reactions.snapshot(studio.queue).requests.at(-1);
    if(index===0){
      assert.equal(current.policy.maxMessages,1);assert.equal(current.adviceRequested,true);
      assert.equal(current.delivered.length,1,'The named viewer must answer this direct selection request');
      assert.equal(current.delivered[0].advice,true,'The response must be a card recommendation');
      assert.match(current.delivered[0].text,/왼쪽|가운데|오른쪽/,'The recommendation must identify one of the supplied options');
    }else{
      assert.equal(current.policy.allowed,false);
      assert.equal(current.delivered.filter(m=>m.advice).length,0,'No renewed advice after refusal or recollection');
    }
    await writeFile(join(folder,'result.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(current));
  }
  report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{
  studio?.close();await writeFile(join(folder,'result.json'),JSON.stringify(report,null,2));
  await writeFile('artifacts/choice-request-result.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({folder,passed:report.passed,error:report.error}));
}
