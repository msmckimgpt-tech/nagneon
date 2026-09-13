// Plain Node against modules extracted from the exact delivered ASAR.
// Synthetic provider/clock; no app window, user profile, account or device.
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {extractAll} from '@electron/asar';
import assert from 'node:assert/strict';

const {folder}=JSON.parse(await readFile('artifacts/latest-package.json','utf8'));
const archive=join(folder,'resources/app.asar'),sha=async()=>createHash('sha256').update(await readFile(archive)).digest('hex');
const archiveSha256=await sha(),appRoot=await mkdtemp(resolve('artifacts/delivered-continuity-'));
extractAll(archive,appRoot);assert.equal(await sha(),archiveSha256);
const load=name=>import(pathToFileURL(join(appRoot,name)));
const [{Studio},{Audience},{defaults},{SCREEN_REACTION_TTL_MS}]=await Promise.all([load('server/studio.js'),load('server/audience.js'),load('shared/defaults.js'),load('server/viewing-continuity.js')]);
const report={folder,archiveSha256,appRoot,at:new Date().toISOString(),deliveredModules:true,liveModel:false,devices:false,userData:false,checks:[],passed:false};
let at=100000,held,delay=false,input;
const observation={game:'Synthetic',scene:'ROUND 1 CLEAR',confidence:.9,excitement:.4,messages:[{personaId:'pop',text:'합성 관문의 첫 성공',kind:'chat',spoiler:false}]};
const s=new Studio({provider:{status:()=>({configured:true}),react:async args=>{input=args;return delay?new Promise(r=>held=r):{observation};}},settings:{...defaults,mode:'live',lurkRatio:0,slowModeSeconds:0},audience:new Audience(undefined,()=>{},()=>.5),now:()=>at,random:()=>.5});clearInterval(s.timer);
try{
  s.start();await s.react({image:'synthetic-one'});at+=2000;s.pump();assert.equal(s.messages.filter(m=>m.kind==='chat').length,1);
  for(let i=0;i<12;i++){at+=15000;assert.equal((await s.react({image:'synthetic-one'})).skipped,'unchanged-input');s.pump();}
  assert.equal(s.calls,1);assert.equal(s.messages.filter(m=>m.kind==='chat').length,1);assert.ok(s.knowledge.get('Synthetic').watched.pop>=180);report.checks.push('unchanged input idles while witnessed viewing time grows');
  at+=15000;await s.react({image:'synthetic-one',speech:'아까 관문에서 어땠어요?'});assert.equal(s.calls,2);assert.ok(input.viewerContext.pop.conversationRhythm.recentReactions.some(m=>m.ageSeconds>=180));assert.ok(input.viewerContext.pop.watchTiming.imageUnchangedSeconds>=180);report.checks.push('retrospective speech reaches delivered provider with reaction age and watch timing');
  at+=15000;s.addMessage('gg','모모님은 퍼즐이랑 탐험 중에 뭐가 좋아요?');await s.react({image:'synthetic-one'});assert.equal(s.calls,3);report.checks.push('new peer address wakes paused-screen conversation');
  s.queue=[];at+=15000;delay=true;const job=s.react({image:'synthetic-two'});at+=SCREEN_REACTION_TTL_MS+1;held({observation});await job;assert.equal(s.queue.length,0);report.checks.push('late screen-only reply is not queued');
  assert.equal(await sha(),archiveSha256);report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{s.close();await writeFile('artifacts/delivered-continuity-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
