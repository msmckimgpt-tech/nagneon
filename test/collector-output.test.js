import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rename,readdir,rm,mkdir,symlink} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {writeCollectorOutput} from '../scripts/lib/collector-output.mjs';
import {runCollector} from '../scripts/lib/collector-runner.mjs';

const fault=code=>Object.assign(new Error('untrusted error details'),{code});
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'backseat-output-test-'));t.after(async()=>{assert.equal(dirname(root),resolve(tmpdir()));assert.ok(root.startsWith(join(tmpdir(),'backseat-output-test-')));await rm(root,{recursive:true,force:true});});return root;}

test('transient Windows rename failures retain the old snapshot until successful atomic publication',async t=>{
  const root=await fixture(t),file=join(root,'latest.json'),old='{"old":true}';await writeFile(file,old);
  await writeFile(file+'.tmp','unknown legacy temp');let calls=0;const waits=[];
  await writeCollectorOutput(root,'latest.json',{current:true},{renameFile:async(a,b)=>{assert.equal(await readFile(file,'utf8'),old);if(calls++<2)throw fault(calls===1?'EPERM':'EBUSY');return rename(a,b);},wait:async ms=>{waits.push(ms);}});
  assert.deepEqual(JSON.parse(await readFile(file,'utf8')),{current:true});assert.deepEqual(waits,[25,50]);assert.equal(calls,3);
  assert.deepEqual((await readdir(root)).sort(),['latest.json','latest.json.tmp']);assert.equal(await readFile(file+'.tmp','utf8'),'unknown legacy temp');
});

test('exhausted sharing retries preserve primary bytes and clean only the new transient snapshot',async t=>{
  const root=await fixture(t),file=join(root,'latest.json');await writeFile(file,'previous snapshot');let calls=0,waited=0;
  await assert.rejects(()=>writeCollectorOutput(root,'latest.json',{text:'new private quote'},{renameFile:async()=>{calls++;throw fault('EPERM');},wait:async ms=>{waited+=ms;}}),{code:'OUTPUT_BUSY'});
  assert.equal(calls,7);assert.equal(waited,1575);assert.equal(await readFile(file,'utf8'),'previous snapshot');assert.deepEqual(await readdir(root),['latest.json']);
  await writeCollectorOutput(root,'latest.json',{text:'after release'});assert.deepEqual(JSON.parse(await readFile(file,'utf8')),{text:'after release'});
});

test('permanent rename errors are not retried and failed serialization leaves no content temporary',async t=>{
  const root=await fixture(t);await writeFile(join(root,'status.json'),'original');let calls=0;
  await assert.rejects(()=>writeCollectorOutput(root,'status.json',{state:'current'},{renameFile:async()=>{calls++;throw fault('ENOSPC');},wait:async()=>assert.fail('no retry')}),{code:'ENOSPC'});
  assert.equal(calls,1);assert.equal(await readFile(join(root,'status.json'),'utf8'),'original');
  const cycle={};cycle.self=cycle;await assert.rejects(()=>writeCollectorOutput(root,'latest.json',cycle),/circular/i);assert.deepEqual(await readdir(root),['status.json']);
});

test('output traversal, substituted directories and junction roots cannot overwrite another location',async t=>{
  const root=await fixture(t),outside=join(root,'outside'),output=join(root,'output');await mkdir(outside);await mkdir(output);await writeFile(join(outside,'note.json'),'preserve');
  await assert.rejects(()=>writeCollectorOutput(output,'../outside/note.json',{}),{code:'OUTPUT_FILENAME_REJECTED'});
  await mkdir(join(output,'status.json'));await assert.rejects(()=>writeCollectorOutput(output,'status.json',{}),{code:'OUTPUT_LINK_REJECTED'});
  const link=join(root,'linked');await symlink(outside,link,process.platform==='win32'?'junction':'dir');await assert.rejects(()=>writeCollectorOutput(link,'latest.json',{}),{code:'OUTPUT_LINK_REJECTED'});
  assert.equal(await readFile(join(outside,'note.json'),'utf8'),'preserve');assert.deepEqual(await readdir(outside),['note.json']);
});

function loopFixture(){let at=0,calls=0;const reports=[],waits=[];const collector={now:()=>at,until:100000,stopped:async()=>false,atomic:async()=>{},poll:async()=>{calls++;return {state:'stopped'};}};return {collector,reports,waits,options:{report:v=>reports.push(v),wait:async ms=>{waits.push(ms);at+=ms;}},setTime:v=>{at=v;},count:()=>calls};}

test('collector continues after an exhausted transient write and resets the consecutive failure budget',async()=>{
  const f=loopFixture();let polls=0;f.collector.poll=async()=>{polls++;if([1,2,4,5].includes(polls))throw fault('OUTPUT_BUSY');return {state:polls===6?'stopped':'collecting'};};
  assert.equal((await runCollector(f.collector,f.options)).exitCode,0);assert.equal(polls,6);assert.deepEqual(f.reports.map(r=>r.attempt),[1,2,1,2]);assert.doesNotMatch(JSON.stringify(f.reports),/untrusted/);
});

test('persistent sharing errors stop with a bounded diagnostic even when status writing also fails',async()=>{
  const f=loopFixture();let polls=0,writes=0;f.collector.poll=async()=>{polls++;throw fault('OUTPUT_BUSY');};f.collector.atomic=async()=>{writes++;throw fault('OUTPUT_BUSY');};
  const result=await runCollector(f.collector,f.options);assert.equal(result.exitCode,1);assert.equal(result.code,'OUTPUT_BUSY_LIMIT');assert.equal(polls,4);assert.equal(writes,1);assert.equal(f.waits.length,3);assert.deepEqual(f.reports.at(-1),{state:'failed',at:45000,code:'OUTPUT_BUSY_LIMIT',statusWritten:false,statusWriteCode:'OUTPUT_BUSY'});
});

test('deadline and STOP remain effective when their final status file cannot be replaced',async()=>{
  for(const reason of ['window-ended','stop-requested']){
    const f=loopFixture();f.collector.until=1000;if(reason==='stop-requested')f.collector.stopped=async()=>true;else f.setTime(1000);
    f.collector.poll=async()=>{throw fault('OUTPUT_BUSY');};const result=await runCollector(f.collector,f.options);
    assert.equal(result.state,'stopped');assert.equal(f.waits.length,0);assert.equal(f.reports[0].reason,reason);assert.equal(f.reports[0].statusWritten,false);
  }
});

test('once and permanent failures do not spin and report only bounded codes',async()=>{
  for(const code of ['OUTPUT_BUSY','ENOSPC','not safe / source text']){
    const f=loopFixture();f.collector.poll=async()=>{throw fault(code);};const result=await runCollector(f.collector,{...f.options,once:true});
    assert.equal(result.exitCode,1);assert.equal(f.waits.length,0);assert.match(result.code,/^[A-Z_0-9]+$/);assert.doesNotMatch(JSON.stringify(f.reports),/untrusted|source text/);
  }
  const f=loopFixture();f.collector.poll=async()=>{throw fault('OUTPUT_BUSY');};f.collector.stopped=async()=>{throw fault('EACCES');};assert.equal((await runCollector(f.collector,f.options)).code,'EACCES');
});

test('a failure status preserves collection counters needed by a later authorized resume',async()=>{
  const f=loopFixture();Object.assign(f.collector,{polls:42,changes:12,timelineBytes:250});let written;
  f.collector.poll=async()=>{throw fault('ENOSPC');};f.collector.atomic=async(_name,value)=>{written=value;};
  assert.equal((await runCollector(f.collector,f.options)).exitCode,1);assert.deepEqual(written,{state:'failed',at:0,polls:42,changes:12,timelineBytes:250,code:'ENOSPC'});
});
