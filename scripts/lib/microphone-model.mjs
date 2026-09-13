import {readFile,lstat,mkdir,mkdtemp,copyFile,rename,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,dirname,resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
export const microphoneModel=JSON.parse(await readFile(new URL('../../shared/microphone-model.json',import.meta.url),'utf8'));
const hash=async file=>{const value=createHash('sha256');for await(const chunk of createReadStream(file))value.update(chunk);return value.digest('hex');};
export async function verifyMicrophoneModel(source,expected=microphoneModel){
  const dir=await lstat(source);if(!dir.isDirectory()||dir.isSymbolicLink())throw Error('Microphone model must be a regular directory');
  for(const file of expected.files){
    if(!/^[\w.-]+$/.test(file.name)||file.name==='.'||file.name==='..'||!/^[a-f0-9]{64}$/.test(file.sha256))throw Error('Invalid model manifest');
    const path=join(source,file.name),stat=await lstat(path);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==file.bytes||await hash(path)!==file.sha256)throw Error('Microphone model integrity failed: '+file.name);
  }
  return expected;
}
export async function installMicrophoneModel(source,target,expected=microphoneModel){
  source=resolve(source);target=resolve(target);
  for(let parent=dirname(target);;parent=dirname(parent)){
    const stat=await lstat(parent).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    if(stat&&(!stat.isDirectory()||stat.isSymbolicLink()))throw Error('Model target parent must be a regular directory');
    if(dirname(parent)===parent)break;
  }
  await verifyMicrophoneModel(source,expected);
  const existing=await lstat(target).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(existing){
    await verifyMicrophoneModel(target,expected);
    const marker=await readFile(join(target,'manifest.json'),'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    if(marker&&!isDeepStrictEqual(JSON.parse(marker),expected))throw Error('Existing model manifest differs');
    if(!marker)await writeFile(join(target,'manifest.json'),JSON.stringify(expected,null,2),{flag:'wx'});
    return {target,changed:!marker,model:expected.name};
  }
  await mkdir(dirname(target),{recursive:true});
  const stage=await mkdtemp(join(dirname(target),'.microphone-model-'));
  // Stage in the target filesystem and publish only after a second integrity
  // check. An interrupted install never replaces an existing model.
  for(const file of expected.files)await copyFile(join(source,file.name),join(stage,file.name));
  await verifyMicrophoneModel(stage,expected);
  await writeFile(join(stage,'manifest.json'),JSON.stringify(expected,null,2));
  await rename(stage,target);
  return {target,changed:true,model:expected.name};
}
