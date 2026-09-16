import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import recovery from '../desktop/profile-recovery.cjs';
import storage from '../desktop/storage.cjs';

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nagneon-recovery-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const appData=path.join(root,'Roaming'),profile=path.join(appData,'backseat-studio'),packages=path.join(root,'Local/Packages');
  const source=path.join(packages,'Agent/LocalCache/Roaming/backseat-studio/data');
  const records=p=>{fs.mkdirSync(p,{recursive:true});fs.writeFileSync(path.join(p,'world.json'),JSON.stringify({settings:{title:'existing'},points:103}));fs.writeFileSync(path.join(p,'history.bin'),Buffer.from([0,255,17]));};
  return {root,appData,profile,packages,source,records};
}
test('app startup restores unique redirected records before opening; source bytes survive and restart does not overwrite',async t=>{
  const f=fixture(t);f.records(f.source);const before=storage.inventory(f.source);
  const dialog={showMessageBox(){throw Error('unexpected prompt');}};
  const result=await recovery.prepareProfile({...f,dialog});
  assert.equal(result.recovered,true);assert.equal(result.files,2);
  assert.deepEqual(storage.inventory(path.join(f.profile,'data')),before);assert.deepEqual(storage.inventory(f.source),before);
  fs.writeFileSync(path.join(f.profile,'data/world.json'),'newer native records');
  assert.equal((await recovery.prepareProfile({...f,dialog})).recovered,false);
  assert.equal(fs.readFileSync(path.join(f.profile,'data/world.json'),'utf8'),'newer native records');
});
test('multiple candidates require selection; reconnect selected profile and preserve damaged setting',async t=>{
  const f=fixture(t);f.records(f.source);f.records(path.join(f.packages,'Other/LocalCache/Roaming/backseat-studio/data'));
  const chosen=path.join(f.root,'chosen');f.records(path.join(chosen,'data'));
  const {configFile}=storage.storagePaths(f.appData);fs.mkdirSync(path.dirname(configFile),{recursive:true});fs.writeFileSync(configFile,'broken settings');
  let prompts=0;
  const dialog={async showMessageBox(){prompts++;return {response:0};},async showOpenDialog(){return {canceled:false,filePaths:[chosen]};}};
  assert.equal((await recovery.prepareProfile({...f,dialog})).profile,chosen);assert.equal(prompts,1);
  assert.equal(storage.readProfile(f.appData),chosen);
  const backup=fs.readdirSync(path.dirname(configFile)).find(n=>n.startsWith('storage.json.before-recovery-'));
  assert.equal(fs.readFileSync(path.join(path.dirname(configFile),backup),'utf8'),'broken settings');
  assert.equal(fs.existsSync(path.join(f.profile,'data')),false);
});
test('unavailable registered storage offers recovery again after invalid selection, then opens selected records',async t=>{
  const f=fixture(t),chosen=path.join(f.root,'chosen');f.records(path.join(chosen,'data'));
  const {configFile}=storage.storagePaths(f.appData);fs.mkdirSync(path.dirname(configFile),{recursive:true});fs.writeFileSync(configFile,JSON.stringify({profile:f.profile}));
  let picks=0;const dialog={async showMessageBox(){return {response:0};},async showOpenDialog(){return {canceled:false,filePaths:[picks++?chosen:path.join(f.root,'invalid')]};}};
  assert.equal((await recovery.prepareProfile({...f,dialog})).profile,chosen);assert.equal(picks,2);
  assert.equal(storage.readProfile(f.appData),chosen);
});
test('fresh install and isolated profiles do not adopt unrelated records; user cancellation preserves setting',async t=>{
  const f=fixture(t);const dialog={async showMessageBox(){return {response:2};}};
  assert.equal((await recovery.prepareProfile({...f,dialog})).firstRun,true);
  f.records(f.source);
  const explicitProfile=path.join(f.root,'isolated');assert.equal((await recovery.prepareProfile({...f,explicitProfile,dialog})).profile,explicitProfile);
  const {configFile}=storage.storagePaths(f.appData);fs.mkdirSync(path.dirname(configFile),{recursive:true});fs.writeFileSync(configFile,'broken');
  assert.equal(await recovery.prepareProfile({...f,dialog}),null);assert.equal(fs.readFileSync(configFile,'utf8'),'broken');
});
test('copy failure never publishes partial data or changes source',t=>{
  const f=fixture(t);f.records(f.source);const original=fs.cpSync;
  fs.cpSync=(...args)=>{original(...args);fs.writeFileSync(path.join(args[1],'history.bin'),'corrupt copy');};
  try {assert.throws(()=>recovery.restoreRecords(f.source,f.profile),/복사 중/);} finally {fs.cpSync=original;}
  assert.equal(fs.existsSync(path.join(f.profile,'data')),false);assert.deepEqual(fs.readFileSync(path.join(f.source,'history.bin')),Buffer.from([0,255,17]));
});
