import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { downloadRuntimePack } from '../server/runtime-download.js';
import { distributionComponents } from '../scripts/lib/distribution-components.mjs';
const sha = b => createHash('sha256').update(b).digest('hex');
async function fixture() {
  await mkdir('artifacts',{recursive:true});
  const bytes = Buffer.from('verified archive bytes');
  const component = distributionComponents([{path:'resources/speech/python/runtime',bytes:1,sha256:sha('x')}]).find(c=>c.id==='audio');
  component.archive={format:'nagneon-runtime-gzip/1',bytes:bytes.length,sha256:sha(bytes)};
  return {bytes,component,url:'https://example.invalid/runtime.ngpack',cache:await mkdtemp(resolve('artifacts/runtime-download-'))};
}

test('runtime download verifies streamed bytes and reuses verified cache without network',async()=>{
  const f=await fixture();let calls=0;
  const result=await downloadRuntimePack({...f,fetcher:async(url,options)=>{calls++;assert.equal(options.credentials,'omit');return new Response(f.bytes);}});
  assert.deepEqual(await readFile(result.path),f.bytes);
  assert.deepEqual(await downloadRuntimePack({...f,fetcher:()=>{throw Error('offline');}}),{path:result.path,reused:true});
  assert.equal(calls,1);
});

test('failed, corrupted, oversized, truncated and cancelled downloads do not publish cache files',async()=>{
  for(const mode of ['http','corrupt','oversize','short','cancel','length']){
    const f=await fixture(),controller=new AbortController();
    await assert.rejects(downloadRuntimePack({...f,signal:controller.signal,onProgress:()=>{if(mode==='cancel')controller.abort();},fetcher:async()=>new Response(mode==='oversize'?Buffer.concat([f.bytes,f.bytes]):mode==='short'?f.bytes.subarray(0,2):mode==='corrupt'?Buffer.alloc(f.bytes.length):f.bytes,{status:mode==='http'?503:200,headers:mode==='length'?{'content-length':'1'}:{}})}));
    assert.deepEqual(await readdir(f.cache),[]);
  }
  const f=await fixture();await assert.rejects(downloadRuntimePack({...f,url:'http://example.invalid/file'}),/HTTPS/);
});

test('runtime download rejects an HTTPS redirect downgraded to plaintext',async()=>{
  const f=await fixture();
  await assert.rejects(downloadRuntimePack({...f,fetcher:async()=>{
    const response=new Response(f.bytes);Object.defineProperty(response,'url',{value:'http://example.invalid/redirect'});return response;
  }}),/HTTPS/);
  assert.deepEqual(await readdir(f.cache),[]);
});
