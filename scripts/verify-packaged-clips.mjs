// Inspect and execute packaged server/decoder files without launching Electron,
// touching a user profile, opening a window, or capturing any device.
import assert from 'node:assert/strict';
import {mkdirSync,readdirSync,readFileSync,writeFileSync,createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve,dirname,isAbsolute} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {extractAll} from '@electron/asar';

const [folderArg,audioArg,videoArg,outputArg]=process.argv.slice(2);
if(!folderArg||!audioArg||!videoArg||!outputArg)throw Error('Usage: node scripts/verify-packaged-clips.mjs package-folder synthetic-audio synthetic-video new-output-directory');
const folder=resolve(folderArg),output=resolve(outputArg),root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
mkdirSync(output,{recursive:true});if(readdirSync(output).length)throw Error('Use a new empty evidence directory');
const hash=async file=>{const h=createHash('sha256');for await(const bytes of createReadStream(file))h.update(bytes);return h.digest('hex');};
const manifest=JSON.parse(readFileSync(join(dirname(dirname(folder)),'manifest.json'),'utf8'));
const result={passed:false,folder,nativeAppLaunched:false,deviceCapture:false,modelCalls:0,inventoryFiles:0,cases:[]};let service;
try{
  for(const file of manifest.files){assert.ok(!isAbsolute(file.path)&&!file.path.split(/[\\/]/).includes('..'));assert.equal(await hash(join(folder,file.path)),file.sha256,file.path);result.inventoryFiles++;}
  const archive=join(folder,'resources/app.asar'),source=join(output,'source');extractAll(archive,source);result.asarSha256=await hash(archive);
  for(const file of ['server/index.js','server/clip-inspector.js','server/clip-recording-routes.js','desktop/runtime.cjs'])assert.equal(await hash(join(source,file)),await hash(join(root,file)),file+' differs from tested source');
  const {packagedRuntime}=await import(pathToFileURL(join(source,'desktop/runtime.cjs')));
  const runtime=packagedRuntime(join(folder,'resources'));
  assert.equal(await hash(runtime.clips.worker),await hash(join(root,'scripts/clip_inspector.py')));result.workerSha256=await hash(runtime.clips.worker);
  const {startServer}=await import(pathToFileURL(join(source,'server/index.js')));
  service=await startServer({port:0,dataDir:join(output,'profile'),runtime,localSpeech:false,provider:{status:()=>({configured:true}),react:async()=>{throw Error('No model call allowed');}}});
  const s=service.studio;s.running=true;s.sessionId='packaged-fixture';s.settings.clipBufferEnabled=true;s.settings.autoHighlights=true;
  const unauthorized=await fetch(service.url+'/api/state');assert.equal(unauthorized.status,401);await unauthorized.arrayBuffer();
  const headers={Authorization:'Bearer '+service.accessToken,'X-Backseat-Client':'studio'};
  for(const [name,path,kind,status] of [['audio',audioArg,'audio',200],['video',videoArg,'video',200],['hidden-video',videoArg,'audio',422]]){
    const bytes=readFileSync(resolve(path)),now=Date.now(),clip=s.clips.create({title:name,game:'Synthetic fixture',scene:'Synthetic media',sessionId:s.sessionId,source:'spectator',creator:{id:'fixture'},participants:[],messages:[],observedAt:now-5000,audioEligible:true});
    const at=performance.now(),res=await fetch(`${service.url}/api/clips/${clip.id}/${kind}?startedAt=${now-15000}&endedAt=${now}&hasAudio=true`,{method:'POST',headers:{...headers,'Content-Type':kind+'/webm'},body:bytes});
    assert.equal(res.status,status);await res.arrayBuffer();assert.equal(s.clips.get(clip.id)[kind],status===200);
    if(status===200){const media=await fetch(`${service.url}/api/clips/${clip.id}/media/${kind}`,{headers});assert.equal(media.status,200);assert.ok(media.headers.get('content-type').startsWith(kind+'/webm'));assert.deepEqual(Buffer.from(await media.arrayBuffer()),bytes);
      const range=await fetch(`${service.url}/api/clips/${clip.id}/media/${kind}`,{headers:{...headers,Range:'bytes=0-63'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),bytes.subarray(0,64));}
    result.cases.push({name,status,ms:Math.round(performance.now()-at)});
  }
  result.passed=true;
}catch(error){result.error=error.stack;throw error;}
finally{await service?.close();writeFileSync(join(output,'result.json'),JSON.stringify(result,null,2));}
console.log(JSON.stringify(result,null,2));
