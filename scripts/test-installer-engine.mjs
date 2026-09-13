import {mkdir,readdir,writeFile,readFile,symlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
if(process.platform!=='win32')throw Error('Run installer engine unit tests on Windows');
const base=resolve('artifacts','installer-unit-'+new Date().toISOString().replace(/[:.]/g,'-'));await mkdir(base);
const fixtures=join(base,'fixtures');await mkdir(fixtures);await mkdir(join(fixtures,'junction-target'));await symlink(join(fixtures,'junction-target'),join(fixtures,'jx'),'junction');
await mkdir(join(fixtures,'bootstrap-junction'));await mkdir(join(fixtures,'bootstrap-junction-target'));
await symlink(join(fixtures,'bootstrap-junction-target'),join(fixtures,'bootstrap-junction','.backseat'),'junction');
const names=(await readdir('installer/engine')).filter(n=>n.endsWith('.cs')&&n!=='Program.cs').sort();
const sources=await Promise.all([...names.map(n=>join('installer/engine',n)),'test/installer/EngineTests.cs'].map(async file=>({file:resolve(file),sha256:createHash('sha256').update(await readFile(file)).digest('hex')})));
async function run(file,args,log){let output='';const code=await new Promise((done,fail)=>{const p=spawn(file,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});p.stdout.on('data',b=>output+=b);p.stderr.on('data',b=>output+=b);p.once('error',fail);p.once('close',done);});await writeFile(join(base,log),output);return {code,output};}
const exe=join(base,'tests.exe');const compiled=await run('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe',['/nologo','/target:exe','/platform:x64','/r:System.Web.Extensions.dll','/r:Microsoft.CSharp.dll','/r:System.Windows.Forms.dll','/out:'+exe,...sources.map(s=>s.file)],'compile.log');
let tested=null;if(compiled.code===0)tested=await run(exe,[fixtures],'test.log');
for(const source of sources)if(createHash('sha256').update(await readFile(source.file)).digest('hex')!==source.sha256)throw Error('Source changed while testing');
const result={passed:compiled.code===0&&tested?.code===0,base,compileExit:compiled.code,testExit:tested?.code,sources,summary:tested?.output.split(/\r?\n/).filter(s=>/RESULT:|FAIL |SKIP /.test(s))};
await writeFile(join(base,'result.json'),JSON.stringify(result,null,2));await writeFile('artifacts/latest-installer-unit-test.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;
