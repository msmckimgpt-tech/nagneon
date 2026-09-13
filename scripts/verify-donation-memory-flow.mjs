// Real loopback HTTP and disk restarts, synthetic audience and messages only.
// Optional packaged source is extracted and executed by Node, not Electron.
import assert from 'node:assert/strict';
import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve,dirname,isAbsolute} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {extractAll} from '@electron/asar';

const [outputArg,packageArg]=process.argv.slice(2);
if(!outputArg)throw Error('Usage: node scripts/verify-donation-memory-flow.mjs new-output-directory [package-folder]');
const output=resolve(outputArg),workspace=resolve(dirname(fileURLToPath(import.meta.url)),'..');await mkdir(output,{recursive:true});if((await readdir(output)).length)throw Error('Use a new empty evidence directory');
const hash=async file=>{const h=createHash('sha256');for await(const bytes of createReadStream(file))h.update(bytes);return h.digest('hex');};
async function files(dir,prefix=''){const result=[];for(const e of await readdir(dir,{withFileTypes:true})){assert.ok(!e.isSymbolicLink());if(e.isDirectory())result.push(...await files(join(dir,e.name),prefix+e.name+'/'));else result.push(prefix+e.name);}return result.sort();}
const result={passed:false,packaged:!!packageArg,deviceCapture:false,nativeAppLaunched:false,modelCalls:0,checks:[],sourceHashes:{}};let service;
try{
 let source=workspace,runtime={};
 if(packageArg){
  const folder=resolve(packageArg),manifest=JSON.parse(await readFile(join(dirname(dirname(folder)),'manifest.json'),'utf8'));result.folder=folder;result.inventoryFiles=0;
  for(const file of manifest.files){assert.ok(!isAbsolute(file.path)&&!file.path.split(/[\\/]/).includes('..'));assert.equal(await hash(join(folder,file.path)),file.sha256,file.path);result.inventoryFiles++;}
  source=join(output,'source');extractAll(join(folder,'resources/app.asar'),source);result.asarSha256=await hash(join(folder,'resources/app.asar'));
  const frontend=await files(join(workspace,'dist'));assert.deepEqual(await files(join(source,'dist')),frontend);for(const file of frontend)assert.equal(await hash(join(source,'dist',file)),await hash(join(workspace,'dist',file)));result.frontendFiles=frontend.length;
  const {packagedRuntime}=await import(pathToFileURL(join(source,'desktop/runtime.cjs')));runtime=packagedRuntime(join(folder,'resources'));
 }
 for(const name of ['server/conversation-journal.js','server/journal-store.js','server/chat-attention.js','server/economy.js','server/studio.js','server/provider.js','server/index.js']){result.sourceHashes[name]=await hash(join(source,name));assert.equal(result.sourceHashes[name],await hash(join(workspace,name)),name+' differs from tested source');}
 const {startServer}=await import(pathToFileURL(join(source,'server/index.js'))),{defaults}=await import(pathToFileURL(join(source,'shared/defaults.js'))),{donationMessage}=await import(pathToFileURL(join(source,'server/chat-attention.js')));
 const profile=join(output,'profile');
 const open=()=>startServer({port:0,dataDir:profile,localSpeech:false,runtime,provider:{status:()=>({configured:true}),react:async()=>{result.modelCalls++;throw Error('No model call allowed');}}});
 const request=async(path,method='GET',body)=>{
  const response=await fetch(service.url+path,{method,headers:{Authorization:'Bearer '+service.accessToken,'X-Backseat-Client':'studio',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal(response.status,200,path);return response.json();
 };
 service=await open();let s=service.studio;
 // Seed an existing audience in this new synthetic profile; production's
 // autonomous arrival flow is unchanged and never runs this fixture.
 s.world.change(d=>{d.settings.personas=structuredClone(defaults.personas);d.settings.managerId=defaults.managerId;d.settings.mode='live';d.settings.category='just-chatting';d.settings.lurkRatio=0;
  for(const p of d.settings.personas){d.audience.members[p.id]={sessions:1,seconds:600,recognized:0,affinity:.8,peers:{},memories:[],origin:{key:'direct',label:'Synthetic',firstSeenAt:1}};s.economy.wallet(d.economy,p.id);}
 });s.audience.random=()=>.5;s.start();
 const gifts=s.economy.reward({settings:s.settings,audience:s.audience,hasInput:true,observation:{confidence:.95,excitement:.95,positiveMoment:{positive:true,impact:.95,reason:'Synthetic witnessed success',signature:'synthetic-private-gift',supporters:['momo'],donations:[{personaId:'momo',message:'퍼즐 해결 축하해요',anonymous:true}]}}});
 assert.equal(gifts.length,1);const gift=s.publishMessage(donationMessage(gifts[0]));s.journal.pin(gift.id,true);
 const clip=s.clips.create({title:'합성 후원 순간',game:'Just Chatting',scene:'합성 대화 기록',source:'spectator',creator:{id:'pop',name:'팝콘'},sessionId:s.sessionId,participants:[{id:'pop',name:'팝콘'}],messages:s.messages});
 const amount=gift.donation.amount,balance=s.economy.data.balance;
 const checkGift=e=>{assert.equal(e.kind,'donation');assert.equal(e.personaId,'anonymous');assert.equal(e.name,'익명의 관객');assert.deepEqual(e.donation,{amount,anonymous:true});assert.equal(e.donorId,undefined);};
 checkGift((await request('/api/journal?query='+encodeURIComponent('후원'))).entries[0]);result.checks.push('live-gift-and-search');
 assert.equal((await fetch(service.url+'/api/donations')).status,401);result.checks.push('unauthenticated-lookup-rejected');
 await service.close();service=null;
 service=await open();s=service.studio;s.world.change(d=>{d.settings.personas.find(p=>p.id==='momo').name='합성새닉네임';});
 const remembered=(await request('/api/journal?query='+encodeURIComponent('후원'))).entries[0];checkGift(remembered);assert.equal(remembered.pinned,true);
 const recalled=s.journal.recall('pop','이전 퍼즐 후원');assert.equal(recalled[0].speakerId,'anonymous');assert.equal(recalled[0].donation.amount,amount);assert.deepEqual(s.journal.recall('unseen','이전 퍼즐 후원'),[]);result.checks.push('restart-witness-recall-and-anonymity');
 checkGift((await request('/api/clips/'+clip.id)).messages[0]);checkGift((await request('/api/export')).conversationJournal.entries[0]);result.checks.push('clip-and-export-preserve-event');
 const entries=(await request('/api/donations')).entries;assert.equal(entries[0].donorId,'momo');assert.equal(entries[0].donorName,'모모');assert.equal(entries[0].currentName,'합성새닉네임');assert.equal(s.economy.data.balance,balance);result.checks.push('free-private-lookup-after-rename');
 await request('/api/journal/'+gift.id,'DELETE');await service.close();service=null;
 service=await open();s=service.studio;assert.equal((await request('/api/journal?query='+encodeURIComponent('후원'))).total,0);assert.deepEqual(s.journal.recall('pop','이전 후원'),[]);
 assert.equal((await request('/api/donations')).entries[0].donorId,'momo');assert.equal(s.economy.data.balance,balance);result.checks.push('second-restart-deletion-without-refund');
 result.amount=amount;result.balance=balance;result.passed=true;
}catch(error){result.error=error.stack;process.exitCode=1;}
finally{await service?.close();await writeFile(join(output,'result.json'),JSON.stringify(result,null,2));}
console.log(JSON.stringify(result,null,2));
