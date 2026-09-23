import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,cp,symlink} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {createPackage} from '@electron/asar';
import {packageSources,verifyPackageSources} from '../scripts/lib/package-sources.mjs';
async function fixture(){
  await mkdir('artifacts',{recursive:true});const root=await mkdtemp(resolve('artifacts/package-source-')),source=join(root,'source'),stage=join(root,'stage'),folder=join(root,'output');
  const files={'LICENSE':'MIT fixture','scripts/clip_perception.py':'perception','desktop/main.cjs':'main','server/temporal-new.js':'sequence','shared/config.json':'{}','dist/index.html':'<html/>','dist/assets/app.js':'screen code','package.json':JSON.stringify({name:'test',version:'1.0.0',scripts:{start:'node private'}}),'package-lock.json':'{}','scripts/speech_worker.py':'microphone','scripts/sound_worker.py':'sound','scripts/clip_inspector.py':'clips'};
  files['shared/temporal-policy.d.ts']='export declare const VIDEO_SAMPLE_MS:number;';
  files['server/speech-listening-controller.d.ts']='export declare class SpeechListeningController {}';
  files['server/youtube-chat.proto']='syntax = "proto2";';
  files['server/legacy-season-versions.json']='{"legacy":true}';
  for(const [file,text] of Object.entries(files)){await mkdir(dirname(join(source,file)),{recursive:true});await writeFile(join(source,file),text);}
  const snapshot=await packageSources(source);await mkdir(join(folder,'resources'),{recursive:true});
  for(const file of snapshot.files){const to=file.kind==='archive'?join(stage,file.target):join(folder,'resources',file.target);await mkdir(dirname(to),{recursive:true});
    if(file.source==='package.json')await writeFile(to,JSON.stringify({name:'test',version:'1.0.0'},null,2)+'\n');else await cp(join(source,file.source),to);}
  await createPackage(stage,join(folder,'resources/app.asar'));
  return {root,source,stage,folder,snapshot,archive:join(folder,'resources/app.asar')};
}
test('complete delivered source comparison includes new modules, frontend assets and all worker scripts',async()=>{
  const f=await fixture(),result=await verifyPackageSources(f.source,f.folder,f.snapshot);assert.equal(result.passed,true);assert.equal(result.matchingSources,13);
  assert.ok(f.snapshot.files.some(file=>file.source==='server/legacy-season-versions.json'));
  assert.ok(f.snapshot.files.some(file=>file.source==='server/youtube-chat.proto'));
  assert.ok(f.snapshot.files.some(file=>file.source==='server/temporal-new.js'));assert.ok(f.snapshot.files.some(file=>file.source==='dist/assets/app.js'));
  assert.deepEqual(f.snapshot.buildInputs.map(file=>file.source),['package-lock.json','package.json','server/speech-listening-controller.d.ts','shared/temporal-policy.d.ts']);assert.ok(!f.snapshot.files.some(file=>file.source.endsWith('.d.ts')||file.source==='package-lock.json'));
});
test('build-only lockfile and package development settings remain tracked after packaging removes them',async()=>{
  for(const source of ['package-lock.json','package.json']){
    const f=await fixture();await writeFile(join(f.source,source),source==='package.json'?JSON.stringify({name:'test',version:'1.0.0',scripts:{start:'changed'}}):'{"lockfileVersion":3}');
    const result=await verifyPackageSources(f.source,f.folder,f.snapshot);assert.equal(result.passed,false);assert.deepEqual(result.failures,['Package source manifest differs from current build sources']);
  }
});
test('changed current source and a missing manifest cannot pass using only old packaged file hashes',async()=>{
  const f=await fixture();await writeFile(join(f.source,'server/temporal-new.js'),'new behavior');let result=await verifyPackageSources(f.source,f.folder,f.snapshot);
  assert.equal(result.passed,false);assert.ok(result.failures.some(v=>v.includes('server/temporal-new.js')));
  result=await verifyPackageSources(f.source,f.folder,undefined);assert.equal(result.passed,false);assert.ok(result.failures.some(v=>v.includes('manifest')));
});
test('stale frontend chunks and tampered runtime workers fail even when source snapshot is unchanged',async()=>{
  const f=await fixture();await writeFile(join(f.stage,'dist/assets/stale.js'),'previous build');await createPackage(f.stage,f.archive);await writeFile(join(f.folder,'resources/speech/speech_worker.py'),'wrong worker');
  const result=await verifyPackageSources(f.source,f.folder,f.snapshot);assert.equal(result.passed,false);assert.ok(result.failures.some(v=>v.includes('stale.js')));assert.ok(result.failures.some(v=>v.includes('speech_worker.py')));
});
test('a source added after staging is missing from the actual archive',async()=>{
  const f=await fixture();await writeFile(join(f.source,'server/new-feature.js'),'new feature');const result=await verifyPackageSources(f.source,f.folder,await packageSources(f.source));
  assert.equal(result.passed,false);assert.ok(result.failures.some(v=>v.includes('missing')&&v.includes('new-feature.js')));
});
test('source directory links and unsupported files are rejected without following private content',async()=>{
  const f=await fixture();await mkdir(join(f.root,'private'));await writeFile(join(f.root,'private','secret.js'),'not to package');await symlink(join(f.root,'private'),join(f.source,'server/linked'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(packageSources(f.source),/link/);assert.equal(await readFile(join(f.root,'private','secret.js'),'utf8'),'not to package');
  const other=await fixture();await writeFile(join(other.source,'server/debug.txt'),'not to package');await assert.rejects(packageSources(other.source),/Unexpected/);
});

test('legacy metadata permission does not allow arbitrary or nested server JSON',async()=>{
  for(const name of ['private.json','nested/legacy-season-versions.json']){
    const f=await fixture(),file=join(f.source,'server',name);await mkdir(dirname(file),{recursive:true});await writeFile(file,'{"private":true}');
    await assert.rejects(packageSources(f.source),/Unexpected package source/);
  }
});
