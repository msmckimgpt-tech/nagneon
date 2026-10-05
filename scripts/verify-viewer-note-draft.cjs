// Synthetic notes/provider; real HTTP, persisted profile, React and Electron.
const {app,BrowserWindow,session}=require('electron');
const {resolve,join}=require('node:path');
const {pathToFileURL}=require('node:url');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {createStudioSession}=require('../desktop/session.cjs');
fs.mkdirSync(resolve('artifacts'),{recursive:true});
const out=fs.mkdtempSync(resolve('artifacts/viewer-note-'));
app.setPath('userData',join(out,'profile'));app.on('window-all-closed',()=>{});
let service,win;const result={passed:false,synthetic:true,checks:[],modelCalls:0};
const provider={status:()=>({kind:'codex',configured:false}),react:async()=>{result.modelCalls++;throw Error('Unexpected model call');}};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 try{
  const {startServer}=await import(pathToFileURL(resolve('server/index.js')).href);
  const {defaults}=await import(pathToFileURL(resolve('shared/defaults.js')).href);
  const options={port:0,persist:true,dataDir:join(out,'data'),localSpeech:false,provider};
  service=await startServer(options);service.studio.ai.update({paused:true});
  service.studio.world.change(d=>{
   for(const id of ['pop','momo']){const p=defaults.personas.find(p=>p.id===id);d.settings.personas.push({...p,system:false});d.audience.members[id]={sessions:1,seconds:600,recognized:0,affinity:.2,peers:{},memories:[],note:id==='pop'?'처음 메모':'다른 관객 메모',aliases:[]};}
  });
  const headers={Authorization:'Bearer '+service.accessToken,'X-Backseat-Client':'studio','Content-Type':'application/json'};
  assert.equal((await fetch(service.url+'/api/onboarding',{method:'POST',headers,body:JSON.stringify({skip:true})})).status,200);
  const js=code=>win.webContents.executeJavaScript(code);
  const until=async code=>{for(let i=0;i<150;i++){if(await js(code))return;await wait(40);}throw Error('Timed out: '+code);};
  const card=`[...document.querySelectorAll('.persona-card')].find(c=>c.querySelector('h2')?.textContent==='팝콘도둑')`;
  const note=`(${card})?.querySelector('textarea')`;
  const save=`[...(${card})?.querySelectorAll('button')||[]].find(b=>b.textContent==='메모 저장')`;
  const type=async text=>{assert.equal(await js(`(()=>{const e=${note};if(!e)return false;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`),true);};
  const open=async()=>{
   win=new BrowserWindow({width:1280,height:900,show:false,webPreferences:{offscreen:true,backgroundThrottling:false,session:createStudioSession(session,service),contextIsolation:true,sandbox:true}});
   await win.loadURL(service.url);await until(`!!document.querySelector('.app-shell')`);
   await js(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='나의 관객').click()`);await until(`!!document.querySelector('.persona-card textarea')`);
  };
  await open();assert.equal(await js(`${note}.value`),'처음 메모');
  // Server commits and SSE arrives, but the HTTP acknowledgement is delayed.
  await js(`window.originalNoteFetch=window.fetch;window.noteReplyReady=false;window.fetch=async(...args)=>{const reply=await window.originalNoteFetch(...args);if(String(args[0]).endsWith('/audience/pop/note')){window.noteReplyReady=true;await new Promise(r=>window.releaseNoteReply=r);}return reply;};void 0`);
  await type('첫 저장');await until(`!${save}.disabled`);await js(`${save}.click()`);await until('window.noteReplyReady');
  assert.equal(service.studio.audience.data.members.pop.note,'첫 저장');
  await type('응답 대기 중 추가한 새 초안');await js('window.releaseNoteReply()');await wait(150);
  assert.equal(await js(`${note}.value`),'응답 대기 중 추가한 새 초안','older acknowledgement must not erase newer typing');
  assert.equal(await js(`${save}.disabled`),false);assert.equal(await js(`(${card}).innerText.includes('메모를 저장했습니다.')`),false);
  result.checks.push('newer draft survives delayed older save and remains unsaved');
  await js('window.fetch=window.originalNoteFetch;void 0');
  // HTTP succeeds before the renderer has received the new authoritative note.
  const publish=service.studio.publish;service.studio.publish=()=>{};
  try{
   await js(`${save}.click()`);await until(`(${card}).innerText.includes('메모를 저장했습니다.')`);await wait(100);
   assert.equal(await js(`${note}.value`),'응답 대기 중 추가한 새 초안','stale state must not erase acknowledged draft');
   assert.equal(service.studio.audience.data.members.pop.note,'응답 대기 중 추가한 새 초안');
  }finally{service.studio.publish=publish;service.studio.publish();}
  result.checks.push('successful save keeps text while SSE state is delayed');
  // A failed save preserves the editable draft and leaves stored content intact.
  await js(`window.fetch=async(...args)=>String(args[0]).endsWith('/audience/pop/note')?new Response(JSON.stringify({error:'합성 저장 실패'}),{status:500,headers:{'Content-Type':'application/json'}}):window.originalNoteFetch(...args);void 0`);
  await type('실패 후 다시 저장할 초안');await js(`${save}.click()`);await until(`document.body.innerText.includes('합성 저장 실패')`);
  assert.equal(await js(`${note}.value`),'실패 후 다시 저장할 초안');assert.equal(service.studio.audience.data.members.pop.note,'응답 대기 중 추가한 새 초안');
  await js('window.fetch=window.originalNoteFetch;void 0');await until(`!${save}.disabled`);await js(`${save}.click()`);await until(`(${card}).innerText.includes('메모를 저장했습니다.')`);
  assert.equal(await js(`document.body.innerText.includes('합성 저장 실패')`),false);
  result.checks.push('failure preserves draft and retry saves it');
  service.studio.world.change(d=>{const p=d.settings.personas.find(p=>p.id==='pop');d.audience.members.pop.aliases.push({name:p.name,at:Date.now()});p.name='새닉네임';});service.studio.publish();
  await until(`document.querySelector('[aria-label="새닉네임 메모"]')?.value==='실패 후 다시 저장할 초안'`);
  assert.equal(service.studio.audience.data.members.momo.note,'다른 관객 메모');
  await js(`document.querySelector('[aria-label="새닉네임 메모"]').scrollIntoView({block:'center'})`);await wait(100);
  fs.writeFileSync(join(out,'notes.png'),(await win.webContents.capturePage()).toPNG());
  win.destroy();win=null;await service.close();service=null;service=await startServer(options);await open();
  await until(`document.querySelector('[aria-label="새닉네임 메모"]')?.value==='실패 후 다시 저장할 초안'`);
  assert.equal(service.studio.audience.data.members.momo.note,'다른 관객 메모');
  result.checks.push('stable viewer identity keeps note through rename and persisted server restart; peer note untouched');
  service.studio.world.change(d=>{d.audience.members.pop.note='다른 연결에서 갱신한 메모';});service.studio.publish();
  await until(`document.querySelector('[aria-label="새닉네임 메모"]')?.value==='다른 연결에서 갱신한 메모'`);
  result.checks.push('clean draft still accepts a genuinely changed remote note');
  assert.equal(result.modelCalls,0);result.passed=true;
 }catch(error){result.error=error.stack;console.error(error);process.exitCode=1;if(win&&!win.isDestroyed())try{fs.writeFileSync(join(out,'failure.png'),(await win.webContents.capturePage()).toPNG());}catch{}}
 finally{win?.destroy();try{await service?.close();}catch(error){result.passed=false;result.cleanupError=error.message;process.exitCode=1;}fs.writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({output:out,...result}));app.exit(process.exitCode||0);}
});
