import {readFile,writeFile,mkdir,rename,lstat} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const lock=JSON.parse(await readFile(join(root,'shared/sound-model.json'),'utf8'));
const out=resolve(process.argv.find(a=>a.startsWith('--out='))?.slice(6)||join(root,'.models/sound-yamnet'));
function verify(bytes,file){if(bytes.length!==file.bytes)throw Error('Sound model size mismatch: '+file.name);const hash=createHash('sha256').update(bytes).digest('hex');if(file.sha256&&hash!==file.sha256)throw Error('Sound model SHA256 mismatch');if(file.gitBlob&&createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex')!==file.gitBlob)throw Error('Sound metadata Git blob mismatch: '+file.name);return hash;}
const present=await lstat(out).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
if(present){if(!present.isDirectory()||present.isSymbolicLink())throw Error('Sound model output is not a regular directory');for(const file of lock.files){const path=join(out,file.name);if(!(await lstat(path)).isFile()||(await lstat(path)).isSymbolicLink())throw Error('Sound file must be regular');verify(await readFile(path),file);}console.log(JSON.stringify({ok:true,existing:true,out}));}
else{
  await mkdir(dirname(out),{recursive:true});const stage=out+'.download-'+randomUUID();await mkdir(stage);const verified=[];
  for(const file of lock.files){const url=`https://huggingface.co/${lock.repository}/resolve/${lock.revision}/${file.name}`;const response=await fetch(url,{signal:AbortSignal.timeout(90000)});if(!response.ok)throw Error('Sound model download failed: '+response.status);const bytes=Buffer.from(await response.arrayBuffer());const sha256=verify(bytes,file);await writeFile(join(stage,file.name),bytes,{flag:'wx'});verified.push({...file,url,sha256});}
  await writeFile(join(stage,'provenance.json'),JSON.stringify({...lock,downloadedAt:new Date().toISOString(),files:verified},null,2));await rename(stage,out);console.log(JSON.stringify({ok:true,out,files:verified},null,2));
}
