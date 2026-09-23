import {cp,mkdir,readFile,writeFile,readdir,lstat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {dirname,resolve,join,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {packager} from '@electron/packager';
import {pruneElectronLocales} from './lib/electron-locales.mjs';
import {listPackage} from '@electron/asar';
import {flipFuses,getCurrentFuseWire,FuseVersion,FuseV1Options} from '@electron/fuses';
import {installMicrophoneModel} from './lib/microphone-model.mjs';
import {packageSources,verifyPackageSources,packageSourceRoots} from './lib/package-sources.mjs';
import {distributionComponents} from './lib/distribution-components.mjs';
import {packageLayout,validatePackageCatalog,stageComponentRuntime} from './lib/package-layout.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {speech,modular}=packageLayout(process.argv.slice(2));
if(process.platform!=='win32'||process.arch!=='x64')throw new Error('Windows x64 빌드 환경이 필요합니다.');
const speechPath=speech?resolve(speech):null;
const catalog=modular?validatePackageCatalog(JSON.parse(await readFile(join(root,'shared/runtime-catalog.json'),'utf8'))):null;
const sourceManifest=await packageSources(root);
const id=new Date().toISOString().replace(/[:.]/g,'-');
const build=join(root,'release',id),stage=join(build,'stage'),resources=join(build,'runtime');
await mkdir(join(root,'release'),{recursive:true});await mkdir(build,{recursive:false});await mkdir(stage);await mkdir(resources);
const json=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
const hash=async file=>{const h=createHash('sha256');for await(const data of createReadStream(file))h.update(data);return h.digest('hex');};
async function files(dir,prefix=''){
  const result=[];
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const path=join(dir,entry.name),name=prefix+entry.name;
    if(entry.isSymbolicLink())throw new Error('배포에 링크를 포함할 수 없습니다: '+name);
    if(entry.isDirectory())result.push(...await files(path,name+'/'));else if(entry.isFile())result.push(name);
  }
  return result.sort();
}
async function run(bin,args,cwd=root){
  await new Promise((done,fail)=>{const child=spawn(bin,args,{cwd,windowsHide:true,stdio:'inherit'});child.on('error',fail);child.on('exit',code=>code===0?done():fail(new Error(bin+' failed: '+code)));});
}

// Allowlisted source staging excludes all personal data, recordings, .env,
// development environments and credentials regardless of .gitignore contents.
for(const [dir,extension] of Object.entries(packageSourceRoots)){
  for(const name of await files(join(root,dir))){
    if(dir==='shared'&&name.endsWith('.d.ts'))continue; // Tracked build input, not runtime JavaScript.
    if(!extension.test(dir+'/'+name))throw new Error('검토되지 않은 배포 소스 파일: '+dir+'/'+name);
    const target=join(stage,dir,name);await mkdir(dirname(target),{recursive:true});await cp(join(root,dir,name),target);
  }
}
const pkg=await json(join(root,'package.json'));
await writeFile(join(stage,'package.json'),JSON.stringify({...pkg,scripts:{}},null,2));
await cp(join(root,'package-lock.json'),join(stage,'package-lock.json'));
await cp(join(root,'LICENSE'),join(stage,'LICENSE'));
// npm CLI is build-time only. Lifecycle scripts are never executed in staging.
const npm=process.env.npm_execpath || join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
await run(process.execPath,[npm,'ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],stage);
const installed=await files(join(stage,'node_modules'));
if(installed.some(f=>/^(@openai\/|electron\/|@electron\/)/.test(f)))throw new Error('개발 도구가 앱 소스에 포함되었습니다.');

// Official, lockfile-pinned Codex runtime; never copy the installed Codex
// Desktop private binary or any auth/profile directory.
const codex=join(root,'node_modules/@openai/codex-win32-x64');
const codexPkg=await json(join(codex,'package.json'));
if(codexPkg.version!=='0.154.0-win32-x64')throw new Error('검증된 Codex 런타임 버전과 다릅니다.');
const codexTarget=join(resources,'codex');
await cp(join(codex,'vendor/x86_64-pc-windows-msvc'),codexTarget,{recursive:true});
await cp(join(root,'third-party/codex'),join(codexTarget,'licenses'),{recursive:true});
await cp(join(codex,'package.json'),join(codexTarget,'npm-package.json'));

const electronVersion=(await json(join(root,'node_modules/electron/package.json'))).version;
let speechManifest,extraResources;
if(modular){
  extraResources=[codexTarget,...await stageComponentRuntime(root,resources,catalog)];
}else{
// The builder verifies the vendor archive before extraction. Recheck the
// pinned model and allowlist only Python/model payloads (never build logs).
speechManifest=await json(join(speechPath,'manifest.json'));
if(speechManifest.schema!=='backseat.speech-runtime/1'||speechManifest.python?.version!=='3.13.15'||!Array.isArray(speechManifest.model?.files))throw new Error('검토된 음성 런타임 매니페스트가 아닙니다.');
const modelFiles=await files(join(speechPath,'model'));
const listedModels=speechManifest.model.files.map(f=>f.name);
if(JSON.stringify([...listedModels].sort())!==JSON.stringify(modelFiles))throw new Error('음성 모델 파일 목록이 다릅니다.');
for(const entry of speechManifest.model.files){
  if(!/^[\w.-]+$/.test(entry.name)||!/^[a-f0-9]{64}$/i.test(entry.sha256))throw new Error('음성 모델 매니페스트 오류');
  if(await hash(join(speechPath,'model',entry.name))!==entry.sha256.toLowerCase())throw new Error('음성 모델 무결성 오류: '+entry.name);
}
const speechTarget=join(resources,'speech');await mkdir(speechTarget);
for(const dir of ['python','model'])for(const file of await files(join(speechPath,dir))){
  if(/(^|\/)__pycache__(\/|$)|\.pyc$/.test(file)||/^Lib\/site-packages\/(bin|Scripts)\//.test(file))continue;
  if(/(^|\/)(auth\.json|\.env|pyvenv\.cfg)$/.test(file))throw new Error('개발/인증 파일은 음성 런타임에 포함할 수 없습니다.');
  const target=join(speechTarget,dir,file);await mkdir(dirname(target),{recursive:true});await cp(join(speechPath,dir,file),target);
}
await writeFile(join(speechTarget,'manifest.json'),JSON.stringify(speechManifest,null,2));
await cp(join(root,'scripts/speech_worker.py'),join(resources,'speech/speech_worker.py'));
await cp(join(root,'scripts/clip_inspector.py'),join(resources,'speech/clip_inspector.py'));
await cp(join(root,'scripts/clip_perception.py'),join(resources,'speech/clip_perception.py'));
await cp(join(root,'third-party/whisper'),join(speechTarget,'licenses/whisper'),{recursive:true});
const accurateModel=join(root,'.models/microphone');
const accurateStat=await lstat(accurateModel).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
if(accurateStat)await installMicrophoneModel(accurateModel,join(speechTarget,'microphone-model'));
const gpuSource=join(root,'.models/gpu');
const gpuManifest=await json(join(gpuSource,'manifest.json')).catch(()=>{throw Error('먼저 scripts/install-speech-gpu.py로 GPU 런타임을 설치하세요.');});
if(gpuManifest.schema!=='nagneon.gpu-runtime/1'||gpuManifest.versions?.nvidia_cublas_cu12!=='12.4.5.8'||gpuManifest.versions?.nvidia_cudnn_cu12!=='9.1.0.70')throw Error('GPU 런타임 버전을 확인하세요.');
for(const required of ['nvidia/cublas/bin/cublas64_12.dll','nvidia/cudnn/bin/cudnn64_9.dll'])if(!gpuManifest.files?.[required])throw Error('GPU 런타임이 불완전합니다.');
for(const [file,entry] of Object.entries(gpuManifest.files)){
  if(isAbsolute(file)||file.split(/[\\/]/).includes('..')||await hash(join(gpuSource,file))!==entry.sha256)throw Error('GPU 런타임 무결성 오류: '+file);
  const target=join(speechTarget,'gpu',file);await mkdir(dirname(target),{recursive:true});await cp(join(gpuSource,file),target);
}
await cp(join(gpuSource,'manifest.json'),join(speechTarget,'gpu/manifest.json'));
const payload=[];for(const file of await files(speechTarget))payload.push({path:file,sha256:await hash(join(speechTarget,file))});
await writeFile(join(speechTarget,'payload-manifest.json'),JSON.stringify(payload,null,2));

const soundTarget=join(resources,'sound');await mkdir(join(soundTarget,'model'),{recursive:true});
const soundSpec=await json(join(root,'shared/sound-model.json'));
for(const file of soundSpec.files){
  const path=join(root,'.models/sound-yamnet',file.name),stat=await lstat(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==file.bytes)throw Error('소리 모델 파일 크기/형식 오류: '+file.name);
  const bytes=await readFile(path),digest=createHash(file.sha256?'sha256':'sha1');
  if(file.gitBlob)digest.update(`blob ${bytes.length}\0`);digest.update(bytes);
  if(digest.digest('hex')!==(file.sha256||file.gitBlob))throw Error('소리 모델 무결성 오류: '+file.name);
  await cp(path,join(soundTarget,'model',file.name));
}
await cp(join(root,'shared/sound-model.json'),join(soundTarget,'provenance.json'));
await cp(join(root,'scripts/sound_worker.py'),join(soundTarget,'sound_worker.py'));
await cp(join(root,'third-party/sound/NOTICE.txt'),join(soundTarget,'NOTICE.txt'));

  extraResources=[codexTarget,speechTarget,soundTarget];
}
const output=await packager({dir:stage,out:join(build,'app'),name:'Nagneon',executableName:'Nagneon',icon:join(root,'branding/nagneon.ico'),platform:'win32',arch:'x64',electronVersion,
  appVersion:pkg.version,buildVersion:pkg.version,asar:true,prune:false,overwrite:false,
  extraResource:extraResources,
  win32metadata:{CompanyName:'Unspecified publisher (development build)',FileDescription:'Nagneon',ProductName:'Nagneon',InternalName:'Nagneon'}
});
const folder=output[0],exe=join(folder,'Nagneon.exe');
const localePruning=await pruneElectronLocales(folder);
await flipFuses(exe,{version:FuseVersion.V1,
  [FuseV1Options.RunAsNode]:false,[FuseV1Options.EnableNodeOptionsEnvironmentVariable]:false,
  [FuseV1Options.EnableNodeCliInspectArguments]:false,[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]:true,
  [FuseV1Options.OnlyLoadAppFromAsar]:true,[FuseV1Options.GrantFileProtocolExtraPrivileges]:false
});
const archiveFiles=listPackage(join(folder,'resources/app.asar')).map(f=>f.replaceAll('\\','/'));
for(const path of archiveFiles){
  if(/^\/(data|artifacts|\.env|\.venv|\.models|release)(\/|$)/.test(path)||/\/(auth\.json|\.env)$/.test(path))throw new Error('개인 파일이 배포본에 포함되었습니다: '+path);
}
const inventory=[];
const sourceCheck=await verifyPackageSources(root,folder,sourceManifest);
if(!sourceCheck.passed)throw Error(sourceCheck.failures.join('\n'));
for(const name of await files(folder))inventory.push({path:name,bytes:(await lstat(join(folder,name))).size,sha256:await hash(join(folder,name))});
const report={version:pkg.version,builtAt:new Date().toISOString(),platform:'win32-x64',signed:false,layout:modular?'components':'bundled',acceptance:'not yet verified',localePruning,electron:electronVersion,codex:codexPkg.version,
  speech:modular?{mode:'components',contentIds:catalog.components.map(({id,contentId})=>({id,contentId}))}:speechManifest.pythonVersion||speechManifest.python,sourceManifest,sourceArchiveFiles:archiveFiles.length,fuses:await getCurrentFuseWire(exe),files:inventory,components:distributionComponents(inventory)};
await writeFile(join(build,'manifest.json'),JSON.stringify(report,null,2));
await writeFile(join(build,'asar-files.json'),JSON.stringify(archiveFiles,null,2));
await writeFile(join(root,'artifacts/latest-package.json'),JSON.stringify({folder,manifest:join(build,'manifest.json'),build},null,2));
console.log(JSON.stringify({folder,manifest:join(build,'manifest.json'),bytes:inventory.reduce((s,f)=>s+f.bytes,0),files:inventory.length,signed:false},null,2));
