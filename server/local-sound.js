import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export class LocalSound {
  constructor(runtime={},spawner=spawn){this.runtime=runtime;this.spawn=spawner;this.child=null;this.ready=false;this.pending=null;this.error='';}
  start(){
    if(this.child)return;
    const python=this.runtime.python||process.env.BACKSEAT_PYTHON||resolve(root,'.venv/Scripts/python.exe');
    const model=this.runtime.model||resolve(root,'.models/sound-yamnet');
    if(!existsSync(python)||!existsSync(resolve(model,'yamnet.onnx')))throw Error('로컬 소리 인식 모델이 없습니다. 배포 파일 또는 모델 준비 상태를 확인하세요.');
    const args=['-X','utf8','-B',this.runtime.worker||resolve(root,'scripts/sound_worker.py'),'--model-path',model];
    if(this.runtime.speechModel)args.push('--speech-model-path',this.runtime.speechModel);
    const child=this.spawn(python,args,{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONIOENCODING:'utf-8',HF_HUB_OFFLINE:'1'}});this.child=child;this.error='';let buffer='';
    child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{buffer+=chunk;let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);try{const value=JSON.parse(line);if(this.child!==child)return;if(value.ready)this.ready=true;else if(this.pending&&value.id===this.pending.id){const pending=this.pending;this.pending=null;value.error?pending.reject(Error(value.error)):pending.resolve(value.sound);}}catch{}}if(buffer.length>1000000){this.fail('소리 인식 응답이 너무 큽니다.');child.kill();}});
    child.stderr.on('data',()=>{});child.stdin.on('error',()=>{if(this.child===child)this.fail('로컬 소리 연결이 종료되었습니다.');});child.on('error',()=>{if(this.child===child)this.fail('로컬 소리 프로세스를 시작하지 못했습니다.');});
    child.on('close',()=>{if(this.child===child){this.child=null;this.fail('로컬 소리 프로세스가 종료되었습니다. 다시 연결해주세요.');}});
  }
  fail(message){this.ready=false;this.error=message;const p=this.pending;this.pending=null;p?.reject(Error(message));}
  async prepare(signal){if(this.runtime.prepare)await this.runtime.prepare(signal);signal.throwIfAborted();this.start();const start=Date.now();while(!this.ready){if(signal.aborted)throw Error('소리 연결을 취소했습니다.');if(this.error)throw Error(this.error);if(Date.now()-start>45000)throw Error('소리 모델 준비 시간이 초과됐습니다.');await new Promise(r=>setTimeout(r,100));}return true;}
  analyze(buffer,signal){
    if(!this.ready)throw Error(this.error||'소리 모델을 준비 중입니다.');if(this.pending)throw Error('이전 소리를 분석하고 있습니다.');
    return new Promise((resolve,reject)=>{const id=randomUUID();const clean=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);};const abort=()=>{if(this.pending?.id===id)this.pending=null;clean();reject(Error('소리 분석을 취소했습니다.'));};const timer=setTimeout(abort,30000);signal.addEventListener('abort',abort,{once:true});this.pending={id,resolve:v=>{clean();resolve(v);},reject:e=>{clean();reject(e);}};if(signal.aborted){abort();return;}this.child.stdin.write(JSON.stringify({id,audio:buffer.toString('base64')})+'\n');});
  }
  close(){const child=this.child;this.child=null;this.fail('소리 인식을 종료했습니다.');child?.kill();}
}
