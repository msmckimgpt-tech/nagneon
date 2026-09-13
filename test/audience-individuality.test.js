import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {arrivalIndividuality} from '../server/audience-individuality.js';
import {startServer} from '../server/index.js';
import {OpenAIProvider} from '../server/provider.js';
import {defaults} from '../shared/defaults.js';

function seeded(seed){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
async function directory(){await mkdir('artifacts',{recursive:true});return mkdtemp(join(resolve('artifacts'),'individuality-test-'));}
const person={id:'old',name:'PRIVATE_NAME',role:'viewer',enabled:true,personality:'PRIVATE_BIO 종이 책갈피와 수첩 꾸미기. 조용히 듣다가 궁금한 것을 질문한다.',values:'PRIVATE_VALUE 서로 다른 취향을 존중한다.',sociability:.58,expertise:.32};
const answer=brief=>({observation:{game:'Just Chatting',scene:'',confidence:0,excitement:0,messages:[],arrival:{name:'새로운별명',personality:brief.interest+'에 관심을 가지며 '+brief.conversation,values:brief.preference,sociability:brief.sociability,expertise:brief.expertise}},usage:{total_tokens:1}});

test('concentrated roster softly reduces repeat interests without forbidding shared taste',()=>{
  const crowded=Array.from({length:20},()=>({...person}));
  const sample=people=>{const random=seeded(52);return Array.from({length:3000},()=>arrivalIndividuality(people,'clip',random));};
  const empty=sample([]),full=sample(crowded),craft=n=>n.filter(x=>x.interest==='손으로 만드는 작은 것들').length;
  assert.ok(craft(empty)>150);assert.ok(craft(full)<craft(empty)/10);
  assert.ok(new Set(full.map(x=>x.interest)).size>=10);
  assert.ok(new Set(full.map(x=>x.sociability)).size>30);
  assert.deepEqual(arrivalIndividuality(crowded,'clip',seeded(1)),arrivalIndividuality(JSON.parse(JSON.stringify(crowded)),'clip',seeded(1)));
  // At the exact weighted interval a shared interest remains a valid choice.
  assert.ok(Array.from({length:10000},(_,i)=>arrivalIndividuality(crowded,'clip',()=>i/10000)).some(x=>x.interest==='손으로 만드는 작은 것들'));
});

test('creation brief contains no identity, private text, notes or witnessed facts',()=>{
  const secret={...person,note:'PRIVATE_NOTE',memories:['PRIVATE_MEMORY'],arrivalClip:{scene:'PRIVATE_CLIP'},aliases:['PRIVATE_ALIAS']};
  const one=arrivalIndividuality([secret],'fan',seeded(6));
  const wire=JSON.stringify(one);assert.ok(!wire.includes('PRIVATE_'));assert.ok(wire.length<1000);
  assert.deepEqual(one,arrivalIndividuality([person,{...secret,system:true}],'fan',seeded(6)));
  for(const bad of [NaN,Infinity,-1,1]){const brief=arrivalIndividuality([],'browse',()=>bad);assert.ok(brief.interest);assert.ok(brief.sociability>=0&&brief.sociability<=1);assert.ok(brief.expertise>=0&&brief.expertise<=1);}
});

test('discovery changes social and game-expertise tendency without determining an entire person',()=>{
  const sample=source=>{const random=seeded(84);return Array.from({length:2000},()=>arrivalIndividuality([],source,random));};
  const browse=sample('browse'),guide=sample('guide'),clip=sample('clip'),average=(xs,key)=>xs.reduce((n,x)=>n+x[key],0)/xs.length;
  assert.ok(average(guide,'expertise')>average(browse,'expertise')+.08);
  assert.ok(average(clip,'sociability')>average(browse,'sociability')+.06);
  assert.deepEqual(new Set(guide.map(x=>x.interest)),new Set(browse.map(x=>x.interest)));
});

test('a real admission generates once, persists only the person and preserves hidden-profile access',async t=>{
  const dataDir=await directory();let calls=0,randomCalls=0,input;
  const provider={status:()=>({configured:true}),react:async args=>{calls++;input=args;return answer(args.special.individuality);}};
  let service=await startServer({port:0,dataDir,localSpeech:false,provider});t.after(()=>service?.close());
  const s=service.studio;clearInterval(s.timer);s.configure({...s.settings,mode:'live',lurkRatio:0});
  s.random=()=>{randomCalls++;return .4;};s.start();assert.equal(calls,0);assert.equal(s.settings.personas.filter(p=>!p.system).length,0);
  const id=randomUUID(),receipt=await s.autonomy.arrive(id);const after=randomCalls;
  assert.equal(receipt.status,'completed');assert.equal(calls,1);assert.deepEqual(input.settings.personas,[]);assert.equal(input.audience,undefined);assert.equal(input.special.source.path,'points');
  assert.deepEqual(input.special.usedNames,s.settings.personas.filter(p=>p.system).map(p=>p.name));
  assert.equal((await s.autonomy.arrive(id)).personaId,receipt.personaId);assert.equal(randomCalls,after);assert.equal(calls,1);
  assert.equal(s.world.publicSettings().personas.find(p=>p.id===receipt.personaId).personality,undefined);
  const disk=await readFile(join(dataDir,'world.json'),'utf8');assert.ok(!disk.includes('"individuality"'));assert.equal(JSON.parse(disk).settings.personas.find(p=>p.id===receipt.personaId).personality,input.special.individuality.interest+'에 관심을 가지며 '+input.special.individuality.conversation);
  await service.close();service=await startServer({port:0,dataDir,localSpeech:false,provider});clearInterval(service.studio.timer);
  assert.equal((await service.studio.autonomy.arrive(id)).personaId,receipt.personaId);assert.equal(calls,1);assert.equal(service.studio.economy.data.balance,10);
});

test('failed composition refunds the hold without keeping an unseen character or retrying the model',async t=>{
  const dataDir=await directory();let calls=0;
  const service=await startServer({port:0,dataDir,localSpeech:false,provider:{status:()=>({configured:true}),react:async args=>{calls++;assert.ok(args.special.individuality);throw Error('synthetic model failure');}}});t.after(()=>service.close());
  const s=service.studio;clearInterval(s.timer);s.configure({...s.settings,mode:'live'});s.start();const id=randomUUID();
  await assert.rejects(s.autonomy.arrive(id),/synthetic model failure/);assert.equal(s.economy.data.balance,60);assert.equal(s.settings.personas.filter(p=>!p.system).length,0);
  assert.equal((await s.autonomy.arrive(id)).status,'failed');assert.equal(calls,1);
  assert.ok(!(await readFile(join(dataDir,'world.json'),'utf8')).includes('"individuality"'));
});

test('extra creation directions are absent from normal live and private interview prompts',()=>{
  const provider=new OpenAIProvider({}),base={settings:defaults,history:[],speech:''};
  for(const special of [undefined,{kind:'interview'}])assert.ok(!provider.payload({...base,special}).instructions.includes('이번 첫 만남에서만 사용하는 내부 창작 방향'));
  assert.ok(provider.payload({...base,special:{kind:'audience-arrival'}}).instructions.includes('이번 첫 만남에서만 사용하는 내부 창작 방향'));
});
