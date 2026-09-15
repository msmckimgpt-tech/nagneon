// Real subscription calls with fictional, repeatable inputs. No personal data or devices.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {CodexProvider} from '../server/codex-provider.js';
import {Settings} from '../server/schema.js';
import {defaults} from '../shared/defaults.js';

const out=resolve(process.argv.find(a=>a.startsWith('--out='))?.slice(6)||'artifacts/audience-model-benchmark');
await mkdir(out,{recursive:true});
if(existsSync(join(out,'results.json')))throw Error('Evidence already exists; use --out=<new folder>.');
const image=await readFile(join(out,'vision.png'));
const settings=Settings.parse({...structuredClone(defaults),mode:'live',category:'just-chatting',chatPace:2,webSearch:false,personas:defaults.personas.filter(p=>['momo','gg','pop','luna'].includes(p.id))});
const base={settings,history:[],previous:null,knowledge:null,adviceRequested:false,advicePolicy:{allowed:false,maxMessages:0},audience:{eligible:['momo','gg','pop'],members:['momo','gg','pop'].map(id=>({id,presence:'active',relationship:'첫 방문'})),lore:[],offStreamPosts:[]}};
const cases=[
  {id:'korean-chat',expected:'Answer cozy preference warmly in Korean; no invented shared past or unsolicited game advice.',args:{...base,speech:'오늘은 좀 지쳤어. 모모야, 너는 잔잔하게 집 꾸미는 게임이랑 경쟁 게임 중에 뭐가 더 좋아? 짧게 얘기해줘.'}},
  {id:'follow-up',expected:'Retain explicit preference for cozy home decoration and answer the follow-up; do not restart choices.',args:{...base,history:[{id:'11111111-1111-4111-8111-111111111111',personaId:'streamer',name:'플레이어',kind:'streamer',time:1789483200000,text:'오늘은 잔잔하게 집 꾸미는 게임을 하자.'},{id:'22222222-2222-4222-8222-222222222222',personaId:'momo',name:'모모',kind:'chat',time:1789483201000,text:'좋아 ㅋㅋ 작은 오두막부터 꾸미자.'}],speech:'좋아, 아까 말한 오두막은 숲속에 지을게. 모모야, 조명은 어떤 분위기면 좋겠어? 게임 공략 말고 취향만 말해줘.'}},
  {id:'vision',expected:'Read fictional screen: BOSS DEFEATED, HP 20/100, ROUND 3. No unseen actions or advice.',args:{...base,settings:{...settings,category:'gaming'},image:'data:image/png;base64,'+image.toString('base64'),speech:'화면에 나온 결과랑 내 남은 체력을 보고 한마디 해줘. 공략은 괜찮아.'}},
  {id:'speech-meaning',expected:'Keep negation and seven attempts; no new game advice or rewritten meaning.',args:{...base,speech:'보스를 깬 게 아니라 아직 못 깼어. 일곱 번 실패했는데 오늘은 공략 말고 그냥 응원만 해줘.',transcriptCandidates:[{messageId:'33333333-3333-4333-8333-333333333333',text:'보스를 깬 게 아니라 아직 못 깼어. 일곱 번 실패했는데 오늘은 공략 말고 그냥 응원만 해줘.'}]}}
];
const configs=process.argv.includes('--luna-diagnostics')?[{model:'gpt-5.6-luna',effort:'low'}]:process.argv.includes('--luna')?[{model:'gpt-6-astra',effort:'low'},{model:'gpt-5.6-luna',effort:'low'},{model:'gpt-5.6-luna',effort:'none'}]:[{model:'gpt-6-astra',effort:'low'},{model:'gpt-5.4-mini',effort:'low'},{model:'gpt-5.4-mini',effort:'none'}];
const report={schema:1,startedAt:new Date().toISOString(),baseline:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),transport:'Official Codex CLI / ChatGPT subscription',input:'Fictional test cases; synthetic screen; real model outputs',imageSha256:createHash('sha256').update(image).digest('hex'),cases:cases.map(({id,expected})=>({id,expected})),configs,results:[],unavailable:[],cost:'NOT_MEASURED',latencyScope:'Provider.react start to parsed complete JSON (includes CLI launch); excludes STT/capture/chat delivery.',limitations:'Two repeats per case/config. Exploratory sample, not an SLA or physical-device acceptance.'};
const save=()=>writeFile(join(out,'results.json'),JSON.stringify(report,null,2));
await writeFile(join(out,'inputs.json'),JSON.stringify(cases.map(c=>({...c,args:{...c.args,image:c.args.image?'vision.png':undefined}})),null,2));
for(let repeat=0;repeat<2;repeat++)for(const c of cases)for(const config of (repeat?[...configs].reverse():configs)){
  const key=config.model+'/'+config.effort;if(report.unavailable.some(e=>e.key===key))continue;
  let rawOutput;
  const provider=new CodexProvider({...process.env,OPENAI_MODEL:config.model,OPENAI_REASONING_EFFORT:config.effort},(bin,args,options)=>{
    const child=spawn(bin,args,options),index=args.indexOf('--output-last-message');
    if(index>=0)child.on('close',()=>{try{rawOutput=readFileSync(args[index+1],'utf8');}catch{}});
    return child;
  });
  const status=await provider.check();if(!status.configured){report.unavailable.push({key,reason:status.authMessage});await save();continue;}
  const start=performance.now();
  try{
    const result=await provider.react(structuredClone(c.args),new AbortController().signal);
    const messages=result.observation.messages;
    const checks={nonempty:messages.length>0,knownPersonas:messages.every(m=>settings.personas.some(p=>p.id===m.personaId)),korean:messages.some(m=>/[가-힣]/.test(m.text)),noAdviceFlags:messages.every(m=>!m.advice),noSpoilerFlags:messages.every(m=>!m.spoiler)};
    report.results.push({case:c.id,repeat,...config,ms:Math.round(performance.now()-start),checks,...result,rawOutput});
  }catch(error){const entry={case:c.id,repeat,...config,ms:Math.round(performance.now()-start),error:error.message,code:error.code,rawOutput};report.results.push(entry);if(['model','auth','usage'].includes(error.code))report.unavailable.push({key,reason:error.message});}
  await save();const latest=report.results.at(-1);console.log(JSON.stringify({case:c.id,repeat,...config,ms:latest.ms,error:latest.error,checks:latest.checks}));
}
report.finishedAt=new Date().toISOString();
report.summary=configs.map(config=>{const rows=report.results.filter(r=>r.model===config.model&&r.effort===config.effort),success=rows.filter(r=>!r.error),times=success.map(r=>r.ms).sort((a,b)=>a-b);return {...config,attempts:rows.length,successes:success.length,medianMs:times.length?(times[Math.floor((times.length-1)/2)]+times[Math.floor(times.length/2)])/2:null,minMs:times[0]??null,maxMs:times.at(-1)??null,mechanicalChecksPassed:success.filter(r=>Object.values(r.checks).every(Boolean)).length};});
await save();console.log(JSON.stringify(report.summary));
