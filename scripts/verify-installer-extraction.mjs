// Exercise the actual NSIS File/oname runtime with adversarial literal paths.
// This harness extracts only into its new artifacts directory; no registry/UI.
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {createSyntheticPackage,buildFileEntries,renderInstallList,verifyPackage} from './build-installer.mjs';
const base=resolve('artifacts','installer-extraction-'+new Date().toISOString().replace(/[:.]/g,'-'));
await mkdir(base);const result={passed:false,base,operations:[]};
async function run(file,args,options={}){let output='';const code=await new Promise((ok,bad)=>{const p=spawn(file,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],...options});p.stdout.on('data',b=>output+=b);p.stderr.on('data',b=>output+=b);p.on('error',bad);p.on('close',ok);});const log=join(base,'command-'+result.operations.length+'.log');await writeFile(log,output);result.operations.push({file,args,code,log});assert.equal(code,0,output);}
try{
  if(process.platform!=='win32')throw Error('Run this Windows extraction acceptance on Windows');
  const source=join(base,'source$0 한글'),target=join(base,'target$INSTDIR 한글');
  const {manifest}=await createSyntheticPackage(source),entries=buildFileEntries(manifest);
  await writeFile(join(base,'files.nsh'),renderInstallList(entries,{errorLabel:'extract_failed'}));
  const setup=join(base,'Extraction.exe'),script=join(base,'extraction.nsi');
  await writeFile(script,`Unicode true
RequestExecutionLevel user
SilentInstall silent
OutFile "${setup}"
!define BACKSEAT_SRC "${source}"
Var StageDir
Section
 StrCpy $StageDir $INSTDIR
 ClearErrors
 !include "files.nsh"
 SetErrorLevel 0
 Goto done
 extract_failed:
 SetErrorLevel 3
 done:
SectionEnd
`);
  await run(resolve('artifacts/installer-tools/nsis-3.12/makensis.exe'),['/V3','/INPUTCHARSET','UTF8',script]);
  await run(setup,['/S','/D='+target],{windowsVerbatimArguments:true});
  result.integrity=await verifyPackage(target,entries);assert.equal(result.integrity.ok,true,JSON.stringify(result.integrity));
  const actual=[];async function walk(dir){for(const item of await readdir(dir,{withFileTypes:true})){const path=join(dir,item.name);if(item.isDirectory())await walk(path);else actual.push(relative(target,path).replaceAll('\\','/'));}}await walk(target);
  assert.deepEqual(actual.sort(),entries.map(e=>e.path).sort());result.files=actual;result.passed=true;
}catch(error){result.error=error.stack;process.exitCode=1;}
await writeFile(join(base,'acceptance.json'),JSON.stringify(result,null,2));await writeFile('artifacts/latest-installer-extraction-test.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
