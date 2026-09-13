import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startServer} from '../server/index.js';
const provider=()=>({status:()=>({configured:true}),react:async()=>({observation:{game:'test',scene:'scene',confidence:.8,excitement:0,messages:[]}})});

test('application reloads a valid settings generation, reports recovery and preserves corrupt original',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'backseat-recovery-'));let service=await startServer({port:0,dataDir:dir,localSpeech:false,provider:provider()});
  try{service.studio.configure({...service.studio.settings,title:'복구할 방송 제목'});service.studio.configure({...service.studio.settings,title:'가장 최근 제목'});}finally{await service.close();}
  const expected=JSON.parse(readFileSync(join(dir,'world.json.bak.1'),'utf8')).settings.title;
  writeFileSync(join(dir,'world.json'),'{broken json');
  service=await startServer({port:0,dataDir:dir,localSpeech:false,provider:provider()});
  try{
    const state=service.studio.state();assert.equal(state.settings.title,expected);assert.equal(state.storage.recovered.length,1);assert.match(state.storage.warnings[0],/복구/);assert.equal(readFileSync(join(dir,'world.json'),'utf8'),'{broken json');
    service.studio.configure({...state.settings,title:'복구 확인 후 저장'});assert.equal(JSON.parse(readFileSync(join(dir,'world.json'),'utf8')).settings.title,'복구 확인 후 저장');const corrupt=readdirSync(dir).find(n=>n.startsWith('world.json.corrupt-'));assert.equal(readFileSync(join(dir,corrupt),'utf8'),'{broken json');
  }finally{await service.close();}
});

test('unrecoverable malformed data fails startup without resetting any record',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'backseat-corrupt-'));writeFileSync(join(dir,'economy.json'),JSON.stringify({balance:-999}));
  await assert.rejects(startServer({port:0,dataDir:dir,localSpeech:false,provider:provider()}),/백업이 없습니다/);assert.equal(JSON.parse(readFileSync(join(dir,'economy.json'),'utf8')).balance,-999);assert.deepEqual(readdirSync(dir),['economy.json']);
});
