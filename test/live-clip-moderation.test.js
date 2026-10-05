import test from 'node:test';
import assert from 'node:assert/strict';
import {createClipFixtureFiles} from './lib/clip-moderation-fixture-paths.js';
import {Studio} from '../server/studio.js';
import {Clips} from '../server/clips.js';
import {Audience} from '../server/audience.js';
import {Economy} from '../server/economy.js';
import {World,migrateWorld,WorldData} from '../server/world.js';
import {Settings,Observation} from '../server/schema.js';
import {ClipsData} from '../server/data-schema.js';
import {defaults} from '../shared/defaults.js';

const T=1_000_000;
function settingsFor(words){
  return Settings.parse({...structuredClone(defaults),mode:'live',category:'just-chatting',gameId:'auto',autoHighlights:true,communityActivityEnabled:false,memesEnabled:false,contextualTranscription:false,pointsEnabled:false,lurkRatio:0,intervalSeconds:5,slowModeSeconds:0,chatPace:3,blockedWords:words,discovery:{enabled:false},personas:defaults.personas.filter(p=>['momo','new','luna'].includes(p.id))});
}
function fixture(t,words,{disk=false}={}){
  let at=T,output,calls=0,clipSaves=0;
  const files=disk?createClipFixtureFiles():null,folder=files?.folder;
  const persist=(name,data)=>{files?.write(name,data);};
  const settings=settingsFor(words),members={};
  for(const p of settings.personas)members[p.id]={sessions:1,seconds:600,recognized:0,affinity:.8,peers:{},memories:[],origin:{key:'direct',label:'합성 기존 관객',firstSeenAt:1}};
  const initialEconomy=new Economy(undefined,()=>{},()=>at);initialEconomy.ensureWallets(settings.personas);
  const data=migrateWorld(settings,{members,lore:[],posts:[]},initialEconomy.data);data.socialWorld.preferences.enabled=false;
  const world=new World(data,d=>persist('world.json',d));
  const audience=new Audience(world.data.audience,d=>world.part('audience',d),()=>.5);
  const economy=new Economy(world.data.economy,d=>world.part('economy',d),()=>at);
  const clips=new Clips({now:()=>at,save:d=>{ClipsData.parse(d);clipSaves++;persist('clips.json',d);}});
  const provider={status:()=>({configured:true,label:'synthetic-stub'}),react:async()=>{calls++;return {observation:structuredClone(output),usage:{total_tokens:0}};}};
  const studio=new Studio({settings,provider,world,audience,economy,clips,now:()=>at,random:()=>.5,persist:d=>world.part('settings',d)});
  clearInterval(studio.timer);
  t.after(async()=>{try{await studio.close();await studio.culture.close();await studio.clipPerception.close();}finally{files?.remove();}});
  studio.start();at=T+30000;
  return {studio,clips,world,folder,files,get calls(){return calls;},get clipSaves(){return clipSaves;},setTime(value){at=value;},async react(observation){at=Math.max(at,studio.lastRequest+2000);output=Observation.parse(observation);const before=structuredClone(output);const result=await studio.react({speech:'합성 방송 장면입니다'});assert.equal(result.ok,true);assert.deepEqual(output,before);return result;}};
}
function observation(title,reason,signature='synthetic-one'){
  return {game:'Just Chatting',scene:'관객이 함께 본 합성 장면',confidence:.8,excitement:.2,messages:[],clipPicks:[{personaId:'momo',title,reason,signature,soundId:'',speechId:''}]};
}

const matrix=[
  ['exact title',['SYNTHBLOCK'],'SYNTHBLOCK','합성 이유',true],
  ['exact reason',['SYNTHBLOCK'],'합성 제목','SYNTHBLOCK',true],
  ['lowercase title',['SYNTHBLOCK'],'synthblock','합성 이유',true],
  ['lowercase reason',['SYNTHBLOCK'],'합성 제목','synthblock',true],
  ['fullwidth title',['SYNTHBLOCK'],'ＳＹＮＴＨＢＬＯＣＫ','합성 이유',true],
  ['fullwidth reason',['SYNTHBLOCK'],'합성 제목','ＳＹＮＴＨＢＬＯＣＫ',true],
  ['fullwidth setting against title',['ＳＹＮＴＨＢＬＯＣＫ'],'SYNTHBLOCK','합성 이유',true],
  ['fullwidth setting against reason',['ＳＹＮＴＨＢＬＯＣＫ'],'합성 제목','SYNTHBLOCK',true],
  ['similar benign word',['SYNTHBLOCK'],'SYNTHCLOCK','합성 이유',false],
  ['no punctuation elision',['SYNTHBLOCK'],'SYNTH-BLOCK','합성 이유',false],
  ['no whitespace elision',['SYNTHBLOCK'],'SYNTH','BLOCK',false],
  ['existing field separator',['SYNTH BLOCK'],'synth','block',true],
  ['empty blocked word list',[],'SYNTHBLOCK','합성 이유',false],
];
for(const [label,words,title,reason,blocked] of matrix){
  test('spectator clip moderation: '+label,async t=>{
    const f=fixture(t,words),input=observation(title,reason);
    const text=label.includes('reason')?reason:label==='existing field separator'?title+' '+reason:title;
    input.messages=[{personaId:'momo',text,kind:'chat',spoiler:false}];
    await f.react(input);
    assert.equal(f.calls,1,'one shared audience response only');
    assert.equal(f.studio.queue.some(m=>m.personaId==='momo'&&m.text===text),!blocked,'same acceptance as existing live chat');
    assert.equal(f.clips.data.length,blocked?0:1);
    assert.equal(f.clipSaves,blocked?0:1,'only accepted clips persist');
    if(!blocked){const clip=ClipsData.parse(structuredClone(f.clips.data))[0];assert.equal(clip.title,title);assert.equal(clip.creator.reason,reason);assert.equal(clip.source,'spectator');assert.equal(clip.creator.id,'momo');assert.equal(clip.observedAt,T+30000);assert.equal(clip.startedAt,T);assert.equal(clip.sessionId,f.studio.sessionId);assert.deepEqual(clip.participants.map(p=>p.id),['momo','new','luna']);}
  });
}

test('rejected title and reason leave the next valid choice available; accepted choices retain cooldown',async t=>{
  const f=fixture(t,['SYNTHBLOCK']);
  for(const input of [observation('synthblock','합성 이유'),observation('합성 제목','ＳＹＮＴＨＢＬＯＣＫ')]){await f.react(input);assert.deepEqual(f.clips.data,[]);assert.equal(f.clipSaves,0);}
  await f.react(observation('SYNTHCLOCK','합성 원문 이유'));assert.equal(f.clips.data.length,1);assert.equal(f.clipSaves,1);
  const original=structuredClone(f.clips.data[0]);
  f.setTime(T+35000);await f.react(observation('새 정상 선택','아직 같은 관객 쿨다운','synthetic-two'));assert.deepEqual(f.clips.data,[original]);assert.equal(f.clipSaves,1);
  f.setTime(original.createdAt+300000);await f.react(observation('새 정상 선택','같은 관객 쿨다운 경계','synthetic-two'));assert.equal(f.clips.data.length,2);assert.equal(f.clipSaves,2);assert.equal(f.calls,5);
});

test('accepted Unicode originals and metadata survive ordinary save and world/clip store reload',async t=>{
  const f=fixture(t,['SYNTHBLOCK'],{disk:true}),title='ＳＹＮＴＨ　ＣＬＯＣＫ',reason='MiXeD 원문 이유';
  await f.react(observation(title,reason));
  assert.equal(f.clipSaves,1);const before=structuredClone(f.clips.data);
  await f.studio.stop();
  const clips=ClipsData.parse(JSON.parse(f.files.read('clips.json'))),world=WorldData.parse(JSON.parse(f.files.read('world.json')));
  const restarted=new Clips({data:clips,now:()=>T+360000}),restartedWorld=new World(world);
  assert.deepEqual(restarted.data,before);assert.deepEqual(restartedWorld.data,world);assert.equal(restarted.get(before[0].id).title,title);assert.equal(restarted.get(before[0].id).creator.reason,reason);assert.equal(restartedWorld.data.settings.blockedWords[0],'SYNTHBLOCK');assert.equal(before[0].sessionId,f.studio.sessionId);
  assert.equal(f.calls,1,'save/reload does not request another AI response');
});
