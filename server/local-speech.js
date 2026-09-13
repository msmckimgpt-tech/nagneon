import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export class LocalSpeech {
  constructor(runtime={},spawner=spawn){this.runtime=runtime;this.spawn=spawner;this.child=null;this.ready=false;this.pending=null;this.error='';}
  start(){
    const python=this.runtime.python || process.env.BACKSEAT_PYTHON || resolve(root,'.venv/Scripts/python.exe');
    if(!existsSync(python)){this.error='로컬 음성 모델 설치가 필요합니다.';return;}
    const args=['-X','utf8','-B',this.runtime.worker || resolve(root,'scripts/speech_worker.py')];
    if(this.runtime.model)args.push('--model-path',this.runtime.model,'--offline');
    this.child=this.spawn(python,args,{windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8',...(this.runtime.model?{HF_HUB_OFFLINE:'1'}:{})}});let buffer='';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data',b=>{buffer+=b;let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);try{const data=JSON.parse(line);if(data.ready)this.ready=true;else if(data.error&&!data.id){this.ready=false;this.error=data.error;const p=this.pending;this.pending=null;p?.reject(new Error(data.error));}else if(this.pending&&data.id===this.pending.id){const p=this.pending;this.pending=null;data.error?p.reject(new Error(data.error)):p.resolve({text:data.text,cues:data.cues});}}catch{}}});
    this.child.stderr.on('data',()=>{});
    this.child.stdin.on('error',()=>{this.ready=false;this.error='로컬 음성 연결이 종료되었습니다. 앱을 다시 시작하세요.';this.pending?.reject(new Error(this.error));this.pending=null;});
    this.child.on('error',()=>{this.error='로컬 음성 프로세스를 시작하지 못했습니다.';this.ready=false;});
    this.child.on('close',()=>{this.ready=false;this.error='로컬 음성 프로세스가 종료되었습니다. 앱을 다시 시작하세요.';this.pending?.reject(new Error(this.error));this.pending=null;});
  }
  transcribe(buffer,signal){
    if(!this.ready)throw new Error(this.error || '로컬 음성 모델을 준비 중입니다. 잠시 후 다시 시도하세요.');
    if(this.pending)throw new Error('이전 음성을 인식 중입니다.');
    return new Promise((resolve,reject)=>{
      const id=randomUUID();const abort=()=>{if(this.pending?.id===id)this.pending=null;clearTimeout(timer);signal.removeEventListener('abort',abort);reject(new Error('음성 인식을 취소했습니다.'));};
      const timer=setTimeout(abort,60000);signal.addEventListener('abort',abort,{once:true});
      const clean=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);};
      this.pending={id,resolve:text=>{clean();resolve(text);},reject:error=>{clean();reject(error);}};
      if(signal.aborted){abort();return;}this.child.stdin.write(JSON.stringify({id,audio:buffer.toString('base64')})+'\n');
    });
  }
  close(){this.child?.kill();this.child=null;}
}
