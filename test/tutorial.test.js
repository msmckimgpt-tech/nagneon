import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startServer} from '../server/index.js';
import {Tutorial,initialTutorial} from '../server/tutorial.js';

const birth={name:'이끼수첩',personality:'조용한 탐험을 좋아한다.',values:'스스로 발견하는 즐거움',sociability:.6,expertise:.3};
const answer={observation:{arrival:birth},usage:{total_tokens:10}};
const provider=react=>({status:()=>({configured:true}),react});
const req=(s,path,body)=>fetch(s.url+'/api/'+path,{method:'POST',headers:{Authorization:'Bearer '+s.accessToken,'X-Backseat-Client':'studio','Content-Type':'application/json'},body:JSON.stringify(body)});
async function open(t,p=provider(async()=>answer)){
  const dir=await mkdtemp(join(tmpdir(),'tutorial-'));const service=await startServer({port:0,dataDir:dir,localSpeech:false,provider:p});
  service.studio.configure({...service.studio.settings,mode:'live'});
  t.after(async()=>{await service.close();await rm(dir,{recursive:true,force:true});});return {...service,dir};
}
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('timed out');}

test('background first arrival survives tutorial skip and rehearsal stop; duplicate IDs never charge twice',async t=>{
  let release,calls=0;const service=await open(t,provider(async(_args,signal)=>{calls++;return new Promise((r,j)=>{release=r;signal.addEventListener('abort',()=>j(Error('aborted')),{once:true});});}));
  const s=service.studio,initial=s.economy.data.balance;
  assert.equal((await req(service,'tutorial',{action:'begin'})).status,200);
  const id=randomUUID();const response=await req(service,'tutorial/arrival',{requestId:id});assert.equal(response.status,202);
  assert.equal((await response.json()).arrival.status,'pending');assert.equal(s.busy,false);assert.equal(s.economy.data.balance,initial-50);
  assert.equal((await req(service,'tutorial/arrival',{requestId:id})).status,202);
  assert.equal((await req(service,'tutorial/arrival',{requestId:randomUUID()})).status,409);assert.equal(calls,1);
  assert.equal((await req(service,'tutorial/rehearsal',{})).status,200);assert.equal(s.settings.mode,'rehearsal');assert.equal(s.running,true);
  assert.equal((await req(service,'tutorial',{action:'skip'})).status,200);assert.equal(s.running,false);assert.equal(s.settings.mode,'live');
  assert.equal((await req(service,'start',{})).status,409);
  release(answer);await until(()=>s.state().tutorial.arrival.status==='completed');
  assert.equal(s.settings.personas.filter(p=>!p.system).length,1);assert.equal(s.economy.data.balance,initial-50);
  assert.equal((await req(service,'tutorial/arrival',{requestId:id})).status,202);assert.equal(calls,1);
  assert.equal((await req(service,'tutorial/arrival',{requestId:randomUUID()})).status,409);
  assert.equal((await req(service,'start',{})).status,200);
});

test('provider failure refunds once and retry creates one first viewer',async t=>{
  let reject,calls=0;const service=await open(t,provider(async()=>++calls===1?new Promise((_,j)=>reject=j):answer));
  const s=service.studio,initial=s.economy.data.balance;await req(service,'tutorial',{action:'begin'});
  const id=randomUUID();await req(service,'tutorial/arrival',{requestId:id});reject(Error('test failure'));
  await until(()=>s.state().tutorial.arrival.status==='failed');assert.equal(s.economy.data.balance,initial);
  await req(service,'tutorial/arrival',{requestId:id});assert.equal(calls,1);assert.equal(s.economy.data.balance,initial);
  await req(service,'tutorial/arrival',{requestId:randomUUID()});await until(()=>s.state().tutorial.arrival.status==='completed');
  assert.equal(s.economy.data.balance,initial-50);assert.equal(calls,2);
});

test('shutdown aborts background provider and settles before close; progress persists across restart',async t=>{
  let aborted=false;const service=await open(t,provider(async(_args,signal)=>new Promise((_,reject)=>{signal.addEventListener('abort',()=>{aborted=true;reject(Error('shutdown'));},{once:true});})));
  await req(service,'tutorial',{action:'begin'});await req(service,'tutorial',{action:'advance',step:'audience',skip:true});
  await req(service,'tutorial/arrival',{requestId:randomUUID()});await service.close();assert.equal(aborted,true);
  const world=JSON.parse(await readFile(join(service.dir,'world.json'),'utf8'));assert.equal(world.economy.balance,60);assert.equal(Object.values(world.autonomy.receipts)[0].status,'failed');
  const restart=await startServer({port:0,dataDir:service.dir,localSpeech:false,provider:provider(async()=>answer)});
  try{assert.equal(restart.studio.state().tutorial.step,'invite');assert.deepEqual(restart.studio.state().tutorial.skipped,['audience']);assert.equal(restart.studio.state().tutorial.arrival.status,'failed');}
  finally{await restart.close();}
});

test('paused tutorial restores preferences and cannot stop a different rehearsal',async t=>{
  const service=await open(t);const s=service.studio;s.configure({...s.settings,showStreamerMessages:false});
  await req(service,'tutorial',{action:'begin'});await req(service,'tutorial/rehearsal',{});
  assert.equal(s.settings.showStreamerMessages,true);await req(service,'tutorial',{action:'pause'});
  assert.equal(s.settings.mode,'live');assert.equal(s.settings.showStreamerMessages,false);assert.equal(s.state().tutorial.status,'paused');
  await req(service,'tutorial',{action:'begin'});await req(service,'tutorial/rehearsal',{});s.stop();s.start();
  assert.equal((await req(service,'tutorial',{action:'skip'})).status,409);assert.equal(s.running,true);
});

test('new vs existing profiles, unknown steps, and failed progress writes remain truthful',async t=>{
  const service=await open(t);assert.equal(service.studio.state().tutorial.status,'new');
  assert.equal((await req(service,'tutorial',{action:'advance',step:'bogus'})).status,400);
  const store={data:initialTutorial(),save:()=>{throw Error('disk full');}};
  const tutorial=new Tutorial(service.studio,store);assert.throws(()=>tutorial.begin(),/disk full/);assert.equal(store.data.status,'new');
  assert.equal(initialTutorial(true).status,'skipped');
  await req(service,'tutorial',{action:'begin'});
  assert.equal((await req(service,'audience/arrive',{requestId:randomUUID(),firstTutorial:true})).status,400);
});

test('crash-left pending receipt recovers as refund and can be retried after restart',async t=>{
  const service=await open(t);await req(service,'tutorial',{action:'begin'});await service.close();
  const file=join(service.dir,'world.json'),world=JSON.parse(await readFile(file,'utf8')),id=randomUUID();
  world.economy.balance-=50;world.autonomy.receipts[id]={firstTutorial:true,status:'pending',cost:50,at:Date.now(),source:{path:'points',key:'browse',label:'first'}};
  world.economy.purchases.push({id,kind:'arrival',key:id,cost:50,status:'pending',at:Date.now(),fingerprint:'fixture'});await writeFile(file,JSON.stringify(world));
  const restart=await startServer({port:0,dataDir:service.dir,localSpeech:false,provider:provider(async()=>answer)});
  try{assert.equal(restart.studio.economy.data.balance,60);assert.equal(restart.studio.state().tutorial.arrival.status,'failed');await req(restart,'tutorial/arrival',{requestId:randomUUID()});await until(()=>restart.studio.state().tutorial.arrival.status==='completed');assert.equal(restart.studio.economy.data.balance,10);}
  finally{await restart.close();}
});

test('concurrent first invites reserve one job; state exposes only the receipt summary',async t=>{
  let release,calls=0;const service=await open(t,provider(async(_args,signal)=>{calls++;return new Promise((r,j)=>{release=r;signal.addEventListener('abort',()=>j(Error('aborted')),{once:true});});}));
  await req(service,'tutorial',{action:'begin'});
  const responses=await Promise.all(Array.from({length:8},()=>req(service,'tutorial/arrival',{requestId:randomUUID()})));
  assert.equal(responses.filter(r=>r.status===202).length,1);assert.equal(responses.filter(r=>r.status===409).length,7);
  assert.equal(calls,1);assert.equal(service.studio.economy.data.balance,10);
  release(answer);await until(()=>service.studio.state().tutorial.arrival.status==='completed');
  assert.equal(service.studio.settings.personas.filter(p=>!p.system).length,1);
  const summary=service.studio.state().tutorial.arrival;assert.equal(summary.source,undefined);
  assert.ok(!JSON.stringify(service.studio.state()).includes(birth.personality));
});

test('unconnected profiles can skip without generating or spending',async t=>{
  let calls=0;const service=await open(t,{status:()=>({configured:false}),react:async()=>{calls++;return answer;}});
  await req(service,'tutorial',{action:'begin'});
  assert.equal((await req(service,'tutorial/arrival',{requestId:randomUUID()})).status,409);
  assert.equal(service.studio.economy.data.balance,60);assert.equal(calls,0);
  assert.equal((await req(service,'tutorial/rehearsal',{})).status,200);
  assert.equal((await req(service,'tutorial',{action:'skip'})).status,200);
  assert.equal(service.studio.running,false);assert.equal(service.studio.state().tutorial.status,'skipped');
});
