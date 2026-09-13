import {existsSync,mkdirSync,lstatSync,readFileSync,readdirSync,openSync,writeFileSync,fsyncSync,closeSync,unlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {JsonStore} from './storage.js';
import {JournalData,emptyJournal} from './conversation-journal.js';

const Index=z.object({version:z.literal(1),revision:z.number().int().nonnegative(),nextOrder:z.number().int().nonnegative(),chunks:z.record(z.string().regex(/^[a-f0-9]{2}$/),z.string().regex(/^[a-f0-9]{64}$/))});
const emptyIndex=()=>({version:1,revision:0,nextOrder:0,chunks:{}});
const digest=content=>createHash('sha256').update(content).digest('hex');
const same=(a,b)=>a.id===b.id&&a.sessionId===b.sessionId&&a.at===b.at&&a.personaId===b.personaId&&a.name===b.name&&a.text===b.text&&a.fictional===b.fictional&&a.title===b.title&&a.pinned===b.pinned&&a.witnesses.join(',')===b.witnesses.join(',')&&JSON.stringify(a.transcription)===JSON.stringify(b.transcription);

// Immutable hash-named buckets + one atomic, backed-up index commit. A source
// belongs to its UUID prefix bucket, so eviction doesn't rewrite every bucket.
export class JournalStore {
  constructor(dir){
    this.dir=resolve(dir);this.chunkDir=join(this.dir,'conversation-journal-chunks');this.file=join(this.dir,'conversation-journal-index.json');this.loading=false;this.current=emptyIndex();this.rows=new Map();this.buckets=new Map();this.data=emptyJournal();
    this.index=new JsonStore(this.file,{initial:emptyIndex,validate:value=>{const v=Index.parse(value);if(this.loading)this.readSnapshot(v);return v;}});
    this.legacy=new JsonStore(join(this.dir,'conversation-journal.json'),{initial:emptyJournal,validate:value=>JournalData.parse(value)});
  }
  get warnings(){return [...this.index.warnings,...this.legacy.warnings,...(this.cleanupWarning?[this.cleanupWarning]:[])];}
  get recoveredFrom(){return this.index.recoveredFrom||this.legacy.recoveredFrom;}
  ensureDir(){mkdirSync(this.chunkDir,{recursive:true});if(lstatSync(this.chunkDir).isSymbolicLink())throw Error('대화 기억 폴더에 링크를 사용할 수 없습니다.');}
  readSnapshot(index){
    const rows=[],buckets=new Map();if(Object.keys(index.chunks).length){if(lstatSync(this.chunkDir).isSymbolicLink())throw Error('대화 기억 폴더 링크 오류');}
    for(const [bucket,hash] of Object.entries(index.chunks)){
      const path=join(this.chunkDir,hash+'.json'),stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink())throw Error('대화 기억 조각 파일 오류');const bytes=readFileSync(path);if(digest(bytes)!==hash)throw Error('대화 기억 조각의 무결성을 확인할 수 없습니다.');
      const data=JSON.parse(bytes);if(!Array.isArray(data)||data.some(r=>!Number.isSafeInteger(r.order)||r.order<0||r.order>=index.nextOrder||typeof r.entry?.id!=='string'||r.entry.id.slice(0,2).toLowerCase()!==bucket))throw Error('대화 기억 조각 순서 오류');rows.push(...data);buckets.set(bucket,data);
    }
    if(new Set(rows.map(r=>r.order)).size!==rows.length)throw Error('중복된 대화 기억 순서');rows.sort((a,b)=>a.order-b.order);const data=JournalData.parse({version:1,revision:index.revision,entries:rows.map(r=>r.entry)});return {data,buckets,rows:new Map(rows.map(r=>[r.entry.id,r]))};
  }
  load(){
    // Index backups are authoritative once any index exists. Never resurrect
    // an old monolithic migration source after a damaged committed index.
    const hasIndex=existsSync(this.file)||(existsSync(this.dir)&&readdirSync(this.dir).some(n=>/^conversation-journal-index\.json\.bak\.\d+$/.test(n)));
    if(!hasIndex){this.data=this.legacy.load();this.rows=new Map(this.data.entries.map((entry,order)=>[entry.id,{entry,order}]));this.current={...emptyIndex(),revision:this.data.revision,nextOrder:this.rows.size};this.buckets=new Map();return structuredClone(this.data);}
    this.loading=true;try{this.current=this.index.load();}finally{this.loading=false;}
    const snapshot=this.readSnapshot(this.current);this.data=snapshot.data;this.rows=snapshot.rows;this.buckets=snapshot.buckets;return structuredClone(this.data);
  }
  save(value){
    const data=JournalData.parse(value),next={version:1,revision:data.revision,nextOrder:this.current.nextOrder,chunks:{}},buckets=new Map(),rows=new Map();
    for(const entry of data.entries){const old=this.rows.get(entry.id);const row=old&&same(old.entry,entry)?old:{entry,order:old?.order??next.nextOrder++};rows.set(entry.id,row);const key=entry.id.slice(0,2).toLowerCase();if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(row);}
    this.ensureDir();
    for(const [key,bucket] of buckets){const old=this.buckets.get(key);if(old&&old.length===bucket.length&&bucket.every((r,i)=>r===old[i])&&this.current.chunks[key]){next.chunks[key]=this.current.chunks[key];continue;}
      const bytes=Buffer.from(JSON.stringify(bucket)),hash=digest(bytes),path=join(this.chunkDir,hash+'.json');
      if(existsSync(path)){if(lstatSync(path).isSymbolicLink()||digest(readFileSync(path))!==hash)throw Error('기존 대화 기억 조각이 손상되었습니다.');}
      else{let fd;try{fd=openSync(path,'wx');writeFileSync(fd,bytes);fsyncSync(fd);}catch(error){if(fd!==undefined){closeSync(fd);fd=undefined;try{unlinkSync(path);}catch{}}throw error;}finally{if(fd!==undefined)closeSync(fd);}}
      next.chunks[key]=hash;
    }
    // A failed index save leaves current rows and all previously referenced
    // immutable files untouched. Unreferenced new files are harmless orphans.
    this.index.save(next);this.current=next;this.rows=rows;this.buckets=buckets;this.data=data;
    if(data.revision%64===0)try{this.collect();}catch(error){this.cleanupWarning='대화 기억 정리를 미뤘습니다. '+error.message;}
  }
  collect(){
    this.ensureDir();const retained=new Set(Object.values(this.current.chunks));
    for(const name of readdirSync(this.dir).filter(n=>/^conversation-journal-index\.json(?:\.bak\.\d+|\.corrupt[-.].+)?$/.test(n))){let index;try{index=Index.parse(JSON.parse(readFileSync(join(this.dir,name),'utf8')));}catch{return;}for(const hash of Object.values(index.chunks))retained.add(hash);}
    for(const name of readdirSync(this.chunkDir)){if(!/^[a-f0-9]{64}\.json$/.test(name)||retained.has(name.slice(0,-5)))continue;const file=join(this.chunkDir,name);if(lstatSync(file).isFile()&&!lstatSync(file).isSymbolicLink())unlinkSync(file);}
  }
}
