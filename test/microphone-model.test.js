import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {installMicrophoneModel,verifyMicrophoneModel} from '../scripts/lib/microphone-model.mjs';
const {packagedRuntime}=createRequire(import.meta.url)('../desktop/runtime.cjs');
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'backseat-microphone-model-'));t.after(()=>rm(root,{recursive:true,force:true}));const source=join(root,'source');await mkdir(source);await writeFile(join(source,'model.bin'),'weights');const manifest={name:'test',files:[{name:'model.bin',bytes:7,sha256:createHash('sha256').update('weights').digest('hex')}]};return {root,source,manifest};}
test('verified model publishes atomically, ignores cache extras, and is idempotent',async t=>{
  const {root,source,manifest}=await fixture(t),target=join(root,'target');await writeFile(join(source,'private-cache'),'excluded');
  assert.equal((await installMicrophoneModel(source,target,manifest)).changed,true);
  assert.equal((await installMicrophoneModel(source,target,manifest)).changed,false);
  await assert.rejects(readFile(join(target,'private-cache')),/ENOENT/);
  assert.deepEqual(JSON.parse(await readFile(join(target,'manifest.json'),'utf8')),manifest);
});
test('wrong source hash and conflicting existing model are rejected without replacement',async t=>{
  const {root,source,manifest}=await fixture(t),target=join(root,'target');await mkdir(target);await writeFile(join(target,'model.bin'),'user data');
  await assert.rejects(installMicrophoneModel(source,target,manifest),/integrity/);assert.equal(await readFile(join(target,'model.bin'),'utf8'),'user data');
  await writeFile(join(source,'model.bin'),'changed');await assert.rejects(verifyMicrophoneModel(source,manifest),/integrity/);
});
test('complete weights missing the discovery marker are repaired; linked targets are rejected',async t=>{
  const {root,source,manifest}=await fixture(t),target=join(root,'target');await mkdir(target);await writeFile(join(target,'model.bin'),'weights');
  assert.equal((await installMicrophoneModel(source,target,manifest)).changed,true);
  assert.deepEqual(JSON.parse(await readFile(join(target,'manifest.json'),'utf8')),manifest);
  const link=join(root,'linked');await symlink(source,link,process.platform==='win32'?'junction':'dir');
  await assert.rejects(installMicrophoneModel(source,link,manifest),/regular directory/);
  await assert.rejects(installMicrophoneModel(source,join(link,'child'),manifest),/regular directory/);
});
test('packaged microphone uses the accurate model while system sound retains small',async t=>{
  const {root}=await fixture(t);
  for(const file of ['codex/bin/codex.exe','speech/python/python.exe','speech/speech_worker.py','speech/clip_inspector.py','speech/model/model.bin','sound/sound_worker.py','sound/model/yamnet.onnx']){await mkdir(join(root,file,'..'),{recursive:true});await writeFile(join(root,file),'fixture');}
  let runtime=packagedRuntime(root);assert.equal(runtime.speech.model,join(root,'speech/model'));assert.equal(runtime.speech.modelName,'small');
  const accurate=join(root,'speech/microphone-model');await mkdir(accurate);await writeFile(join(accurate,'manifest.json'),'{}');
  assert.throws(()=>packagedRuntime(root),/실행 파일/);
  await writeFile(join(accurate,'model.bin'),'fixture');runtime=packagedRuntime(root);
  assert.equal(runtime.speech.model,accurate);assert.equal(runtime.speech.modelName,'medium');assert.equal(runtime.sound.speechModel,join(root,'speech/model'));
});
