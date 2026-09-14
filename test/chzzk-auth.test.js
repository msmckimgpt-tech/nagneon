import test from 'node:test';
import assert from 'node:assert/strict';
import {ChzzkAuth} from '../server/chzzk-auth.js';

const credentials={clientId:'test-client-id',clientSecret:'test-client-secret'};
const tokens=()=>new Response(JSON.stringify({code:200,content:{accessToken:'private-access-token',refreshToken:'private-refresh-token',tokenType:'Bearer',expiresIn:'86400'}}));
const until=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}throw Error('timeout');};
const callback=result=>{const url=new URL(result.redirectUri);url.searchParams.set('state',new URL(result.authorizationUrl).searchParams.get('state'));url.searchParams.set('code','test-auth-code');return url;};

test('real loopback callback verifies one-use state and exchanges credentials only server-side',async t=>{
  let authorized,request;const states=[];const auth=new ChzzkAuth({port:0,onState:s=>states.push(s),fetchImpl:async(url,options)=>{request={url,options};return tokens();},onAuthorized:async value=>{authorized=value;}});t.after(()=>auth.cancel());
  const result=await auth.begin(credentials),url=callback(result),wrong=new URL(url);wrong.searchParams.set('state','bad');
  assert.equal((await fetch(wrong)).status,400);assert.equal(authorized,undefined);
  const duplicate=new URL(url);duplicate.searchParams.append('state','bad');assert.equal((await fetch(duplicate)).status,400);
  const response=await fetch(url);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.ok(!(await response.text()).includes('private-access'));
  await until(()=>!!authorized);assert.equal(authorized.accessToken,'private-access-token');assert.equal(authorized.refreshToken,undefined);
  assert.equal(request.url,'https://openapi.chzzk.naver.com/auth/v1/token');assert.equal(request.options.redirect,'error');assert.equal(JSON.parse(request.options.body).clientSecret,credentials.clientSecret);
  assert.ok(!JSON.stringify(states).includes('secret'));assert.ok(!JSON.stringify(states).includes('token'));assert.equal(auth.active,null);
  await assert.rejects(fetch(url));
});

test('cancelled exchange and old callback cannot replace a new authorization',async t=>{
  let resolveToken,called=0;const auth=new ChzzkAuth({port:0,fetchImpl:()=>new Promise(r=>{resolveToken=r;}),onAuthorized:async()=>{called++;}});t.after(()=>auth.cancel());
  const first=await auth.begin(credentials);await fetch(callback(first));await until(()=>!!resolveToken);auth.cancel();const next=await auth.begin(credentials);resolveToken(tokens());await new Promise(r=>setTimeout(r,20));
  assert.equal(called,0);assert.equal(auth.active.redirectUri,next.redirectUri);const oldState=new URL(next.redirectUri);oldState.search=new URL(callback(first)).search;assert.equal((await fetch(oldState)).status,400);
});

test('timeout releases owned listener and token errors never echo credentials',async t=>{
  const states=[];const auth=new ChzzkAuth({port:0,timeoutMs:30,onState:s=>states.push(s)});t.after(()=>auth.cancel());const started=await auth.begin(credentials);await until(()=>states.at(-1).phase==='failed');assert.equal(auth.active,null);await assert.rejects(fetch(callback(started)));
  const failed=new ChzzkAuth({port:0,onState:s=>states.push(s),fetchImpl:async()=>{throw Error('test-client-secret private-access-token');}});t.after(()=>failed.cancel());await fetch(callback(await failed.begin(credentials)));await until(()=>failed.active===null);assert.ok(!JSON.stringify(states).includes('test-client-secret'));assert.ok(!JSON.stringify(states).includes('private-access-token'));
});
