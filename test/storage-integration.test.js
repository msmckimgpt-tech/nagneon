import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startServer} from '../server/index.js';
const provider=()=>({status:()=>({configured:true}),react:async()=>({observation:{game:'test',scene:'scene',confidence:.8,excitement:0,messages:[]}})});

test('World2 refuses backup rollback and preserves primary and backups for explicit recovery',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'backseat-recovery-'));const service=await startServer({port:0,dataDir:dir,localSpeech:false,provider:provider()});
  try{service.studio.configure({...service.studio.settings,title:'복구할 방송 제목'});service.studio.configure({...service.studio.settings,title:'가장 최근 제목'});}finally{await service.close();}
  const backup=readFileSync(join(dir,'world.json.bak.1'),'utf8');
  writeFileSync(join(dir,'world.json'),'{broken json');
  await assert.rejects(startServer({port:0,dataDir:dir,localSpeech:false,provider:provider()}),/손상/);
  assert.equal(readFileSync(join(dir,'world.json'),'utf8'),'{broken json');
  assert.equal(readFileSync(join(dir,'world.json.bak.1'),'utf8'),backup);
});

test('unrecoverable malformed data fails startup without resetting any record',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'backseat-corrupt-'));writeFileSync(join(dir,'economy.json'),JSON.stringify({balance:-999}));
  await assert.rejects(startServer({port:0,dataDir:dir,localSpeech:false,provider:provider()}),/백업이 없습니다/);assert.equal(JSON.parse(readFileSync(join(dir,'economy.json'),'utf8')).balance,-999);assert.deepEqual(readdirSync(dir),['economy.json']);
});
