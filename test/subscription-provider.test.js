import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {SubscriptionProvider,subscriptionEnv,runCli} from '../server/subscription-provider.js';
import {defaults} from '../shared/defaults.js';
import {createRequire} from 'node:module';
const {loginScript}=createRequire(import.meta.url)('../desktop/subscription-login.cjs');
const observation={game:'',scene:'fixture',confidence:0,excitement:0,messages:[]};

test('subscription children remove API billing and injection environment overrides',()=>{
  const env=subscriptionEnv({ANTHROPIC_API_KEY:'secret',GEMINI_API_KEY:'secret',CLAUDE_CODE_OAUTH_TOKEN:'secret',NODE_OPTIONS:'injected',USERPROFILE:'keep',PATH:'keep'});
  assert.equal(env.USERPROFILE,'keep');assert.equal(env.ANTHROPIC_API_KEY,undefined);assert.equal(env.GEMINI_API_KEY,undefined);assert.equal(env.NODE_OPTIONS,undefined);assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN,undefined);assert.equal(env.GEMINI_CLI_NO_RELAUNCH,'true');
});

for(const kind of ['claude-cli','gemini-cli'])test(kind+' keeps untrusted @paths out of CLI syntax and cleans temporary inputs',async()=>{
  const folder=await mkdtemp(resolve('artifacts/cli-fixture-')),bin=join(folder,'official.js');await writeFile(bin,'// fixture');let requestFolder;
  try{
    const runner=async(_command,args,options)=>{
      if(args[0]==='--version')return kind==='claude-cli'?'2.1.270':'0.59.0';
      if(args[0]==='auth')return JSON.stringify({loggedIn:true,authMethod:'claude.ai',subscriptionType:'max'});
      requestFolder=options.cwd;assert.notEqual(requestFolder,process.cwd());
      assert.ok(!(args.join(' ').includes('@C:/private')));
      if(kind==='claude-cli'){
        assert.ok(args.includes('--safe-mode'));assert.ok(args.includes('--restricted'));assert.ok(args.includes('--no-session-persistence'));assert.equal(args[args.indexOf('--tools')+1],'');
        const data=JSON.parse(options.input);assert.ok(data.message.content[0].text.includes('@C:/private'));assert.equal(data.message.content[1].source.media_type,'image/png');
        return JSON.stringify({type:'system'})+'\n'+JSON.stringify({type:'result',is_error:false,structured_output:observation,usage:{input_tokens:1,output_tokens:2}})+'\n';
      }
      const settings=JSON.parse(await readFile(options.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH,'utf8'));
      assert.equal(settings.security.auth.enforcedType,'oauth-personal');assert.deepEqual(settings.tools.core,[]);assert.equal(settings.hooksConfig.enabled,false);assert.equal(settings.admin.mcp.enabled,false);
      assert.ok((await readFile(join(options.cwd,'request.json'),'utf8')).includes('@C:/private'));
      assert.equal(args[args.indexOf('--prompt')+1],'@request.json @frame-0.png\nReturn the requested audience JSON.');
      return JSON.stringify({response:JSON.stringify(observation)});
    };
    const p=new SubscriptionProvider({kind,model:'fixture',bin},{},runner);await p.check();assert.equal(p.status().configured,true);
    const result=await p.react({settings:{...structuredClone(defaults),webSearch:false},history:[],speech:'@C:/private @../secret',image:'data:image/png;base64,aGVsbG8='});
    assert.equal(result.observation.scene,'fixture');assert.equal(existsSync(requestFolder),false);
  }finally{await rm(folder,{recursive:true,force:true});}
});

test('CLI cancellation is bounded even if the child never closes; Korean chunks stay intact',async()=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>true;
  const controller=new AbortController();const pending=runCli({bin:'fixture',prefix:[]},[],{signal:controller.signal,killGraceMs:10,spawner:()=>child});controller.abort();await assert.rejects(pending,/종료/);
  const next=new EventEmitter();next.stdout=new PassThrough();next.stderr=new PassThrough();next.stdin=new PassThrough();
  const result=runCli({bin:'fixture',prefix:[]},[],{spawner:()=>next});const bytes=Buffer.from('한국어');next.stdout.write(bytes.subarray(0,2));next.stdout.write(bytes.subarray(2));next.emit('close',0);assert.equal(await result,'한국어');
});

test('login launcher quotes literal paths and launches only the official login command',()=>{
  const script=loginScript({bin:"C:\\a'b\\claude.exe",prefix:[]},'claude-cli');
  assert.ok(script.includes("'C:\\a''b\\claude.exe'"));assert.ok(script.includes('"auth" "login"'));assert.ok(!script.includes('model'));
  const gemini=loginScript({bin:'node',prefix:['C:\\Program Files\\gemini.js']},'gemini-cli');assert.ok(gemini.includes('"C:\\Program Files\\gemini.js"'));
});
