// Cancel the delivered decoder on a previous synthetic visit fixture, without devices.
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const visit=JSON.parse(await readFile(process.argv[2],'utf8'));
assert.equal(visit.synthetic,true);assert.equal(visit.deviceCapture,false);assert.equal(visit.passed,true);assert.ok(visit.deliveredFolder);
const folder=await mkdtemp(resolve('artifacts/clip-media-cancel-')),source=join(visit.folder,'source');
const [{ClipPerception},{Clips},{packagedRuntime}]=await Promise.all(['server/clip-perception.js','server/clips.js','desktop/runtime.cjs'].map(f=>import(pathToFileURL(join(source,f)))));
const runtime=packagedRuntime(join(visit.deliveredFolder,'resources')),controller=new AbortController();
const report={folder,deliveredFolder:visit.deliveredFolder,archiveSha256:visit.archiveSha256,synthetic:true,deviceCapture:false,nativeApp:false,passed:false};
let timer,child;
const reader=new ClipPerception(runtime,(executable,args,options)=>{
 assert.equal(resolve(executable),resolve(runtime.clips.python));assert.equal(resolve(args[3]),resolve(runtime.clipPerception.worker));assert.equal(options.windowsHide,true);
 child=spawn(executable,args,options);Object.assign(report,{pid:child.pid,executable,args});
 child.once('spawn',()=>{report.startedAt=Date.now();timer=setTimeout(()=>{report.abortedAt=Date.now();controller.abort();},500);});
 child.once('close',(code,signal)=>Object.assign(report,{closedAt:Date.now(),code,signal}));return child;
});
try{
 const clips=new Clips({data:[visit.clip],dir:join(visit.folder,'profile/clip-media')});
 await assert.rejects(reader.read(clips,visit.clip,controller.signal),/취소/);
 assert.ok(report.abortedAt);assert.ok(report.closedAt);assert.ok(child.killed);assert.equal(reader.active,null);
 report.cancelMs=report.closedAt-report.abortedAt;assert.ok(report.cancelMs<3000);report.passed=true;
}catch(e){report.error=e.stack;process.exitCode=1;}
finally{clearTimeout(timer);await reader.close();await writeFile(join(folder,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
