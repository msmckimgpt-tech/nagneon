import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {JournalStore} from '../server/journal-store.js';
import {ConversationJournal,emptyJournal} from '../server/conversation-journal.js';
const seed=()=>({id:randomUUID(),sessionId:randomUUID(),at:Date.now(),personaId:'momo',name:'모모',text:'오래 기억할 약속',witnesses:['momo'],fictional:false,title:'방송',pinned:false});
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'backseat-journal-store-'));t.after(()=>rm(dir,{recursive:true,force:true}));const store=new JournalStore(dir);return {dir,store,j:new ConversationJournal(store.load(),v=>store.save(v))};}
function add(j,text='새로운 대화'){const e=seed();j.record({id:e.id,time:e.at,personaId:e.personaId,name:e.name,text},{sessionId:e.sessionId,witnesses:e.witnesses,title:e.title});return e.id;}

test('immutable buckets persist exact ordering, pins, and deletion across restart',async t=>{
  const {dir,store,j}=await fixture(t);const first=add(j),second=add(j,'다음 대화');j.pin(first,true);j.forget([second]);assert.deepEqual(new JournalStore(dir).load(),j.data);assert.equal((await readdir(join(dir,'conversation-journal-chunks'))).some(n=>/^[a-f0-9]{64}\.json$/.test(n)),true);assert.equal(store.current.revision,4);
});
test('index commit failure never replaces memory or old immutable data and retry succeeds',async t=>{
  const {dir,store,j}=await fixture(t);add(j);const before=structuredClone(j.data),disk=await readFile(store.file);const save=store.index.save.bind(store.index);store.index.save=()=>{throw Error('index disk full');};assert.throws(()=>add(j,'취소될 저장'),/disk full/);assert.deepEqual(j.data,before);assert.deepEqual(await readFile(store.file),disk);assert.deepEqual(new JournalStore(dir).load(),before);store.index.save=save;add(j,'재시도 성공');assert.equal(new JournalStore(dir).load().entries.length,2);
});
test('damaged referenced chunk recovers an older complete index with a visible warning',async t=>{
  const {dir,store,j}=await fixture(t);const id=add(j);j.pin(id,true);const key=id.slice(0,2),bad=join(store.chunkDir,store.current.chunks[key]+'.json');await writeFile(bad,'damaged bytes');const recovered=new JournalStore(dir),data=recovered.load();assert.equal(data.entries[0].pinned,false);assert.ok(recovered.warnings.length);assert.ok(recovered.recoveredFrom);const restored=new ConversationJournal(data,v=>recovered.save(v));add(restored,'복구 후 기록');assert.equal(new JournalStore(dir).load().entries.length,2);assert.equal(await readFile(bad,'utf8'),'damaged bytes');
});
test('unrecoverable index does not resurrect stale legacy quotes or overwrite corrupt files',async t=>{
  const {dir,store}=await fixture(t);await writeFile(store.file,'broken index');await writeFile(join(dir,'conversation-journal.json'),JSON.stringify({...emptyJournal(),entries:[seed()]}));assert.throws(()=>new JournalStore(dir).load());assert.equal(await readFile(store.file,'utf8'),'broken index');
});
test('legacy validated JSON migrates on first save while keeping its original file untouched',async t=>{
  const {dir}=await fixture(t);const original={...emptyJournal(),entries:[seed()]},bytes=JSON.stringify(original);await writeFile(join(dir,'conversation-journal.json'),bytes);const store=new JournalStore(dir),j=new ConversationJournal(store.load(),v=>store.save(v));j.pin(original.entries[0].id,true);assert.deepEqual(new JournalStore(dir).load(),j.data);assert.equal(await readFile(join(dir,'conversation-journal.json'),'utf8'),bytes);
});
test('garbage collection retains every backup snapshot and leaves unknown files untouched',async t=>{
  const {dir,store,j}=await fixture(t);const id=add(j);for(let i=0;i<10;i++)j.pin(id,i%2===0);await writeFile(join(store.chunkDir,'keep-me.txt'),'unowned');const orphan='a'.repeat(64)+'.json';await writeFile(join(store.chunkDir,orphan),'orphan');store.collect();assert.equal(await readFile(join(store.chunkDir,'keep-me.txt'),'utf8'),'unowned');assert.ok(!(await readdir(store.chunkDir)).includes(orphan));for(const file of (await readdir(dir)).filter(n=>/\.bak\.\d+$/.test(n))){const index=JSON.parse(await readFile(join(dir,file),'utf8'));assert.ok(store.readSnapshot(index).data.entries.length===1);}
});
test('malformed bucket path and duplicate sequence cannot escape or masquerade as a complete snapshot',async t=>{
  const {store,j}=await fixture(t);add(j);assert.throws(()=>store.index.save({...store.current,chunks:{'../bad':'a'.repeat(64)}}));assert.deepEqual(store.readSnapshot(store.current).data,j.data);
});

test('valid uppercase UUID sources round-trip without creating invalid index keys',async t=>{
  const {dir,store}=await fixture(t),entry={...seed(),id:'ABCDEF01-1234-4234-8234-123456789ABC'};
  store.save({...emptyJournal(),revision:1,entries:[entry]});assert.deepEqual(new JournalStore(dir).load().entries,[entry]);assert.deepEqual(Object.keys(store.current.chunks),['ab']);
});
