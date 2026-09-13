import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const windows=path=>process.platform==='win32'?resolve(path):path.replace(/^\/mnt\/([a-z])\//,(_,drive)=>drive.toUpperCase()+':/').replaceAll('/','\\');
export async function buildInstallerEngine(outDir,{sourceDir='installer/engine'}={}){
  const root=resolve(sourceDir);await mkdir(outDir,{recursive:true});
  const names=(await readdir(root)).filter(n=>n.endsWith('.cs')).sort();if(names.length<8)throw Error('Installer engine source is incomplete');
  const sources=await Promise.all(names.map(async name=>({name,sha256:createHash('sha256').update(await readFile(join(root,name))).digest('hex')})));
  const compiler=process.env.CSC||(process.platform==='win32'?'C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe':'/mnt/c/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  if(!existsSync(compiler))throw Error('Windows .NET Framework C# compiler not found');
  const file=resolve(outDir,'InstallEngine.exe');
  const args=['/nologo','/target:winexe','/platform:x64','/r:System.Web.Extensions.dll','/r:Microsoft.CSharp.dll','/r:System.Windows.Forms.dll','/out:'+windows(file),...names.map(n=>windows(join(root,n)))];
  const result=await new Promise((resolve,reject)=>{let output='';const child=spawn(compiler,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.on('error',reject);child.on('close',code=>resolve({code,output}));});
  await writeFile(join(outDir,'compiler.log'),result.output);await writeFile(join(outDir,'compiler-result.json'),JSON.stringify({compiler,args,exitCode:result.code,sources},null,2));
  if(result.code!==0)throw Error('Installer engine compile failed; see '+join(outDir,'compiler.log'));
  for(const source of sources)if(createHash('sha256').update(await readFile(join(root,source.name))).digest('hex')!==source.sha256)throw Error('Installer source changed during compile');
  return {file,sourceDir:root,sources,sha256:createHash('sha256').update(await readFile(file)).digest('hex')};
}
