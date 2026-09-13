// Synthetic PNGs, speech and sound transcripts only. Does not inspect screens,
// open an app, capture devices, or use the user's collected conversation.
import {writeFile,mkdtemp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {CodexProvider} from '../server/codex-provider.js';
import {Studio} from '../server/studio.js';
import {Audience} from '../server/audience.js';
import {defaults} from '../shared/defaults.js';

const glyphs={R:['11110','10001','10001','11110','10100','10010','10001'],O:['01110','10001','10001','10001','10001','10001','01110'],U:['10001','10001','10001','10001','10001','10001','01110'],N:['10001','11001','11001','10101','10011','10011','10001'],D:['11110','10001','10001','10001','10001','10001','11110'],C:['01111','10000','10000','10000','10000','10000','01111'],L:['10000','10000','10000','10000','10000','10000','11111'],E:['11111','10000','10000','11110','10000','10000','11111'],A:['01110','10001','10001','11111','10001','10001','10001'],'1':['00100','01100','00100','00100','00100','00100','01110'],'2':['01110','10001','00001','00010','00100','01000','11111']};
function crc(bytes){let n=0xffffffff;for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;}
function chunk(type,data){const name=Buffer.from(type),size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([name,data])));return Buffer.concat([size,name,data,sum]);}
function scoreboard(round,sparkle=0){
  const w=480,h=180,stride=w*3+1,pixels=Buffer.alloc(stride*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*stride+1+x*3;pixels.set([18,24,37],i);}
  function dot(x,y,color){pixels.set(color,y*stride+1+x*3);}
  function label(text,y){for(let c=0;c<text.length;c++){const g=glyphs[text[c]];if(!g)continue;for(let row=0;row<7;row++)for(let col=0;col<5;col++)if(g[row][col]==='1')for(let dy=0;dy<6;dy++)for(let dx=0;dx<6;dx++)dot(38+c*36+col*6+dx,y+row*6+dy,[132,231,173]);}}
  label('ROUND '+round,24);label('CLEAR',100);
  for(let y=15;y<25;y++)for(let x=400+sparkle;x<410+sparkle;x++)dot(x,y,[244,217,105]);
  const header=Buffer.alloc(13);header.writeUInt32BE(w);header.writeUInt32BE(h,4);header[8]=8;header[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}

const base=await mkdtemp(resolve('artifacts/viewing-continuity-model-'));
const images={};for(const [id,round,sparkle] of [['round1',1,0],['round1Animated',1,12],['round2',2,0]]){const png=scoreboard(round,sparkle);await writeFile(join(base,id+'.png'),png);images[id]='data:image/png;base64,'+png.toString('base64');}
const provider=new CodexProvider({...process.env,OPENAI_MODEL:'gpt-6-astra',OPENAI_REASONING_EFFORT:'low'});
const report={at:new Date().toISOString(),model:'gpt-6-astra',effort:'low',synthetic:true,devices:false,userData:false,clock:'controlled simulation; latency below is real provider wall time',results:[],passed:false};
let at=Date.now()-600000,lastInput,lastOutput,s;
const advance=ms=>at+=ms;
const flush=()=>{for(let i=0;i<8;i++){advance(2000);s.pump();}};
const save=()=>writeFile(join(base,'result.json'),JSON.stringify(report,null,2));
async function run(id,args,check){
  lastOutput=null;lastInput=null;const began=Date.now(),before=s.calls;
  try{
    const outcome=await s.react(args);const passed=check(lastOutput?.observation,outcome);
    const entry={id,passed,outcome,modelCalls:s.calls-before,ms:Date.now()-began,imageSha256:args.image?createHash('sha256').update(args.image).digest('hex'):null,speech:args.speech||'',observation:lastOutput?.observation,usage:lastOutput?.usage,context:lastInput?Object.fromEntries(Object.entries(lastInput.viewerContext).map(([id,p])=>[id,{watchTiming:p.watchTiming,reactions:p.conversationRhythm.recentReactions,heardSounds:p.heardSounds}])):null};
    report.results.push(entry);console.log(JSON.stringify({id,passed,modelCalls:entry.modelCalls,ms:entry.ms,messages:entry.observation?.messages||[]}));flush();
  }catch(error){report.results.push({id,passed:false,error:error.stack});console.log(JSON.stringify({id,error:error.message}));}
  await save();
}
try{
  await provider.check();if(!provider.status().configured)throw Error('Official CLI account is unavailable');
  s=new Studio({provider:{status:()=>provider.status(),react:async(args,signal)=>{lastInput=args;lastOutput=await provider.react(args,signal);return lastOutput;}},settings:{...defaults,mode:'live',category:'gaming',gameId:'auto',lurkRatio:0,chatPace:3,maxCalls:8,slowModeSeconds:0,personas:defaults.personas.map(p=>({...p,enabled:p.id!=='new'}))},audience:new Audience(undefined,()=>{},()=>.5),now:()=>at,random:()=>.5});clearInterval(s.timer);s.start();
  await run('first-round-success',{image:images.round1,speech:'와 드디어 첫 관문 깼다! 열 번 만에 성공했어요!'},o=>o.messages.length>=1&&o.messages.length<=3);
  advance(120000);await run('identical-result-idles',{image:images.round1},(_o,r)=>r.skipped==='unchanged-input');
  // Move witnessed cheers outside the 35-line recent chat window.
  for(let i=0;i<40;i++){advance(3000);s.addMessage('streamer','합성 방송의 별도 일상 이야기 '+(i+1),'streamer');}
  advance(20000);await run('same-result-animation-after-minutes',{image:images.round1Animated},o=>o.messages.length===0);
  advance(20000);await run('retrospective-question',{image:images.round1Animated,speech:'모모님, 아까 첫 관문 겨우 깼을 때 어떤 기분이었어요?'},o=>o.messages.some(m=>m.personaId==='momo')&&o.messages.length<=2);
  advance(20000);await run('new-round-success',{image:images.round2,speech:'두 번째 관문도 방금 깼어요! 이번에는 한 번에 됐네!'},o=>o.messages.length>=1&&o.messages.length<=3);
  advance(60000);const p=s.settings.personas.find(p=>p.id==='new');p.enabled=true;s.audience.join(p,s.settings,at);
  await run('late-arrival',{image:images.round2},o=>!o.messages.some(m=>m.personaId==='new'&&/아까|드디어|열 번|한 번에|함께 봤|첫 관문/.test(m.text)));
  advance(20000);s.sound.events=[{id:'synthetic-offscreen-sound',startedAt:at-1000,endedAt:at,silent:false,witnesses:s.presentWitnesses(),classes:[],systemSpeech:'다음 관문으로 이동합니다.'}];
  await run('fresh-offscreen-sound',{image:images.round2},o=>!o.messages.some(m=>/세 번째.*(?:깼|클리어|성공)|또.*(?:깼|클리어|성공)/.test(m.text)));
  advance(40000);s.addMessage('pop','모모님은 퍼즐이랑 탐험 중에 뭐가 더 좋아요?');
  await run('peer-conversation-on-paused-screen',{image:images.round2},o=>o.messages.some(m=>m.personaId==='momo')&&o.messages.length<=2);
  report.passed=report.results.length===8&&report.results.every(r=>r.passed);
  report.limit='Seven live Astra calls and one exact-input skip on synthetic PNGs with a controlled clock. Criteria need manual output review; this is not a measured user-session improvement, latency benchmark, or semantic event detector.';
}catch(error){report.error=error.stack;}finally{s?.close();await save();}
console.log(JSON.stringify({base,passed:report.passed,cases:report.results.length}));if(!report.passed)process.exitCode=1;
