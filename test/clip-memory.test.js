import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import {renameSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Clips,ClipFeatures} from '../server/clips.js';
import {clipTextSnapshot} from '../server/clip-memory.js';
import {ClipsData} from '../server/data-schema.js';
import {JsonStore} from '../server/storage.js';
import {Studio} from '../server/studio.js';
import {startServer} from '../server/index.js';
import {defaults} from '../shared/defaults.js';
import {donationMessage} from '../server/chat-attention.js';
import {seedMetAudience} from './helpers/met-audience.js';

const T=Date.now()-100000;
const message=(text,extra={})=>({id:randomUUID(),time:T,personaId:'streamer',name:'플레이어',kind:'streamer',text,...extra});
const base=(extra={})=>({title:'기차 소리 별명',game:'퍼즐',scene:'밤에 기차 소리에 별명을 붙였다.',sessionId:randomUUID(),participants:[{id:'momo',name:'모모'}],messages:[message('기차 소리가 들렸어요')],source:'spectator',creator:{id:'momo',name:'모모'},...extra});
const reply=(id='new',text='이야기 잘 읽었어요')=>({personaId:id,text,kind:'chat',spoiler:false});
const result=messages=>({observation:{game:'Just Chatting',scene:'대화',confidence:1,excitement:0,messages,positiveMoment:{positive:false,impact:0,reason:'',signature:'',supporters:[],donations:[]}},usage:{total_tokens:1}});
const fake=(react=async()=>result([reply()]))=>({status:()=>({configured:true}),react});
const allItems=rows=>rows.flatMap(c=>c.items);
async function folder(){await mkdir('artifacts',{recursive:true});return mkdtemp(resolve('artifacts/clip-memory-test-'));}
function fixture(t,{provider=fake(),save=()=>{}}={}){
  let now=T+1000;const clips=new Clips({now:()=>now,save}),s=new Studio({provider,clips,settings:{...defaults,mode:'live',maxCalls:50,discovery:{...defaults.discovery,enabled:false}},now:()=>now,random:()=>.5});clearInterval(s.timer);s.ai.update({features:{clip:true}});s.start();t.after(()=>s.close());
  const c=clips.create(base());return {s,clips,c,tick:()=>now+=1000};
}

test('autonomous reading with retired HTTP trigger survives restart/rename into only that viewers live context and deletion removes the source',async()=>{
  const dir=await folder();let service,args;const provider=fake(async a=>{args=a;return result(a.special?[reply()]:[]);});
  try{
    service=await startServer({port:0,dataDir:dir,provider,localSpeech:false});seedMetAudience(service.studio);const s=service.studio;s.social.preferences({enabled:false});s.ai.update({background:true});clearInterval(s.timer);s.configure({...s.settings,mode:'live',category:'just-chatting',chatPace:4,lurkRatio:0,maxCalls:30});s.start();
    const gift=donationMessage({id:randomUUID(),at:T,amount:24,anonymous:true,text:'퍼즐 해결 축하'}),c=s.clips.create(base({messages:[gift]}));
    const parent=s.clips.comment(c.id,{name:'플레이어',text:'기차 소리 별명은 야간열차로 할게요'});
    const headers={Authorization:'Bearer '+service.accessToken,'X-Backseat-Client':'studio','Content-Type':'application/json'};
    assert.equal((await fetch(service.url+`/api/clips/${c.id}/react`,{method:'POST',headers:{'Content-Type':'application/json','X-Backseat-Client':'studio'},body:JSON.stringify({targets:['new']})})).status,401);
    const response=await fetch(service.url+`/api/clips/${c.id}/react`,{method:'POST',headers,body:JSON.stringify({targets:['new'],parentId:parent.id})});assert.equal(response.status,410);
    s.now=()=>Date.now()+70000;s.random=()=>.9999;s.pump();assert.ok(s.communityActivity.active);await s.communityActivity.active.promise;s.now=Date.now;assert.equal(s.clips.get(c.id).comments.length,2);
    assert.equal(args.audience.members.find(m=>m.id==='new').attended,false);assert.equal(s.journal.recall('new','야간열차').length,0);
    for(const path of [`/api/clips/${c.id}`,'/api/state','/api/export'])assert.ok(!(await (await fetch(service.url+path,{headers})).text()).includes('metadataHash'),'public surfaces do not expose reading receipts');
    const unseen=s.clips.comment(c.id,{name:'플레이어',text:'새로 올린 비밀번호는 7359예요'});
    s.world.change(d=>{d.settings.personas.find(p=>p.id==='new').name='별명바뀐관객';});s.stop();await service.close();
    service=await startServer({port:0,dataDir:dir,provider,localSpeech:false});clearInterval(service.studio.timer);service.studio.audience.random=()=>.5;service.studio.start();
    await service.studio.react({speech:'별명바뀐관객님, 기차 소리 별명 뭐였죠?'});
    const remembered=args.viewerContext.new.clipMemories;assert.ok(allItems(remembered).some(m=>m.text.includes('야간열차')&&m.experience==='read-clip-comment'));assert.ok(allItems(remembered).some(m=>m.donation?.amount===24&&m.personaId==='anonymous'));assert.ok(allItems(remembered).some(m=>m.experience==='own-clip-comment'));
    assert.ok(!allItems(remembered).some(m=>m.id===unseen.id));assert.deepEqual(service.studio.clips.recall('pop','기차 소리'),[]);assert.deepEqual(args.viewerContext.new.recollections,[]);
    const laterHeaders={Authorization:'Bearer '+service.accessToken,'X-Backseat-Client':'studio'};
    assert.equal((await fetch(service.url+`/api/clips/${c.id}/comments/${parent.id}`,{method:'DELETE',headers:laterHeaders})).status,200);
    assert.ok(!allItems(service.studio.clips.recall('new','야간열차')).some(m=>m.id===parent.id));
    assert.equal((await fetch(service.url+`/api/clips/${c.id}`,{method:'DELETE',headers:laterHeaders})).status,200);
    await service.close();service=await startServer({port:0,dataDir:dir,provider,localSpeech:false});assert.deepEqual(service.studio.clips.recall('new','기차 소리'),[]);
    assert.equal(JSON.parse(await readFile(join(dir,'clips.json'),'utf8')).length,0);
  }finally{await service?.close();}
});

test('reading receipt and comments share one durable save and a failed rename cannot grant knowledge',async t=>{
  const dir=await folder(),file=join(dir,'clips.json');let fail=false;
  const store=new JsonStore(file,{validate:v=>ClipsData.parse(v),initial:()=>[],fs:{renameSync:(from,to)=>{if(fail&&to===file)throw Error('simulated clip commit failure');renameSync(from,to);}}});store.load();
  const {s,clips,c}=fixture(t,{save:v=>store.save(v)});clips.comment(c.id,{name:'플레이어',text:'별명은 야간열차'});const before=structuredClone(clips.data);fail=true;
  await assert.rejects(s.clipFeatures.comments({id:c.id,targets:['new']}),/simulated clip commit failure/);assert.deepEqual(clips.data,before);assert.deepEqual(clips.recall('new','야간열차'),[]);
  fail=false;assert.deepEqual(new Clips({data:new JsonStore(file,{validate:v=>ClipsData.parse(v)}).load()}).data,JSON.parse(JSON.stringify(before)));
  await s.clipFeatures.comments({id:c.id,targets:['new']});const restored=new Clips({data:new JsonStore(file,{validate:v=>ClipsData.parse(v)}).load()});assert.ok(allItems(restored.recall('new','야간열차')).some(m=>m.text.includes('야간열차')));
});

test('deleting any read comment during inference rejects the whole new response, even when it is not the reply target',async t=>{
  let release;const wait=new Promise(r=>release=r),{s,clips,c}=fixture(t,{provider:fake(async()=>wait)});const parent=clips.comment(c.id,{name:'플레이어',text:'읽는 중인 말'});
  const pending=s.clipFeatures.comments({id:c.id,targets:['new']});clips.removeComment(c.id,parent.id);release(result([reply()]));
  await assert.rejects(pending,/읽던 댓글/);assert.equal(clips.data[0].readings,undefined);assert.equal(clips.get(c.id).comments.length,1);assert.equal(s.busy,false);
});

test('unseen additions and other generated replies do not join an earlier reading snapshot',async t=>{
  let release;const wait=new Promise(r=>release=r),{s,clips,c,tick}=fixture(t,{provider:fake(async()=>wait)});const parent=clips.comment(c.id,{name:'플레이어',text:'먼저 읽은 별명은 야간열차'});
  const pending=s.clipFeatures.comments({id:c.id,targets:['new','pop']});tick();const unseen=clips.comment(c.id,{name:'플레이어',text:'나중에 추가한 암호 7359'});release(result([reply('new','내가 쓴 하나'),reply('pop','내가 쓴 둘')]));await pending;
  const rows=allItems(clips.recall('new','별명'));assert.ok(rows.some(m=>m.id===parent.id));assert.ok(!rows.some(m=>m.id===unseen.id||m.text==='내가 쓴 둘'));assert.ok(rows.some(m=>m.text==='내가 쓴 하나'&&m.experience==='own-clip-comment'));
  assert.ok(!JSON.stringify(clips.get(c.id)).includes('readings'));assert.ok(!JSON.stringify(clips.list()).includes('readings'));
});

test('an old reply target and ancestors outside the recent window are read, while deleted text is absent',async t=>{
  let args;const {s,clips,c,tick}=fixture(t,{provider:fake(async a=>{args=a;return result([reply()]);})});const parent=clips.comment(c.id,{name:'플레이어',text:'야간열차의 원래 별명'}),child=clips.comment(c.id,{name:'플레이어',text:'별명을 유지하자',parentId:parent.id});
  for(let i=0;i<40;i++){tick();clips.comment(c.id,{name:'플레이어',text:'다른 이야기 '+i});}const deleted=clips.comment(c.id,{name:'플레이어',text:'지워야 할 원문'});clips.removeComment(c.id,deleted.id);
  await s.clipFeatures.comments({id:c.id,parentId:child.id,targets:['new']});const input=args.special.clip.comments;assert.ok(input.some(m=>m.id===parent.id));assert.ok(input.some(m=>m.id===child.id));assert.ok(!input.some(m=>m.id===deleted.id));assert.ok(input.length<=34);
  assert.ok(allItems(clips.recall('new','야간열차 원래 별명')).some(m=>m.id===parent.id));
});

test('legacy comments prove only their authors own words and never grant surrounding knowledge',()=>{
  const clips=new Clips({now:()=>T+1000}),c=clips.create(base());clips.comment(c.id,{name:'플레이어',text:'외부 관객에게 안 보일 숨은 단어'});const own=clips.comment(c.id,{name:'옛날이름',personaId:'new',kind:'ai',text:'제가 쓴 댓글이에요'});
  const found=clips.recall('new','댓글',T+2000);assert.equal(found[0].scene,undefined);assert.equal(found[0].title,undefined);assert.deepEqual(found[0].items.map(m=>m.id),[own.id]);assert.equal(found[0].items[0].experience,'own-clip-comment');assert.deepEqual(clips.recall('pop','댓글'),[]);
});

test('a first tracked reading does not erase an older authored comment outside its recent window',async t=>{
  const {s,clips,c,tick}=fixture(t);const own=clips.comment(c.id,{name:'예전이름',personaId:'new',kind:'ai',text:'제 취향은 빗소리예요'});
  for(let i=0;i<40;i++){tick();clips.comment(c.id,{name:'플레이어',text:'다른 이야기 '+i});}
  assert.ok(allItems(clips.recall('new','빗소리 취향')).some(m=>m.id===own.id));await s.clipFeatures.comments({id:c.id,targets:['new']});
  assert.ok(allItems(clips.recall('new','빗소리 취향')).some(m=>m.id===own.id&&m.experience==='own-clip-comment'));
});

test('source version changes cannot silently rewrite a viewers memory or grant future reads',async t=>{
  const {s,clips,c}=fixture(t);const original=clips.comment(c.id,{name:'플레이어',text:'별명은 야간열차'});await s.clipFeatures.comments({id:c.id,targets:['new']});
  clips.data[0].comments.find(m=>m.id===original.id).text='읽지 않은 새로운 별명';assert.ok(!JSON.stringify(clips.recall('new','별명')).includes('읽지 않은'));
  clips.data[0].scene='읽지 않은 새 장면';assert.deepEqual(clips.recall('new','별명'),[]);
  const data=ClipsData.parse(clips.data);data[0].readings[0].readAt=Date.now()+86400000;assert.deepEqual(new Clips({data}).recall('new','별명'),[]);
});

test('fiction, anonymous public donation and uncertain STT remain distinct in clip memory',async t=>{
  const {s,clips}=fixture(t),gift=donationMessage({id:randomUUID(),at:T,amount:24,anonymous:true,text:'가상 우주선 축하'});gift.donation.privateDonorId='NEVER-EXPOSE';
  const spoken=message('우주선 이름은 바미야',{fictional:true,transcription:{source:'microphone',correction:{text:'우주선 이름은 밤이야',confidence:.91,reason:'합성 교정',at:T}}});
  const c=clips.create(base({source:'directed-episode',messages:[gift,spoken]}));await s.clipFeatures.comments({id:c.id,targets:['new']});
  const rows=clips.recall('new','우주선'),words=allItems(rows);assert.equal(rows[0].fictional,true);assert.ok(words.some(m=>m.text===spoken.text&&m.fictional&&m.transcriptionCorrection.confidence===.91));assert.ok(words.some(m=>m.personaId==='anonymous'&&m.donation.amount===24));assert.ok(!JSON.stringify(rows).includes('NEVER-EXPOSE'));
});

test('reading schema rejects corrupt identity/reference graphs and accepts old clips without receipts',async t=>{
  const {s,clips,c}=fixture(t);assert.equal(ClipsData.parse(clips.data).length,1);await s.clipFeatures.comments({id:c.id,targets:['new']});const valid=ClipsData.parse(clips.data);
  for(const edit of [v=>v[0].readings.push({...v[0].readings[0]}),v=>v[0].readings[0].viewerId='__proto__',v=>v[0].readings[0].messages.push({id:'missing',hash:'a'.repeat(64)}),v=>v[0].readings[0].comments.push({...v[0].readings[0].comments[0]}),v=>v[0].readings[0].metadataHash='bad']){const value=structuredClone(valid);edit(value);assert.throws(()=>ClipsData.parse(value));}
});

test('recall size stays bounded and relevant old clips outrank newer unrelated ones',()=>{
  let now=T;const clips=new Clips({now:()=>++now});let wanted;
  for(let i=0;i<6;i++){const c=clips.create(base({title:i?'다른 게임':'야간열차',scene:'😀'.repeat(500),messages:[]}));if(!i)wanted=c.id;const reading=clipTextSnapshot(clips.get(c.id));clips.commentBatch(c.id,[{personaId:'new',name:'관객',kind:'ai',text:(i?'나중 이야기':'야간열차')+'😀'.repeat(400)}],{reading});}
  const rows=clips.recall('new','야간열차',now+1);assert.equal(rows.length,2);assert.equal(rows[0].clipId,wanted);assert.ok(rows.every(c=>c.scene.length<=240&&c.scene.isWellFormed()&&c.items.length<=4&&c.items.every(m=>m.text.length<=220&&m.text.isWellFormed()&&m.excerpt)));
});

test('cached sources detect nested edits, do not share mutable output and survive unrelated commits',async t=>{
  const {s,clips}=fixture(t),gift=donationMessage({id:randomUUID(),at:T,amount:24,anonymous:true,text:'응원해요'}),c=clips.create(base({messages:[gift]}));await s.clipFeatures.comments({id:c.id,targets:['new']});
  const first=clips.recall('new','후원'),item=allItems(first).find(m=>m.donation);item.donation.amount=200;
  assert.equal(allItems(clips.recall('new','후원')).find(m=>m.donation).donation.amount,24);
  const unrelated=clips.create(base({title:'다른 클립'}));clips.comment(unrelated.id,{name:'플레이어',text:'다른 댓글'});
  assert.equal(allItems(clips.recall('new','후원')).find(m=>m.donation).donation.amount,24);
  clips.data.find(x=>x.id===c.id).messages[0].donation.amount=90;
  assert.ok(!allItems(clips.recall('new','후원')).some(m=>m.id===gift.id));
});
