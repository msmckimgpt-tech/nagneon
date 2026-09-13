// Opt-in real Astra replay of one frozen, AI-authored conversation. Mechanical
// checks detect the observed missing facts; full replies still require review.
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {extractAll} from '@electron/asar';
import assert from 'node:assert/strict';

if(!process.argv.includes('--live'))throw Error('Use --live to make two real model calls on the frozen synthetic conversation.');
const label=process.argv.find(a=>a.startsWith('--label='))?.slice(8)||'candidate';
if(!/^[a-z0-9-]{1,40}$/.test(label))throw Error('Invalid report label');
const baselinePath=process.argv.find(a=>a.startsWith('--journal-module='))?.slice(17);
const packagePath=process.argv.find(a=>a.startsWith('--package='))?.slice(10);
if(baselinePath&&packagePath)throw Error('Select source comparison or packaged modules, not both.');
await mkdir('artifacts',{recursive:true});const folder=await mkdtemp(resolve(`artifacts/recall-continuation-${label}-`));
let appRoot=resolve('.'),archiveSha256=null,providerEnv={...process.env,OPENAI_MODEL:'gpt-6-astra',OPENAI_REASONING_EFFORT:'low'};
if(packagePath){
 const archive=join(resolve(packagePath),'resources/app.asar');
 archiveSha256=createHash('sha256').update(await readFile(archive)).digest('hex');
 appRoot=join(folder,'delivered-modules');extractAll(archive,appRoot);
 assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'),archiveSha256);
 const require=createRequire(pathToFileURL(join(appRoot,'package.json')));
 const {packagedRuntime}=require(join(appRoot,'desktop/runtime.cjs'));
 providerEnv={...providerEnv,CODEX_BIN:packagedRuntime(join(resolve(packagePath),'resources')).codexBin,PATH:join(process.env.SystemRoot,'System32')+';'+process.env.SystemRoot};
}
const load=path=>import(pathToFileURL(join(appRoot,path)));
const [{CodexProvider},{ConversationJournal},{JournalStore},{Studio},{Audience},{defaults}]=await Promise.all([
 load('server/codex-provider.js'),load('server/conversation-journal.js'),load('server/journal-store.js'),load('server/studio.js'),load('server/audience.js'),load('shared/defaults.js')
]);
const Journal=baselinePath?(await import(pathToFileURL(resolve(baselinePath)))).ConversationJournal:ConversationJournal;
const fixturePath='test/fixtures/recall-conversation.json',fixture=JSON.parse(await readFile(fixturePath,'utf8'));
const provider=new CodexProvider(providerEnv);
const report={folder,label,passed:false,reviewRequired:true,model:provider.model,effort:provider.effort,appRoot,packagePath:packagePath?resolve(packagePath):null,archiveSha256,sourceHashes:{},calls:[],scope:'Frozen synthetic conversation, real model and Studio publication, real journal save/load, controlled queue clock. Packaged mode extracts the exact delivered ASAR, not a native window test. No devices, user data, or general naturalness/latency acceptance.'};
for(const path of ['server/provider.js','server/viewer-context.js','server/conversation-journal.js','server/recall-continuation.js'])report.sourceHashes[path]=createHash('sha256').update(await readFile(join(appRoot,path))).digest('hex');
for(const path of [fixturePath,'scripts/verify-recall-continuation.mjs',...(baselinePath?[baselinePath]:[])])report.sourceHashes[path]=createHash('sha256').update(await readFile(path)).digest('hex');
const cases=[
 {id:'appointment',speech:'모모, 우리 다음 금요일에 추리게임 같이 하기로 한 거 몇 시였지?',speaker:'momo',expected:'Saturday at nine, corrected by streamer during the first conversation.',check:text=>/토요일/.test(text)&&/아홉|9/.test(text)},
 {id:'peer-tastes',speech:'팝콘도둑, 지난번에 너랑 모모가 각각 무슨 야식 고른다고 했지? 내가 고른 거랑 헷갈리지 말고 ㅋㅋ',speaker:'pop',expected:'Pop chose butter popcorn, Momo chose tteokbokki, streamer chose fried dumplings.',check:text=>/버터팝콘/.test(text)&&/떡볶이/.test(text)},
];
const save=()=>writeFile(join(folder,'result.json'),JSON.stringify(report,null,2));
try{
 await provider.check();assert.equal(provider.available,true);assert.equal(provider.model,'gpt-6-astra');assert.equal(provider.effort,'low');
 for(const c of cases){let studio;const row={id:c.id,speech:c.speech,expected:c.expected,factsPassed:false};report.calls.push(row);
  try{
   const dir=join(folder,c.id),store=new JournalStore(dir);store.save(structuredClone(fixture.journal));
   const restored=new JournalStore(dir);let clock=Math.max(...fixture.journal.entries.map(e=>e.at))+600000;
   studio=new Studio({provider:{status:()=>provider.status(),react:async(args,signal)=>{
    row.input=args;await writeFile(join(folder,c.id+'-input.json'),JSON.stringify(provider.payload(args),null,2));
    const at=Date.now(),result=await provider.react(args,signal);row.modelMs=Date.now()-at;clock+=row.modelMs;
    row.observation=result.observation;row.usage=result.usage;return result;
   }},journal:new Journal(restored.load(),v=>restored.save(v)),audience:new Audience(structuredClone(fixture.audience),()=>{},()=>.5),settings:{...defaults,mode:'live',category:'just-chatting',lurkRatio:0,slowModeSeconds:0,chatPace:3,maxCalls:1,communityActivityEnabled:false,personas:defaults.personas.filter(p=>['momo','pop','luna'].includes(p.id))},now:()=>clock,random:()=>.5});
   clearInterval(studio.timer);studio.start();clock+=5000;row.result=await studio.react({speech:c.speech});assert.ok(row.observation,'Real provider result is required');
   let guard=0;while(studio.queue.length&&guard++<20){clock=Math.max(clock,studio.queue[0].due)+1000;studio.pump();}assert.equal(studio.queue.length,0);
   row.delivered=studio.messages.filter(m=>m.kind==='chat');
   row.factsPassed=row.delivered.some(m=>m.personaId===c.speaker&&c.check(m.text))&&!row.observation.positiveMoment.positive;
   console.log(JSON.stringify({id:c.id,factsPassed:row.factsPassed,modelMs:row.modelMs,messages:row.delivered.map(m=>({id:m.personaId,text:m.text}))}));
  }catch(error){row.error=error.stack;}finally{studio?.close();await save();}
 }
 report.passed=report.calls.length===cases.length&&report.calls.every(c=>c.factsPassed&&!c.error);
}catch(error){report.error=error.stack;}
await save();await writeFile(`artifacts/recall-continuation-${label}-result.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({folder,passed:report.passed,error:report.error}));if(!report.passed)process.exitCode=1;
