// Executes the actual desktop entrypoint with an isolated profile. No model
// generation or microphone input. Covers IPC and native overlay close paths.
const {app,BrowserWindow,dialog}=require('electron');
const {mkdirSync,writeFileSync,readFileSync}=require('node:fs');
const {createHash}=require('node:crypto');
const {resolve}=require('node:path');
const assert=require('node:assert/strict');
const profile=resolve('artifacts/lifecycle-profile-'+Date.now());mkdirSync(profile,{recursive:true});
process.argv.push('--backseat-profile='+profile);
process.env.BACKSEAT_PYTHON=resolve(profile,'speech-disabled-for-ui-test.exe');
const report={profile,checkedAt:new Date().toISOString(),mainSha256:createHash('sha256').update(readFileSync('desktop/main.cjs')).digest('hex'),checks:[]};
let closing=false,failed=false,main;
function fail(error){failed=true;report.passed=false;report.error=error.message||String(error);writeFileSync('artifacts/desktop-lifecycle-test.json',JSON.stringify(report,null,2));console.error(report.error);app.exit(1);}
process.on('uncaughtException',fail);process.on('unhandledRejection',fail);
dialog.showErrorBox=(title,text)=>fail(new Error(title+': '+text));
const until=async test=>{const deadline=Date.now()+5000;while(!test()){if(Date.now()>deadline)throw new Error('Window lifecycle timed out');await new Promise(r=>setTimeout(r,40));}};
app.on('quit',()=>{
  if(failed)return;
  report.passed=closing&&report.checks.length===4;
  if(!report.passed)report.error='App quit before lifecycle completed';
  writeFileSync('artifacts/desktop-lifecycle-test.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
});
app.on('browser-window-created',(_event,win)=>{
  if(main)return;main=win;
  win.webContents.once('did-finish-load',async()=>{
    try{
      await win.webContents.executeJavaScript('backseat.openOverlay()');
      let overlay=BrowserWindow.getAllWindows().find(w=>w!==win);assert.ok(overlay);
      const state=await overlay.webContents.executeJavaScript("fetch('/api/state').then(r=>r.json())");assert.equal(state.running,false);assert.equal(state.calls,0);report.checks.push('overlay shares authenticated session without starting a broadcast');
      const account=await win.webContents.executeJavaScript('backseat.accountStatus()');assert.equal(account.status,'idle');assert.equal(account.code,undefined);
      for(const call of ['backseat.accountStatus()','backseat.startAccountLogin("browser")','backseat.openAccountLogin()'])assert.equal(await overlay.webContents.executeJavaScript(call+'.then(()=>false,()=>true)'),true);
      await win.webContents.executeJavaScript('backseat.closeOverlay()');await until(()=>overlay.isDestroyed());
      assert.equal(await win.webContents.executeJavaScript('backseat.toggleClickThrough()'),false);report.checks.push('IPC close followed by click-through request is harmless');
      await win.webContents.executeJavaScript('backseat.openOverlay()');overlay=BrowserWindow.getAllWindows().find(w=>w!==win);assert.ok(overlay);
      overlay.close();await until(()=>overlay.isDestroyed());report.checks.push('reopened overlay can close through native window lifecycle');
      report.checks.push('main closes after an already-closed overlay');closing=true;win.close();
    }catch(error){fail(error);}
  });
});
setTimeout(()=>fail(new Error('Desktop lifecycle watchdog expired')),40000).unref();
require('../desktop/main.cjs');
