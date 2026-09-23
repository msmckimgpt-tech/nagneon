import test from 'node:test';
import assert from 'node:assert/strict';
import {Studio} from '../server/studio.js';
import {Audience} from '../server/audience.js';
import {defaults} from '../shared/defaults.js';

function setup(t) {
  let now=1_000_000,fail=false,requests=0;
  // Keep the audience's independent RNG stable: a random departure changes
  // viewing identity and is not an unchanged-input retry scenario.
  const audience=new Audience(undefined,undefined,()=>0.5);
  const studio=new Studio({audience,now:()=>now,random:()=>0.5,settings:{...defaults,mode:'live',lurkRatio:0,intervalSeconds:5},provider:{status:()=>({configured:true}),react:async()=>{
    requests++;if(fail)throw Error('synthetic unavailable');
    return {observation:{game:'Test',scene:'synthetic',confidence:0.9,excitement:0.2,messages:[]},usage:{total_tokens:1}};
  }}});
  studio.start();t.after(()=>studio.close());
  return {studio,get requests(){return requests;},async request(failed,input){fail=failed;now=Math.max(now+10_000,studio.retryAt);return studio.react(input||{speech:'synthetic input '+now});},async failure(){await assert.rejects(this.request(true),/synthetic unavailable/);return studio.retryAt-now;}};
}

test('alternating failures and successes retain a bounded retry delay',async t=>{
  const f=setup(t);
  for(const delay of [6000,12000,24000,48000,60000,60000]){
    assert.equal(await f.failure(),delay);
    assert.deepEqual(await f.studio.react({speech:'too soon'}),{skipped:'backoff'});
    await f.request(false);
  }
  assert.equal(f.requests,12);
});

test('three consecutive accepted responses restore the initial retry delay',async t=>{
  const f=setup(t);await f.failure();await f.failure();
  await f.request(false);await f.request(false);
  assert.equal(await f.failure(),24000);
  await f.request(false);await f.request(false);await f.request(false);
  assert.equal(await f.failure(),6000);
  assert.equal(f.studio.running,true);
});

test('unchanged frames do not count as a recovered model response',async t=>{
  const f=setup(t);await f.failure();await f.request(false,{image:'synthetic fixed frame'});
  const requests=f.requests;
  for(let i=0;i<3;i++)assert.deepEqual(await f.request(false,{image:'synthetic fixed frame'}),{skipped:'unchanged-input'});
  assert.equal(f.requests,requests);
  assert.equal(await f.failure(),12000);
});
