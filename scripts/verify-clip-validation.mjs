// Real HTTP + binary decoder acceptance using supplied synthetic recordings.
// No account/model calls, device capture, user profile, or visible window.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {startServer} from '../server/index.js';
import {ClipInspector} from '../server/clip-inspector.js';

const [audioArg,videoArg,outputArg]=process.argv.slice(2);
if(!audioArg||!videoArg||!outputArg)throw Error('Usage: node scripts/verify-clip-validation.mjs synthetic-audio.webm synthetic-video.webm new-output-directory');
const output=resolve(outputArg);mkdirSync(output,{recursive:true});if(readdirSync(output).length)throw Error('Use a new empty evidence directory');
const dataDir=join(output,'data'),audio=readFileSync(resolve(audioArg)),video=readFileSync(resolve(videoArg));
const hash=b=>createHash('sha256').update(b).digest('hex');
const result={passed:false,synthetic:true,deviceCapture:false,modelCalls:0,fixtures:{audio:hash(audio),video:hash(video)},cases:[]};
const provider={status:()=>({configured:true}),react:async()=>{throw Error('Model calls forbidden in this file fixture');}};
let service;
try{
  service=await startServer({port:0,dataDir,localSpeech:false,provider});
  const s=service.studio;s.running=true;s.sessionId='synthetic-validation';s.settings.clipBufferEnabled=true;s.settings.autoHighlights=true;
  const headers={Authorization:'Bearer '+service.accessToken,'X-Backseat-Client':'studio'};
  const cases=[['fake-webm',Buffer.concat([Buffer.from('1a45dfa3','hex'),Buffer.alloc(120)]),'audio',true,15000,422],
    ['truncated-audio',audio.subarray(0,audio.length-1),'audio',true,15000,422],
    ['truncated-video',video.subarray(0,Math.floor(video.length/2)),'video',true,15000,422],
    ['hidden-video',video,'audio',true,15000,422],['missing-video',audio,'video',true,15000,422],
    ['hidden-audio',video,'video',false,15000,422],['wrong-duration',audio,'audio',true,3000,422],
    ['trailing-junk',Buffer.concat([audio,Buffer.from('junk')]),'audio',true,15000,422],
    ['valid-audio',audio,'audio',true,15000,200],['valid-video',video,'video',true,15000,200]];
  for(const [name,bytes,kind,hasAudio,duration,expected] of cases){
    const now=Date.now(),clip=s.clips.create({title:name,scene:'Synthetic recording',game:'File fixture',sessionId:s.sessionId,source:'spectator',creator:{id:'synthetic'},participants:[],messages:[],observedAt:now-duration/2,audioEligible:true});
    const started=performance.now();
    const request=fetch(`${service.url}/api/clips/${clip.id}/${kind}?startedAt=${now-duration}&endedAt=${now}&hasAudio=${hasAudio}`,{method:'POST',headers:{...headers,'Content-Type':kind+'/webm'},body:bytes});
    const stateStart=performance.now(),state=await fetch(service.url+'/api/state',{headers});assert.equal(state.status,200);await state.arrayBuffer();const stateMs=performance.now()-stateStart;
    const response=await request,value=await response.json();assert.equal(response.status,expected,`${name}: ${JSON.stringify(value)}`);
    assert.equal(s.clips.get(clip.id)[kind],expected===200);
    const path=s.clips.file(clip.id,'webm');assert.equal(existsSync(path),expected===200);
    if(expected===200){assert.equal(hash(readFileSync(path)),hash(bytes));s.clips.remove(clip.id);}else assert.ok(value.error);
    assert.deepEqual(existsSync(join(dataDir,'clip-media'))?readdirSync(join(dataDir,'clip-media')):[],[]);
    result.cases.push({name,status:response.status,ms:Math.round(performance.now()-started),stateMs:Math.round(stateMs),noUncommittedMedia:true});
  }
  await service.close();service=null;
  const inspector=new ClipInspector();
  try{result.decoded={};for(const [kind,bytes] of [['audio',audio],['video',video]])result.decoded[kind]=await inspector.inspect(bytes,{kind,hasAudio:true,startedAt:0,endedAt:15000});}finally{await inspector.close();}
  // A missing decoder is an explicit failure, never a header-only fallback.
  service=await startServer({port:0,dataDir:join(output,'missing-runtime'),provider,localSpeech:false,runtime:{clips:{python:join(output,'missing-python.exe')}}});
  const s2=service.studio,now=Date.now();s2.running=true;s2.sessionId='missing';s2.settings.clipBufferEnabled=true;s2.settings.autoHighlights=true;
  const c=s2.clips.create({title:'Missing runtime',game:'Fixture',scene:'Fixture',sessionId:'missing',source:'spectator',creator:{id:'synthetic'},participants:[],messages:[],observedAt:now-1000,audioEligible:true});
  const failed=await fetch(`${service.url}/api/clips/${c.id}/audio?startedAt=${now-15000}&endedAt=${now}&hasAudio=true`,{method:'POST',headers:{Authorization:'Bearer '+service.accessToken,'X-Backseat-Client':'studio','Content-Type':'audio/webm'},body:audio});
  assert.equal(failed.status,503);await failed.arrayBuffer();assert.equal(s2.clips.get(c.id).audio,false);assert.equal(existsSync(s2.clips.file(c.id,'webm')),false);result.missingRuntimeStatus=503;result.passed=true;
}catch(error){result.error=error.stack;throw error;}
finally{await service?.close();writeFileSync(join(output,'result.json'),JSON.stringify(result,null,2));}
console.log(JSON.stringify(result,null,2));
