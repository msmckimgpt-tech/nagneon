import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {lstat,mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {SubscriptionVoiceHost} from '../server/subscription-voice-host.js';

const bucket=balance=>({credits:{hasCredits:false,unlimited:false,balance},primary:{usedPercent:5}});
function preflight(limits,accountResult={account:{type:'chatgpt',planType:'pro'}}){
  const calls=[],host=new SubscriptionVoiceHost({bin:'unused-synthetic',dir:join(tmpdir(),'nagneon-allowance-no-spawn')});
  host.rpc=async method=>{calls.push(method);if(method==='account/read')return structuredClone(accountResult);if(method==='account/rateLimits/read')return structuredClone(limits);throw Error('Unexpected synthetic RPC');};
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

for(const [label,accountResult] of [
  ['null reply',null],['array reply',[]],['string reply','synthetic-private-account'],['number reply',4],['boolean reply',false],
  ['missing account',{}],['null account',{account:null}],['array account',{account:Object.assign([],{type:'chatgpt'})}],
  ['primitive account',{account:'synthetic-private-account'}],
])test('malformed '+label+' produces a controlled authentication refusal',async()=>{
  const {host,calls}=preflight({rateLimits:bucket('0')},accountResult);
  await assert.rejects(host.checkAllowance(),error=>error.code==='VOICE_AUTH'&&!error.message.includes('synthetic-private-account'));
  assert.deepEqual(calls,['account/read']);assert.equal(host.account,undefined);
});

const malformedLimits=[
  ['null response',null],['missing response',undefined],['array response',Object.assign([],{rateLimits:bucket('0')})],
  ['string response','synthetic-private-quota'],['number response',0],['boolean response',false],
  ['array keyed map',{rateLimitsByLimitId:[bucket('0')]}],['string keyed map',{rateLimits:bucket('0'),rateLimitsByLimitId:'synthetic-private-quota'}],
  ['numeric keyed map',{rateLimits:bucket('0'),rateLimitsByLimitId:0}],['boolean keyed map',{rateLimits:bucket('0'),rateLimitsByLimitId:false}],
  ['null keyed bucket',{rateLimitsByLimitId:{synthetic:null}}],['array keyed bucket',{rateLimitsByLimitId:{synthetic:Object.assign([],bucket('0'))}}],
  ['string keyed bucket',{rateLimitsByLimitId:{synthetic:'synthetic-private-quota'}}],
  ['array legacy bucket',{rateLimits:Object.assign([],bucket('0'))}],['numeric legacy bucket',{rateLimits:0}],['boolean legacy bucket',{rateLimits:false}],
  ['null credits',{rateLimits:{...bucket('0'),credits:null}}],['array credits',{rateLimits:{...bucket('0'),credits:Object.assign([],bucket('0').credits)}}],
  ['primitive credits',{rateLimits:{...bucket('0'),credits:'synthetic-private-quota'}}],
  ['missing windows',{rateLimits:{credits:bucket('0').credits}}],['null windows',{rateLimits:{...bucket('0'),primary:null,secondary:null}}],
  ['missing used percentage',{rateLimits:{...bucket('0'),primary:{}}}],['null used percentage',{rateLimits:{...bucket('0'),primary:{usedPercent:null}}}],
  ['string used percentage',{rateLimits:{...bucket('0'),primary:{usedPercent:'5'}}}],['boolean used percentage',{rateLimits:{...bucket('0'),primary:{usedPercent:false}}}],
  ['nonfinite used percentage',{rateLimits:{...bucket('0'),primary:{usedPercent:Infinity}}}],['NaN used percentage',{rateLimits:{...bucket('0'),primary:{usedPercent:NaN}}}],
  ['fractional used percentage',{rateLimits:{...bucket('0'),primary:{usedPercent:5.5}}}],['negative used percentage',{rateLimits:{...bucket('0'),primary:{usedPercent:-1}}}],
  ['array window',{rateLimits:{...bucket('0'),primary:Object.assign([],{usedPercent:5})}}],['primitive window',{rateLimits:{...bucket('0'),primary:5}}],
  ['invalid secondary beside valid primary',{rateLimits:{...bucket('0'),secondary:{usedPercent:'0'}}}],
  ['unknown keyed window beside valid legacy',{rateLimits:bucket('0'),rateLimitsByLimitId:{synthetic:{credits:bucket('0').credits}}}],
];
for(const [label,limits] of malformedLimits)test('unknown allowance refuses '+label+' without raw diagnostics',async()=>{
  const {host,calls}=preflight(limits);
  await assert.rejects(host.checkAllowance(),error=>error.code==='VOICE_ALLOWANCE'&&!error.message.includes('synthetic-private-quota'));
  assert.deepEqual(calls,['account/read','account/rateLimits/read']);assert.equal(host.account,undefined);
});

test('nullable quota fields and either valid window retain zero-balance acceptance',async()=>{
  for(const limits of [
    {rateLimits:bucket('0'),rateLimitsByLimitId:null},
    {rateLimits:null,rateLimitsByLimitId:{synthetic:bucket('0.00')}},
    {rateLimits:{...bucket('0'),primary:{usedPercent:0},secondary:null}},
    {rateLimits:{...bucket('0'),primary:null,secondary:{usedPercent:99}}},
    {rateLimits:{credits:bucket('0').credits,secondary:{usedPercent:5}}},
    {rateLimits:{...bucket('0'),secondary:{usedPercent:99}},rateLimitsByLimitId:{synthetic:bucket('0')}},
  ])await preflight(limits).host.checkAllowance();
  for(const limits of [{rateLimits:null,rateLimitsByLimitId:null},{},{rateLimitsByLimitId:{}}])await assert.rejects(preflight(limits).host.checkAllowance(),{code:'VOICE_ALLOWANCE'});
});

test('any exhausted present window refuses the entire included allowance',async()=>{
  for(const limits of [
    {rateLimits:{...bucket('0'),secondary:{usedPercent:100}}},
    {rateLimits:{...bucket('0'),primary:{usedPercent:101}}},
    {rateLimits:bucket('0'),rateLimitsByLimitId:{synthetic:{...bucket('0'),secondary:{usedPercent:100}}}},
  ])await assert.rejects(preflight(limits).host.checkAllowance(),{code:'VOICE_ALLOWANCE'});
});

for(const ordinaryUsageAllowed of [false,null,undefined,'true',1,{},[]])
  test('explicit ordinary usage permission '+JSON.stringify(ordinaryUsageAllowed)+' must be true',async()=>{
    await assert.rejects(preflight({rateLimits:bucket('0'),ordinaryUsageAllowed}).host.checkAllowance(),{code:'VOICE_ALLOWANCE'});
  });

for(const rateLimitReachedType of [
  'rate_limit_reached','workspace_owner_credits_depleted','workspace_member_credits_depleted',
  'workspace_owner_usage_limit_reached','workspace_member_usage_limit_reached',
  'usageLimit','unknown-synthetic-limit',false,0,'',{},[],
])
  test('nonnull reached limit '+JSON.stringify(rateLimitReachedType)+' refuses even low numeric usage',async()=>{
    await assert.rejects(preflight({ordinaryUsageAllowed:true,rateLimits:{...bucket('0'),rateLimitReachedType}}).host.checkAllowance(),{code:'VOICE_ALLOWANCE'});
  });

for(const spendControlReached of [true,'false',0,{},[]])
  test('spend control '+JSON.stringify(spendControlReached)+' refuses unless explicitly false',async()=>{
    await assert.rejects(preflight({ordinaryUsageAllowed:true,rateLimits:{...bucket('0'),spendControlReached}}).host.checkAllowance(),{code:'VOICE_ALLOWANCE'});
  });

test('nullable and omitted reached flags retain legacy zero-balance acceptance',async()=>{
  for(const fields of [{},{rateLimitReachedType:null,spendControlReached:null},{spendControlReached:false}]){
    await preflight({rateLimits:{...bucket('0'),...fields}}).host.checkAllowance();
    await preflight({ordinaryUsageAllowed:true,rateLimits:null,rateLimitsByLimitId:{synthetic:{...bucket('0'),...fields}}}).host.checkAllowance();
  }
});

test('ordinary permission and valid legacy metadata cannot conceal a keyed denial',async()=>{
  for(const invalid of [
    {...bucket('0'),rateLimitReachedType:'unknown-synthetic-limit'},
    {...bucket('0'),spendControlReached:true},
    {...bucket('0'),spendControlReached:'false'},
    {credits:bucket('0').credits},
  ])await assert.rejects(preflight({ordinaryUsageAllowed:true,rateLimits:bucket('0'),rateLimitsByLimitId:{synthetic:invalid}}).host.checkAllowance(),{code:'VOICE_ALLOWANCE'});
});

test('unavailable balance closes the real host startup path before a voice session is requested',async t=>{
  const tempRoot=await realpath(tmpdir());assert.equal(await realpath(tempRoot),tempRoot);assert.equal((await lstat(tempRoot)).isSymbolicLink(),false);
  const dir=await mkdtemp(join(tempRoot,'nagneon-allowance-start-'));
  const verifyOwnedDirectory=async()=>{assert.equal(dirname(dir),tempRoot);assert.match(basename(dir),/^nagneon-allowance-start-[A-Za-z0-9]{6}$/);const info=await lstat(dir);assert.equal(info.isDirectory(),true);assert.equal(info.isSymbolicLink(),false);assert.equal(await realpath(dir),resolve(dir));};
  await verifyOwnedDirectory();t.after(async()=>{await verifyOwnedDirectory();await rm(dir,{recursive:true});});
  const requests=[],child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();let closed=false;
  const finish=()=>{if(!closed){closed=true;child.emit('close',0,null);}};
  child.stdin.write=data=>{const request=JSON.parse(data);if(!request.method)return true;requests.push(request.method);if(request.id!==undefined)queueMicrotask(()=>{const result=request.method==='initialize'?{userAgent:'synthetic-allowance-host'}:request.method==='account/read'?{account:{type:'chatgpt',planType:'pro'}}:request.method==='account/rateLimits/read'?{rateLimits:bucket(null)}:{};child.stdout.emit('data',Buffer.from(JSON.stringify({id:request.id,result})+'\n'));});return true;};
  child.stdin.end=()=>queueMicrotask(finish);child.kill=()=>{queueMicrotask(finish);return true;};
  const host=new SubscriptionVoiceHost({bin:'synthetic-no-executable',dir,spawner:()=>child});
  await assert.rejects(host.start({sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'}),{code:'VOICE_ALLOWANCE'});
  assert.equal(requests.includes('thread/start'),false);assert.equal(requests.includes('thread/realtime/start'),false);assert.equal(closed,true);assert.equal(host.closed,true);assert.deepEqual(host.exitResult,{code:0,signal:null});
});
