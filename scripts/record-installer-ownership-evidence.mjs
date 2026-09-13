import {readFile,writeFile,mkdir,readdir,copyFile} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve('.'),json=async p=>JSON.parse((await readFile(p,'utf8')).replace(/^\uFEFF/,''));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const names=(await readdir('installer/engine')).filter(n=>n.endsWith('.cs')).sort();
const sources=await Promise.all(names.map(async name=>({name,sha256:digest(await readFile(join('installer/engine',name)))})));
const records=['unit','guards','transaction','nsis'];
const runs=await Promise.all(records.map(n=>json('artifacts/latest-installer-'+n+'-test.json')));
const full=await json('artifacts/latest-full-installer-test.json');
assert.ok(full.passed&&full.installed&&full.uninstalled);
const sourceMatches=[];
for(let i=0;i<runs.length;i++){
  const run=runs[i];assert.equal(run.passed,true);
  if(records[i]==='unit'){
    for(const source of run.sources.filter(s=>names.includes(s.file.split(/[\\/]/).at(-1)))){
      assert.equal(source.sha256,sources.find(s=>s.name===source.file.split(/[\\/]/).at(-1)).sha256);
    }
  }else{
    const compiled=await json(join(run.base,'engine/compiler-result.json'));
    assert.equal(compiled.exitCode,0);assert.deepEqual(compiled.sources,sources);
  }
  sourceMatches.push({base:run.base,currentSourcesMatch:true});
}
const compiled=await json(join(full.project,'engine-build/compiler-result.json'));
assert.equal(compiled.exitCode,0);assert.deepEqual(compiled.sources,sources);
sourceMatches.push({base:full.project,currentSourcesMatch:true});
const runtime=await json(join(full.base,'runtime-result.json')),native=await json(join(full.base,'native-result.json'));
assert.ok(runtime.passed&&runtime.deliveredModules&&runtime.liveModel&&runtime.soundLive);
assert.ok(native.passed&&native.closed);assert.equal(runtime.folder,full.payload);
const oldApp=await json('artifacts/sound-user-app-process.json'),app=await json('artifacts/installer-ownership-user-app-process.json');
assert.equal(app.ProcessId,oldApp.ProcessId);assert.equal(app.ExecutablePath,oldApp.ExecutablePath);
assert.equal(new Date(app.CreationDate).valueOf(),new Date(oldApp.CreationDate).valueOf());
const snapshot=resolve('artifacts','installer-ownership-source-'+new Date().toISOString().replace(/[:.]/g,'-'));await mkdir(snapshot);
for(const name of names)await copyFile(join('installer/engine',name),join(snapshot,name));
const paths=new Set([
  'HANDOFF.md','docs/INSTALLER.md','docs/SYSTEM-SOUND.md','installer/engine/README.md','installer/backseat.nsi.in',
  'scripts/build-installer-engine.mjs','scripts/build-installer.mjs','scripts/verify-installer-transactions.mjs',
  'scripts/verify-installer-nsis.mjs','scripts/verify-installer-guards.mjs','scripts/test-installer-engine.mjs',
  'scripts/verify-full-installer.mjs','scripts/verify-packaged-runtime.mjs','scripts/record-installer-ownership-evidence.mjs',
  'scripts/installer-test-publication.ps1','scripts/installer-snapshot.ps1','test/installer/EngineTests.cs','test/installer-build.test.js',
  'artifacts/installer-ownership-user-app-process.json','artifacts/latest-full-installer-test.json',
  'artifacts/installer-ownership-builder-final.log','artifacts/installer-ownership-unit-current.log',
  'artifacts/installer-guards-current.log','artifacts/installer-ownership-transactions-current.log',
  'artifacts/installer-ownership-nsis-current.log','artifacts/installer-full-ownership-build.log',
  'artifacts/installer-full-install-current.log','artifacts/installer-full-uninstall-current.log'
]);
for(let i=0;i<runs.length;i++)paths.add('artifacts/latest-installer-'+records[i]+'-test.json');
for(const base of [...runs.map(r=>r.base),full.base,full.project,join(full.project,'engine-build')]){
  for(const entry of await readdir(base,{withFileTypes:true}))if(entry.isFile()&&/\.(json|log|txt|jpg|png|nsi|nsh)$/.test(entry.name))paths.add(join(base,entry.name));
}
for(const run of runs.filter(r=>r.operations)){
  paths.add(join(run.base,'engine/compiler-result.json'));
  for(const op of run.operations)if(op.log)paths.add(op.log);
}
for(const name of names)paths.add(join(snapshot,name));
const files=[];
for(const path of paths){
  const absolute=resolve(path);assert.ok(absolute.startsWith(root+'\\'));
  const bytes=await readFile(absolute);files.push({path:relative(root,absolute).replaceAll('\\','/'),bytes:bytes.length,sha256:digest(bytes)});
}
const evidence={recordedAt:new Date().toISOString(),scope:'TEST installer: stored ownership, real failure preservation and full installed app/runtime/uninstall. Production and retail readiness remain disabled.',sourceMatches,sourceSnapshot:snapshot,userAppUnchanged:true,unit:runs[0].summary,guards:runs[1].checks.length,transactions:runs[2].checks.length,nsis:runs[3].checks.length,full:{verifiedFiles:full.verifiedFiles,payloadBytes:full.payloadBytes,setupSha256:full.setupSha256,native:true,deliveredSoundAndLiveAstra:true,uninstalled:true},files};
const output=join(snapshot,'evidence.json');await writeFile(output,JSON.stringify(evidence,null,2));
await writeFile('artifacts/latest-installer-ownership-evidence.json',JSON.stringify({output,...evidence},null,2));
console.log(JSON.stringify({output,files:files.length,sourceMatches,full:evidence.full,userAppUnchanged:true},null,2));
