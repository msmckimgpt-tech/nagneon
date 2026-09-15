const {app,BrowserWindow}=require('electron');
const {resolve,join}=require('node:path');
const fs=require('node:fs');
const out=resolve(process.argv.find(a=>a.startsWith('--out='))?.slice(6)||'artifacts/audience-model-benchmark');
fs.mkdirSync(out,{recursive:true});app.setPath('userData',join(out,'fixture-profile'));
app.whenReady().then(async()=>{
  try{
    const win=new BrowserWindow({width:1000,height:680,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
    await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><html><body style="margin:0;background:#172333;color:white;font:24px Segoe UI"><main style="padding:36px"><h1>NAGNEON TEST ARENA</h1><p>Fictional game scene</p><p>PLAYER HP: 20 / 100 &nbsp; ROUND: 3</p><div style="background:#273b4d;height:260px;display:grid;place-items:center;font-size:52px;color:#f3c974">BOSS DEFEATED</div><p>TIME 02:31 &nbsp; SCORE 1250</p></main></body></html>'));
    fs.writeFileSync(join(out,'vision.png'),(await win.webContents.capturePage()).toPNG());win.destroy();app.quit();
  }catch(error){console.error(error);app.exit(1);}
});
