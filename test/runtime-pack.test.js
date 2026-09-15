import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { distributionComponents } from '../scripts/lib/distribution-components.mjs';
import { writeRuntimePack } from '../scripts/lib/runtime-pack.mjs';
import { installRuntimePack } from '../server/runtime-pack.js';
const hash = b => createHash('sha256').update(b).digest('hex');
async function fixture() {
  await mkdir('artifacts', { recursive: true });
  const root = await mkdtemp(resolve('artifacts/runtime-pack-'));
  const data = [Buffer.from('음성 런타임 fixture\n'.repeat(3000)), Buffer.alloc(0)];
  const paths = ['resources/speech/python/library.bin', 'resources/speech/python/zero.bin'];
  for (const [i,p] of paths.entries()) { await mkdir(dirname(join(root,p)),{recursive:true}); await writeFile(join(root,p),data[i]); }
  const component = distributionComponents(paths.map((path,i)=>({path,bytes:data[i].length,sha256:hash(data[i])}))).find(c=>c.id==='audio');
  const archive = join(root,'audio.ngpack'), cache = join(root,'cache');
  const packed = await writeRuntimePack(root,component,archive);
  return {root,data,component:packed,archive,cache};
}

test('real gzip runtime pack installs byte-exact files atomically and reuses them offline',async()=>{
  const f=await fixture(), progress=[];
  const installed=await installRuntimePack({...f,onProgress:p=>progress.push(p)});
  assert.equal(installed.reused,false);
  for(const [i,file] of f.component.files.entries())assert.deepEqual(await readFile(join(installed.path,file.path)),f.data[i]);
  assert.equal(progress.at(-1).extractedBytes,f.component.bytes);
  const reused=await installRuntimePack({...f,archive:'nonexistent'});
  assert.deepEqual(reused,{path:installed.path,reused:true});
  await writeFile(join(installed.path,f.component.files[0].path),'damaged');
  await assert.rejects(installRuntimePack(f),/integrity mismatch/);
  assert.equal(await readFile(join(installed.path,f.component.files[0].path),'utf8'),'damaged');
});

test('corrupt, truncated, excess and cancelled packs never publish partial runtime or leave a lock',async()=>{
  for(const mode of ['download','gzip','short','truncated-gzip','excess','cancel']){
    const f=await fixture();
    if(mode==='download')await writeFile(f.archive,'corrupt download');
    else if(mode!=='cancel'){
      const bytes=mode==='gzip'?Buffer.from('not gzip'):mode==='truncated-gzip'?gzipSync(Buffer.concat(f.data)).subarray(0,-8):gzipSync(mode==='short'?Buffer.from('short'):Buffer.concat([...f.data,Buffer.from('excess')]));
      await writeFile(f.archive,bytes);f.component.archive={...f.component.archive,bytes:bytes.length,sha256:hash(bytes)};
    }
    const controller=new AbortController();
    await assert.rejects(installRuntimePack({...f,signal:controller.signal,onProgress:()=>{if(mode==='cancel')controller.abort();}}));
    assert.deepEqual(await readdir(f.cache),[]);
  }
});

test('runtime extraction rejects traversal and cannot overwrite an existing archive',async()=>{
  const f=await fixture();
  await assert.rejects(writeRuntimePack(f.root,f.component,f.archive),/EEXIST/);
  const bad={...f.component,files:[{path:'resources/../../outside',bytes:1,sha256:hash('x')}]};
  await assert.rejects(installRuntimePack({...f,component:bad}),/path/);
});

test('repair preserves a damaged install on cancellation and replaces it only with verified files',async()=>{
  const f=await fixture(),installed=await installRuntimePack(f),path=join(installed.path,f.component.files[0].path);
  await writeFile(path,'damaged');
  const controller=new AbortController();
  await assert.rejects(installRuntimePack({...f,repair:true,signal:controller.signal,onProgress:()=>controller.abort()}));
  assert.equal(await readFile(path,'utf8'),'damaged');
  assert.deepEqual(await readdir(f.cache),[installed.path.split(/[\\/]/).at(-1)]);
  const repaired=await installRuntimePack({...f,repair:true});
  assert.equal(repaired.path,installed.path);assert.equal(repaired.reused,false);
  assert.deepEqual(await readFile(path),f.data[0]);
  assert.deepEqual(await readdir(f.cache),[installed.path.split(/[\\/]/).at(-1)]);
});
