// Synthetic profile; real React, HTTP persistence and Electron. No model/devices.
const {app,BrowserWindow,session}=require('electron');
const {resolve,join}=require('node:path');
const {pathToFileURL}=require('node:url');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {createStudioSession}=require('../desktop/session.cjs');
fs.mkdirSync(resolve('artifacts'),{recursive:true});
const out=fs.mkdtempSync(resolve('artifacts/genre-presets-'));
app.setPath('userData',join(out,'profile'));app.on('window-all-closed',()=>{});
let service,win;const result={passed:false,synthetic:true,checks:[],modelCalls:0};
const provider={status:()=>({kind:'codex',configured:false}),react:async()=>{result.modelCalls++;throw Error('Unexpected model call');}};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 try{
  const {startServer}=await import(pathToFileURL(resolve('server/index.js')).href);
  const options={port:0,persist:true,dataDir:join(out,'data'),localSpeech:false,provider};
  service=await startServer(options);service.studio.ai.update({paused:true});
  assert.equal(service.studio.world.data.settings.games.length,10);
  const legacy=structuredClone(service.studio.world.data.settings.games.slice(0,4));
  legacy[1].name='사용자 게임';legacy[1].context='사용자 관찰 지침';legacy[1].popularity=.15;
  service.studio.world.change(d=>{d.settings.games=legacy;d.settings.gameId='league';});
  const headers={Authorization:'Bearer '+service.accessToken,'X-Backseat-Client':'studio','Content-Type':'application/json'};
  assert.equal((await fetch(service.url+'/api/onboarding',{method:'POST',headers,body:JSON.stringify({skip:true})})).status,200);
  const js=code=>win.webContents.executeJavaScript(code);
  const until=async code=>{for(let i=0;i<150;i++){if(await js(code))return;await wait(40);}throw Error('Timed out: '+code);};
  const click=async label=>{assert.equal(await js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)});if(!b||b.disabled)return false;b.click();return true;})()`),true,'button '+label);};
  const open=async()=>{
   win=new BrowserWindow({width:1280,height:900,show:false,webPreferences:{offscreen:true,backgroundThrottling:false,session:createStudioSession(session,service),contextIsolation:true,sandbox:true}});
   await win.loadURL(service.url);await until(`!!document.querySelector('.app-shell')`);
  };
  const settings=async()=>{await click('방송 설정');await until(`!!document.querySelector('.settings-dialog')`);await click('게임');await until(`!!document.querySelector('#settings-panel-games')`);};
  const count=()=>js(`document.querySelectorAll('#settings-panel-games .persona-editor').length`);
  await open();await settings();assert.equal(await count(),4);
  await click('장르 기본값 추가');await until(`document.querySelectorAll('#settings-panel-games .persona-editor').length===10`);
  assert.equal(service.studio.world.data.settings.games.length,4);
  await click('방송 설정 창 닫기');await settings();assert.equal(await count(),4);
  result.checks.push('unsaved additions are discarded without changing persisted games');
  await click('장르 기본값 추가');await until(`document.querySelectorAll('#settings-panel-games .persona-editor').length===10`);
  assert.equal(await js(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='장르 기본값 추가됨').disabled`),true);
  await wait(200);
  fs.writeFileSync(join(out,'games.png'),(await win.webContents.capturePage()).toPNG());
  await click('설정 저장');await until(`!document.querySelector('.settings-dialog')`);
  assert.deepEqual(service.studio.world.data.settings.games.slice(0,4),legacy);
  assert.equal(service.studio.world.data.settings.gameId,'league');
  assert.equal(service.studio.world.data.settings.games.length,10);
  win.destroy();win=null;await service.close();service=null;service=await startServer(options);
  assert.deepEqual(service.studio.world.data.settings.games.slice(0,4),legacy);
  assert.equal(service.studio.world.data.settings.gameId,'league');
  assert.equal(service.studio.world.data.settings.games.length,10);
  await open();await settings();assert.equal(await count(),10);
  result.checks.push('saved six genres survive server restart; existing names, instructions, popularity and selection preserved');
  assert.equal(result.modelCalls,0);result.passed=true;
 }catch(error){result.error=error.stack;console.error(error);process.exitCode=1;if(win&&!win.isDestroyed())try{fs.writeFileSync(join(out,'failure.png'),(await win.webContents.capturePage()).toPNG());}catch{}}
 finally{win?.destroy();try{await service?.close();}catch(error){result.passed=false;result.cleanupError=error.message;process.exitCode=1;}fs.writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({output:out,...result}));app.exit(process.exitCode||0);}
});
