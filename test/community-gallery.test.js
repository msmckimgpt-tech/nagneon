import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Studio} from '../server/studio.js';
import {Audience} from '../server/audience.js';
import {defaults} from '../shared/defaults.js';
import {GalleryPost} from '../server/community.js';
import {startServer} from '../server/index.js';

function studio(t,react=async()=>({observation:{messages:[],communityVotes:[]}})){
  const s=new Studio({settings:{...defaults,mode:'live'},provider:{status:()=>({configured:true}),react},audience:new Audience(undefined,()=>{},()=>.5)});clearInterval(s.timer);s.start();s.stop();t.after(()=>s.close());return s;
}
test('legacy posts become readable gallery entries without rewriting their original content',t=>{
  const s=studio(t),old={id:'old',name:'이전 관객',text:'지난 방송 후기\n다음에도 기대해요',time:1,kind:'ai'};s.audience.data.posts.push(old);
  const p=s.community.get('old');assert.equal(p.title,'지난 방송 후기');assert.equal(p.category,'후기');assert.deepEqual(p.comments,[]);p.text='changed';assert.deepEqual(s.audience.data.posts[0],old);
});
test('comments, replies and votes persist together; retries of a vote do not multiply recommendations',t=>{
  const s=studio(t),p=s.community.post({title:'새 방송 안내',text:'내일은 퍼즐을 해요',category:'공지'});
  const [c]=s.community.comment(p.id,{text:'좋아요'});s.community.comment(p.id,{text:'시간은 저녁이에요',parentId:c.id});s.community.recommend(p.id,true);s.community.recommend(p.id,true);
  const saved=GalleryPost.parse(s.community.get(p.id));assert.equal(saved.comments.length,2);assert.deepEqual(saved.votes,['streamer']);assert.throws(()=>s.community.comment(p.id,{text:'bad',parentId:randomUUID()}));
  s.community.removeComment(p.id,c.id);assert.equal(s.community.get(p.id).comments[1].parentId,c.id);assert.throws(()=>s.community.comment(p.id,{text:'bad',parentId:c.id}));s.community.recommend(p.id,false);assert.deepEqual(s.community.get(p.id).votes,[]);
  s.community.remove(p.id);assert.throws(()=>s.community.get(p.id));
});
test('gallery storage failure leaves both original audience and posts unchanged',t=>{
  const s=studio(t),p=s.community.post({title:'test',text:'original'}),before=structuredClone(s.audience.data);s.audience.save=()=>{throw Error('synthetic disk failure');};
  assert.throws(()=>s.community.comment(p.id,{text:'cannot save'}),/disk failure/);assert.deepEqual(s.audience.data,before);assert.throws(()=>s.community.recommend(p.id,true));assert.deepEqual(s.audience.data,before);
});
test('AI gallery readers use a fresh signal after broadcast stop and cannot impersonate unknown voters',async t=>{
  let request;const s=studio(t,async(args,signal)=>{request=args;assert.equal(signal.aborted,false);return {usage:{total_tokens:12},observation:{messages:[{personaId:'momo',text:'퍼즐 후기도 기다려요',spoiler:false},{personaId:'unknown',text:'not accepted'}],communityVotes:[{personaId:'momo',recommended:true},{personaId:'unknown',recommended:true}]}};});
  s.settings.personas=s.settings.personas.filter(p=>p.id==='momo');const p=s.community.post({title:'다음 게임',text:'퍼즐을 할 거예요'});await s.community.react(p.id);assert.equal(request.special.kind,'gallery-comment');assert.equal(request.previous,null);assert.deepEqual(request.history,[]);assert.equal(s.tokens,12);assert.equal(s.community.get(p.id).comments.length,1);assert.deepEqual(s.community.get(p.id).votes,['momo']);assert.equal(s.busy,false);
});
test('deleting a post while readers respond cannot resurrect it or leave partial votes',async t=>{
  let finish;const s=studio(t,()=>new Promise(r=>finish=r));s.settings.personas=s.settings.personas.filter(p=>p.id==='momo');const p=s.community.post({title:'soon deleted',text:'synthetic'}),job=s.community.react(p.id);s.community.remove(p.id);finish({observation:{messages:[{personaId:'momo',text:'late'}],communityVotes:[{personaId:'momo',recommended:true}]}});await assert.rejects(job,/찾을/);assert.equal(s.audience.data.posts.length,0);assert.equal(s.busy,false);
});
test('real gallery HTTP routes expose posts, replies, recommendation toggles and deletion',async t=>{
  const service=await startServer({port:0,persist:false,localSpeech:false,provider:{status:()=>({configured:true})}});t.after(()=>service.close());
  const call=async(path,body,method=body===undefined?'GET':'POST')=>{const r=await fetch(service.url+'/api/community/'+path,{method,headers:{Authorization:'Bearer '+service.accessToken,'X-Backseat-Client':'studio','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  const {body:p}=await call('post',{title:'HTTP 안내',text:'독립 프로필의 합성 게시글',category:'공지'});assert.ok(p.id);const {body:[c]}=await call(`posts/${p.id}/comments`,{text:'첫 댓글'});assert.ok(c.id);await call(`posts/${p.id}/comments`,{text:'답글',parentId:c.id});await call(`posts/${p.id}/recommend`,{recommended:true});await call(`posts/${p.id}/recommend`,{recommended:true});
  const fetched=(await call(`posts/${p.id}`)).body;assert.equal(fetched.comments.length,2);assert.equal(fetched.votes.length,1);assert.equal((await call('posts')).body.length,1);assert.equal((await call(`posts/${p.id}`,undefined,'DELETE')).status,200);assert.equal((await call('posts')).body.length,0);
});
