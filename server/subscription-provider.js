import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,resolve,isAbsolute,delimiter} from 'node:path';
import {homedir,tmpdir} from 'node:os';
import {OpenAIProvider,format} from './provider.js';
import {Observation} from './schema.js';

export function cliCommand(kind,configured='',env=process.env){
  const claude=kind==='claude-cli',home=env.USERPROFILE||env.HOME||homedir();
  const npm=join(env.APPDATA||join(home,'AppData','Roaming'),'npm','node_modules');
  const candidates=configured?[configured]:claude?[
    env.CLAUDE_BIN,join(home,'.local','bin','claude.exe'),join(npm,'@anthropic-ai','claude-code','bin','claude.exe'),join(npm,'@anthropic-ai','claude-code-win32-x64','claude.exe')
  ]:[env.GEMINI_BIN,join(npm,'@google','gemini-cli','bundle','gemini.js')];
  if(!configured)for(const directory of (env.PATH||'').split(delimiter))candidates.push(join(directory,claude?'claude.exe':'gemini.exe'));
  const bin=candidates.find(path=>path&&isAbsolute(path)&&existsSync(path));
  if(!bin)throw Error('공식 CLI를 설치하거나 실행 파일의 절대 경로를 설정해주세요.');
  if(/\.(?:mjs|cjs|js)$/i.test(bin))return {bin:env.NAGNEON_NODE_BIN||'node',prefix:[bin]};
  if(!/\.exe$/i.test(bin))throw Error('CLI 경로는 공식 .exe 또는 .js 파일이어야 합니다. 셸 명령은 입력할 수 없습니다.');
  return {bin,prefix:[]};
}

// The official CLI owns authentication. Never read/copy its account files.
// Child-only environment changes prevent accidental API/Vertex billing routes.
export function subscriptionEnv(env=process.env){
  const next={...env,GEMINI_CLI_NO_RELAUNCH:'true',NO_BROWSER:'true',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'};
  for(const key of ['ELECTRON_RUN_AS_NODE','NODE_OPTIONS','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL','CLAUDE_CODE_OAUTH_TOKEN','CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY','GEMINI_API_KEY','GOOGLE_API_KEY','GOOGLE_GENAI_USE_VERTEXAI','GOOGLE_APPLICATION_CREDENTIALS','GEMINI_WRITE_SYSTEM_MD'])delete next[key];
  return next;
}

export function runCli(command,args,{cwd,env,input='',signal,timeout=60000,killGraceMs=5000,spawner=spawn}={}){
  return new Promise((done,fail)=>{
    if(signal?.aborted)return fail(Error('CLI 요청을 취소했습니다.'));
    let child,ended=false,bytes=0,output=[],failed=false,deadline;
    const cancel=()=>{if(failed)return;failed=true;child?.kill();deadline=setTimeout(()=>finish(Error('CLI 종료를 확인하지 못했습니다.')),killGraceMs);};
    const timer=setTimeout(cancel,timeout);
    const finish=(error,value)=>{if(ended)return;ended=true;clearTimeout(timer);clearTimeout(deadline);signal?.removeEventListener('abort',cancel);error?fail(error):done(value);};
    try{child=spawner(command.bin,[...command.prefix,...args],{cwd,env,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});}
    catch{return finish(Error('CLI를 실행할 수 없습니다. 설치와 경로를 확인해주세요.'));}
    signal?.addEventListener('abort',cancel,{once:true});
    if(signal?.aborted)cancel();
    child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>2*1024*1024)return cancel();output.push(Buffer.from(chunk));});
    // Never surface CLI stderr, which can contain account details or prompts.
    child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
    child.on('error',()=>finish(Error('CLI를 실행할 수 없습니다. 설치와 경로를 확인해주세요.')));
    child.on('close',code=>finish(failed||signal?.aborted?Error('CLI 요청이 취소되었거나 응답 제한을 넘었습니다.'):code!==0?Error('공식 CLI 로그인을 확인하고 모델 접근 권한·사용량을 확인해주세요.'):null,Buffer.concat(output).toString('utf8')));
    child.stdin.end(input);
  });
}

export class SubscriptionProvider extends OpenAIProvider{
  constructor(config,env=process.env,runner=runCli){
    super({});this.kind=config.kind;this.model=config.model;this.cliPath=config.bin||'';this.env=subscriptionEnv(env);this.runner=runner;this.available=false;this.effort='provider-default';this.message='공식 CLI 설치와 구독 로그인을 확인해주세요.';this.transcriptionModel='로컬 음성 인식';
  }
  status(){return {kind:this.kind,configured:this.available,model:this.model,effort:this.effort,transcriptionModel:this.transcriptionModel,authMessage:this.message,webSearch:false};}
  async check(signal){
    this.available=false;
    try{
      this.command=cliCommand(this.kind,this.cliPath,this.env);
      const version=await this.runner(this.command,['--version'],{env:this.env,signal,timeout:15000});
      const match=/(\d+)\.(\d+)\.(\d+)/.exec(version),n=match?Number(match[1])*1e6+Number(match[2])*1000+Number(match[3]):0;
      if(n<(this.kind==='claude-cli'?2001270:59000))throw Error('검증된 실행 격리 옵션을 위해 Claude Code 2.1.270 이상 또는 Gemini CLI 0.59.0 이상이 필요합니다.');
      if(this.kind==='claude-cli'){
        const auth=JSON.parse(await this.runner(this.command,['auth','status'],{env:this.env,signal,timeout:15000}));
        if(!auth.loggedIn||auth.authMethod!=='claude.ai')throw Error('공식 Claude CLI에서 구독 계정으로 로그인해주세요.');
      }
      this.available=true;this.message=this.kind==='claude-cli'?'Claude 구독 로그인 확인됨 · 응답 확인으로 모델을 시험하세요.':'Gemini CLI 준비됨 · Google 로그인과 모델 접근은 응답 확인으로 시험하세요.';
    }catch(error){this.message=error.message;}
    signal?.throwIfAborted();return this.status();
  }
  async react(args,signal){
    if(!this.available)await this.check(signal);if(!this.available)throw Error(this.message);
    if(args.settings.webSearch&&args.adviceRequested)throw Error('CLI 관객 연결은 웹 검색을 지원하지 않습니다. 웹 검색 설정을 꺼주세요.');
    const folder=await mkdtemp(join(tmpdir(),'nagneon-cli-'));
    try{
      const payload=this.payload(args),parts=payload.input[0].content;
      const instructions=payload.instructions+'\nReturn only one JSON object matching this schema. No tools or file access.\n'+JSON.stringify(format.schema);
      const system=join(folder,'system.md');await writeFile(system,instructions);
      let command,input='',env={...this.env};
      if(this.kind==='claude-cli'){
        command=['--safe-mode','--restricted','-p','--model',this.model,'--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--no-session-persistence','--max-turns','2','--system-prompt-file',system,'--input-format','stream-json','--output-format','stream-json','--verbose','--json-schema',JSON.stringify(format.schema)];
        input=JSON.stringify({type:'user',message:{role:'user',content:parts.map(p=>{
          if(p.type==='input_text')return {type:'text',text:p.text};const i=this.image(p.image_url);return {type:'image',source:{type:'base64',media_type:i.mime,data:i.data}};
        })}})+'\n';
      }else{
        // Only generated local filenames enter Gemini's @file preprocessor.
        // Chat containing @paths stays inside the data file, never CLI syntax.
        await writeFile(join(folder,'request.json'),parts.filter(p=>p.type==='input_text').map(p=>p.text).join('\n'));
        const files=['@request.json'];let index=0;
        for(const p of parts.filter(p=>p.type==='input_image')){const i=this.image(p.image_url),name='frame-'+index+++'.'+(i.mime==='image/png'?'png':'jpg');await writeFile(join(folder,name),Buffer.from(i.data,'base64'));files.push('@'+name);}
        const settings=join(folder,'settings.json');
        await writeFile(settings,JSON.stringify({general:{disableAutoUpdate:true},security:{auth:{selectedType:'oauth-personal',enforcedType:'oauth-personal'}},admin:{extensions:{enabled:false},mcp:{enabled:false},skills:{enabled:false}},hooksConfig:{enabled:false},tools:{core:[],allowed:[],exclude:['*']},context:{fileName:[],includeDirectories:[],includeDirectoryTree:false,memoryBoundaryMarkers:[]},telemetry:{enabled:false,logPrompts:false},privacy:{usageStatisticsEnabled:false},model:{maxSessionTurns:1}}));
        env={...env,GEMINI_SYSTEM_MD:system,GEMINI_CLI_SYSTEM_SETTINGS_PATH:settings};
        command=['--model',this.model,'--output-format','json','--prompt',files.join(' ')+'\nReturn the requested audience JSON.'];
      }
      const raw=await this.runner(this.command,command,{cwd:folder,env,input,signal});
      const envelope=this.kind==='claude-cli'?raw.trim().split(/\r?\n/).map(line=>JSON.parse(line)).findLast(value=>value.type==='result'):JSON.parse(raw);if(!envelope)throw Error('CLI result missing');if(envelope.is_error||envelope.error)throw Error('CLI가 모델 응답을 완료하지 못했습니다.');
      const value=this.kind==='claude-cli'?envelope.structured_output:undefined;
      const text=(envelope.response||envelope.result||'').trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');
      const observation=Observation.parse(value||JSON.parse(text));
      // Do not invent usage if a CLI version omits provider token counts.
      const usage=this.kind==='claude-cli'?envelope.usage||{}:{};
      return {observation,usage};
    }catch(error){if(signal?.aborted)throw Error('CLI 관객 요청을 취소했습니다.');throw Error('CLI 관객 응답을 확인하지 못했습니다. 공식 CLI 로그인·모델 권한·JSON 출력 지원을 확인해주세요.');}
    finally{await rm(folder,{recursive:true,force:true});}
  }
  image(url){const m=/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(url);if(!m)throw Error('화면 형식 오류');return {mime:'image/'+m[1],data:m[2]};}
  async transcribe(){throw Error('로컬 음성 인식을 준비해주세요.');}
}
