import {readFile,readdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {extractFile,listPackage} from '@electron/asar';
import {defaultSanitizePackageJson} from '@electron/packager';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const roots={desktop:/\.cjs$/,server:/\.js$/,shared:/\.(js|json)$/,dist:/\.(html|js|css|svg|png|woff2?)$/};
const workers={'scripts/clip_perception.py':'speech/clip_perception.py','scripts/speech_worker.py':'speech/speech_worker.py','scripts/sound_worker.py':'sound/sound_worker.py','scripts/clip_inspector.py':'speech/clip_inspector.py'};

export async function packageSources(root){
  const files=[],buildInputs=[];
  async function visit(dir,prefix,extension){
    const stat=await lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Package source must be a regular directory: '+prefix);
    for(const entry of await readdir(dir,{withFileTypes:true})){
      const path=join(dir,entry.name),name=prefix+'/'+entry.name;
      if(entry.isSymbolicLink())throw Error('Package source link: '+name);
      if(entry.isDirectory())await visit(path,name,extension);
      else{
        if(!entry.isFile())throw Error('Unexpected package source: '+name);
        if(name.startsWith('shared/')&&name.endsWith('.d.ts')){buildInputs.push({source:name,sha256:digest(await readFile(path))});continue;}
        if(!extension.test(name))throw Error('Unexpected package source: '+name);
        files.push({source:name,kind:'archive',target:name,sha256:digest(await readFile(path))});
      }
    }
  }
  for(const [name,extension] of Object.entries(roots))await visit(join(root,name),name,extension);
  const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
  files.push({source:'package.json',kind:'archive',target:'package.json',sha256:digest(JSON.stringify(defaultSanitizePackageJson(pkg),null,2)+'\n')});
  for(const source of ['package.json','package-lock.json'])buildInputs.push({source,sha256:digest(await readFile(join(root,source)))});
  for(const [source,target] of Object.entries(workers))files.push({source,kind:'resource',target,sha256:digest(await readFile(join(root,source)))});
  files.sort((a,b)=>a.source.localeCompare(b.source));
  buildInputs.sort((a,b)=>a.source.localeCompare(b.source));
  return {schema:'backseat.package-sources/1',files,buildInputs};
}

export async function verifyPackageSources(root,folder,manifest){
  const expected=await packageSources(root),failures=[];
  if(manifest?.schema!==expected.schema||JSON.stringify(manifest.files)!==JSON.stringify(expected.files)||JSON.stringify(manifest.buildInputs)!==JSON.stringify(expected.buildInputs))failures.push('Package source manifest differs from current build sources');
  const archive=join(folder,'resources/app.asar'),nodes=listPackage(archive).map(path=>path.replaceAll('\\','/'));
  const builtSources=nodes.filter(path=>/^\/(desktop|server|shared|dist)\//.test(path)&&!nodes.some(other=>other.startsWith(path+'/')));
  const expectedPaths=new Set(expected.files.filter(file=>file.kind==='archive').map(file=>'/'+file.target));
  for(const file of builtSources)if(!expectedPaths.has(file))failures.push('Unexpected app source: '+file);
  for(const file of expected.files){
    try{
      const bytes=file.kind==='archive'?extractFile(archive,join(...file.target.split('/'))):await readFile(join(folder,'resources',file.target));
      if(digest(bytes)!==file.sha256)failures.push('App source differs: '+file.source);
    }catch{failures.push('App source missing or unreadable: '+file.source);}
  }
  return {passed:failures.length===0,matchingSources:expected.files.length,failures};
}
