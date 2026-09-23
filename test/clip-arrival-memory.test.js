import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {startServer} from '../server/index.js';
import {WorldData} from '../server/world.js';
import {OpenAIProvider} from '../server/provider.js';
import {arrivalClipSnapshot,recallArrivalClip} from '../server/arrival-clip-memory.js';

const birth={name:'구름구경',personality:'조용한 잡담과 게임 구경을 좋아한다.',values:'서로 존중',sociability:.9,expertise:.3};
const answer=(arrival=null)=>({observation:{game:'Just Chatting',scene:'대화',confidence:1,excitement:0,messages:[],arrival}});
const fake=(react=async args=>answer(args.special?.kind==='audience-arrival'?birth:null))=>({status:()=>({configured:true}),react});
async function folder(){await mkdir('artifacts',{recursive:true});return mkdtemp(resolve('artifacts/clip-arrival-test-'));}
async function open(t,{provider=fake(),dataDir,live=true}={}){
  dataDir ||= await folder();const app=await startServer({port:0,provider,dataDir,localSpeech:false});clearInterval(app.studio.timer);t?.after(()=>app.close());
  const s=app.studio;if(live){s.configure({...s.settings,mode:'live',category:'just-chatting',lurkRatio:0,maxCalls:30,chatPace:3});s.audience.random=()=>0;s.random=()=>.5;s.start();}
  return {...app,dataDir};
}
const clip=(s,extra={})=>s.clips.create({title:'구름찻집 첫 소개',game:'Just Chatting',scene:'스트리머가 기차 안 카페에 구름찻집이라는 별명을 붙였다.',participants:[],messages:[],source:'spectator',creator:{id:'synthetic-author',name:'합성 작성자'},sessionId:randomUUID(),...extra});
const arrive=(s,c,id=randomUUID())=>s.autonomy.arrive(id,{path:'clip',clip:c});
const payload=app=>new OpenAIProvider().payload({settings:app.studio.settings,history:[],speech:'',audience:app.studio.audience.data,offStream:true});
const req=(app,path)=>fetch(app.url+'/api/'+path,{headers:{Authorization:'Bearer '+app.accessToken,'X-Backseat-Client':'studio'}});

test('arrival persists a versioned private encounter, not an event embedded in the permanent persona',async t=>{
  const calls=[],app=await open(t,{provider:fake(async args=>{calls.push(args);return answer(args.special?birth:null);})}),s=app.studio,c=clip(s);
  s.clips.comment(c.id,{name:'플레이어',text:'보지 않은 댓글 암호는 7359'});
  const receipt=await arrive(s,{...c,title:'FORGED_TITLE',scene:'FORGED_SCENE'}),member=s.audience.data.members[receipt.personaId];
  assert.equal(receipt.status,'completed');assert.equal(member.arrivalClip.receiptId,receipt.id);assert.equal(member.arrivalClip.clipId,c.id);
  assert.equal(calls[0].special.clip.interest,'일상 대화와 취향 교류');assert.ok(!JSON.stringify(calls[0]).includes('구름찻집'));assert.ok(!JSON.stringify(calls[0]).includes('FORGED'));
  await s.react({speech:'구름구경님, 어떤 이야기 보고 오셨어요?'});const packet=calls[1].viewerContext[receipt.personaId];
  assert.equal(packet.arrivalClipMemory.title,c.title);assert.equal(packet.arrivalClipMemory.experience,'read-discovery-summary');assert.deepEqual(packet.clipMemories,[]);assert.ok(!JSON.stringify(calls[1]).includes('7359'));assert.ok(!JSON.stringify(calls[1]).includes('receiptId'));
  assert.deepEqual(s.knowledge.entries,{});
  // Reacting can advance the live presence clock. Reading the clip must not
  // grant viewing time from before this viewer's actual admission.
  const elapsedSinceAdmission=Math.max(0,(s.now()-member.joinedAt)/1000);
  assert.ok(member.seconds>=0&&member.seconds<=elapsedSinceAdmission+0.1);
  const disk=JSON.parse(await readFile(join(app.dataDir,'world.json'),'utf8'));assert.equal(disk.audience.members[receipt.personaId].arrivalClip.hash,member.arrivalClip.hash);
});

test('restart and nickname changes preserve the encounter only for the stable viewer ID',async()=>{
  let input,app=await open(null,{provider:fake(async args=>{input=args;return answer(args.special?birth:null);})});const dataDir=app.dataDir;
  try{
    const s=app.studio,c=clip(s),first=await arrive(s,c),second=await s.autonomy.arrive(randomUUID(),{path:'broadcast'});
    s.world.change(d=>{d.settings.personas.find(p=>p.id===first.personaId).name='돌아온구름';d.audience.members[first.personaId].aliases=[{name:birth.name,at:Date.now()}];});
    await app.close();app=await open(null,{dataDir,provider:fake(async args=>{input=args;return answer();})});
    await app.studio.react({speech:'돌아온구름님은 어떤 소개 보고 들어오셨죠?'});
    assert.equal(input.viewerContext[first.personaId].arrivalClipMemory.scene,c.scene);assert.equal(input.viewerContext[second.personaId].arrivalClipMemory,null);assert.equal(input.viewerContext[first.personaId].previous,null);assert.equal(input.viewerContext[first.personaId].chatHistory.some(m=>m.personaId!=='streamer'),false);
    assert.ok(!input.audience.members.some(m=>m.arrivalClip));
    for(const path of ['state','export']){const text=JSON.stringify(await(await req(app,path)).json());assert.ok(!text.includes('arrivalClip'));assert.ok(!text.includes('read-discovery-summary'));}
    const full=payload(app).input[0].content[0].text;assert.ok(!full.includes('arrivalClip'));assert.ok(!full.includes('receiptId'));
  }finally{await app.close();}
});

test('deleting or editing a source prevents old framing from being recalled; new comments remain unread',async t=>{
  const app=await open(t),s=app.studio,c=clip(s),r=await arrive(s,c),reading=s.audience.data.members[r.personaId].arrivalClip;
  s.clips.comment(c.id,{name:'플레이어',text:'추가된 댓글'});assert.equal(s.clips.recallArrival(reading).scene,c.scene);
  s.clips.change(data=>{data[0].scene='새로 고친, 읽지 않은 소개';});assert.equal(s.clips.recallArrival(reading),null);
  s.clips.remove(c.id);assert.equal(s.clips.recallArrival(reading),null);assert.equal(s.audience.data.members[r.personaId].arrivalClip.clipId,c.id);
});

for(const mutation of ['delete','edit'])test(`source ${mutation} during generation cancels admission and leaves no phantom memory`,async t=>{
  let release;const app=await open(t,{provider:fake(()=>new Promise(r=>release=r))}),s=app.studio,c=clip(s),id=randomUUID();const pending=arrive(s,c,id);
  if(mutation==='delete')s.clips.remove(c.id);else s.clips.change(data=>{data[0].title='소개가 바뀜';});
  release(answer(birth));await assert.rejects(pending,/핫클립|소개/);assert.equal(s.settings.personas.filter(p=>!p.system).length,0);assert.ok(!Object.values(s.audience.data.members).some(m=>m.arrivalClip));assert.equal(s.world.data.autonomy.receipts[id].status,'failed');assert.equal(s.economy.data.balance,200);
});

test('new comments during generation do not invalidate a description-only encounter or grant comment knowledge',async t=>{
  let release;const app=await open(t,{provider:fake(()=>new Promise(r=>release=r))}),s=app.studio,c=clip(s);const pending=arrive(s,c);
  s.clips.comment(c.id,{name:'플레이어',text:'처리 중 새 댓글 9988'});release(answer(birth));const r=await pending;
  assert.equal(s.clips.recallArrival(s.audience.data.members[r.personaId].arrivalClip).title,c.title);assert.deepEqual(s.clips.recall(r.personaId,'9988'),[]);
});

test('world commit failure leaves neither a viewer nor a receipt grant and the held settlement fails once',async t=>{
  const app=await open(t),s=app.studio,c=clip(s),save=s.world.save;let failed=false;
  s.world.save=value=>{if(!failed&&Object.values(value.audience.members).some(m=>m.arrivalClip)){failed=true;throw Error('synthetic world write failed');}save(value);};
  const id=randomUUID();await assert.rejects(arrive(s,c,id),/write failed/);assert.equal(failed,true);assert.equal(s.world.data.autonomy.receipts[id].status,'failed');assert.equal(s.economy.data.balance,200);assert.ok(!Object.values(s.audience.data.members).some(m=>m.arrivalClip));
  const calls=s.calls;assert.equal((await arrive(s,c,id)).status,'failed');assert.equal(s.calls,calls);
});

test('legacy clip IDs and other source paths do not fabricate a reading',async t=>{
  const app=await open(t),s=app.studio,c=clip(s);const r=await s.autonomy.arrive(randomUUID(),{path:'broadcast'});
  s.world.change(d=>{d.audience.members[r.personaId].origin.clipId=c.id;});assert.equal(s.clips.recallArrival(s.audience.data.members[r.personaId].arrivalClip),null);
  const before=s.calls;await assert.rejects(s.autonomy.arrive(randomUUID(),{path:'clip',clip:{id:randomUUID()}}),/핫클립/);await assert.rejects(s.autonomy.arrive(randomUUID(),{path:'points',clip:c}),/경로/);assert.equal(s.calls,before);
});

test('schema validates actor, source, completed settlement, receipt identity and encounter time together',async t=>{
  const app=await open(t),s=app.studio,c=clip(s),r=await arrive(s,c),valid=structuredClone(s.world.data);assert.ok(WorldData.safeParse(valid).success);
  for(const change of [d=>delete d.autonomy.receipts[r.id],d=>d.autonomy.receipts[r.id].status='pending',d=>d.autonomy.receipts[r.id].personaId='other',d=>d.autonomy.receipts[r.id].source.path='points',d=>d.autonomy.receipts[r.id].source.clipId=randomUUID(),d=>d.audience.members[r.personaId].arrivalClip.receivedAt=0,d=>d.audience.members[r.personaId].arrivalClip.version=99]){const invalid=structuredClone(valid);change(invalid);assert.equal(WorldData.safeParse(invalid).success,false);}
  const reading=valid.audience.members[r.personaId].arrivalClip;assert.equal(s.clips.recallArrival(reading,reading.receivedAt-1),null);
});

test('bounded descriptions retain fiction and never contain chat, donation identity, media flags or private metadata',()=>{
  const raw={id:randomUUID(),title:'x'.repeat(99)+'😀😀',game:'Just Chatting',scene:'😀'.repeat(500),source:'season-chapter',messages:[{text:'PRIVATE_DONOR'}],video:true,readings:[{hash:'PRIVATE_READING'}]},snapshot=arrivalClipSnapshot(raw);
  const reading={version:1,clipId:raw.id,receiptId:randomUUID(),receivedAt:1000,hash:snapshot.hash};const out=recallArrivalClip([raw],reading,2000);
  assert.equal(out.fictional,true);assert.equal(out.excerpt,true);assert.ok(out.title.length<=100&&out.scene.length<=600&&out.title.isWellFormed()&&out.scene.isWellFormed());assert.ok(!JSON.stringify(out).includes('PRIVATE'));assert.equal(out.video,undefined);
});

for(const phase of ['held','completed'])test(`abrupt process exit at ${phase} keeps admission and encounter atomic after disk restart`,async t=>{
  const dataDir=await folder(),requestId=randomUUID(),marker=phase==='held'?73:74;
  const output=await new Promise((ok,no)=>{const p=spawn(process.execPath,['test/fixtures/clip-arrival-crash.mjs',dataDir,phase,requestId],{cwd:process.cwd(),windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);p.once('error',no);p.once('close',code=>code===marker?ok(stdout):no(Error('child '+code+' '+stderr)));});
  assert.match(output,new RegExp('"phase":"'+phase+'"'));const app=await open(t,{dataDir,live:false}),s=app.studio,receipt=s.world.data.autonomy.receipts[requestId];
  assert.equal(receipt.status,phase==='held'?'failed':'completed');const members=Object.values(s.audience.data.members).filter(m=>m.arrivalClip);assert.equal(members.length,phase==='held'?0:1);assert.equal(s.economy.data.balance,200);
  if(members.length)assert.equal(s.clips.recallArrival(members[0].arrivalClip).title,'중단 시험 클립');assert.equal(s.calls,0);
});
