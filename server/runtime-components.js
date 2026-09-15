import { join, isAbsolute } from 'node:path';
import { lstat } from 'node:fs/promises';
import { installRuntimePack, validateRuntimeComponent, verifyRuntimeComponent } from './runtime-pack.js';
import { downloadRuntimePack } from './runtime-download.js';
const features={microphone:['audio','microphone'],sound:['audio','sound'],clips:['audio'],perception:['audio','sound','microphone']};
const labels={audio:'공통 음성 처리',sound:'시스템 소리 인식',microphone:'한국어 마이크 인식',gpu:'GPU 가속'};

export class RuntimeComponents {
  constructor({catalog,cache,onChange=()=>{},download=downloadRuntimePack,install=installRuntimePack,verify=verifyRuntimeComponent}){
    if(catalog?.format!=='nagneon-runtime-catalog/1'||!Array.isArray(catalog.components))throw Error('실행 구성 목록을 확인하세요.');
    if(!cache||!isAbsolute(cache))throw Error('실행 구성 저장 경로를 확인하세요.');
    this.components=new Map();this.rows=new Map();this.jobs=new Map();this.cache=cache;this.onChange=onChange;this.download=download;this.install=install;this.verify=verify;this.closed=false;this.lastProgress=0;
    for(const c of catalog.components){validateRuntimeComponent(c);if(this.components.has(c.id))throw Error('중복 실행 구성입니다.');const url=new URL(c.archive?.url);if(url.protocol!=='https:'||url.username||url.password)throw Error('실행 구성 주소를 확인하세요.');this.components.set(c.id,c);this.rows.set(c.id,{id:c.id,label:labels[c.id],status:'idle',downloadedBytes:0,downloadBytes:c.archive.bytes,installedBytes:0,installBytes:c.bytes,error:''});}
    if(Object.keys(labels).some(id=>!this.components.has(id)))throw Error('실행 구성 목록이 불완전합니다.');
  }
  snapshot(){return {components:[...this.rows.values()].map(row=>({...row}))};}
  change(id,patch,progress=false){Object.assign(this.rows.get(id),patch);if(!progress||Date.now()-this.lastProgress>=250){this.lastProgress=Date.now();this.onChange();}}
  path(id){const c=this.components.get(id);return join(this.cache,'installed',id+'-'+c.contentId.slice(0,32));}
  async prepare(feature,signal=new AbortController().signal,device='cpu'){
    if(!features[feature])throw Error('알 수 없는 실행 기능입니다.');
    const ids=[...features[feature],...(feature==='microphone'&&device==='gpu'?['gpu']:[])];
    for(const id of ids){signal.throwIfAborted();await this.acquire(id,signal);}
    signal.throwIfAborted();return Object.fromEntries(ids.map(id=>[id,this.path(id)]));
  }
  async acquire(id,signal){
    if(this.closed)throw Error('실행 구성 준비가 종료되었습니다.');signal.throwIfAborted();
    if(this.rows.get(id).status==='ready')return;
    let job=this.jobs.get(id);
    if(job?.controller.signal.aborted){await job.promise.catch(()=>{});return this.acquire(id,signal);}
    if(!job){
      job={controller:new AbortController(),users:0,promise:null};this.jobs.set(id,job);
      job.promise=Promise.resolve().then(()=>this.run(id,job.controller.signal)).finally(()=>{if(this.jobs.get(id)===job)this.jobs.delete(id);});
      job.promise.catch(()=>{});
    }
    job.users++;
    try{await new Promise((yes,no)=>{const abort=()=>no(signal.reason||Error('준비를 취소했습니다.'));signal.addEventListener('abort',abort,{once:true});job.promise.then(yes,no).finally(()=>signal.removeEventListener('abort',abort));if(signal.aborted)abort();});}
    finally{job.users--;if(!job.users&&this.jobs.get(id)===job)job.controller.abort();}
  }
  async run(id,signal){
    const component=this.components.get(id),target=this.path(id);
    this.change(id,{status:'checking',error:''});
    try{
      const exists=await lstat(target).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
      signal.throwIfAborted();
      if(exists)await this.verify(target,component,signal);
      else{
        this.change(id,{status:'downloading',downloadedBytes:0,installedBytes:0});
        const downloaded=await this.download({url:component.archive.url,component,cache:join(this.cache,'downloads'),signal,onProgress:p=>this.change(id,{downloadedBytes:p.downloadedBytes},true)});
        signal.throwIfAborted();this.change(id,{status:'installing',downloadedBytes:component.archive.bytes});
        await this.install({archive:downloaded.path,component,cache:join(this.cache,'installed'),signal,onProgress:p=>this.change(id,{installedBytes:p.extractedBytes},true)});
      }
      signal.throwIfAborted();this.change(id,{status:'ready',downloadedBytes:component.archive.bytes,installedBytes:component.bytes});
    }catch(error){this.change(id,{status:signal.aborted?'idle':'error',error:signal.aborted?'':'구성을 준비하지 못했습니다. 연결과 저장 공간을 확인한 뒤 다시 시도해주세요.'});throw new Error(signal.aborted?'구성 준비를 취소했습니다.':this.rows.get(id).error,{cause:error});}
  }
  cancel(){for(const job of this.jobs.values())job.controller.abort();}
  async close(){this.closed=true;this.cancel();await Promise.allSettled([...this.jobs.values()].map(j=>j.promise));}
}
