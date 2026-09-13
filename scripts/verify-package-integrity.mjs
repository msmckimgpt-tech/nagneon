import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {extractFile} from '@electron/asar';
import {getCurrentFuseWire,FuseV1Options,FuseState} from '@electron/fuses';
const {folder,manifest}=JSON.parse(await readFile('artifacts/latest-package.json','utf8'));
const spec=JSON.parse(await readFile(manifest,'utf8'));
const digest=buffer=>createHash('sha256').update(buffer).digest('hex');
const hashFile=async path=>{const h=createHash('sha256');for await(const b of createReadStream(path))h.update(b);return h.digest('hex');};
async function walk(dir,prefix=''){const list=[];for(const f of await readdir(dir,{withFileTypes:true})){if(f.isSymbolicLink())throw new Error('Unexpected package link');if(f.isDirectory())list.push(...await walk(join(dir,f.name),prefix+f.name+'/'));else list.push(prefix+f.name);}return list;}
const failures=[];
for(const file of spec.files)if(await hashFile(join(folder,file.path))!==file.sha256)failures.push('File changed: '+file.path);
const expected=new Set(spec.files.map(f=>f.path));for(const file of await walk(folder))if(!expected.has(file))failures.push('Unexpected file: '+file);
const sourceFiles=['desktop/main.cjs','desktop/session.cjs','desktop/runtime.cjs','desktop/preload.cjs','desktop/account-login.cjs','server/index.js','server/codex-provider.js','server/local-speech.js','server/local-access.js','server/onboarding.js','server/connection-probe.js','server/provider.js','server/knowledge.js','server/viewer-context.js','server/studio.js','server/conversation-journal.js','server/journal-store.js','server/data-schema.js','server/seasons.js','server/seasons-schema.js','shared/seasons.js'];
sourceFiles.push('desktop/capture.cjs','server/local-sound.js','server/sound-scene.js','server/sound-routes.js','shared/sound-model.json');
sourceFiles.push('server/world.js','server/audience-autonomy.js','server/audience.js','server/ambient.js','server/advice-intent.js','server/schema.js','server/clips.js','server/special-features.js','server/economy.js');
sourceFiles.push('server/speech-inbox.js','server/chat-quality.js');
sourceFiles.push('server/transcript-correction.js');
for(const file of sourceFiles)if(digest(extractFile(join(folder,'resources/app.asar'),file))!==digest(await readFile(resolve(file))))failures.push('App source differs: '+file);
if(await hashFile(join(folder,'resources/speech/speech_worker.py'))!==await hashFile('scripts/speech_worker.py'))failures.push('Speech worker differs');
if(await hashFile(join(folder,'resources/sound/sound_worker.py'))!==await hashFile('scripts/sound_worker.py'))failures.push('Sound worker differs');
const fuses=await getCurrentFuseWire(join(folder,'BACKSEAT.exe'));
for(const option of [FuseV1Options.RunAsNode,FuseV1Options.EnableNodeOptionsEnvironmentVariable,FuseV1Options.EnableNodeCliInspectArguments,FuseV1Options.GrantFileProtocolExtraPrivileges])if(fuses[option]!==FuseState.DISABLE)failures.push('Unsafe fuse: '+option);
for(const option of [FuseV1Options.EnableEmbeddedAsarIntegrityValidation,FuseV1Options.OnlyLoadAppFromAsar])if(fuses[option]!==FuseState.ENABLE)failures.push('Missing ASAR protection: '+option);
const result={passed:!failures.length,checkedAt:new Date().toISOString(),folder,files:spec.files.length,matchingSources:sourceFiles.length+2,bytes:spec.files.reduce((s,f)=>s+f.bytes,0),failures};
const runtimeReport=process.argv.find(a=>a.startsWith('--runtime-report='))?.slice(17)||'artifacts/packaged-runtime-test.json';
const prior=JSON.parse(await readFile(runtimeReport,'utf8'));
if(prior.passed&&prior.folder!==folder){
  const priorManifest=JSON.parse(await readFile(resolve(prior.folder,'../../manifest.json'),'utf8'));
  const relevant=f=>/^resources\/(codex|speech)\//.test(f.path)&&!/^resources\/speech\/(manifest|payload-manifest)\.json$/.test(f.path);
  const before=new Map(priorManifest.files.filter(relevant).map(f=>[f.path,f.sha256]));
  const after=spec.files.filter(relevant);const changed=[],metadataOnly=[];
  for(const file of after.filter(f=>before.get(f.path)!==f.sha256)){
    let harmless=false;
    if(/\.dist-info\/RECORD$/.test(file.path)){
      const oldLines=(await readFile(join(prior.folder,file.path),'utf8')).trim().split(/\r?\n/);
      const newLines=(await readFile(join(folder,file.path),'utf8')).trim().split(/\r?\n/);
      const launcher=line=>/^(\.\.\/)+bin\/[\w.-]+\.exe,sha256=[\w-]+,\d+$/.test(line);
      const rows=lines=>lines.filter(launcher).map(line=>{const [name,_hash,size]=line.split(',');return [name,size];});
      const names=rows(oldLines).map(([name])=>name.split('/').at(-1));
      harmless=JSON.stringify(oldLines.filter(l=>!launcher(l)))===JSON.stringify(newLines.filter(l=>!launcher(l)))&&JSON.stringify(rows(oldLines))===JSON.stringify(rows(newLines))&&names.length>0&&names.every(name=>![...priorManifest.files,...spec.files].some(f=>f.path.endsWith('/'+name)));
    }
    if(harmless)metadataOnly.push(file.path);else changed.push(file.path);
  }
  if(after.length!==before.size)changed.push('runtime file set differs');
  const adapters=['server/provider.js','server/codex-provider.js','server/local-speech.js','desktop/runtime.cjs','server/connection-probe.js','desktop/account-login.cjs'];
  for(const file of adapters){
    if(digest(extractFile(join(prior.folder,'resources/app.asar'),file))!==digest(extractFile(join(folder,'resources/app.asar'),file)))changed.push(file);
  }
  result.runtimeContinuity={sourceTest:'artifacts/packaged-runtime-test.json',sourceFolder:prior.folder,comparedFiles:after.length+adapters.length,changed,metadataOnly,metadataExplanation:'Runtime code, libraries, model and adapters are identical when changed is empty. Only omitted launcher hashes in RECORD may differ; build provenance manifests are excluded from continuity comparison.'};
  try{const native=JSON.parse(await readFile('artifacts/onboarding-native-test.json','utf8'));if(native.passed&&native.actualModel&&native.folder===prior.folder&&!changed.length)result.runtimeContinuity.nativeModelEvidence={source:'artifacts/onboarding-native-test.json',folder:native.folder,latencySeconds:native.latencySeconds,caveat:'Actual native model call was on the prior package; listed model/runtime adapters are identical. New package startup is verified separately.'};}catch{}
  if(changed.length){result.passed=false;failures.push('Prior runtime evidence cannot be reused for changed runtime files');}
}
await writeFile('artifacts/package-integrity-test.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;
