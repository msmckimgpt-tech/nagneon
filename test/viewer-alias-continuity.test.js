import test from 'node:test';
import assert from 'node:assert/strict';
import {Audience} from '../server/audience.js';
import {Studio} from '../server/studio.js';
import {defaults} from '../shared/defaults.js';
import {Settings} from '../server/schema.js';
import {createViewerAddressResolver} from '../server/viewer-addressing.js';

const settings=()=>Settings.parse({...structuredClone(defaults),mode:'live',lurkRatio:0,slowModeSeconds:0,chatPace:1,communityActivityEnabled:false,personas:structuredClone(defaults.personas.filter(p=>['momo','pop','luna'].includes(p.id)))});
function fixture(){const cfg=settings(),a=new Audience(undefined,()=>{},()=>.5);a.start(cfg,100000);const p=cfg.personas.find(p=>p.id==='momo');a.data.members.momo.aliases=[{name:p.name,at:110000}];p.name='구름산책';a.data.members.momo.note='스트리머 개인 메모';a.presence.momo='lurking';return {cfg,a};}

test('a former nickname wakes the same present viewer without replacing identity or notes',()=>{
 const {cfg,a}=fixture(),before=structuredClone(a.data.members.momo);
 const audience=a.context(cfg,'모모님은 야식 뭐 먹을래');
 assert.ok(audience.eligible.includes('momo'));assert.equal(a.presence.momo,'active');
 assert.equal(a.data.members.momo.recognized,before.recognized+1);assert.equal(a.data.members.momo.joinedAt,before.joinedAt);assert.equal(a.data.members.momo.note,before.note);
});

test('old nickname cannot bypass absence, original hearers or a stale visit',()=>{
 for(const boundary of ['away','hearers','visit']){const {cfg,a}=fixture(),before=structuredClone(a.data.members.momo);if(boundary==='away')a.presence.momo='away';if(boundary==='visit')a.data.members.momo.joinedAt=99000;
 const eligible=a.context(cfg,'모모님 계세요',0,boundary==='hearers'?{hearers:['pop']}:{}).eligible;
 assert.ok(!eligible.includes('momo'));assert.equal(a.data.members.momo.recognized,before.recognized);}
});

test('reused current nickname reserves its owner even while absent or disabled',()=>{
 for(const disabled of [false,true]){const {cfg,a}=fixture();const other=cfg.personas.find(p=>p.id==='pop');other.name='모모';other.enabled=!disabled;a.presence.pop='away';
 a.context(cfg,'모모님 계세요');assert.equal(a.presence.momo,'lurking');assert.equal(a.presence.pop,'away');}
});

test('Studio passes stable addressing and witnessed peer attention into the actual reaction input',async t=>{
 const {cfg,a}=fixture(),inputs=[];let now=200000;
 const s=new Studio({settings:cfg,audience:a,now:()=>now,random:()=>.5,provider:{status:()=>({configured:true}),react:async args=>{inputs.push(args);return {observation:{game:'Test',scene:'합성 대화',confidence:.9,excitement:.1,messages:[]}};}}});clearInterval(s.timer);t.after(()=>s.close());s.start();a.presence.momo='lurking';
 s.addMessage('pop','모모님은 야식 뭐 먹어요');now+=5000;
 await s.react({speech:'모모님은 야식 뭐 먹을래'});
 const packet=inputs[0]?.viewerContext.momo;assert.ok(packet);assert.equal(packet.conversationRhythm.addressed,true);
 assert.ok(packet.chatAttention.items.some(m=>m.text==='모모님은 야식 뭐 먹어요'&&m.attention==='addressed'));
 assert.ok(!JSON.stringify(inputs).includes('스트리머 개인 메모'));
 assert.equal(a.data.members.pop.peers.momo,1);assert.equal(inputs.length,1);
});

test('ambiguous historical names do not choose an owner or create peer affinity',()=>{
 const {cfg,a}=fixture();a.data.members.pop.aliases=[{name:'모모',at:110000}];
 a.context(cfg,'모모님 계세요');assert.equal(a.presence.momo,'lurking');
 a.message('luna','모모님 반가워요',cfg);assert.equal(a.data.members.luna.peers.momo,undefined);assert.equal(a.data.members.luna.peers.pop,undefined);
});

test('longest overlapping name wins, while separate mentions can address both',()=>{
 const resolve=createViewerAddressResolver([{id:'a',name:'모모'},{id:'b',name:'모모친구'},{id:'c',name:'Cat'}]);
 assert.deepEqual([...resolve('모모친구님 안녕')],['b']);assert.deepEqual([...resolve('모모친구랑 모모님은 어때요')].sort(),['a','b']);
 assert.deepEqual([...resolve('Catalog, bobcat, cat2')],[]);assert.deepEqual([...resolve('ＣＡＴ님 어때요')],['c']);
});

test('ambiguous longer alias reserves its span; removed viewers and future aliases are ignored',()=>{
 const resolve=createViewerAddressResolver([{id:'a',name:'모모'},{id:'b',name:'구름'},{id:'c',name:'햇살'}],{
 b:{aliases:[{name:'모모친구',at:10},{name:'미래이름',at:30},null,{}]},c:{aliases:[{name:'모모친구',at:10}]},removed:{aliases:[{name:'과거이름',at:10}]}
 },20);
 assert.deepEqual([...resolve('모모친구님, 미래이름님, 과거이름님')],[]);
 assert.deepEqual([...resolve('모모친구님, 모모님')],['a']);
});

test('Studio resolves names against the full roster before selecting speaking viewers',async t=>{
 const {cfg,a}=fixture();cfg.personas.find(p=>p.id==='pop').name='모모';const inputs=[];let now=200000;
 const s=new Studio({settings:cfg,audience:a,now:()=>now,random:()=>.5,provider:{status:()=>({configured:true}),react:async args=>{inputs.push(args);return {observation:{game:'Test',scene:'합성 대화',confidence:.9,excitement:.1,messages:[]}};}}});clearInterval(s.timer);t.after(()=>s.close());s.start();a.presence.pop='away';a.presence.momo='active';
 s.addMessage('luna','모모님은 어때요');now+=5000;await s.react({speech:'모모님 계세요'});
 const packet=inputs[0]?.viewerContext.momo;assert.ok(packet);assert.equal(packet.conversationRhythm.addressed,false);
 assert.equal(packet.chatAttention.items.find(m=>m.text==='모모님은 어때요').attention,'background');assert.equal(a.presence.pop,'away');
});
