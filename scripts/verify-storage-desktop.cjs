// Real Electron renderer and product IPC/shutdown, isolated profile and dialog
// responses. Does not access personal saves or capture physical devices.
const {app,BrowserWindow,dialog}=require('electron');
const fs=require('node:fs');
const {resolve,join}=require('node:path');
const assert=require('node:assert/strict');
const base=resolve('artifacts/storage-native-'+Date.now());
const appData=join(base,'appdata'),source=join(appData,'backseat-studio'),target=join(base,'custom-save');
fs.mkdirSync(join(source,'data'),{recursive:true});
fs.writeFileSync(join(source,'data','onboarding.json'),JSON.stringify({version:1,status:'completed',completedAt:1}));
fs.writeFileSync(join(source,'data','preserve.bin'),Buffer.from([0,255,17]));
app.setPath('appData',appData);
process.env.CODEX_HOME=join(base,'codex');fs.mkdirSync(process.env.CODEX_HOME);
let relaunch=false,ui=false,failure;
app.relaunch=()=>{relaunch=true;};
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[target]});
dialog.showMessageBox=async()=>({response:0});
dialog.showErrorBox=(_title,message)=>{failure=message;};
app.on('quit',()=>{
  let passed=false;
  try{
    assert.equal(failure,undefined);assert.ok(ui&&relaunch);
    assert.equal(JSON.parse(fs.readFileSync(join(appData,'Nagneon','storage.json'),'utf8')).profile,target);
    assert.deepEqual(fs.readFileSync(join(target,'data','preserve.bin')),Buffer.from([0,255,17]));
    assert.ok(fs.existsSync(join(source,'data','preserve.bin')));passed=true;
  }catch(error){failure=String(error);}
  fs.writeFileSync(join(base,'result.json'),JSON.stringify({passed,ui,relaunch,failure,base,isolated:true,dialogs:'simulated',devices:false},null,2));
  console.log(JSON.stringify({passed,base,failure}));
  if(!passed)process.exitCode=1;
});
require('../desktop/main.cjs');
setTimeout(()=>{failure='timeout';app.exit(2);},60000).unref();
app.whenReady().then(async()=>{
  try{
    let win;
    for(let i=0;i<200;i++){
      win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('http://'));
      if(win&&await win.webContents.executeJavaScript('!!document.querySelector(".app-shell")').catch(()=>false))break;
      await new Promise(r=>setTimeout(r,100));
    }
    const js=code=>win.webContents.executeJavaScript(code);
    assert.equal((await js('window.backseat.storageStatus()')).profile,source);
    await js(`document.querySelector('[data-tutorial="settings"]').click()`);
    await new Promise(r=>setTimeout(r,200));
    await js(`document.getElementById('settings-tab-media').click()`);
    await new Promise(r=>setTimeout(r,300));
    assert.ok(await js(`document.querySelector('[aria-label="저장 위치"]').textContent.includes(${JSON.stringify(source)})`));
    fs.writeFileSync(join(base,'settings.png'),(await win.webContents.capturePage()).toPNG());ui=true;
    await js('window.backseat.changeStorage(false)').catch(()=>{});
  }catch(error){failure=String(error);app.quit();}
});
