// Real isolated Electron window and synthetic session; no platform or device access.
const {app,BrowserWindow,session}=require('electron');
const {resolve,join}=require('node:path');
const {pathToFileURL}=require('node:url');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {createStudioSession}=require('../desktop/session.cjs');
const {applyOverlayPrivacy}=require('../desktop/overlay-privacy.cjs');
const out=resolve('artifacts/public-overlay');fs.mkdirSync(out,{recursive:true});
app.setPath('userData',join(out,'profile'));
let service,win;
app.whenReady().then(async()=>{
  try{
    const {startServer}=await import(pathToFileURL(resolve('server/index.js')).href);
    service=await startServer({port:0,persist:false,localSpeech:false,provider:{status:()=>({configured:false})}});
    const settings=service.studio.settings;assert.equal(settings.overlayMode,'private');
    win=new BrowserWindow({width:420,height:720,show:false,webPreferences:{session:createStudioSession(session,service),contextIsolation:true,sandbox:true}});
    applyOverlayPrivacy(win,settings);assert.equal(win.isContentProtected(),true);
    service.studio.configure({...settings,overlayMode:'public'});
    applyOverlayPrivacy(win,service.studio.settings);assert.equal(win.isContentProtected(),false);
    await win.loadURL(service.url+'/overlay');
    for(let i=0;i<150;i++){
      if(await win.webContents.executeJavaScript('!!document.querySelector(".overlay-public-disclosure")'))break;
      await new Promise(r=>setTimeout(r,40));
    }
    assert.equal(await win.webContents.executeJavaScript('document.querySelector(".overlay-public-disclosure").textContent.includes("AI 관객")'),true);
    assert.equal(await win.webContents.executeJavaScript('document.querySelector(".overlay-public-disclosure").textContent.includes("가상 포인트")'),true);
    assert.equal(await win.webContents.executeJavaScript('document.querySelector(".overlay-public-disclosure").textContent.includes("이전 장면이나 대화에 늦게 도착")'),true);
    assert.equal(await win.webContents.executeJavaScript('getComputedStyle(document.querySelector(".overlay-public-disclosure")).opacity'),'1');
    const {donationMessage}=await import(pathToFileURL(resolve('server/chat-attention.js')).href);
    service.studio.publishMessage(donationMessage({id:'overlay-test',at:Date.now(),name:'합성 관객',personaId:'synthetic',amount:25,text:'가상 포인트 표시 검사',anonymous:false}));
    for(let i=0;i<100;i++){
      if(await win.webContents.executeJavaScript('!!document.querySelector(".donation-toast")'))break;
      await new Promise(r=>setTimeout(r,40));
    }
    await new Promise(r=>setTimeout(r,400));
    assert.equal(await win.webContents.executeJavaScript(`(()=>{const note=document.querySelector('.overlay-public-disclosure'),toast=document.querySelector('.donation-toast');return !!toast&&toast.getBoundingClientRect().top>=note.getBoundingClientRect().bottom&&toast.textContent.includes('실제 금전 후원이 아닙니다');})()`),true,'public donation does not obscure the disclosure');
    fs.writeFileSync(join(out,'public.png'),(await win.webContents.capturePage()).toPNG());
    service.studio.configure({...settings,overlayMode:'private'});
    applyOverlayPrivacy(win,service.studio.settings);assert.equal(win.isContentProtected(),true);
    fs.writeFileSync(join(out,'result.json'),JSON.stringify({passed:true,synthetic:true,nativeProtectionModes:true,publicDisclosure:true,obsCaptureVerified:false},null,2));
  }catch(error){console.error(error);process.exitCode=1;fs.writeFileSync(join(out,'result.json'),JSON.stringify({passed:false,error:error.stack}));}
  finally{win?.destroy();await service?.close();app.exit(process.exitCode||0);}
});
