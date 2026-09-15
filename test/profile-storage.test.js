import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import storage from '../desktop/storage.cjs';
test('storage defaults to system profile; migrations preserve all bytes and source',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nagneon-storage-'));
  try{
    const source=storage.readProfile(root),target=path.join(root,'custom');
    fs.mkdirSync(path.join(source,'data','clips'),{recursive:true});
    fs.writeFileSync(path.join(source,'data','world.json'),'saved world');
    fs.writeFileSync(path.join(source,'data','clips','one.bin'),Buffer.from([0,255,13]));
    const configFile=storage.storagePaths(root).configFile;
    assert.equal(storage.migrateStorage({source,target,configFile}).files,2);
    assert.equal(storage.readProfile(root),target);
    assert.equal(fs.readFileSync(path.join(source,'data','world.json'),'utf8'),'saved world');
    assert.deepEqual(fs.readFileSync(path.join(target,'data','clips','one.bin')),Buffer.from([0,255,13]));
    assert.throws(()=>storage.migrateStorage({source:target,target:source,configFile}),/빈 폴더/);
    assert.equal(storage.readProfile(root),target);
    fs.renameSync(target,target+'-offline');
    assert.throws(()=>storage.readProfile(root),/저장 위치/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('storage rejects overlap, relative destinations and corrupt registry',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nagneon-storage-'));
  try{
    assert.throws(()=>storage.validateDestination(root,path.join(root,'child')),/분리/);
    assert.throws(()=>storage.validateDestination(root,path.dirname(root)),/분리/);
    assert.throws(()=>storage.validateDestination(root,'relative'),/절대/);
    const {configFile}=storage.storagePaths(root);fs.mkdirSync(path.dirname(configFile),{recursive:true});fs.writeFileSync(configFile,'broken');
    assert.throws(()=>storage.readProfile(root));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
