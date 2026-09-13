import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {AccountLogin,readPrompt,loginUrl} from '../desktop/account-login.cjs';
import {CodexProvider,codexFailure,resolveCodexBin} from '../server/codex-provider.js';

const browser='https://auth.openai.com/oauth/authorize?client_id=test&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&state=ephemeral';
const device='https://auth.openai.com/codex/device';
const prompt=`Open this link\n\x1b[34m${device}\x1b[0m\n2. Enter this one-time code (expires in 15 minutes)\n\x1b[34mABCD-EFGHI\x1b[0m\nContinue only if you started this login in Codex.\n`;
const flush=()=>new Promise(r=>setImmediate(r));
function child(){const c=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();c.kill=()=>{c.killed=true;return true;};return c;}
function fixture(options={}){let checks=0;const children=[],changes=[];const account=new AccountLogin({check:async()=>({configured:++checks>1}),spawner:(_bin,args,opts)=>{assert.equal(opts.windowsHide,true);assert.ok(!args.includes('--with-access-token'));const c=child();children.push(c);return c;},onChange:v=>changes.push(v),openExternal:async url=>url,...options});return {account,children,changes};}

test('only validated official browser/device prompts leave the login adapter',()=>{
  assert.equal(loginUrl(browser,'browser'),browser);assert.equal(loginUrl(device,'device'),device);
  for(const value of ['https://evil.example/oauth/authorize','https://auth.openai.com.evil.example/codex/device','http://auth.openai.com/codex/device','https://auth.openai.com@evil.example/codex/device','https://auth.openai.com/codex/device?code=secret',browser.replace('localhost','evil.example'),browser.replace('%2Fauth%2Fcallback','%2Fanything'),browser+'#secret'])assert.equal(loginUrl(value,'device'),null);
  assert.equal(loginUrl(browser.replace('localhost','evil.example'),'browser'),null);
  assert.deepEqual(readPrompt(prompt,'device'),{url:device,code:'ABCD-EFGHI'});
  assert.equal(readPrompt('secret-token '+device+'\nABCD-EFGHI','device'),null);
  assert.deepEqual(readPrompt('Starting local login server on http://localhost:1455\n'+browser+'\n','browser'),{url:browser});
});
test('fragmented prompt, duplicate starts and cancel keep one child and erase temporary code',async()=>{
  const {account,children,changes}=fixture();await account.start('device');await account.start('browser');assert.equal(children.length,1);
  children[0].stdout.write(prompt.slice(0,71));assert.equal(account.snapshot().status,'starting');children[0].stdout.write(prompt.slice(71));assert.equal(account.snapshot().code,'ABCD-EFGHI');
  account.stop();assert.equal(account.snapshot().status,'cancelling');assert.equal(account.snapshot().code,undefined);
  await account.start('browser');assert.equal(children.length,1);children[0].emit('close',0);await flush();assert.equal(account.snapshot().status,'cancelled');
  assert.ok(!JSON.stringify(changes).includes('secret-token'));await assert.rejects(account.open(),/진행 중/);account.dispose();
});
test('successful CLI exit is confirmed using official login status',async()=>{
  const {account,children}=fixture();await account.start();children[0].stderr.write(browser+'\n');assert.equal(account.snapshot().status,'waiting');children[0].emit('close',0);await flush();assert.deepEqual(account.snapshot(),{status:'connected'});account.dispose();
});
test('cancel while checking cannot spawn later; already connected never replaces login',async()=>{
  let resolve;const a=fixture({check:()=>new Promise(r=>resolve=r)});const start=a.account.start();a.account.stop();resolve({configured:false});await start;assert.equal(a.children.length,0);assert.equal(a.account.snapshot().status,'cancelled');
  const b=fixture({check:async()=>({configured:true})});await b.account.start();assert.equal(b.children.length,0);assert.equal(b.account.snapshot().status,'connected');a.account.dispose();b.account.dispose();
});
test('expiry kills only the owned child and a late success cannot reconnect',async()=>{
  const {account,children}=fixture({timeoutMs:15});await account.start('device');children[0].stdout.write(prompt);await new Promise(r=>setTimeout(r,25));assert.equal(children[0].killed,true);assert.equal(account.snapshot().code,undefined);children[0].emit('close',0);await flush();assert.equal(account.snapshot().status,'expired');account.dispose();
});
test('cancel during post-login verification cannot leave a dead process in cancelling',async()=>{
  let checked=0,resolve;const {account,children}=fixture({check:async()=>++checked===1?{configured:false}:await new Promise(r=>resolve=r)});
  await account.start();children[0].emit('close',0);await flush();assert.equal(account.snapshot().status,'checking');account.stop();assert.equal(account.snapshot().status,'cancelled');resolve({configured:true});await flush();assert.equal(account.snapshot().status,'cancelled');account.dispose();
});
test('failed CLI output is sanitized and only a current official URL can open',async()=>{
  const opened=[];const {account,children}=fixture({openExternal:async url=>opened.push(url)});await account.start();children[0].stderr.write(browser+'\n');await account.open();assert.deepEqual(opened,[browser]);children[0].stderr.write('Error token=secret-token');children[0].emit('close',1);await flush();assert.equal(account.snapshot().status,'failed');assert.ok(!JSON.stringify(account.snapshot()).includes('secret-token'));await assert.rejects(account.start('untrusted'),/방식/);account.dispose();
});
test('official login status distinguishes subscription, API key, logged out and missing binary',async()=>{
  for(const [output,exit,expected] of [['Logged in using ChatGPT',0,'connected'],['Logged in using an API key - sk-secret',0,'api-key'],['Not logged in',1,'signed-out'],['unexpected details',1,'unavailable']]){
    const p=new CodexProvider({},()=>{const c=child();setImmediate(()=>{c.stderr.write(output);c.emit('close',exit);});return c;});const status=await p.check();assert.equal(status.authState,expected);assert.ok(!JSON.stringify(status).includes('sk-secret'));
  }
  const p=new CodexProvider({},()=>{const c=child();setImmediate(()=>c.emit('error',new Error('private path')));return c;});assert.equal((await p.check()).authState,'missing-cli');
});
test('model failure reasons map to fixed user-facing categories',()=>{
  for(const [message,kind] of [['You have hit your usage limit','usage'],['The gpt-6-astra model is not supported','model'],['Token expired, HTTP 401','auth'],['WebSocket stream disconnected','network'],['Unhandled failure','unknown']])assert.equal(codexFailure(message),kind);
});

test('installed Windows CLI is usable without a global codex executable on PATH', {skip:process.platform!=='win32'}, async()=>{
  const home=await mkdtemp(join(tmpdir(),'backseat-login-path-'));
  try{
    await writeFile(join(home,'config.toml'),'cli_auth_credentials_store = "file"\n');
    const env={...process.env,CODEX_BIN:'',CODEX_HOME:home};
    for(const key of Object.keys(env))if(key.toLowerCase()==='path')env[key]=resolve('node_modules/.bin');
    const provider=new CodexProvider(env);
    const status=await provider.check();
    assert.equal(status.authState,'signed-out');
    assert.match(provider.bin,/codex\.exe$/i);
    assert.equal(status.configured,false);
    // Login and inference must share the resolved native executable.
    const account=new AccountLogin({bin:provider.bin,env:provider.env,check:()=>provider.check(),spawner:(bin,args,opts)=>{
      assert.equal(bin,provider.bin);assert.equal(opts.env.CODEX_HOME,home);assert.equal(opts.shell,undefined);
      const c=child();setImmediate(()=>c.emit('close',1));return c;
    }});
    await account.start('device');await flush();account.dispose();
  }finally{await rm(home,{recursive:true,force:true});}
});

test('CLI resolution preserves explicit paths and selects matching native packages',()=>{
  const root=resolve('test fixtures','Codex & runtime');
  const options={platform:'win32',arch:'arm64',resolvePackage:name=>{
    assert.equal(name,'@openai/codex-win32-arm64/package.json');return join(root,'package.json');
  },exists:bin=>bin===join(root,'vendor','aarch64-pc-windows-msvc','bin','codex.exe')};
  assert.equal(resolveCodexBin({},options),join(root,'vendor','aarch64-pc-windows-msvc','bin','codex.exe'));
  assert.equal(resolveCodexBin({CODEX_BIN:'explicit missing.exe'},{resolvePackage:()=>{throw new Error('must not search');}}),'explicit missing.exe');
  assert.equal(resolveCodexBin({}, {...options,exists:()=>false,resolvePackage:()=>{throw Object.assign(new Error('missing'),{code:'MODULE_NOT_FOUND'});}}),'codex');
  assert.equal(resolveCodexBin({}, {platform:'unsupported',arch:'x64',resolvePackage:()=>{throw new Error('must not search');}}),'codex');
  assert.equal(resolveCodexBin({}, {platform:'linux',arch:'x64',resolvePackage:()=>join(root,'package.json'),exists:bin=>bin===join(root,'vendor','x86_64-unknown-linux-musl','codex','codex')}),join(root,'vendor','x86_64-unknown-linux-musl','codex','codex'));
});
