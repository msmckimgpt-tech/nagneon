import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {startServer} from '../server/index.js';
import {emptySeasons,SeasonsData} from '../server/seasons-schema.js';
import {EpisodesData} from '../server/data-schema.js';
import {OpenAIProvider} from '../server/provider.js';
import {defaults} from '../shared/defaults.js';

test('retired stories remain intact through restart, export and rejected mutation attempts',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'nagneon-story-archive-'));
  const message={id:randomUUID(),personaId:'momo',name:'모모',color:'#ffffff',text:'과거의 가상 대화',kind:'chat',time:1000,fictional:true};
  const episode={id:randomUUID(),episodeId:'awards',title:'예전 시상식',premise:'상상',cast:[],sessionId:randomUUID(),sessionStartedAt:1000,startedAt:1000,endedAt:2000,stage:0,stageTitle:'인사',totalStages:3,messages:[message],choices:[],status:'interrupted'};
  const season={id:randomUUID(),templateId:'our-room-v1',version:1,title:'예전 시즌',premise:'상상',createdAt:1000,updatedAt:1000,status:'open',chapters:[{node:'opening',stage:0,startedAt:1000,endedAt:null,sessionId:randomUUID(),cast:[],messages:[message],lines:[]}],decisions:[],keepsake:null};
  const seasons={...emptySeasons(),settings:{autoProposals:true},seasons:[season]};
  EpisodesData.parse([episode]);SeasonsData.parse(seasons);
  const original={episodes:JSON.stringify([episode]),seasons:JSON.stringify(seasons)};
  for(const [name,text] of Object.entries(original))writeFileSync(join(dir,name+'.json'),text);
  let calls=0;
  for(let cycle=0;cycle<2;cycle++){
    const app=await startServer({port:0,dataDir:dir,localSpeech:false,provider:{status:()=>({configured:true}),react:async()=>{calls++;throw Error('unexpected story generation');}}});
    try{
      const request=(path,method='GET')=>fetch(app.url+'/api/'+path,{method,headers:{Authorization:'Bearer '+app.accessToken,'X-Backseat-Client':'studio'}});
      for(const path of ['director/start','director/advance','director/finish','director/clip','seasons','seasons/settings','seasons/resume','seasons/advance','seasons/choose','seasons/propose','seasons/respond','seasons/pause','seasons/clip'])assert.equal((await request(path,'POST')).status,410,path);
      assert.equal((await request('seasons/'+season.id,'DELETE')).status,410);
      assert.deepEqual(await(await request('seasons/'+season.id)).json(),season);
      const archive=await(await request('story-archive')).json();assert.equal(archive.episodes[0].messageCount,1);assert.equal(archive.seasons[0].messageCount,1);
      const state=await(await request('state')).json();assert.equal('director' in state,false);assert.equal('seasons' in state,false);
      app.studio.start();app.studio.pump();app.studio.stop();
      const exported=await(await request('export')).json();assert.deepEqual(exported.episodesArchive,[episode]);assert.deepEqual(exported.seasonsArchive,seasons);
    }finally{await app.close();}
    for(const [name,text] of Object.entries(original))assert.equal(readFileSync(join(dir,name+'.json'),'utf8'),text);
  }
  assert.equal(calls,0);
});

test('natural roleplay uses ordinary dialogue without retired engine prompts',()=>{
  const request=new OpenAIProvider({}).payload({settings:defaults,history:[],speech:'오늘은 우리가 우주선 승무원이라는 설정으로 이야기해 보자'});
  const data=JSON.parse(request.input[0].content[0].text);
  assert.match(data.streamerSpeech,/우주선/);assert.equal('directed' in data,false);
  assert.doesNotMatch(request.instructions,/season-stage|directed-episode/);
  assert.match(request.instructions,/허구의 사건을 실제 게임 결과/);
});
