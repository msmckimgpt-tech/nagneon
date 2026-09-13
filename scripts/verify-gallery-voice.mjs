import {readFile,writeFile,mkdtemp,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {extractAll} from '@electron/asar';
import {parseArgs} from 'node:util';

await mkdir('artifacts',{recursive:true});const folder=await mkdtemp(resolve('artifacts/gallery-voice-'));
const report={folder,synthetic:true,deviceCapture:false,nativeApp:false,passed:false,checks:[],sourceHashes:{}};const hash=b=>createHash('sha256').update(b).digest('hex');
const {values}=parseArgs({options:{folder:{type:'string'},'media-only':{type:'boolean'}}});
let sourceRoot=resolve('.'),runtime={clips:{python:resolve('artifacts/python/python.exe')}};
if(values.folder){
  report.deliveredFolder=resolve(values.folder);const archive=join(report.deliveredFolder,'resources/app.asar');report.archiveSha256=hash(await readFile(archive));sourceRoot=join(folder,'source');extractAll(archive,sourceRoot);
  const {packagedRuntime}=await import(pathToFileURL(join(sourceRoot,'desktop/runtime.cjs')));runtime=packagedRuntime(join(report.deliveredFolder,'resources'));
  process.env.PATH=join(process.env.SystemRoot,'System32')+';'+process.env.SystemRoot;delete process.env.PYTHONHOME;delete process.env.PYTHONPATH;process.env.PYTHONDONTWRITEBYTECODE='1';
}
const load=p=>import(pathToFileURL(join(sourceRoot,p)));
const [{startServer},{Studio},{Audience},{defaults},{CodexProvider}]=await Promise.all([load('server/index.js'),load('server/studio.js'),load('server/audience.js'),load('shared/defaults.js'),load('server/codex-provider.js')]);
for(const f of ['server/community.js','server/provider.js','server/schema.js','server/data-schema.js','server/clips.js','server/clip-recording-routes.js'])report.sourceHashes[f]=hash(await readFile(join(sourceRoot,f)));
let service,s;
try{
 if(!values['media-only']){
 const provider=new CodexProvider({...process.env,...(runtime.codexBin?{CODEX_BIN:runtime.codexBin}:{}),OPENAI_MODEL:'gpt-6-astra',OPENAI_REASONING_EFFORT:'low'});await provider.check();assert.ok(provider.available,provider.authMessage);
 const relay={status:()=>provider.status(),react:async(args,signal)=>{const start=Date.now(),out=await provider.react(args,signal);report.model={model:'gpt-6-astra',effort:'low',ms:Date.now()-start,input:provider.payload(args),...out};return out;}};
 s=new Studio({provider:relay,settings:{...defaults,mode:'live'},audience:new Audience(undefined,()=>{},()=>.5)});clearInterval(s.timer);s.start();s.stop();s.settings.personas=s.settings.personas.filter(p=>['pop','gg','momo'].includes(p.id));
 const p=s.community.post({title:'다음 방송은 천천히 퍼즐 풀기',text:'시간을 재지 않고 조각을 맞추면서 이야기해보고 싶어요. 어려운 부분은 제가 물을 때 같이 고민해 주세요.',category:'공지'});await s.community.react(p.id);report.gallery=s.community.get(p.id);assert.ok(report.gallery.comments.length);assert.ok(report.gallery.votes.every(id=>['pop','gg','momo'].includes(id)));s.close();s=null;
 }
 const source=resolve('artifacts/separated-fixtures'),game=await readFile(join(source,'game.webm')),voice=await readFile(join(source,'voice.webm'));report.fixture=JSON.parse(await readFile(join(source,'result.json')));assert.equal(report.fixture.passed,true);
 const dataDir=join(folder,'profile');const fake={status:()=>({configured:true}),react:async()=>{throw Error('unexpected model call');}};
 service=await startServer({port:0,dataDir,localSpeech:false,provider:fake,runtime});const studio=service.studio,now=Date.now();clearInterval(studio.timer);studio.running=true;studio.sessionId='synthetic-voice';studio.settings.clipBufferEnabled=true;studio.settings.autoHighlights=true;
 const clip=studio.clips.create({title:'분리 소리 시험',game:'Synthetic',scene:'합성 영상과 주파수',participants:[],messages:[],sessionId:studio.sessionId,observedAt:now-2500,creator:{id:'fixture',name:'합성 관객'},source:'spectator'});
 const headers={Authorization:'Bearer '+service.accessToken,'X-Backseat-Client':'studio'};
 const send=async(kind,bytes,start=now-4000,end=now-1000)=>{const response=await fetch(`${service.url}/api/clips/${clip.id}/${kind}?startedAt=${start}&endedAt=${end}&hasAudio=true&audioLayout=separate`,{method:'POST',headers:{...headers,'Content-Type':(kind==='voice'?'audio':kind)+'/webm'},body:bytes});const body=await response.json();report.checks.push({kind,status:response.status,body});return {response,body};};
 assert.equal((await send('voice',voice)).response.status,409,'base must exist before voice');
 assert.equal((await send('video',game)).response.status,200);
 assert.equal((await send('voice',voice.subarray(0,voice.length/2))).response.status,422);
 assert.equal(studio.clips.get(clip.id).video,true);assert.ok(!studio.clips.get(clip.id).voice);
 assert.equal((await send('voice',voice,now-3990,now-990)).response.status,200);
 for(const [kind,expected] of [['video',game],['voice',voice]]){const res=await fetch(`${service.url}/api/clips/${clip.id}/media/${kind}`,{headers});assert.equal(res.status,200);assert.equal(hash(Buffer.from(await res.arrayBuffer())),hash(expected));}
 const id=clip.id;await service.close();service=null;
 service=await startServer({port:0,dataDir,localSpeech:false,provider:fake,runtime});assert.equal(service.studio.clips.get(id).voice,true);assert.equal(service.studio.clips.get(id).audioLayout,'separate');report.restarted=true;service.studio.clips.remove(id);assert.equal(service.studio.clips.list().length,0);report.removed=true;report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;console.error(error.stack);}
finally{s?.close();await service?.close();report.finishedAt=new Date().toISOString();await writeFile(join(folder,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({folder,passed:report.passed,checks:report.checks.map(c=>({kind:c.kind,status:c.status})),messages:report.model?.observation.messages,votes:report.gallery?.votes,error:report.error}));}
