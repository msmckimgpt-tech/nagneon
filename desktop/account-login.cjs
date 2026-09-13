const {spawn}=require('node:child_process');

// Only the official CLI handles OAuth credentials. Raw CLI output never leaves
// this process; only a validated, temporary login URL/code reaches the main UI.
const DEVICE_URL='https://auth.openai.com/codex/device';
function loginUrl(value,method){
  try{const u=new URL(value);if(u.protocol!=='https:'||u.hostname!=='auth.openai.com'||u.port||u.username||u.password||u.hash)return null;
    if(method==='device')return u.href===DEVICE_URL?u.href:null;
    if(u.pathname!=='/oauth/authorize')return null;
    const redirect=new URL(u.searchParams.get('redirect_uri'));
    if(redirect.protocol!=='http:'||!['localhost','127.0.0.1'].includes(redirect.hostname)||redirect.pathname!=='/auth/callback'||redirect.username||redirect.password)return null;
    return u.href;
  }catch{return null;}
}
function readPrompt(output,method){
  const plain=output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'');
  const urls=plain.match(/https:\/\/[^\s<>"']+/g)||[];
  const url=urls.map(v=>loginUrl(v,method)).find(Boolean);
  if(!url)return null;
  if(method==='browser')return {url};
  const code=plain.match(/one-time code[^\n]*\n\s*([A-Z0-9]{3,8}-[A-Z0-9]{3,8})\s*(?:\n|$)/)?.[1];
  return code?{url,code}:null;
}
class AccountLogin{
  constructor({bin='codex',spawner=spawn,check,onChange=()=>{},openExternal,env=process.env,timeoutMs=15*60*1000,now=Date.now}={}){
    Object.assign(this,{bin,spawn:spawner,check,onChange,openExternal,env,timeoutMs,now});this.active=null;this.disposed=false;this.value={status:'idle'};
  }
  snapshot(){return {...this.value};}
  update(value){this.value=value;this.onChange(this.snapshot());}
  async start(method='browser'){
    if(!['browser','device'].includes(method))throw new Error('로그인 방식을 확인하세요.');
    if(this.disposed)throw new Error('앱을 다시 실행해주세요.');
    if(this.active)return this.snapshot();
    const run={method,child:null,timer:null,buffer:'',stopping:false};this.active=run;this.update({status:'checking',method});
    try{
      const status=await this.check();if(this.active!==run||run.stopping)return this.snapshot();
      if(status.configured){this.active=null;this.update({status:'connected'});return this.snapshot();}
      if(status.authState==='missing-cli'){this.active=null;this.update({status:'failed',message:'로그인 구성 요소를 실행할 수 없습니다. 앱 설치를 복구한 뒤 다시 시도하세요.'});return this.snapshot();}
      run.child=this.spawn(this.bin,['login',...(method==='device'?['--device-auth']:[])],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:this.env});
      this.update({status:'starting',method});
      const read=chunk=>{
        if(this.active!==run||run.stopping)return;
        run.buffer=(run.buffer+String(chunk)).slice(-16384);
        const prompt=readPrompt(run.buffer,method);
        if(prompt&&this.value.status!=='waiting')this.update({status:'waiting',method,...prompt,expiresAt:this.now()+this.timeoutMs});
      };
      run.child.stdout.on('data',read);run.child.stderr.on('data',read);
      run.child.once('error',()=>this.finish(run,{status:'failed',message:'로그인 구성 요소를 실행하지 못했습니다. 앱 설치를 확인해주세요.'}));
      run.child.once('close',code=>void this.closed(run,code));
      run.timer=setTimeout(()=>this.stop('expired'),this.timeoutMs);run.timer.unref?.();
    }catch{this.finish(run,{status:'failed',message:'로그인 준비에 실패했습니다. 연결을 확인하고 다시 시도하세요.'});}
    return this.snapshot();
  }
  finish(run,value){if(this.active!==run)return;clearTimeout(run.timer);run.buffer='';this.active=null;if(!this.disposed)this.update(value);}
  async closed(run,code){
    if(this.active!==run)return;
    run.closed=true;
    if(run.stopping){this.finish(run,{status:run.stopping});return;}
    if(code!==0){this.finish(run,{status:'failed',message:run.method==='device'?'기기 코드 로그인이 완료되지 않았습니다. 계정의 기기 코드 로그인 허용 여부를 확인하거나 브라우저 로그인을 이용하세요.':'로그인이 완료되지 않았습니다. 브라우저에서 다시 시도하거나 기기 코드 로그인을 이용하세요.'});return;}
    this.update({status:'checking',method:run.method});
    try{const status=await this.check();if(run.stopping){this.finish(run,{status:run.stopping});return;}this.finish(run,status.configured?{status:'connected'}:{status:'failed',message:'로그인 이후 ChatGPT 연결을 확인하지 못했습니다. 연결 상태를 다시 확인하세요.'});}
    catch{this.finish(run,{status:'failed',message:'로그인 확인에 실패했습니다. 연결 상태를 다시 확인하세요.'});}
  }
  stop(reason='cancelled'){
    const run=this.active;if(!run)return this.snapshot();
    run.stopping=reason;clearTimeout(run.timer);run.buffer='';
    this.update({status:'cancelling',message:reason==='expired'?'로그인 시간이 만료되어 정리 중입니다.':'로그인을 취소하는 중입니다.'});
    if(run.child&&!run.closed)run.child.kill();else this.finish(run,{status:reason});
    // Keep ownership until close; never start a second process while cancelling.
    return this.snapshot();
  }
  async open(){
    if(this.value.status!=='waiting'||!this.active||this.active.stopping)throw new Error('진행 중인 로그인 링크가 없습니다.');
    const url=loginUrl(this.value.url,this.value.method);if(!url)throw new Error('공식 로그인 주소를 확인할 수 없습니다.');
    await this.openExternal(url);return {ok:true};
  }
  dispose(){this.stop();this.disposed=true;this.value={status:'idle'};}
}
module.exports={AccountLogin,readPrompt,loginUrl};
