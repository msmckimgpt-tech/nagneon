// Explicit, isolated official App Server probe. Never reads or copies credentials.
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {OpenAIProvider,format} from '../server/provider.js';
import {Observation,Settings} from '../server/schema.js';
import {defaults} from '../shared/defaults.js';
const dir=await mkdtemp(join(tmpdir(),'backseat-stream-probe-'));
const disabled=['shell_tool','unified_exec','apps','plugins','hooks','memories','multi_agent','browser_use','computer_use','image_generation','skill_search','view_image','code_mode','code_mode_host'];
const args=['app-server','--stdio','-c','mcp_servers={}','-c','mcp_servers.node_repl.enabled=false','-c','project_doc_max_bytes=0','-c','approval_policy="never"','-c','web_search="disabled"'];
for(const feature of disabled)args.push('--disable',feature);
const child=spawn(process.env.CODEX_BIN||'codex',args,{cwd:dir,windowsHide:true,stdio:['pipe','pipe','pipe']});
const pending=new Map(),events=[],requests=[];let sequence=0,buffer='',closed=false,threadId,done,started=Date.now();
const send=data=>child.stdin.write(JSON.stringify(data)+'\n');
const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});send({id,method,params});});
const terminal=new Promise(resolve=>child.on('close',code=>{closed=true;for(const p of pending.values())p.reject(new Error('App server closed: '+code));pending.clear();resolve(code);}));
child.on('error',error=>{for(const p of pending.values())p.reject(error);done?.reject(error);});
child.stderr.on('data',()=>{}); // Account diagnostics are not emitted or persisted.
child.stdout.on('data',chunk=>{buffer+=chunk;let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);let e;try{e=JSON.parse(line);}catch{continue;}
  if(e.id!==undefined&&pending.has(e.id)){const p=pending.get(e.id);pending.delete(e.id);e.error?p.reject(new Error(JSON.stringify(e.error))):p.resolve(e.result);}
  else if(e.id!==undefined){requests.push(e.method);send({id:e.id,error:{code:-32601,message:'This spectator app provides no tools or approvals.'}});done?.reject(new Error('Unexpected server request: '+e.method));}
  else if(e.method){const p=e.params||{};if(!threadId||p.threadId===threadId){const keep=['item/agentMessage/delta','item/completed','thread/tokenUsage/updated','turn/completed','turn/started'];if(keep.includes(e.method)){events.push({ms:Date.now()-started,method:e.method,params:p});if(e.method==='turn/completed')done?.resolve(p);}}}
}});
const watchdog=setTimeout(()=>{done?.reject(new Error('Probe deadline'));child.kill();},90000);
const report={model:'gpt-6-astra',effort:'low',transport:'official app-server stdio',startedAt:new Date().toISOString(),ephemeral:true};
try{
  await rpc('initialize',{clientInfo:{name:'backseat_studio_probe',title:'Nagneon',version:'0.1.0'},capabilities:{experimentalApi:true}});send({method:'initialized',params:{}});
  const effective=await rpc('config/read',{includeLayers:false});const config=effective.config;
  report.config={mcpServers:Object.entries(config.mcp_servers||{}).filter(([,server])=>server.enabled!==false).map(([name])=>name),disabledFeatures:disabled.map(id=>({id,value:config.features?.[id]})),approvalPolicy:config.approval_policy,webSearch:config.web_search};
  if(report.config.mcpServers.length||report.config.disabledFeatures.some(f=>f.value!==false))throw new Error('Probe config is not isolated; refusing a model turn.');
  const settings=Settings.parse({...defaults,mode:'live',category:'just-chatting',personas:defaults.personas.filter(p=>['momo','gg','luna'].includes(p.id)),chatPace:2});
  const payload=new OpenAIProvider().payload({settings,history:[],speech:'오늘은 편하게 얘기하자. 모모는 어떤 게임 방송을 제일 좋아해?'});
  const thread=await rpc('thread/start',{model:'gpt-6-astra',allowProviderModelFallback:false,cwd:dir,approvalPolicy:'never',sandbox:'read-only',ephemeral:true,baseInstructions:payload.instructions,developerInstructions:'Return only the requested JSON. No tools. Do not inspect files.',config:{model_reasoning_effort:'low',project_doc_max_bytes:0,web_search:'disabled'},environments:[],dynamicTools:[]});
  threadId=thread.thread.id;report.setupMs=Date.now()-started;report.thread={ephemeral:thread.thread.ephemeral,model:thread.model,approvalPolicy:thread.approvalPolicy,sandbox:thread.sandbox,instructionSources:thread.instructionSources};
  started=Date.now();const completed=new Promise((resolve,reject)=>done={resolve,reject});
  await rpc('turn/start',{threadId,model:'gpt-6-astra',effort:'low',input:[{type:'text',text:payload.input[0].content[0].text}],outputSchema:format.schema});
  const completion=await completed;report.totalMs=Date.now()-started;report.status=completion.turn?.status;
  const message=events.filter(e=>e.method==='item/completed'&&e.params.item?.type==='agentMessage').at(-1)?.params.item;
  report.observation=Observation.parse(JSON.parse(message.text));report.firstDeltaMs=events.find(e=>e.method==='item/agentMessage/delta')?.ms;report.messageCompleteMs=events.find(e=>e.method==='item/completed'&&e.params.item?.type==='agentMessage')?.ms;report.requests=requests;report.events=events;report.passed=report.status==='completed'&&requests.length===0;
}catch(error){report.passed=false;report.error=error.message;process.exitCode=1;}
finally{clearTimeout(watchdog);child.stdin.end();const finish=await Promise.race([terminal,new Promise(r=>setTimeout(()=>r('timeout'),3000))]);if(finish==='timeout'){child.kill();await terminal;}report.processClosed=closed;await writeFile('artifacts/codex-stream-probe.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,events:report.events?.map(({ms,method})=>({ms,method}))}));if(dirname(resolve(dir))===resolve(tmpdir())&&dir.startsWith(join(tmpdir(),'backseat-stream-probe-')))await rm(dir,{recursive:true,force:true});}
