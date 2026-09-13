import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const messages={invalid:'클립 파일이 손상되었거나 녹화 정보와 일치하지 않습니다.',
  unavailable:'클립 재생 검사기를 실행하지 못했습니다. 앱 설치 상태를 확인하세요.',
  timeout:'클립 재생 검사가 제한 시간을 초과했습니다.',busy:'이전 클립의 재생 검사를 마친 뒤 다시 시도하세요.',
  cancelled:'클립 저장이 취소되었습니다.'};
const failure=code=>Object.assign(new Error(messages[code]||messages.invalid),{code:'clip-'+code});

// One short-lived decoder, binary stdin only: no temporary recording, URL,
// microphone, sound model, or ASR process. A slot remains held until it exits.
export class ClipInspector {
  constructor({python=process.env.BACKSEAT_PYTHON||resolve(root,'.venv/Scripts/python.exe'),worker=resolve(root,'scripts/clip_inspector.py'),timeoutMs=15000,launch=spawn}={}){
    Object.assign(this,{python,worker,timeoutMs,launch});this.active=null;this.closed=false;
  }
  inspect(buffer,{kind,hasAudio,startedAt,endedAt},signal){
    if(this.closed||signal?.aborted)return Promise.reject(failure('cancelled'));
    if(this.active)return Promise.reject(failure('busy'));
    if(!Buffer.isBuffer(buffer)||buffer.length<100||buffer.length>20*1024*1024||buffer.subarray(0,4).toString('hex')!=='1a45dfa3'||!['video','audio'].includes(kind)||typeof hasAudio!=='boolean'||!Number.isFinite(startedAt)||!Number.isFinite(endedAt)||endedAt<=startedAt||endedAt-startedAt>45000)return Promise.reject(failure('invalid'));
    if(!existsSync(this.python)||!existsSync(this.worker))return Promise.reject(failure('unavailable'));
    return new Promise((yes,no)=>{
      let child;
      try{child=this.launch(this.python,['-X','utf8','-B',this.worker,kind,String(hasAudio),(endedAt-startedAt).toString()],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONIOENCODING:'utf-8',OMP_NUM_THREADS:'1'}});}catch{return no(failure('unavailable'));}
      let output='',outputBytes=0,error=null;
      const cancel=code=>{if(!error)error=failure(code);child.stdin.destroy();child.kill();};
      const abort=()=>cancel('cancelled');
      let exited;const completion=new Promise(resolve=>{exited=resolve;});
      this.active={child,abort,completion};
      const timer=setTimeout(()=>cancel('timeout'),this.timeoutMs);
      signal?.addEventListener('abort',abort,{once:true});
      child.on('error',()=>{error||=failure('unavailable');});
      child.stdin.on('error',()=>{error||=failure('invalid');});
      child.stderr.on('data',data=>{outputBytes+=data.length;if(outputBytes>8192)cancel('invalid');});
      child.stdout.on('data',data=>{outputBytes+=data.length;if(outputBytes>8192)cancel('invalid');else output+=data.toString('utf8');});
      child.once('close',code=>{
        clearTimeout(timer);signal?.removeEventListener('abort',abort);if(this.active?.child===child)this.active=null;exited();
        if(error)return no(error);
        try{const result=JSON.parse(output);if(code!==0||result.ok!==true||result.kind!==kind||result.hasAudio!==hasAudio||!Number.isFinite(result.durationMs)||result.durationMs<=0)throw failure('invalid');yes(result);}catch{return no(failure('invalid'));}
      });
      if(signal?.aborted)abort();else child.stdin.end(buffer);
    });
  }
  close(){this.closed=true;const active=this.active;active?.abort();return active?.completion||Promise.resolve();}
}
