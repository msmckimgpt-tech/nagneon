import {readFile,writeFile,mkdir,readdir,copyFile} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve('.'),json=async p=>JSON.parse((await readFile(p,'utf8')).replace(/^\uFEFF/,''));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const engine=await json('artifacts/latest-installer-transaction-test.json'),nsis=await json('artifacts/latest-installer-nsis-test.json');
assert.equal(engine.passed,true);assert.equal(nsis.passed,true);
const names=(await readdir('installer/engine')).filter(n=>n.endsWith('.cs')).sort();
const sources=await Promise.all(names.map(async name=>({name,sha256:digest(await readFile(join('installer/engine',name)))})));
const sourceMatches=[];
for(const run of [engine,nsis]){
  const compiled=await json(join(run.base,'engine/compiler-result.json'));assert.equal(compiled.exitCode,0);
  assert.deepEqual(compiled.sources,sources);sourceMatches.push({base:run.base,currentSourcesMatch:true});
}
const snapshot=resolve('artifacts/installer-stage-source');await mkdir(snapshot);
for(const name of names)await copyFile(join('installer/engine',name),join(snapshot,name));
const oldApp=await json('artifacts/sound-user-app-process.json'),app=await json('artifacts/installer-stage-user-app-process.json');
assert.equal(app.ProcessId,oldApp.ProcessId);assert.equal(app.ExecutablePath,oldApp.ExecutablePath);assert.equal(new Date(app.CreationDate).valueOf(),new Date(oldApp.CreationDate).valueOf());
const paths=new Set([
  'HANDOFF.md','docs/INSTALLER.md','installer/engine/README.md','installer/backseat.nsi.in',
  'scripts/build-installer-engine.mjs','scripts/build-installer.mjs','scripts/verify-installer-transactions.mjs','scripts/verify-installer-nsis.mjs','scripts/verify-installer-extraction.mjs','scripts/installer-fixture-app.cs','scripts/installer-snapshot.ps1','test/installer-build.test.js',
  'artifacts/latest-installer-transaction-test.json','artifacts/latest-installer-nsis-test.json','artifacts/latest-installer-extraction-test.json',
  'artifacts/installer-engine-ui-inert-test.json','artifacts/installer-builder-final-tests.log','artifacts/installer-extraction-final.log',
  'artifacts/installer-transactions-first.log','artifacts/installer-transactions-second.log','artifacts/installer-transactions-third.log','artifacts/installer-transactions-parent-lock-fix.log','artifacts/installer-transactions-control-backup.log','artifacts/installer-nsis-first.log',
  'artifacts/installer-engine-current-unit/test.log','artifacts/installer-engine-current-unit/result.json','artifacts/claude-engine-audit-output.txt','artifacts/claude-engine-audit-20260913/audit-result.json','artifacts/installer-stage-user-app-process.json'
]);
for(const run of [engine,nsis]){
  paths.add(join(run.base,'acceptance.json'));paths.add(join(run.base,'engine/compiler-result.json'));
  for(const operation of run.operations)paths.add(operation.log);
  for(const name of await readdir(run.base))if(/^(?:result-|external-|.*-result\.json)/.test(name)&&name.endsWith('.json'))paths.add(join(run.base,name));
}
for(const name of names)paths.add(join(snapshot,name));
const files=[];for(const path of paths){const absolute=resolve(path);assert.ok(absolute.startsWith(root+'\\'));const bytes=await readFile(absolute);files.push({path:relative(root,absolute).replaceAll('\\','/'),bytes:bytes.length,sha256:digest(bytes)});}
const evidence={recordedAt:new Date().toISOString(),scope:'Synthetic Windows installer acceptance; production remains disabled; full product installation and outstanding ownership/recovery gates remain',engineChecks:engine.checks.length,nsisChecks:nsis.checks.length,sourceMatches,sourceSnapshot:snapshot,userAppUnchanged:true,claudeAuditSession:{id:23220,exitCode:0},files};
await writeFile('artifacts/installer-stage-evidence.json',JSON.stringify(evidence,null,2));
console.log(JSON.stringify({files:files.length,engineChecks:evidence.engineChecks,nsisChecks:evidence.nsisChecks,sourceMatches,userAppUnchanged:true},null,2));
