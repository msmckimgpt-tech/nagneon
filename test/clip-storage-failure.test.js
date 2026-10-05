import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Clips} from '../server/clips.js';

const now=100000;
const bytes=Buffer.concat([Buffer.from('1a45dfa3','hex'),Buffer.alloc(128)]);
const metadata={kind:'video',hasAudio:true,audioLayout:'separate',startedAt:90000,endedAt:now};
function harness(t,options={}){
  const dir=fs.mkdtempSync(join(tmpdir(),'nagneon-clip-write-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const clips=new Clips({dir,now:()=>now,...options});
  const clip=clips.create({title:'Synthetic clip',game:'Test',participants:[],messages:[],sessionId:'test',observedAt:95000});
  return {dir,clips,clip};
}

test('failed filesystem rename leaves no charged temporary recording and retry recovers',t=>{
  const {dir,clips,clip}=harness(t);
  const target=clips.file(clip.id,'webm');
  // A real filesystem collision forces rename failure on Windows and POSIX.
  fs.mkdirSync(target);
  assert.throws(()=>clips.recording(clip.id,bytes,metadata));
  assert.equal(clips.get(clip.id).video,false);
  assert.deepEqual(fs.readdirSync(dir),[clip.id+'.webm']);
  assert.equal(clips.storageUsed(),0);
  fs.rmdirSync(target);
  clips.recording(clip.id,bytes,metadata);
  assert.equal(clips.get(clip.id).video,true);
  assert.deepEqual(fs.readFileSync(target),bytes);
  assert.equal(clips.storageUsed(),bytes.length);
});

for(const stage of ['write','flush','rename'])test(`${stage} failure rolls back only the pending microphone file`,t=>{
  let failing=false;
  const fault=Object.assign(new Error('Synthetic disk failure'),{code:stage==='write'?'ENOSPC':'EIO'});
  const {dir,clips,clip}=harness(t,{fs:{
    writeFileSync(fd,buffer){
      if(failing&&stage==='write'){fs.writeFileSync(fd,buffer.subarray(0,12));throw fault;}
      fs.writeFileSync(fd,buffer);
    },
    fsyncSync(fd){if(failing&&stage==='flush')throw fault;fs.fsyncSync(fd);},
    renameSync(from,to){if(failing&&stage==='rename')throw fault;fs.renameSync(from,to);},
  }});
  clips.recording(clip.id,bytes,metadata);
  // An older, unrelated temporary file is evidence, not ours to delete.
  const preserved=join(dir,'unrelated.webm.tmp');
  fs.writeFileSync(preserved,'preserve');
  const before=clips.get(clip.id),used=clips.storageUsed();
  failing=true;
  assert.throws(()=>clips.recording(clip.id,bytes,{...metadata,kind:'voice'}),error=>error===fault);
  assert.deepEqual(clips.get(clip.id),before);
  assert.deepEqual(fs.readFileSync(clips.file(clip.id,'webm')),bytes);
  assert.equal(fs.readFileSync(preserved,'utf8'),'preserve');
  assert.equal(clips.storageUsed(),used);
  assert.deepEqual(fs.readdirSync(dir).sort(),[clip.id+'.webm','unrelated.webm.tmp'].sort());
  failing=false;
  clips.recording(clip.id,bytes,{...metadata,kind:'voice'});
  assert.equal(clips.get(clip.id).voice,true);
  assert.deepEqual(fs.readFileSync(clips.file(clip.id,'voice.webm')),bytes);
});

test('failed thumbnail write preserves the clip list and closes the file before cleanup',t=>{
  let descriptor,closed=false;
  const {dir,clips,clip}=harness(t,{fs:{
    openSync(...args){descriptor=fs.openSync(...args);return descriptor;},
    writeFileSync(fd,buffer){fs.writeFileSync(fd,buffer.subarray(0,4));throw Error('Synthetic full disk');},
    closeSync(fd){fs.closeSync(fd);closed=true;},
    unlinkSync(path){assert.equal(closed,true);fs.unlinkSync(path);},
  }});
  assert.throws(()=>clips.create({title:'Synthetic failed thumbnail',participants:[],messages:[],image:'data:image/png;base64,'+bytes.toString('base64')}),/full disk/);
  assert.deepEqual(clips.list().map(c=>c.id),[clip.id]);
  assert.equal(closed,true);
  assert.throws(()=>fs.fstatSync(descriptor),{code:'EBADF'});
  assert.deepEqual(fs.readdirSync(dir),[]);
});

test('open failure never deletes a file it could not create',t=>{
  let removed=false;
  const {dir,clips,clip}=harness(t,{fs:{
    openSync(){throw Object.assign(Error('Synthetic access denied'),{code:'EACCES'});},
    unlinkSync(){removed=true;},
  }});
  assert.throws(()=>clips.recording(clip.id,bytes,metadata),{code:'EACCES'});
  assert.equal(removed,false);
  assert.deepEqual(fs.readdirSync(dir),[]);
  assert.equal(clips.get(clip.id).video,false);
});
