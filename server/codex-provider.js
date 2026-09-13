import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { OpenAIProvider, format } from './provider.js';
import { Observation } from './schema.js';

export function codexFailure(text=''){
  if(/rate.?limit|usage.?limit|quota|usage cap|too many requests|credits/i.test(text))return 'usage';
  if(/model.{0,100}(not found|does not exist|not supported|unavailable|access)|unsupported.{0,40}model/i.test(text))return 'model';
  if(/unauthori[sz]ed|authentication|not logged in|token.{0,40}(expired|invalid)|401/i.test(text))return 'auth';
  if(/connect|network|dns|timed? ?out|certificate|websocket|stream disconnected/i.test(text))return 'network';
  return 'unknown';
}
const failureMessages={usage:'ChatGPT 사용량 한도에 도달했습니다. 한도 회복 후 다시 시도하거나 리허설로 이어가세요.',model:'이 계정에서 gpt-6-astra 모델을 사용할 수 없습니다. 계정의 모델 접근 권한을 확인해주세요.',auth:'ChatGPT 인증을 확인하지 못했습니다. 방송 설정에서 계정을 다시 연결해주세요.',network:'모델 서버 연결이 끊겼습니다. 인터넷 연결을 확인한 뒤 다시 시도하세요.',unknown:'관객 응답을 완료하지 못했습니다. 계정 연결과 모델 접근 상태를 확인해주세요.'};

// Official CLI owns and refreshes the login. This app never reads auth.json.
export class CodexProvider extends OpenAIProvider {
  constructor(env=process.env,spawner=spawn){super(env);this.spawn=spawner;this.bin=env.CODEX_BIN || 'codex';this.env={...process.env,...env};this.compactInstructions=env.BACKSEAT_COMPACT_INSTRUCTIONS!=='0';this.minimalSkillContext=env.BACKSEAT_MINIMAL_SKILL_CONTEXT!=='0';this.available=false;this.authState='checking';this.authMessage='로그인 상태 확인 중';}
  async check(){
    const result=await new Promise(resolve=>{
      const child=this.spawn(this.bin,['login','status'],{windowsHide:true,timeout:10000,env:this.env});let text='';
      child.stdout.on('data',b=>text=(text+b).slice(-8192));child.stderr.on('data',b=>text=(text+b).slice(-8192));
      child.on('error',()=>resolve({code:1,text:'',missing:true}));child.on('close',code=>resolve({code,text}));
    });
    this.available=result.code===0 && /Logged in using ChatGPT/i.test(result.text);
    this.authState=this.available?'connected':result.missing?'missing-cli':/API key/i.test(result.text)?'api-key':/Not logged in/i.test(result.text)?'signed-out':'unavailable';
    this.authMessage={connected:'ChatGPT 구독 연결됨','missing-cli':'로그인 구성 요소를 실행할 수 없습니다.','api-key':'현재 API 키 로그인입니다. ChatGPT 구독 계정을 연결하세요.','signed-out':'ChatGPT 계정 연결이 필요합니다.',unavailable:'계정 상태를 확인하지 못했습니다. 연결을 다시 확인하세요.'}[this.authState];return this.status();
  }
  status(){return {...super.status(),configured:this.available,kind:'codex',authState:this.authState,authMessage:this.authMessage,audioConfigured:!!this.key};}
  async react(args,signal){
    if(!this.available)throw new Error(this.authMessage);
    const dir=await mkdtemp(join(tmpdir(),'backseat-'));const schema=join(dir,'response.json');const output=join(dir,'result.json');
    try{
      await writeFile(schema,JSON.stringify(format.schema));
      const payload=this.payload(args);
      const command=['exec','--ignore-user-config','--ephemeral','--skip-git-repo-check','--sandbox','read-only','-C',dir,'--model',this.model,'-c',`model_reasoning_effort="${this.effort}"`,'-c','approval_policy="never"','-c',`web_search="${args.settings.webSearch&&args.adviceRequested?'live':'disabled'}"`,'-c','project_doc_max_bytes=0','--output-schema',schema,'--output-last-message',output,'--json'];
      if(this.minimalSkillContext)command.push('-c','skills.max_context_tokens=1');
      // Official per-invocation base-instruction override avoids a coding assistant
      // preamble in this audience application. No user/global configuration changes.
      if(this.compactInstructions){const instructions=join(dir,'audience-instructions.md');await writeFile(instructions,payload.instructions+'\nReturn only the requested JSON. Do not inspect files. Use web search only when explicitly permitted.');command.push('-c',`model_instructions_file=${JSON.stringify(instructions)}`);}
      for(const flag of ['shell_tool','unified_exec','apps','plugins','hooks','memories','multi_agent','browser_use','computer_use','image_generation','skill_search','view_image','code_mode','code_mode_host'])command.push('--disable',flag);
      if(args.image){const path=join(dir,args.image.startsWith('data:image/png')?'frame.png':'frame.jpg');await writeFile(path,Buffer.from(args.image.split(',')[1],'base64'));command.push('--image',path);}
      command.push('-');
      const prompt=(this.compactInstructions?'':payload.instructions+'\nReturn only the requested JSON. Do not inspect files. Only use web search if explicitly permitted above.\n')+payload.input[0].content[0].text;
      const usage=await new Promise((resolve,reject)=>{
        const child=this.spawn(this.bin,command,{windowsHide:true,cwd:dir,stdio:['pipe','pipe','pipe'],env:this.env});let buffer='',usage={total_tokens:0},done=false,terminationError=null,killDeadline,failureKind='unknown';
        const finish=(error)=>{if(done)return;done=true;clearTimeout(timer);clearTimeout(killDeadline);signal.removeEventListener('abort',abort);error?reject(error):resolve(usage);};
        const terminate=(error)=>{if(terminationError)return;terminationError=error;child.kill();killDeadline=setTimeout(()=>finish(terminationError),5000);};
        const abort=()=>terminate(new Error('관객 응답을 취소했습니다.'));
        const timer=setTimeout(()=>terminate(new Error('구독 모델 응답이 90초를 초과했습니다.')),90000);
        child.on('error',()=>finish(new Error('Codex 실행 실패. 설치 경로와 로그인 상태를 확인하세요.')));
        child.stdout.on('data',chunk=>{buffer+=chunk;let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);try{const event=JSON.parse(line);if(event.type==='turn.completed'){const u=event.usage||{};usage={input_tokens:u.input_tokens||0,cached_input_tokens:u.cached_input_tokens||0,output_tokens:u.output_tokens||0,total_tokens:(u.input_tokens||0)+(u.output_tokens||0)};}else if(['error','turn.failed'].includes(event.type)){const kind=codexFailure(String(event.message||event.error?.message||'').slice(0,8192));if(kind!=='unknown')failureKind=kind;}}catch{}}if(buffer.length>1_000_000)buffer='';});
        child.stderr.on('data',chunk=>{const kind=codexFailure(String(chunk).slice(0,8192));if(kind!=='unknown')failureKind=kind;}); // Never expose raw account diagnostics.
        child.on('close',code=>finish(terminationError || (code===0?null:Object.assign(new Error(failureMessages[failureKind]),{code:failureKind}))));
        child.stdin.on('error',()=>{});signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}child.stdin.end(prompt);
      });
      try{return {observation:Observation.parse(JSON.parse(await readFile(output,'utf8'))),usage};}
      catch{throw new Error('구독 모델의 응답 형식이 올바르지 않습니다.');}
    }finally{if(dirname(resolve(dir))===resolve(tmpdir())&&dir.split(/[\\/]/).pop().startsWith('backseat-')){
      try{await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
      catch{console.error('임시 캡처 파일 삭제 실패:',dir);}
    }}
  }
}
