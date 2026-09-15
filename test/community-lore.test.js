import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Audience} from '../server/audience.js';
import {AudienceData} from '../server/data-schema.js';
import {defaults} from '../shared/defaults.js';
import {startServer} from '../server/index.js';
import {seedMetAudience} from './helpers/met-audience.js';

test('expired legacy lore survives normalization, adding more than 30 and relevant retrieval',()=>{
  const old={members:{},posts:[],lore:[{text:'낙하산 장인: 연속 낙사에서 생긴 농담',expiresAt:1}]};
  const parsed=AudienceData.parse(old),a=new Audience(parsed);
  assert.equal(parsed.lore[0].id,AudienceData.parse(old).lore[0].id);
  for(let i=0;i<45;i++)a.lore('우주선 승무원 '+i);
  assert.equal(a.data.lore.length,46);
  assert.deepEqual(a.context(defaults,'낙하산 장인은 어디서 시작했죠?').lore.map(e=>e.text),[old.lore[0].text]);
  assert.equal(a.context(defaults,'우주선 이야기').lore.length,3);
  assert.deepEqual(a.context(defaults,'오늘 뭐 할까요?').lore,[]);
  assert.deepEqual(a.context(defaults,'').lore,[]);
  assert.equal(a.context(defaults,'낙하산').lore[0].source,'streamer-note');
});

test('lore mutations do not change memory when durable save fails',()=>{
  const a=new Audience({members:{},posts:[],lore:[{text:'낙하산 장인',expiresAt:1}]},()=>{throw Error('disk full');});
  const before=structuredClone(a.data);
  assert.throws(()=>a.lore('새 기억'),/disk full/);assert.deepEqual(a.data,before);
  assert.throws(()=>a.forgetLore(before.lore[0].id),/disk full/);assert.deepEqual(a.data,before);
});

test('HTTP lore keeps legacy records after restart and deletes only the requested stable ID',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'nagneon-lore-'));
  writeFileSync(join(dir,'audience.json'),JSON.stringify({members:{},posts:[],lore:[{text:'지난 낙하산 장인',expiresAt:1}]}));
  writeFileSync(join(dir,'settings.json'),JSON.stringify(defaults));
  let oldId,newId;
  for(let cycle=0;cycle<2;cycle++){
    const app=await startServer({port:0,dataDir:dir,localSpeech:false,provider:{status:()=>({configured:false})}});
    try{
      const request=(path,method='GET',body)=>fetch(app.url+'/api/'+path,{method,headers:{Authorization:'Bearer '+app.accessToken,'X-Backseat-Client':'studio','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
      const state=await(await request('state')).json();assert.equal(state.audience.lore[0].text,'지난 낙하산 장인');
      if(!cycle){oldId=state.audience.lore[0].id;const added=await(await request('community/lore','POST',{text:'우주선 승무원',days:1})).json();newId=added.id;assert.equal(added.expiresAt,undefined);}
      else{
        assert.equal(state.audience.lore[0].id,oldId);assert.equal(state.audience.lore[1].id,newId);
        assert.equal((await request('community/lore/'+oldId,'DELETE')).status,200);
        assert.deepEqual((await(await request('state')).json()).audience.lore.map(e=>e.id),[newId]);
        assert.equal((await request('community/lore/'+oldId,'DELETE')).status,404);
      }
    }finally{await app.close();}
  }
});

test('deleting lore cancels affected model output and removes affected queued replies',async t=>{
  let finish,input;
  const app=await startServer({port:0,persist:false,localSpeech:false,provider:{status:()=>({configured:true}),react:args=>{input=args;return new Promise(resolve=>finish=resolve);}}});
  t.after(()=>app.close());const s=app.studio;clearInterval(s.timer);seedMetAudience(s);s.configure({...s.settings,mode:'live',lurkRatio:0});
  const entry=s.audience.lore('낙하산 장인');s.start();const pending=s.react({speech:'낙하산 장인 이야기를 해 줘'});
  assert.equal(input.audience.lore[0].id,entry.id);
  s.queue.push({loreIds:[entry.id],text:'삭제할 기억을 참고한 답변'},{text:'별개의 대기 답변'});
  const response=await fetch(app.url+'/api/community/lore/'+entry.id,{method:'DELETE',headers:{Authorization:'Bearer '+app.accessToken,'X-Backseat-Client':'studio'}});assert.equal(response.status,200);
  finish({observation:{messages:[]}});assert.deepEqual(await pending,{skipped:'superseded'});assert.deepEqual(s.queue.map(m=>m.text),['별개의 대기 답변']);
});
