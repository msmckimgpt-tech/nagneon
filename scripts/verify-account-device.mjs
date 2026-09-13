// Start/cancel a real official device-code login in an EMPTY, isolated Codex
// home. Never logs in, opens a browser, reads credentials or modifies the user's
// existing Codex account. Device codes and raw CLI output are never recorded.
import {mkdtemp,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {AccountLogin} from '../desktop/account-login.cjs';
import {CodexProvider} from '../server/codex-provider.js';
await mkdir('artifacts',{recursive:true});
const home=await mkdtemp(resolve('artifacts/isolated-login-'));
await writeFile(join(home,'config.toml'),'cli_auth_credentials_store = "file"\n');
const env={...process.env,CODEX_HOME:home,CODEX_BIN:''};
// Exercise the real automatic selection, including the Windows npm .cmd case.
for(const key of Object.keys(env))if(key.toLowerCase()==='path')env[key]=resolve('node_modules/.bin');
const provider=new CodexProvider(env);const bin=provider.bin;
const statuses=[];let resolveState;const changed=()=>new Promise(r=>resolveState=r);
const account=new AccountLogin({bin,env,check:()=>provider.check(),onChange:value=>{statuses.push(value.status);resolveState?.(value);resolveState=null;},openExternal:()=>{throw new Error('This test never opens a browser');},timeoutMs:45000});
const report={checkedAt:new Date().toISOString(),isolatedHome:home,officialBinary:bin,loginCompleted:false,existingAccountModified:false,statuses};
try{
  await provider.check();assert.equal(provider.available,false);await account.start('device');
  const deadline=Date.now()+50000;while(!['waiting','failed','expired'].includes(account.snapshot().status)){if(Date.now()>deadline)throw new Error('Login prompt timeout');await Promise.race([changed(),new Promise(r=>setTimeout(r,500))]);}
  const state=account.snapshot();assert.equal(state.status,'waiting',state.message);assert.equal(state.url,'https://auth.openai.com/codex/device');assert.match(state.code,/^[A-Z0-9]+-[A-Z0-9]+$/);report.promptRecognized=true;
  account.stop();while(account.snapshot().status==='cancelling'){if(Date.now()>deadline)throw new Error('Cancel did not finish');await Promise.race([changed(),new Promise(r=>setTimeout(r,100))]);}
  assert.equal(account.snapshot().status,'cancelled');assert.equal(account.snapshot().code,undefined);await provider.check();assert.equal(provider.available,false);report.passed=true;
}catch(error){report.passed=false;report.error=error.message;process.exitCode=1;}
finally{account.dispose();await writeFile('artifacts/account-device-test.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
