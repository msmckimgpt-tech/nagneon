// Opt-in official account validation with synthetic names and one model call.
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {CodexProvider} from '../server/codex-provider.js';
import {Studio} from '../server/studio.js';
import {Audience} from '../server/audience.js';
import {defaults} from '../shared/defaults.js';

if(!process.argv.includes('--live'))throw Error('Use --live for one real Astra low call.');
await mkdir('artifacts',{recursive:true});const folder=await mkdtemp(resolve('artifacts/viewer-alias-'));
const provider=new CodexProvider({...process.env,OPENAI_MODEL:'gpt-6-astra',OPENAI_REASONING_EFFORT:'low'});
const report={folder,passed:false,model:provider.model,effort:provider.effort,synthetic:true,physicalDevices:false,scope:'One synthetic former-name address through the actual Studio pipeline. Full reply review required; not general conversation quality acceptance.',sourceHashes:{}};
for(const path of ['server/viewer-addressing.js','server/audience.js','server/viewer-context.js','server/studio.js'])report.sourceHashes[path]=createHash('sha256').update(await readFile(path)).digest('hex');
let studio;
try{
 await provider.check();if(!provider.available||provider.model!=='gpt-6-astra'||provider.effort!=='low')throw Error('Requested official model connection unavailable');
 let clock=1000000;
 studio=new Studio({provider:{status:()=>provider.status(),react:async(args,signal)=>{
  report.addressed=args.viewerContext?.momo?.conversationRhythm.addressed;
  await writeFile(join(folder,'input.json'),JSON.stringify(provider.payload(args),null,2));
  const start=Date.now(),result=await provider.react(args,signal);report.modelMs=Date.now()-start;clock+=report.modelMs;report.observation=result.observation;report.usage=result.usage;return result;
 }},audience:new Audience(undefined,()=>{},()=>.5),settings:{...defaults,mode:'live',category:'just-chatting',lurkRatio:0,slowModeSeconds:0,chatPace:1,maxCalls:1,communityActivityEnabled:false,personas:defaults.personas.filter(p=>['momo','pop','luna'].includes(p.id)).map(p=>({...p,...(p.id==='momo'?{name:'구름산책'}:{})}))},now:()=>clock,random:()=>.5});
 clearInterval(studio.timer);studio.start();studio.audience.data.members.momo.aliases=[{name:'모모',at:clock-1000}];studio.audience.presence.momo='lurking';clock+=5000;
 await studio.react({speech:'모모님, 지금은 어떤 닉으로 활동해?'});
 for(let i=0;studio.queue.length&&i<20;i++){clock=Math.max(clock,studio.queue[0].due)+1000;studio.pump();}
 report.delivered=studio.messages.filter(m=>m.kind==='chat').map(({personaId,text})=>({personaId,text}));
 report.passed=report.addressed===true&&report.delivered.some(m=>m.personaId==='momo'&&/구름산책/.test(m.text))&&studio.queue.length===0;
}catch(error){report.error=error.stack;}
finally{studio?.close();await writeFile(join(folder,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({folder,passed:report.passed,addressed:report.addressed,modelMs:report.modelMs,delivered:report.delivered,error:report.error}));}
if(!report.passed)process.exitCode=1;
