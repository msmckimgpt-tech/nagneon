import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const retry='마이크를 껐다 켜거나 음성 인식을 다시 준비해주세요.';

export class LocalSpeech {
  constructor(runtime={},spawner=spawn,{clock=globalThis,startupTimeoutMs=45000,requestTimeoutMs=60000}={}){
    this.runtime=runtime;this.spawn=spawner;this.clock=clock;this.startupTimeoutMs=startupTimeoutMs;this.requestTimeoutMs=requestTimeoutMs;
    this.child=null;this.ready=false;this.pending=null;this.error='';this.model='';this.closed=false;this.retiring=false;this.waiters=new Set();this.jobs=new Map();
  }
  start(){
    if(this.closed||this.child)return;
    this.ready=false;this.error='';this.model='';
    const python=this.runtime.python||process.env.BACKSEAT_PYTHON||resolve(root,'.venv/Scripts/python.exe');
    if(!existsSync(python)){this.fail('로컬 음성 모델 설치가 필요합니다.');return;}
    const args=['-X','utf8','-B',this.runtime.worker||resolve(root,'scripts/speech_worker.py')];
    const installed=resolve(root,'.models/microphone');
    const model=this.runtime.model||(existsSync(resolve(installed,'manifest.json'))?installed:null);
    if(model)args.push('--model-path',model,'--offline','--model-name',this.runtime.modelName||(model===installed?'medium':'local'));
    let child;
    try{child=this.spawn(python,args,{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONIOENCODING:'utf-8',...(model?{HF_HUB_OFFLINE:'1'}:{})}});}
    catch{this.fail('로컬 음성 프로세스를 시작하지 못했습니다. '+retry);return;}
    this.child=child;this.retiring=false;let buffer='';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',chunk=>{
      if(this.child!==child||this.retiring)return;
      buffer+=chunk;
      if(buffer.length>1_000_000){buffer='';this.retire('음성 인식 응답이 너무 큽니다. '+retry);return;}
      let n;
      while((n=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,n);buffer=buffer.slice(n+1);let data;
        try{data=JSON.parse(line);}catch{continue;}
        if(!data||typeof data!=='object')continue;
        if(data.ready===true){
          this.clock.clearTimeout(this.startupTimer);this.ready=true;this.error='';this.model=typeof data.model==='string'?data.model.slice(0,120):'';
          for(const waiter of [...this.waiters])waiter.finish();
        }else if(data.error&&!data.id){this.retire(String(data.error).slice(0,1000));return;}
        else if(this.jobs.has(data.id)){
          const job=this.jobs.get(data.id);
          this.finishJob(job,data.error?Error(String(data.error).slice(0,1000)):null,{text:data.text,cues:data.cues,...(data.timing?{timing:data.timing}:{})});
        }
      }
    });
    child.stderr.on('data',()=>{});
    child.stdin.on('error',()=>{if(this.child===child)this.retire('로컬 음성 연결이 종료되었습니다. '+retry);});
    child.on('error',()=>{if(this.child===child)this.retire('로컬 음성 프로세스를 시작하지 못했습니다. '+retry);});
    child.on('close',()=>{
      if(this.child!==child)return;
      this.child=null;this.retiring=false;
      this.fail(this.error||'로컬 음성 프로세스가 종료되었습니다. '+retry);
    });
    this.startupTimer=this.clock.setTimeout(()=>{if(this.child===child&&!this.ready)this.retire('음성 모델 준비 시간이 초과됐습니다. '+retry);},this.startupTimeoutMs);
  }
  fail(message){
    this.ready=false;this.error=message;this.clock.clearTimeout(this.startupTimer);
    for(const job of [...this.jobs.values()])this.finishJob(job,Error(message));
    for(const waiter of [...this.waiters])waiter.finish(Error(message));
  }
  retire(message){
    this.fail(message);
    if(!this.child||this.retiring)return;
    this.retiring=true;
    // Keep ownership until close. Never overlap a replacement with a stuck worker.
    try{this.child.kill();}catch{this.error='음성 인식기 종료를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.';}
  }
  async prepare(signal=new AbortController().signal){
    if(signal.aborted)throw Error('음성 준비를 취소했습니다.');
    if(this.closed)throw Error('음성 인식을 종료했습니다.');
    if(this.retiring)throw Error('이전 음성 인식기 종료를 기다리고 있습니다. 잠시 후 다시 시도해주세요.');
    this.start();
    if(this.ready)return true;
    if(this.error)throw Error(this.error);
    return new Promise((resolve,reject)=>{
      const abort=()=>waiter.finish(Error('음성 준비를 취소했습니다.'));
      const waiter={finish:error=>{this.waiters.delete(waiter);signal.removeEventListener('abort',abort);error?reject(error):resolve(true);}};
      this.waiters.add(waiter);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    });
  }
  finishJob(job,error,value){
    this.jobs.delete(job.id);this.clock.clearTimeout(job.timer);job.signal.removeEventListener('abort',job.abort);
    if(this.pending===job)this.pending=null;
    error?job.reject(error):job.resolve(value);
  }
  transcribe(buffer,signal){
    if(!this.ready)throw Error(this.error||'로컬 음성 모델을 준비 중입니다. 잠시 후 다시 시도하세요.');
    if(this.pending)throw Error('이전 음성을 인식 중입니다.');
    if(this.jobs.size>=8)throw Error('취소한 음성을 정리 중입니다. 잠시 후 다시 말해주세요.');
    if(signal.aborted)return Promise.reject(Error('음성 인식을 취소했습니다.'));
    return new Promise((resolve,reject)=>{
      const id=randomUUID(),job={id,resolve,reject,signal};
      job.abort=()=>{
        if(this.pending===job)this.pending=null;
        signal.removeEventListener('abort',job.abort);reject(Error('음성 인식을 취소했습니다.'));
        // Python may still be decoding cancelled audio. Its deadline survives.
      };
      job.timer=this.clock.setTimeout(()=>this.retire('음성 인식 시간이 초과됐습니다. '+retry),this.requestTimeoutMs);
      this.pending=job;this.jobs.set(id,job);signal.addEventListener('abort',job.abort,{once:true});
      if(signal.aborted){this.finishJob(job,Error('음성 인식을 취소했습니다.'));return;}
      try{this.child.stdin.write(JSON.stringify({id,audio:buffer.toString('base64')})+'\n');}
      catch{this.retire('로컬 음성 연결이 종료되었습니다. '+retry);}
    });
  }
  close(){
    this.closed=true;const child=this.child;this.retire('음성 인식을 종료했습니다.');
    if(!child||this.child!==child)return Promise.resolve();
    return new Promise((resolve,reject)=>{
      const done=()=>{this.clock.clearTimeout(timer);resolve();};
      const timer=this.clock.setTimeout(()=>{child.off('close',done);reject(Error('음성 인식기 종료를 확인하지 못했습니다.'));},5000);
      child.once('close',done);
    });
  }
}
