// Real Chromium + local HTTP. Synthetic in-memory state; no accounts/devices.
const {app,BrowserWindow,session}=require('electron');
const {createServer}=require('node:http');
const {Server}=require('node:net');
const {resolve,join}=require('node:path');
const {pathToFileURL}=require('node:url');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {createStudioSession}=require('../desktop/session.cjs');
fs.mkdirSync(resolve('artifacts'),{recursive:true});
const out=fs.mkdtempSync(resolve('artifacts/browser-loopback-'));
app.setPath('userData',join(out,'profile'));
// The rejected-port probe closes before the product window is created.
app.on('window-all-closed',()=>{});
let service,win,probe;const originalListen=Server.prototype.listen;
const result={passed:false,synthetic:true,checks:[]};

async function fixturePort(){
  for(const port of [6000,6667,10080]){
    const s=createServer();
    try{await new Promise((yes,no)=>{s.once('error',no);s.listen(port,'127.0.0.1',yes);});return port;}
    catch(error){if(error.code!=='EADDRINUSE')throw error;}
    finally{if(s.listening)await new Promise(r=>s.close(r));}
  }
  throw Error('No restricted fixture port available');
}

app.whenReady().then(async()=>{
  try{
    const blocked=await fixturePort();
    probe=new BrowserWindow({show:false,webPreferences:{offscreen:true,contextIsolation:true,sandbox:true}});
    await assert.rejects(probe.loadURL(`http://127.0.0.1:${blocked}/`),error=>error.code==='ERR_UNSAFE_PORT'||String(error).includes('ERR_UNSAFE_PORT'));
    probe.destroy();probe=null;result.checks.push('Chromium still blocks restricted ports');
    let injected=false,modelCalls=0;
    Server.prototype.listen=function(...args){
      const port=typeof args[0]==='object'?args[0].port:args[0];
      if(port===0&&!injected){injected=true;args[0]=typeof args[0]==='object'?{...args[0],port:blocked}:blocked;}
      return originalListen.apply(this,args);
    };
    const {startServer}=await import(pathToFileURL(resolve('server/index.js')).href);
    service=await startServer({port:0,persist:false,localSpeech:false,provider:{status:()=>({kind:'codex',configured:false}),react:()=>{modelCalls++;throw Error('Unexpected model call');}}});
    Server.prototype.listen=originalListen;
    assert.equal(injected,true);assert.notEqual(Number(new URL(service.url).port),blocked);
    assert.equal(service.server.address().address,'127.0.0.1');
    result.checks.push('restricted OS assignment replaced with an owned loopback listener');
    win=new BrowserWindow({width:1000,height:800,show:false,webPreferences:{offscreen:true,session:createStudioSession(session,service),contextIsolation:true,sandbox:true}});
    await win.loadURL(service.url);
    let ready=false;
    for(let i=0;i<150;i++){
      ready=await win.webContents.executeJavaScript('!!document.querySelector(".welcome-shell")');
      if(ready)break;await new Promise(r=>setTimeout(r,40));
    }
    assert.equal(ready,true,'first-run UI rendered');
    assert.equal(await win.webContents.executeJavaScript('fetch("/api/state").then(r=>r.status)'),200);
    const denied=await fetch(service.url+'/api/state');assert.equal(denied.status,401);await denied.text();
    assert.equal(modelCalls,0);
    fs.writeFileSync(join(out,'welcome.png'),(await win.webContents.capturePage()).toPNG());
    result.checks.push('real first-run UI and authenticated renderer fetch succeed; unauthenticated request rejected; no model calls');
    result.blockedPort=blocked;result.selectedPort=Number(new URL(service.url).port);
    win.destroy();win=null;await service.close();assert.equal(service.server.listening,false);service=null;
    result.checks.push('normal close releases the final listener');result.passed=true;
  }catch(error){result.error=error.stack;console.error(error);process.exitCode=1;}
  finally{
    Server.prototype.listen=originalListen;probe?.destroy();win?.destroy();
    try{await service?.close();}catch(error){result.passed=false;result.cleanupError=error.message;process.exitCode=1;}
    fs.writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify({output:out,...result}));app.exit(process.exitCode||0);
  }
});
