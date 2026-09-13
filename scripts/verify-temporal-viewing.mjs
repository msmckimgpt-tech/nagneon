// File-generated synthetic frames only. No browser, screen, mic, app or game.
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {deflateSync} from 'node:zlib';
import {randomUUID,createHash} from 'node:crypto';
import {CodexProvider} from '../server/codex-provider.js';
import {Studio} from '../server/studio.js';
import {Audience} from '../server/audience.js';
import {defaults} from '../shared/defaults.js';
import {TemporalFrames} from '../src/temporal-frames.ts';
import {Frame} from '../server/schema.js';

function crc(bytes){let n=0xffffffff;for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;}
function chunk(type,data){const name=Buffer.from(type),size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([name,data])));return Buffer.concat([size,name,data,sum]);}
function scene(x,y){
  const w=640,h=360,stride=w*3+1,pixels=Buffer.alloc(stride*h);
  const rect=(x,y,width,height,color)=>{for(let row=y;row<y+height;row++)for(let col=x;col<x+width;col++)pixels.set(color,row*stride+1+col*3);};
  rect(0,0,w,h,[26,34,47]);rect(0,310,w,50,[99,110,127]);rect(40,300,4,10,[230,230,230]);rect(590,300,4,10,[230,230,230]);
  rect(x,y,36,36,[241,79,75]);rect(x+23,y+9,5,5,[255,255,255]);
  const header=Buffer.alloc(13);header.writeUInt32BE(w);header.writeUInt32BE(h,4);header[8]=8;header[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}

await mkdir('artifacts',{recursive:true});const folder=await mkdtemp(resolve('artifacts/temporal-astra-'));
const provider=new CodexProvider({...process.env,OPENAI_MODEL:'gpt-6-astra',OPENAI_REASONING_EFFORT:'low'});
const report={model:'gpt-6-astra',effort:'low',synthetic:true,devices:false,userData:false,results:[],passed:false,limits:'Controlled scenes and clock. Not a native capture/FPS benchmark or user-session latency claim.'};
report.sourceHashes=Object.fromEntries(await Promise.all(['server/studio.js','server/provider.js','server/codex-provider.js','server/temporal-video.js','server/viewing-continuity.js','server/schema.js','src/temporal-frames.ts','src/temporal-capture.ts','src/useMedia.ts','shared/temporal-policy.js'].map(async file=>[file,createHash('sha256').update(await readFile(file)).digest('hex')])));
const save=()=>writeFile(join(folder,'result.json'),JSON.stringify(report,null,2));
const motion=[274,260,210,150,125,150,210,260,274];
const arc=motion.map(y=>scene(300,y));
const left=[540,480,420,360,300].map(x=>scene(x,274));
const right=[60,120,180,240,300].map(x=>scene(x,274));
for(const [name,images] of Object.entries({arc,left,right}))for(const [i,bytes] of images.entries())await writeFile(join(folder,`${name}-${i+1}.png`),bytes);
const words=o=>o.messages.map(m=>m.text).join(' ');
async function run(id,images,{single=false,speech='방금 빨간 네모는 어떻게 움직였어요?',check}={}){
  let at=Date.now()-30000,input,output;const start=at;
  const s=new Studio({provider:{status:()=>provider.status(),react:async(a,signal)=>{input=a;output=await provider.react(a,signal);return output;}},settings:{...defaults,mode:'live',gameId:'synthetic',games:[{id:'synthetic',name:'Synthetic',genre:'합성 화면',context:'제공된 화면과 발언만 참고한다.',popularity:0}],lurkRatio:0,chatPace:2,intervalSeconds:5,maxCalls:8,slowModeSeconds:0,personas:defaults.personas.filter(p=>['pop','momo',defaults.managerId].includes(p.id))},audience:new Audience(undefined,()=>{},()=>.5),now:()=>at,random:()=>.5});
  clearInterval(s.timer);s.start();const buffer=new TemporalFrames();buffer.reset(s.sessionId,randomUUID());
  for(const [i,bytes] of images.entries())buffer.add('data:image/png;base64,'+bytes.toString('base64'),start+1000+i*500,i===0?0:.1);
  at=start+1000+(images.length-1)*500;
  const video=buffer.window(at),args=Frame.parse(single?{image:video.frames.at(-1).image,speech}:{video,speech});const began=Date.now();
  try{
    const outcome=await s.react(args),ms=Date.now()-began;
    const passed=check(output.observation);const inputSummary={timeline:input.screenTimeline,frames:input.frames?.map(f=>({at:f.at,sha256:createHash('sha256').update(f.image).digest('hex')})),speech:input.speech};
    report.results.push({id,passed,ms,outcome,single,input:inputSummary,output,chat:words(output.observation)});
    console.log(JSON.stringify({id,passed,ms,chat:words(output.observation)}));
  }catch(error){report.results.push({id,passed:false,error:error.stack});console.log(JSON.stringify({id,error:error.message}));}
  finally{s.close();await save();}
}
try{
  await provider.check();if(!provider.status().configured)throw Error('Official CLI account is unavailable');
  await run('single-final-ambiguous',arc,{single:true,check:o=>!/점프했|뛰었다|뛰어올랐|점프해서|올라갔다가/.test(words(o))});
  await run('sequence-jump-and-return',arc,{check:o=>/점프|뛰|올라|위로/.test(words(o))&&/착지|내려|돌아|다시|제자리|바닥/.test(words(o))});
  await run('sequence-left-to-center',right,{check:o=>/오른쪽|우측|왼쪽에서.*(?:중앙|가운데)/.test(words(o))});
  await run('sequence-right-to-center',left,{check:o=>/왼쪽|좌측|오른쪽에서.*(?:중앙|가운데)/.test(words(o))});
  await run('sequence-static-no-invented-motion',Array(8).fill(arc.at(-1)),{check:o=>!/점프했|뛰었다|뛰어올랐|점프해서|올라갔다가|왼쪽으로.*이동|오른쪽으로.*이동/.test(words(o))});
  await run('sequence-live-reaction',arc,{speech:'',check:o=>/점프|뛰|올라|위로|상승/.test(o.scene)&&o.messages.length<=2&&!/프레임|이미지|분석|관측|확인됩니다/.test(words(o))});
  report.passed=report.results.length===6&&report.results.every(r=>r.passed);
}catch(error){report.error=error.stack;}
await save();await writeFile(resolve('artifacts/temporal-astra-result.json'),JSON.stringify({folder,...report},null,2));console.log(JSON.stringify({folder,passed:report.passed}));if(!report.passed)process.exitCode=1;
