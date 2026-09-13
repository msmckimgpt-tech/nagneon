// Synthetic dialogue only; never submits the user's retained test transcript.
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {extractAll} from '@electron/asar';
import {parseArgs} from 'node:util';
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';

await mkdir('artifacts',{recursive:true});const folder=await mkdtemp(resolve('artifacts/listening-astra-'));
const report={folder,model:'gpt-6-astra',effort:'low',synthetic:true,userData:false,devices:false,mechanicalPassed:false,calls:[],hashes:{}};
const {values,positionals}=parseArgs({options:{folder:{type:'string'}},allowPositionals:true});
let sourceRoot=resolve('.'),runtime={};
if(values.folder){
  report.deliveredFolder=resolve(values.folder);const archive=join(report.deliveredFolder,'resources/app.asar');report.archiveSha256=createHash('sha256').update(await readFile(archive)).digest('hex');sourceRoot=join(folder,'source');extractAll(archive,sourceRoot);
  const {packagedRuntime}=await import(pathToFileURL(join(sourceRoot,'desktop/runtime.cjs')));runtime=packagedRuntime(join(report.deliveredFolder,'resources'));
  process.env.PATH=join(process.env.SystemRoot,'System32')+';'+process.env.SystemRoot;
}
const load=p=>import(pathToFileURL(join(sourceRoot,p)));
const [{CodexProvider},{defaults},{liveViewerContext},{ConversationJournal},{Observation}]=await Promise.all([load('server/codex-provider.js'),load('shared/defaults.js'),load('server/viewer-context.js'),load('server/conversation-journal.js'),load('server/schema.js')]);
for(const f of ['server/provider.js','server/conversation-rhythm.js','server/streamer-expression.js','server/viewer-context.js','server/conversation-journal.js','server/transcript-correction.js'])report.hashes[f]=createHash('sha256').update(await readFile(join(sourceRoot,f))).digest('hex');
const save=()=>writeFile(join(folder,'result.json'),JSON.stringify(report,null,2));
const provider=new CodexProvider({...process.env,...(runtime.codexBin?{CODEX_BIN:runtime.codexBin}:{}),OPENAI_MODEL:'gpt-6-astra',OPENAI_REASONING_EFFORT:'low'},(bin,args,options)=>{
  const child=spawn(bin,args,options),index=args.indexOf('--output-last-message');
  if(index>=0)child.on('close',()=>{try{const raw=readFileSync(args[index+1],'utf8'),parsed=JSON.parse(raw),check=Observation.safeParse(parsed);writeFileSync(join(folder,`response-${report.calls.length+1}.json`),JSON.stringify({raw,issues:check.success?[]:check.error.issues},null,2));}catch{}});
  return child;
});
try{
  await provider.check();assert.ok(provider.available,provider.authMessage);
  const settings={...defaults,mode:'live',category:'just-chatting',webSearch:false,chatPace:2,personas:defaults.personas.filter(p=>['pop','gg'].includes(p.id))};
  const cases=[
    {id:'playful-boast',speech:'제 실력이 좀 대단하죠? 하하 농담이에요. 운이 도와줬네요.',history:['와 겨우 통과했어요. 여러분 덕분이에요.','아까는 자신만만했는데 손에 땀이 났어요.']},
    {id:'quiet-company',speech:'',history:['저는 퇴근하고 작은 퍼즐 맞출 때 마음이 편해요.','오늘은 서두르지 말고 천천히 해볼게요.'],ambient:{id:'quiet-company',idle:true,instruction:'화면 변화 없는 조용한 틈이다. 함께 들은 이야기로 최대 한 명이 가볍게 말을 건넨다. 새 사건을 만들거나 화면을 분석하지 않는다. 답을 재촉하지 않는다.'}},
    {id:'requested-commentary',speech:'각보는고양이님, 제가 잠깐 간식 먹는 동안 지금까지 들은 설명으로 이 퍼즐 풀이를 중계해 주세요. 길어도 괜찮아요.',history:['이 퍼즐은 같은 색 세 개를 이으면 문이 열려요.','방금 파란 조각을 연결해서 첫 문을 열었어요.','다음 문은 초록 세 개가 필요한데 둘만 모였어요.']},
    {id:'resolved-outcome',speech:'열쇠가 없네요. 어? 찾았어요! 방금 주머니에 있었네요.',history:['마지막 문 앞인데 열쇠가 안 보여요.']},
  ];
  for(const c of cases.filter(c=>!positionals[0]||c.id===positionals[0])){
    const now=Date.now(),journal=new ConversationJournal(),sessionId=randomUUID(),history=c.history.map((text,i)=>({id:randomUUID(),kind:'streamer',personaId:'streamer',name:'방장',text,time:now-180000+i*3000}));
    for(const m of history)journal.record(m,{sessionId,witnesses:['pop','gg']});
    const audience={members:settings.personas.map(p=>({id:p.id,joinedAt:now-200000})),eligible:['pop','gg']};
    const args={settings,history:[],previous:null,speech:c.speech,ambient:c.ambient,adviceRequested:false,...liveViewerContext(audience,settings.personas,history,null,{journal,speech:c.speech,now})};
    const start=Date.now();const output=await provider.react(args,AbortSignal.timeout(60000));
    const entry={id:c.id,ms:Date.now()-start,input:provider.payload(args),...output};report.calls.push(entry);await save();
    assert.ok(output.observation.messages.every(m=>['pop','gg'].includes(m.personaId)));
    if(c.id==='quiet-company')assert.ok(output.observation.messages.length<=1);
    else assert.ok(output.observation.messages.length>0,'Expected invited reaction');
    console.log(JSON.stringify({id:c.id,ms:entry.ms,messages:output.observation.messages}));
  }
  report.mechanicalPassed=true;
}catch(error){report.error=error.stack;process.exitCode=1;console.error(error.stack);}
finally{report.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify({folder,mechanicalPassed:report.mechanicalPassed}));}
