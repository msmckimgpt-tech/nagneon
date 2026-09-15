// Downloads public, catalog-pinned components into this worktree's short cache.
// No account login, model request, microphone or screen capture is performed.
import {readFile,mkdir,writeFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {RuntimeComponents} from '../server/runtime-components.js';
const catalog=JSON.parse(await readFile('shared/runtime-catalog.json','utf8'));
const cache=resolve('artifacts/r'),reportPath=resolve('artifacts/critical-review/published-runtime-download.json');
await mkdir(join(cache,'..'),{recursive:true});
const report={startedAt:new Date().toISOString(),cache,actualPublicHttps:true,physicalDevices:false,modelCall:false,passed:false,checks:[]};
let manager=new RuntimeComponents({catalog,cache});
const ticker=setInterval(()=>console.log(JSON.stringify(manager.snapshot())),30000);
try{
  await manager.prepare('microphone',undefined,'gpu');await manager.prepare('sound');
  assert.ok(manager.snapshot().components.every(c=>c.status==='ready'));
  report.checks.push('public HTTPS files download and install with pinned compressed and extracted hashes');
  assert.deepEqual(await readdir(join(cache,'downloads')),[]);
  report.checks.push('successful installation leaves no duplicate compressed packs');
  await manager.close();
  manager=new RuntimeComponents({catalog,cache,download:()=>{throw Error('Offline verification must not request the network');}});
  await manager.prepare('microphone',undefined,'gpu');await manager.prepare('sound');
  assert.ok(manager.snapshot().components.every(c=>c.status==='ready'));
  report.checks.push('a fresh manager verifies and reuses every installed component offline');
  report.componentIds=Object.fromEntries(catalog.components.map(c=>[c.id,c.contentId]));report.passed=true;
}catch(error){report.error=error.stack;report.cause=error.cause?.message;process.exitCode=1;}
finally{clearInterval(ticker);await manager.close();report.finishedAt=new Date().toISOString();await writeFile(reportPath,JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
