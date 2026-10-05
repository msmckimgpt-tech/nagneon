import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join,relative,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Audience} from '../server/audience.js';
import {Community} from '../server/community.js';
import {communityRevision} from '../server/community-activity.js';
import {liveViewerContext} from '../server/viewer-context.js';
import {OpenAIProvider} from '../server/provider.js';
import {CodexProvider} from '../server/codex-provider.js';
import {startServer} from '../server/index.js';
import {defaults} from '../shared/defaults.js';

const privateRevision='9'.repeat(64), privateTime=987654321;
function fixture(){
  let saves=0;
  const people=structuredClone(defaults.personas.filter(p=>!p.system).slice(0,2));
  assert.equal(people.length,2);
  const settings={...structuredClone(defaults),personas:people,streamer:'합성방장'};
  const members=Object.fromEntries(people.map(p=>[p.id,{sessions:1,seconds:60,recognized:0,affinity:.3,peers:{},memories:[],joinedAt:2000}]));
  const posts=Array.from({length:12},(_,i)=>{
    const parent=randomUUID(),reply=randomUUID();
    return {id:randomUUID(),name:'합성방장',personaId:'streamer',text:`합성 게시글 ${i}\n함께 이야기한 방송 후기`,time:1000+i,kind:'ai',
      ...(i===11?{}:{title:`방송 후기 ${i}`,category:'후기'}),
      comments:[{id:parent,name:people[0].name,personaId:people[0].id,text:`공개 댓글 ${i}`,time:1200+i,parentId:null,kind:'ai'},
        {id:reply,name:'합성방장',personaId:'streamer',text:'삭제된 댓글입니다.',time:1300+i,parentId:parent,kind:'streamer',deleted:true}],
      votes:[people[1].id,'streamer'],source:{url:'https://public.example.org/story',title:'합성 공개 출처',details:{label:'함께 본 이야기'}},
      activityReads:[{viewerId:people[0].id,revision:privateRevision,at:privateTime+i}]};
  });
  const audience=new Audience({members,posts,lore:[]},()=>{saves++;},()=>0);
  audience.lastStart=2000;
  for(const p of people)audience.presence[p.id]='active';
  const community=new Community({settings,audience,now:()=>3000,publish:()=>{}});
  const history=Array.from({length:12},(_,i)=>({id:randomUUID(),personaId:'streamer',name:'합성방장',kind:'streamer',time:2100+i,text:('합성 공개 대화 '+i+' ').repeat(20)}));
  const context=()=>audience.context(settings,'지난 방송 후기 기억나요?',0);
  const publicPosts=()=>community.list().slice(0,8).reverse();
  const args=()=>({...liveViewerContext(context(),people,history,null,{speech:'지난 방송 후기 기억나요?',now:3000,privateMembers:audience.data.members}),settings,speech:'지난 방송 후기 기억나요?',history});
  return {audience,community,people,settings,history,context,publicPosts,args,get saves(){return saves;}};
}
function expand(data){
  const copy=structuredClone(data);
  for(const group of copy.viewerContextShared||[])for(const id of group.viewerIds)Object.assign(copy.viewerContext[id],structuredClone(group.fields));
  delete copy.viewerContextShared;
  return copy;
}

test('live gallery input is public, chronological and bounded without changing durable receipts',()=>{
  const f=fixture(),before=structuredClone(f.audience.data),value=f.context();
  assert.equal(value.offStreamPosts.length,8);
  assert.deepEqual(value.offStreamPosts.map(p=>p.id),before.posts.slice(4).map(p=>p.id));
  assert.deepEqual(value.offStreamPosts,f.publicPosts());
  for(const post of value.offStreamPosts){
    assert.equal(Object.hasOwn(post,'activityReads'),false);
    assert.equal(post.comments.length,2);assert.equal(post.comments[1].parentId,post.comments[0].id);
    assert.equal(post.comments[1].deleted,true);assert.deepEqual(post.votes,[f.people[1].id,'streamer']);
    assert.equal(post.source.details.label,'함께 본 이야기');
    assert.deepEqual(post.source,before.posts.find(raw=>raw.id===post.id).source);
  }
  assert.equal(value.offStreamPosts.at(-1).title,'합성 게시글 11');
  assert.equal(value.offStreamPosts.at(-1).category,'후기');
  assert.deepEqual(f.audience.data,before);assert.equal(f.saves,0);
});

test('mutating a live public post cannot rewrite stored comments, votes or nested source metadata',()=>{
  const f=fixture(),before=structuredClone(f.audience.data),post=f.context().offStreamPosts[0];
  post.text='변경';post.comments[0].text='변경';post.comments[1].parentId=null;post.votes.splice(0);
  post.source.details.label='변경';
  assert.deepEqual(f.audience.data,before);assert.equal(f.saves,0);
  assert.deepEqual(f.context().offStreamPosts,f.publicPosts());
});

test('legacy and empty galleries remain readable with no fabricated private read receipt',()=>{
  const f=fixture();f.audience.data.posts=[{id:randomUUID(),name:'합성방장',text:'제목 없는 예전 글',time:1,kind:'streamer'}];
  const before=structuredClone(f.audience.data),post=f.context().offStreamPosts[0];
  assert.equal(post.title,'제목 없는 예전 글');assert.equal(post.category,'자유');
  assert.deepEqual(post.comments,[]);assert.deepEqual(post.votes,[]);assert.equal(Object.hasOwn(post,'activityReads'),false);
  assert.deepEqual(f.audience.data,before);f.audience.data.posts=[];assert.deepEqual(f.context().offStreamPosts,[]);assert.equal(f.saves,0);
});

for(const [name,Provider]of [['OpenAI',OpenAIProvider],['Codex',CodexProvider]]){
  test(`${name} common model input excludes read records with actual viewer sharing off and on`,()=>{
    const f=fixture(),before=structuredClone(f.audience.data),args=f.args(),argsBefore=structuredClone(args),plainValues=[];
    assert.equal(before.posts.some(p=>p.activityReads.some(r=>r.viewerId===f.people[1].id)),false);
    for(const enabled of ['0','1']){
      const provider=new Provider({BACKSEAT_SHARED_VIEWER_CONTEXT:enabled});provider.request=()=>assert.fail('No provider request is allowed');
      const payload=provider.payload(args),text=payload.input[0].content.find(c=>c.type==='input_text').text,value=JSON.parse(text);
      assert.deepEqual(args,argsBefore);
      assert.deepEqual(value.audience.offStreamPosts,f.publicPosts());
      assert.equal(text.includes('activityReads'),false);assert.equal(text.includes(privateRevision),false);assert.equal(text.includes(String(privateTime)),false);
      assert.equal(payload.store,false);
      if(enabled==='1')assert.ok(value.viewerContextShared?.some(g=>f.people.every(p=>g.viewerIds.includes(p.id))),'actual shared viewer group must be exercised');
      else assert.equal(value.viewerContextShared,undefined);
      plainValues.push(expand(value));
    }
    assert.deepEqual(plainValues[0],plainValues[1]);assert.deepEqual(f.audience.data,before);assert.equal(f.saves,0);
  });
}

test('public live projection leaves each stored reader revision and revisit fingerprint intact',()=>{
  const f=fixture(),before=structuredClone(f.audience.data.posts);
  const revisions=f.people.map(p=>before.map(post=>communityRevision('gallery',post,p.id)));
  for(let i=0;i<4;i++)f.args();
  assert.deepEqual(f.audience.data.posts,before);
  assert.deepEqual(f.people.map(p=>f.audience.data.posts.map(post=>communityRevision('gallery',post,p.id))),revisions);
  assert.equal(f.saves,0);
});

test('authenticated live dispatch and ordinary world save/restart preserve private records while passing public posts',async t=>{
  fs.mkdirSync(join(process.cwd(),'artifacts'),{recursive:true});
  const base=fs.realpathSync(join(process.cwd(),'artifacts')),dir=fs.mkdtempSync(join(base,'live-gallery-'));
  let calls=0,captured,service,restored;
  t.after(async()=>{
    if(restored)await restored.close();if(service)await service.close();
    const target=fs.realpathSync(dir),within=relative(base,target);
    assert.ok(within&&!within.startsWith('..')&&!isAbsolute(within));
    fs.rmSync(target,{recursive:true,force:true});
  });
  service=await startServer({port:0,dataDir:dir,localSpeech:false,provider:{status:()=>({configured:true}),react:async args=>{
    calls++;captured=new CodexProvider({}).payload(args);
    return {observation:{game:'Just Chatting',scene:'합성 후기 대화',confidence:1,excitement:.2,messages:[]},usage:{total_tokens:0}};
  }}});
  const f=fixture(),s=service.studio;
  clearInterval(s.timer);s.ai.update({background:false});
  s.world.change(next=>{
    next.settings.personas.push(...f.people);
    next.audience={...next.audience,...structuredClone(f.audience.data)};
  });
  s.configure({...s.settings,mode:'live',lurkRatio:0});
  const expected=structuredClone(s.audience.data.posts);
  const headers={Authorization:'Bearer '+service.accessToken,'X-Backseat-Client':'studio','Content-Type':'application/json'};
  const publicResponse=await fetch(service.url+'/api/community/posts',{headers});assert.equal(publicResponse.status,200);
  const publicList=await publicResponse.json();
  s.start();
  for(const p of f.people){s.audience.presence[p.id]='active';s.audience.data.members[p.id].joinedAt=s.now();}
  const response=await fetch(service.url+'/api/react',{method:'POST',headers,body:JSON.stringify({speech:'지난 방송 후기 기억나요?'})});
  assert.equal(response.status,200);assert.equal(calls,1);
  const data=JSON.parse(captured.input[0].content.find(c=>c.type==='input_text').text);
  assert.deepEqual(data.audience.offStreamPosts,publicList.slice(0,8).reverse());
  assert.equal(JSON.stringify(data).includes('activityReads'),false);assert.equal(JSON.stringify(data).includes(privateRevision),false);
  assert.deepEqual(s.audience.data.posts,expected);
  s.stop();await service.close();
  restored=await startServer({port:0,dataDir:dir,localSpeech:false,provider:{status:()=>({configured:true}),react:()=>assert.fail('Restart must not call a model')}});
  clearInterval(restored.studio.timer);restored.studio.ai.update({background:false});
  assert.deepEqual(restored.studio.audience.data.posts,expected);
  assert.equal(restored.studio.community.list().some(p=>Object.hasOwn(p,'activityReads')),false);
  assert.equal(calls,1);
});
