const {app,BrowserWindow}=require('electron');
const {join}=require('node:path');
app.setPath('userData',join(__dirname,'../artifacts/fixture-profile'));
app.whenReady().then(async()=>{
  const win=new BrowserWindow({width:1000,height:680,title:'Backseat Capture Fixture',webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
  await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(`<!doctype html><html><head><title>Backseat Capture Fixture</title></head><body style="margin:0;background:#172333;color:#fff;font:24px Segoe UI"><div style="padding:36px"><h1>BACKSEAT TEST ARENA</h1><p>LOCAL CAPTURE TEST — fictional game scene</p><div style="display:flex;gap:60px;color:#bfee88"><p>PLAYER HP: 20 / 100</p><p>ROUND: 3</p></div><div style="background:#273b4d;height:260px;display:grid;place-items:center;font-size:52px;color:#f3c974">BOSS DEFEATED</div><p>TIME 02:31 · SCORE 1250</p></div></body></html>`));
  win.show();const image=await win.webContents.capturePage();require('node:fs').writeFileSync(join(__dirname,'../artifacts/vision-fixture.png'),image.toPNG());
});
app.on('window-all-closed',()=>app.quit());
