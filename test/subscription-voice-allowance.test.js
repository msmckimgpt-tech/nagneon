import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {SubscriptionVoiceHost} from '../server/subscription-voice-host.js';

const bucket=balance=>({credits:{hasCredits:false,unlimited:false,balance},primary:{usedPercent:5}});
function preflight(limits){
  const calls=[],host=new SubscriptionVoiceHost({bin:'unused-synthetic',dir:join(tmpdir(),'nagneon-allowance-no-spawn')});
  host.rpc=async method=>{calls.push(method);if(method==='account/read')return {account:{type:'chatgpt',planType:'pro'}};if(method==='account/rateLimits/read')return structuredClone(limits);throw Error('Unexpected synthetic RPC');};
  return {host,calls};
}
const unavailable=[['null',null],['missing',undefined],['empty string',''],['whitespace',' \t\n '],['boolean',false],['numeric protocol mismatch',0],['empty array',[]],['hexadecimal string','0x0'],['exponent string','0e0'],['nonzero decimal below floating point range','0.'+'0'.repeat(400)+'1']];
for(const [label,balance] of unavailable)test('subscription preflight refuses '+label+' credit balance',async()=>{
  const {host,calls}=preflight({rateLimits:bucket(balance)});
  await assert.rejects(host.checkAllowance(),{code:'VOICE_ALLOWANCE'});
  assert.deepEqual(calls,['account/read','account/rateLimits/read']);assert.equal(host.account,undefined);
});

test('explicit decimal zero remains accepted without changing account or connection settings',async()=>{
  for(const balance of ['0','0.00','000.000',' +0.0 ','-0.000']){
    const {host,calls}=preflight({rateLimits:bucket(balance)});await host.checkAllowance();assert.deepEqual(host.account,{type:'chatgpt',plan:'pro'});assert.deepEqual(calls,['account/read','account/rateLimits/read']);
  }
});

test('known zero in one quota cannot conceal an unavailable balance in another quota',async()=>{
  for(const limits of [{rateLimits:bucket('0'),rateLimitsByLimitId:{synthetic:bucket(null)}},{rateLimits:bucket(null),rateLimitsByLimitId:{synthetic:bucket('0')}},{rateLimitsByLimitId:{synthetic:bucket(null)}}])await assert.rejects(preflight(limits).host.checkAllowance(),{code:'VOICE_ALLOWANCE'});
  await preflight({rateLimitsByLimitId:{synthetic:bucket('0.00')}}).host.checkAllowance();
});

test('positive balance, credit flag, unlimited credits and exhausted quota remain refused',async()=>{
  for(const value of [bucket('0.01'),{...bucket('0'),credits:{hasCredits:true,unlimited:false,balance:'0'}},{...bucket('0'),credits:{hasCredits:false,unlimited:true,balance:'0'}},{...bucket('0'),primary:{usedPercent:100}}])await assert.rejects(preflight({rateLimits:value}).host.checkAllowance(),{code:'VOICE_ALLOWANCE'});
});

test('unavailable balance closes the real host startup path before a voice session is requested',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'nagneon-allowance-start-'));assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));t.after(()=>rm(dir,{recursive:true}));
  const requests=[],child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();let closed=false;
  const finish=()=>{if(!closed){closed=true;child.emit('close',0,null);}};
  child.stdin.write=data=>{const request=JSON.parse(data);if(!request.method)return true;requests.push(request.method);if(request.id!==undefined)queueMicrotask(()=>{const result=request.method==='initialize'?{userAgent:'synthetic-allowance-host'}:request.method==='account/read'?{account:{type:'chatgpt',planType:'pro'}}:request.method==='account/rateLimits/read'?{rateLimits:bucket(null)}:{};child.stdout.emit('data',Buffer.from(JSON.stringify({id:request.id,result})+'\n'));});return true;};
  child.stdin.end=()=>queueMicrotask(finish);child.kill=()=>{queueMicrotask(finish);return true;};
  const host=new SubscriptionVoiceHost({bin:'synthetic-no-executable',dir,spawner:()=>child});
  await assert.rejects(host.start({sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'}),{code:'VOICE_ALLOWANCE'});
  assert.equal(requests.includes('thread/start'),false);assert.equal(requests.includes('thread/realtime/start'),false);assert.equal(closed,true);assert.equal(host.closed,true);assert.deepEqual(host.exitResult,{code:0,signal:null});
});
