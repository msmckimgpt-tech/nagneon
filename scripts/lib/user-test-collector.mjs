import {open,lstat,realpath,mkdir,appendFile,readFile,unlink} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {JournalData} from '../../server/conversation-journal.js';
import {writeCollectorOutput} from './collector-output.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const list=value=>Array.isArray(value)?value:[];
const text=(value,max=300)=>typeof value==='string'?value.slice(0,max):'';
const number=value=>Number.isFinite(value)?value:0;
const inside=(root,path)=>{const rel=relative(root,path);return !!rel&&!rel.startsWith('..')&&!isAbsolute(rel);};
const fault=code=>Object.assign(new Error(code),{code});

// No application stores are instantiated: their recovery or migrations must
// never run against a live user's data. Every source handle is read-only.
export class TestDataReader {
  constructor(source,{maxFileBytes=16*1024*1024,maxReadBytes=40*1024*1024,readHook}={}){
    this.source=resolve(source);this.maxFileBytes=maxFileBytes;this.maxReadBytes=maxReadBytes;this.readHook=readHook;
  }
  async bytes(name){
    const path=resolve(this.source,name);
    if(!inside(this.source,path))throw fault('SOURCE_PATH_REJECTED');
    if(resolve(await realpath(this.source))!==this.source)throw fault('SOURCE_LINK_REJECTED');
    let cursor=this.source;
    for(const part of relative(this.source,path).split(/[\\/]/)){
      cursor=join(cursor,part);if((await lstat(cursor)).isSymbolicLink())throw fault('SOURCE_LINK_REJECTED');
    }
    const handle=await open(path,'r');
    try{
      const stat=await handle.stat();
      if(!stat.isFile()||stat.size>this.maxFileBytes||this.readBytes+stat.size>this.maxReadBytes)throw fault('SOURCE_SIZE_LIMIT');
      // Bounded read also protects against a file growing after stat().
      const buffer=Buffer.alloc(stat.size+1);let length=0;
      while(length<buffer.length){const result=await handle.read(buffer,length,buffer.length-length,null);if(!result.bytesRead)break;length+=result.bytesRead;}
      if(length!==stat.size)throw fault('SOURCE_CHANGED');
      this.readBytes+=length;const bytes=buffer.subarray(0,length);
      this.provenance[name]={sha256:hash(bytes),bytes:length,modifiedAt:stat.mtime.toISOString()};
      await this.readHook?.(name);return bytes;
    }finally{await handle.close();}
  }
  async json(name,optional=false){
    try{return JSON.parse((await this.bytes(name)).toString('utf8').replace(/^\uFEFF/,''));}
    catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}
  }
  async journal(){
    const index=await this.json('conversation-journal-index.json',true);
    if(!index)return {data:JournalData.parse(await this.json('conversation-journal.json',true)||{version:1,revision:0,entries:[]}),format:'legacy-or-empty'};
    if(index.version!==1||!Number.isSafeInteger(index.revision)||index.revision<0||!Number.isSafeInteger(index.nextOrder)||index.nextOrder<0||!index.chunks||Array.isArray(index.chunks)||Object.keys(index.chunks).length>256)throw fault('JOURNAL_INDEX_INVALID');
    const rows=[];
    for(const [bucket,digest] of Object.entries(index.chunks)){
      if(!/^[a-f0-9]{2}$/.test(bucket)||typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest))throw fault('JOURNAL_INDEX_INVALID');
      const bytes=await this.bytes('conversation-journal-chunks/'+digest+'.json');
      if(hash(bytes)!==digest)throw fault('JOURNAL_HASH_MISMATCH');
      const chunk=JSON.parse(bytes);
      if(!Array.isArray(chunk)||rows.length+chunk.length>4000||chunk.some(row=>!Number.isSafeInteger(row.order)||row.order<0||row.order>=index.nextOrder||row.entry?.id?.slice(0,2).toLowerCase()!==bucket))throw fault('JOURNAL_CHUNK_INVALID');
      rows.push(...chunk);
    }
    if(new Set(rows.map(row=>row.order)).size!==rows.length)throw fault('JOURNAL_ORDER_INVALID');
    // A concurrent index commit may delete an obsolete bucket. Retry on the
    // next poll instead of reporting a mixed or recovered historical journal.
    const initialHash=this.provenance['conversation-journal-index.json'].sha256;
    if(hash(await this.bytes('conversation-journal-index.json'))!==initialHash)throw fault('SOURCE_CHANGED');
    rows.sort((a,b)=>a.order-b.order);
    return {data:JournalData.parse({version:1,revision:index.revision,entries:rows.map(row=>row.entry)}),format:'immutable-chunks'};
  }
  async snapshot(since,until){
    this.readBytes=0;this.provenance={};const errors=[];
    const read=async(name,fn)=>{try{return await fn();}catch(error){errors.push({source:name,code:/^[A-Z_0-9]+$/.test(error.code||'')?error.code:'INVALID_DATA'});return null;}};
    const world=await read('world',()=>this.json('world.json',true));
    const settings=world?.settings||await read('settings',()=>this.json('settings.json',true));
    const audience=world?.audience||await read('audience',()=>this.json('audience.json',true));
    const economy=world?.economy||await read('economy',()=>this.json('economy.json',true));
    const journal=await read('journal',()=>this.journal());
    const knowledge=await read('knowledge',()=>this.json('knowledge.json',true));
    const clips=await read('clips',()=>this.json('clips.json',true));
    const inWindow=at=>Number.isFinite(at)&&at>=since&&at<=until;
    const entries=list(journal?.data.entries).filter(e=>inWindow(e.at));
    const people=list(settings?.personas).slice(0,40).map(p=>{
      const m=object(audience?.members?.[p.id]);
      return {id:text(p.id,80),name:text(p.name,100),system:!!p.system,enabled:!!p.enabled,sessions:number(m.sessions),seconds:number(m.seconds),joinedAt:number(m.joinedAt),aliases:list(m.aliases).filter(a=>inWindow(a.at)).map(a=>({name:text(a.name,100),at:a.at}))};
    });
    const observations=Object.values(object(knowledge)).slice(0,200).map(game=>({game:text(game.name,200),seconds:number(game.seconds),observations:list(game.observations).filter(o=>inWindow(o.at)).slice(-500).map(o=>({id:text(o.id,100),at:o.at,text:text(o.text,3000),witnesses:list(o.witnesses).map(id=>text(id,80)).slice(0,40)}))}));
    const clipData=list(clips).filter(c=>inWindow(c.createdAt)||list(c.comments).some(m=>inWindow(m.at))).slice(-200).map(c=>({id:text(c.id,100),title:text(c.title,300),game:text(c.game,200),sessionId:text(c.sessionId,100),createdAt:number(c.createdAt),video:!!c.video,participants:list(c.participants).slice(0,40).map(p=>({id:text(p.id,80),name:text(p.name,100)})),comments:list(c.comments).filter(m=>inWindow(m.at)&&!m.deleted).slice(-500).map(m=>({id:text(m.id,100),personaId:text(m.personaId,80),name:text(m.name,100),text:text(m.text,3000),parentId:text(m.parentId,100)||null,at:m.at}))}));
    return {version:1,window:{since,until},sourceFormat:world?'world':'legacy',provenance:this.provenance,errors,
      settings:{mode:text(settings?.mode),gameTitle:text(settings?.gameTitle,200),adviceMode:text(settings?.adviceMode),clipBufferEnabled:!!settings?.clipBufferEnabled},
      audience:people,economy:{balance:number(economy?.balance),ledger:list(economy?.ledger).filter(e=>inWindow(e.at)).slice(-1000).map(e=>({id:text(e.id,100),at:e.at,kind:text(e.kind,60),amount:number(e.amount)}))},
      conversation:{available:!!journal,format:journal?.format||null,revision:journal?.data.revision??null,entries},knowledge:observations,clips:clipData,
      metrics:{messages:entries.length,streamerMessages:entries.filter(e=>e.personaId==='streamer').length,viewerMessages:entries.filter(e=>e.personaId!=='streamer').length,sessionIds:[...new Set(entries.map(e=>e.sessionId))],viewers:people.filter(p=>!p.system).length,clips:clipData.length,errors:errors.length}};
  }
}

export class UserTestCollector {
  constructor({source,output,since,until,now=Date.now,reader,maxTimelineBytes=8*1024*1024}){
    this.source=resolve(source);this.output=resolve(output);this.since=since;this.until=until;this.now=now;
    if(!Number.isFinite(since)||!Number.isFinite(until)||until<=since||until-since>24*60*60*1000)throw fault('INVALID_COLLECTION_WINDOW');
    if(this.output===this.source||inside(this.source,this.output)||inside(this.output,this.source))throw fault('OUTPUT_OVERLAPS_SOURCE');
    this.reader=reader||new TestDataReader(source);this.maxTimelineBytes=maxTimelineBytes;this.timelineBytes=0;this.polls=0;this.changes=0;this.initialized=false;
  }
  async initialize({resume=false}={}){
    await mkdir(dirname(this.output),{recursive:true});
    if(resolve(await realpath(dirname(this.output)))!==dirname(this.output))throw fault('OUTPUT_LINK_REJECTED');
    if(resume)return this.resume();
    await mkdir(this.output); // A collection directory is owned by one process.
    this.initialized=true;
    await this.atomic('collection.json',{version:1,pid:process.pid,source:this.source,since:this.since,until:this.until,intervalSeconds:15,scope:'read-only saved application data; no devices or network',retention:'latest content snapshot; metrics timeline only'});
  }
  async resume(){
    if(resolve(await realpath(this.output))!==this.output)throw fault('OUTPUT_LINK_REJECTED');
    // Only one recovery attempt may inspect/replace the owner at a time. A live
    // owner, including a reused PID, is never stopped or overridden.
    const leasePath=join(this.output,'resume.lock'),lease=await open(leasePath,'wx');
    try{
      const reader=new TestDataReader(this.output,{maxFileBytes:65536,maxReadBytes:131072});reader.readBytes=0;reader.provenance={};
      const meta=await reader.json('collection.json');
      if(meta?.version!==1||typeof meta.source!=='string'||resolve(meta.source)!==this.source||meta.since!==this.since||meta.until!==this.until||!Number.isSafeInteger(meta.pid)||meta.pid<1)throw fault('COLLECTION_OWNER_MISMATCH');
      try{process.kill(meta.pid,0);throw fault('COLLECTOR_ALREADY_RUNNING');}catch(error){if(error.code!=='ESRCH')throw error;}
      const status=await reader.json('status.json',true);
      let timeline;try{timeline=await lstat(join(this.output,'metrics.jsonl'));}catch(error){if(error.code!=='ENOENT')throw error;}
      if(timeline&&(!timeline.isFile()||timeline.isSymbolicLink()||timeline.size>this.maxTimelineBytes))throw fault('COLLECTION_TIMELINE_INVALID');
      this.timelineBytes=timeline?.size||0;this.polls=Number.isSafeInteger(status?.polls)&&status.polls>=0?status.polls:0;this.changes=Number.isSafeInteger(status?.changes)&&status.changes>=0?status.changes:0;
      await this.atomic('collection.json',{...meta,pid:process.pid,resumedAt:this.now(),previousPid:meta.pid});
      this.initialized=true; // First poll replaces latest.json, never a new transcript archive.
    }finally{await lease.close();await unlink(leasePath);}
  }
  async atomic(name,value){
    await writeCollectorOutput(this.output,name,value);
  }
  async stopped(){try{await lstat(join(this.output,'STOP'));return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
  async poll(){
    if(!this.initialized)throw fault('COLLECTOR_NOT_INITIALIZED');
    const at=this.now();
    if(at>=this.until||await this.stopped()){const status={state:'stopped',reason:at>=this.until?'window-ended':'stop-requested',at,polls:this.polls,changes:this.changes};await this.atomic('status.json',status);return status;}
    const snapshot=await this.reader.snapshot(this.since,this.until);this.polls++;
    const digest=hash(JSON.stringify(snapshot));
    if(digest!==this.lastHash){
      const line=JSON.stringify({at,sha256:digest,metrics:snapshot.metrics})+'\n';
      if(this.timelineBytes+Buffer.byteLength(line)>this.maxTimelineBytes){const status={state:'stopped',reason:'timeline-limit',at,polls:this.polls,changes:this.changes};await this.atomic('status.json',status);return status;}
      // No content history/backups: a deleted quote disappears on the next
      // successful snapshot. A failed journal read publishes unavailable,
      // never resurrects an earlier text from a backup.
      await this.atomic('latest.json',snapshot);await appendFile(join(this.output,'metrics.jsonl'),line);
      this.lastHash=digest;this.timelineBytes+=Buffer.byteLength(line);this.changes++;
    }
    const status={state:snapshot.errors.length?'degraded':'collecting',at,polls:this.polls,changes:this.changes,sourceFiles:Object.keys(snapshot.provenance).length,errors:snapshot.errors,metrics:snapshot.metrics,timelineBytes:this.timelineBytes};
    await this.atomic('status.json',status);return status;
  }
}

export async function readCollectorStatus(output){return JSON.parse(await readFile(join(output,'status.json'),'utf8'));}
