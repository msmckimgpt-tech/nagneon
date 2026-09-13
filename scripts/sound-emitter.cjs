// Separate process: generated tones exercise real Windows output loopback.
const {app,BrowserWindow}=require('electron');
const {join}=require('node:path');
const {existsSync}=require('node:fs');
app.setPath('userData',join(process.argv[2],'emitter-profile'));
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
let win;app.whenReady().then(async()=>{
  win=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});
  await win.loadURL('data:text/html,<title>Generated sound fixture</title>');
  await win.webContents.executeJavaScript(`window.ctx=new AudioContext();window.osc=ctx.createOscillator();window.g=ctx.createGain();osc.frequency.value=880;g.gain.value=.12;osc.connect(g).connect(ctx.destination);osc.start();ctx.resume();`,true);
  console.log('SOUND_FIXTURE_READY');
  process.stdin.on('data',()=>app.quit());setTimeout(()=>app.quit(),90000).unref();
  setInterval(()=>{if(existsSync(join(process.argv[2],'stop-emitter')))app.quit();},250).unref();
});
