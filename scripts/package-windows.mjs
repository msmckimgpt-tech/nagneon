import {cp,mkdir,readFile,writeFile,readdir,lstat,rename} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {basename,dirname,resolve,join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {packager} from '@electron/packager';
import {pruneElectronLocales} from './lib/electron-locales.mjs';
import {listPackage} from '@electron/asar';
import {flipFuses,getCurrentFuseWire,FuseVersion,FuseV1Options} from '@electron/fuses';
import {installMicrophoneModel} from './lib/microphone-model.mjs';
import {packageSources,verifyPackageSources,packageSourceRoots,packageBuildInput} from './lib/package-sources.mjs';
import {distributionComponents} from './lib/distribution-components.mjs';
import {packageLayout,validatePackageCatalog,stageComponentRuntime} from './lib/package-layout.mjs';
import {
  createPackageScratch,
  freeSpace,
  markPackageScratch,
  packageGate,
  removeOwnedPackageScratch,
  storageFingerprint,
  treeStats,
  writePackageBuildOwner,
} from './lib/storage-maintenance.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {speech,modular}=packageLayout(process.argv.slice(2));
if(process.platform!=='win32'||process.arch!=='x64')throw new Error('Windows x64 빌드 환경이 필요합니다.');
const speechPath=speech?resolve(speech):null;
const catalog=modular?validatePackageCatalog(JSON.parse(await readFile(join(root,'shared/runtime-catalog.json'),'utf8'))):null;
const sourceManifest=await packageSources(root);
const json=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
const hash=async file=>{const h=createHash('sha256');for await(const data of createReadStream(file))h.update(data);return h.digest('hex');};
async function files(dir,prefix=''){
  const result=[];
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const path=join(dir,entry.name),name=prefix+entry.name;
    if(entry.isSymbolicLink())throw new Error('배포에 링크를 포함할 수 없습니다: '+name);
    if(entry.isDirectory())result.push(...await files(path,name+'/'));else if(entry.isFile())result.push(name);
    else throw new Error('검토되지 않은 배포 파일 형식: '+name);
  }
  return result.sort();
}
async function treeIdentity(dir){
  const result=[];
  for(const name of await files(dir))result.push({path:name,sha256:await hash(join(dir,name))});
  return storageFingerprint(result);
}
async function packageRecipeIdentity(codexRoot){
  const recipeFiles=[
    'scripts/package-windows.mjs',
    'scripts/lib/package-sources.mjs',
    'scripts/lib/package-layout.mjs',
    'scripts/lib/distribution-components.mjs',
    'scripts/lib/electron-locales.mjs',
    'scripts/lib/microphone-model.mjs',
    'scripts/lib/storage-maintenance.mjs',
    'server/runtime-pack.js',
  ];
  const inputs=[];
  for(const path of recipeFiles)inputs.push({path,sha256:await hash(join(root,path))});
  const identity={
    schema:'nagneon.package-recipe/1',
    inputs,
    icon:await hash(join(root,'branding/nagneon.ico')),
    codexRuntime:await treeIdentity(join(codexRoot,'vendor/x86_64-pc-windows-msvc')),
    codexLicenses:await treeIdentity(join(root,'third-party/codex')),
  };
  if(!modular){
    identity.whisperLicenses=await treeIdentity(join(root,'third-party/whisper'));
    identity.soundNotice=await hash(join(root,'third-party/sound/NOTICE.txt'));
  }
  return identity;
}
async function run(bin,args,cwd=root){
  await new Promise((done,fail)=>{const child=spawn(bin,args,{cwd,windowsHide:true,stdio:'inherit'});child.on('error',fail);child.on('exit',code=>code===0?done():fail(new Error(bin+' failed: '+code)));});
}

const pkg=await json(join(root,'package.json'));
const codex=join(root,'node_modules/@openai/codex-win32-x64');
const codexPkg=await json(join(codex,'package.json'));
if(codexPkg.version!=='0.156.1-win32-x64')throw new Error('검증된 Codex 런타임 버전과 다릅니다.');
const electronVersion=(await json(join(root,'node_modules/electron/package.json'))).version;
const packagingRecipe=await packageRecipeIdentity(codex);
let speechManifest,bundledIdentity=null;
if(!modular){
  speechManifest=await json(join(speechPath,'manifest.json'));
  if(speechManifest.schema!=='backseat.speech-runtime/1'||speechManifest.python?.version!=='3.13.15'||!Array.isArray(speechManifest.model?.files))throw new Error('검토된 음성 런타임 매니페스트가 아닙니다.');
  const identity={speech:await treeIdentity(speechPath)};
  for(const [name,path] of Object.entries({microphone:join(root,'.models/microphone'),gpu:join(root,'.models/gpu'),sound:join(root,'.models/sound-yamnet')})){
    const stat=await lstat(path).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    identity[name]=stat?await treeIdentity(path):null;
  }
  bundledIdentity=identity;
}
const buildFingerprint=storageFingerprint({
  schema:'nagneon.package-build-input/1',
  sourceManifest,
  packageVersion:pkg.version,
  platform:process.platform,
  arch:process.arch,
  node:process.version,
  electron:electronVersion,
  codex:codexPkg.version,
  recipe:packagingRecipe,
  layout:modular?'components':'bundled',
  runtime:modular?catalog.components.map(({id,contentId,archive})=>({id,contentId,archive:{bytes:archive.bytes,sha256:archive.sha256,url:archive.url}})):bundledIdentity,
});
const storageBefore=await freeSpace(root);
const gate=await packageGate(root,buildFingerprint);
if(gate.reused){
  const {build,folder,manifestPath,manifest}=gate.reused;
  await writeFile(join(root,'artifacts/latest-package.json'),JSON.stringify({folder,manifest:manifestPath,build,reused:true},null,2));
  console.log(JSON.stringify({
    folder,manifest:manifestPath,bytes:manifest.files.reduce((s,f)=>s+f.bytes,0),files:manifest.files.length,signed:false,reused:true,
    storage:{freeBytesBefore:storageBefore.freeBytes,freeBytesAfter:(await freeSpace(root)).freeBytes,scratchBytesRetained:0,ownedBuilds:gate.builds.owned.length}
  },null,2));
}else{
  const id=new Date().toISOString().replace(/[:.]/g,'-');
  const {scratch,stage,runtime:resources,app:appOutput,publish}=await createPackageScratch(root,id);
  let scratchRemoved=false;
  try{
    // Allowlisted source staging excludes all personal data, recordings, .env,
    // development environments and credentials regardless of .gitignore contents.
    for(const [dir,extension] of Object.entries(packageSourceRoots)){
      for(const name of await files(join(root,dir))){
        if(packageBuildInput(dir+'/'+name))continue;
        if(!extension.test(dir+'/'+name))throw new Error('검토되지 않은 배포 소스 파일: '+dir+'/'+name);
        const target=join(stage,dir,name);await mkdir(dirname(target),{recursive:true});await cp(join(root,dir,name),target);
      }
    }
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
    const codexTarget=join(resources,'codex');
    await cp(join(codex,'vendor/x86_64-pc-windows-msvc'),codexTarget,{recursive:true});
    await cp(join(root,'third-party/codex'),join(codexTarget,'licenses'),{recursive:true});
    await cp(join(codex,'package.json'),join(codexTarget,'npm-package.json'));

    let extraResources;
    if(modular){
      extraResources=[codexTarget,...await stageComponentRuntime(root,resources,catalog)];
    }else{
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

    const output=await packager({dir:stage,out:appOutput,name:'Nagneon',executableName:'Nagneon',icon:join(root,'branding/nagneon.ico'),platform:'win32',arch:'x64',electronVersion,
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
    const [stageStorage,runtimeStorage,appStorage]=await Promise.all([treeStats(stage),treeStats(resources),treeStats(appOutput)]);
    const runtimeFiles=await files(resources);
    const report={version:pkg.version,builtAt:new Date().toISOString(),platform:'win32-x64',signed:false,layout:modular?'components':'bundled',acceptance:'not yet verified',localePruning,electron:electronVersion,codex:codexPkg.version,
      buildFingerprint,packageRecipe:packagingRecipe,
      speech:modular?{mode:'components',contentIds:catalog.components.map(({id,contentId})=>({id,contentId}))}:speechManifest.pythonVersion||speechManifest.python,sourceManifest,sourceArchiveFiles:archiveFiles.length,fuses:await getCurrentFuseWire(exe),files:inventory,components:distributionComponents(inventory),
      storage:{schema:'nagneon.package-storage/1',runId:id,policy:'scratch-is-transactional; successful scratch is removed; failed scratch blocks the next package until explicit maintenance',stage:stageStorage,runtime:runtimeStorage,app:appStorage,runtimeFiles}
    };

    await mkdir(publish);
    await rename(appOutput,join(publish,'app'));
    await writeFile(join(publish,'manifest.json'),JSON.stringify(report,null,2));
    await writeFile(join(publish,'asar-files.json'),JSON.stringify(archiveFiles,null,2));
    const finalFolderRelative='app/'+basename(folder);
    await writePackageBuildOwner(publish,{runId:id,createdAt:report.builtAt,fingerprint:buildFingerprint,layout:report.layout,folder:finalFolderRelative,manifest:'manifest.json'});
    await mkdir(join(root,'release'),{recursive:true});
    const build=join(root,'release',id);
    await rename(publish,build);
    const finalFolder=join(build,...finalFolderRelative.split('/'));
    await writeFile(join(root,'artifacts/latest-package.json'),JSON.stringify({folder:finalFolder,manifest:join(build,'manifest.json'),build,reused:false},null,2));
    await markPackageScratch(scratch,id,'published');
    const removed=await removeOwnedPackageScratch(root,scratch,id);
    scratchRemoved=true;
    const storageAfter=await freeSpace(root);
    console.log(JSON.stringify({
      folder:finalFolder,manifest:join(build,'manifest.json'),bytes:inventory.reduce((s,f)=>s+f.bytes,0),files:inventory.length,signed:false,reused:false,
      storage:{freeBytesBefore:storageBefore.freeBytes,freeBytesAfter:storageAfter.freeBytes,stageBytes:stageStorage.bytes,runtimeBytes:runtimeStorage.bytes,packagerOutputBytes:appStorage.bytes,scratchBytesRemoved:removed.bytes,scratchBytesRetained:0,ownedBuildLimit:2}
    },null,2));
  }catch(error){
    if(!scratchRemoved)await markPackageScratch(scratch,id,'failed',error?.message).catch(()=>{});
    throw error;
  }
}
