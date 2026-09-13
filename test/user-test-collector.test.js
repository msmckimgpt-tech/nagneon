import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,lstat,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {JournalStore} from '../server/journal-store.js';
import {UserTestCollector,TestDataReader,readCollectorStatus} from '../scripts/lib/user-test-collector.mjs';

const since=Date.parse('2026-09-13T03:45:16Z'),until=since+12*60*60*1000;
const entry=(at=since+1000)=>({id:randomUUID(),sessionId:randomUUID(),at,personaId:'streamer',name:'방장',text:'훈수는 아직 말고 함께 봐주세요.',witnesses:['viewer'],fictional:false,title:'첫 방송',pinned:false});
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'backseat-test-observer-'));t.after(()=>rm(root,{recursive:true,force:true}));const source=join(root,'data');await mkdir(source);return {root,source,output:join(root,'collection')};}
const json=async(file,value)=>writeFile(file,JSON.stringify(value));
async function tree(root,prefix=''){const result={};for(const file of await readdir(join(root,prefix))){const path=join(prefix,file),stat=await lstat(join(root,path));if(stat.isDirectory())Object.assign(result,await tree(root,path));else result[path]=createHash('sha256').update(await readFile(join(root,path))).digest('hex');}return result;}

test('observer reads actual committed journal and projects new evidence without changing source files',async t=>{
  const f=await fixture(t),old=entry(since-1000),fresh=entry();
  const store=new JournalStore(f.source);store.save({version:1,revision:2,entries:[old,fresh]});
  await json(join(f.source,'world.json'),{settings:{mode:'live',personas:[{id:'viewer',name:'관객',personality:'PRIVATE_PERSONALITY',apiKey:'PRIVATE_TOKEN'}]},audience:{members:{viewer:{sessions:2,seconds:42,note:'PRIVATE_NOTE',origin:{key:'hidden'},peers:{friend:.8},aliases:[{name:'지난이름',at:since+1000}]}}},economy:{balance:50,ledger:[{id:'new',at:since+1000,amount:-50,kind:'arrival',text:'PRIVATE_LEDGER_TEXT'}]}});
  await json(join(f.source,'auth.json'),{token:'PRIVATE_AUTH'});await writeFile(join(f.source,'secret.wav'),'PRIVATE_AUDIO');
  const before=await tree(f.source),c=new UserTestCollector({...f,since,until,now:()=>since+2000});await c.initialize();const result=await c.poll();
  assert.equal(result.state,'collecting');assert.equal(result.metrics.messages,1);assert.deepEqual(await tree(f.source),before);
  const collected=JSON.parse(await readFile(join(f.output,'latest.json'),'utf8'));
  assert.deepEqual(collected.conversation.entries,[fresh]);assert.equal(collected.audience[0].aliases[0].name,'지난이름');
  assert.doesNotMatch(JSON.stringify(collected),/PRIVATE_|"peers"|"origin"|"personality"|auth\.json|secret\.wav/);
  const timeline=await readFile(join(f.output,'metrics.jsonl'),'utf8');assert.doesNotMatch(timeline,/훈수|방장|관객|PRIVATE_/);
  assert.equal((await c.poll()).changes,1);assert.equal((await readdir(f.output)).filter(n=>n.endsWith('.tmp')).length,0);
});

test('deleted quotes disappear on next snapshot and are never retained in a content timeline',async t=>{
  const f=await fixture(t),e=entry(),store=new JournalStore(f.source);store.save({version:1,revision:1,entries:[e]});
  const c=new UserTestCollector({...f,since,until,now:()=>since+2000});await c.initialize();await c.poll();
  store.save({version:1,revision:2,entries:[]});await c.poll();
  for(const file of await readdir(f.output))assert.doesNotMatch(await readFile(join(f.output,file),'utf8'),/훈수/);
  assert.equal((await readCollectorStatus(f.output)).metrics.messages,0);
});

test('damaged committed index is reported, never replaced by legacy or backed-up text',async t=>{
  const f=await fixture(t),e=entry();await json(join(f.source,'conversation-journal.json'),{version:1,revision:1,entries:[e]});
  await writeFile(join(f.source,'conversation-journal-index.json'),'broken');
  const c=new UserTestCollector({...f,since,until,now:()=>since+2000});await c.initialize();const result=await c.poll();
  assert.equal(result.state,'degraded');assert.deepEqual(result.errors,[{source:'journal',code:'INVALID_DATA'}]);assert.equal(result.metrics.messages,0);
  assert.equal(await readFile(join(f.source,'conversation-journal-index.json'),'utf8'),'broken');
});

test('index change during read cannot publish mixed journal content; next poll recovers',async t=>{
  const f=await fixture(t),store=new JournalStore(f.source),e=entry();store.save({version:1,revision:1,entries:[e]});let mutate=true;
  const reader=new TestDataReader(f.source,{readHook:async name=>{if(mutate&&name.startsWith('conversation-journal-chunks/')){mutate=false;store.save({version:1,revision:2,entries:[]});}}});
  const c=new UserTestCollector({...f,since,until,reader,now:()=>since+2000});await c.initialize();const first=await c.poll();
  assert.equal(first.state,'degraded');assert.equal(first.errors[0].code,'SOURCE_CHANGED');assert.equal(first.metrics.messages,0);
  const second=await c.poll();assert.equal(second.state,'collecting');assert.equal(second.metrics.messages,0);
});

test('journal traversal, wrong hash, read budget and directory junction are rejected',async t=>{
  const f=await fixture(t),store=new JournalStore(f.source);store.save({version:1,revision:1,entries:[entry()]});
  const indexFile=join(f.source,'conversation-journal-index.json'),index=JSON.parse(await readFile(indexFile,'utf8'));
  await json(indexFile,{...index,chunks:{'../outside':'a'.repeat(64)}});
  let result=await new TestDataReader(f.source).snapshot(since,until);assert.equal(result.errors[0].code,'JOURNAL_INDEX_INVALID');
  await json(indexFile,index);await writeFile(join(store.chunkDir,Object.values(index.chunks)[0]+'.json'),'[]');
  result=await new TestDataReader(f.source).snapshot(since,until);assert.equal(result.errors[0].code,'JOURNAL_HASH_MISMATCH');
  result=await new TestDataReader(f.source,{maxFileBytes:8}).snapshot(since,until);assert.equal(result.errors[0].code,'SOURCE_SIZE_LIMIT');
  const linked=join(f.root,'linked');await symlink(f.source,linked,process.platform==='win32'?'junction':'dir');
  result=await new TestDataReader(linked).snapshot(since,until);assert.ok(result.errors.every(e=>e.code==='SOURCE_LINK_REJECTED'));
});

test('deadline, stop file, size limit, overlapping paths and duplicate ownership do not touch source',async t=>{
  const f=await fixture(t);let at=since+1000,c=new UserTestCollector({...f,since,until,now:()=>at});await c.initialize();await c.poll();
  await assert.rejects(()=>new UserTestCollector({...f,since,until}).initialize(),{code:'EEXIST'});
  assert.throws(()=>new UserTestCollector({...f,output:join(f.source,'nested'),since,until}),/OVERLAPS/);
  at=until;assert.equal((await c.poll()).reason,'window-ended');
  c=new UserTestCollector({...f,output:join(f.root,'second'),since,until,now:()=>since+1000});await c.initialize();await writeFile(join(c.output,'STOP'),'');assert.equal((await c.poll()).reason,'stop-requested');
  c=new UserTestCollector({...f,output:join(f.root,'third'),since,until,now:()=>since+1000,maxTimelineBytes:1});await c.initialize();assert.equal((await c.poll()).reason,'timeline-limit');
  assert.deepEqual(await readdir(f.source),[]);
});
