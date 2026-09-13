// Real Windows enumeration and previews through the production policy.
// No capture consent, media stream, network, microphone or AI request.
const {app,BrowserWindow,session,desktopCapturer}=require('electron');
const {attachCapture}=require('../desktop/capture.cjs');
const {resolve,join}=require('node:path');
const {mkdirSync,writeFileSync}=require('node:fs');
const assert=require('node:assert/strict');
const base=resolve('artifacts/capture-native-'+Date.now());mkdirSync(base);app.setPath('userData',join(base,'profile'));
const report={passed:false,base,nativeWindows:true,requestedMediaStream:false,operations:[]};
let main,fixture;setTimeout(()=>app.exit(2),90000).unref();app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
  try{
    main=new BrowserWindow({show:false,webPreferences:{sandbox:true}});
    fixture=new BrowserWindow({width:500,height:320,show:true,title:'Capture picker native fixture',webPreferences:{sandbox:true}});
    await fixture.loadURL('data:text/html,'+encodeURIComponent('<title>Capture picker native fixture</title><body style="background:#192b39;color:#c8eea7;font:24px sans-serif;padding:32px">BACKSEAT<br><br>Native preview fixture</body>'));
    fixture.show();fixture.focus();await fixture.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
    const handlers={};attachCapture({main,session:session.defaultSession,ipcMain:{handle:(name,fn)=>handlers[name]=fn},desktopCapturer});
    const event={sender:main.webContents,senderFrame:main.webContents.mainFrame};
    const timed=async(name,fn)=>{const start=Date.now();const value=await fn();report.operations.push({name,ms:Date.now()-start,count:value.length});return value;};
    const names=await timed('metadata without thumbnails',()=>handlers['capture:sources'](event));
    const fixtureId=fixture.getMediaSourceId();report.fixture={id:fixtureId,title:fixture.getTitle(),visible:fixture.isVisible(),listed:names.filter(s=>s.id===fixtureId)};
    assert.ok(names.some(s=>s.id===fixtureId));assert.ok(names.every(s=>s.thumbnail===''));
    const windows=timed('window previews',()=>handlers['capture:previews'](event,'window'));
    const screens=timed('screen previews',()=>handlers['capture:previews'](event,'screen'));
    const reopened=await timed('metadata while previews are pending',()=>handlers['capture:sources'](event));
    assert.ok(reopened.some(s=>s.id===fixtureId));
    const [windowResults,screenResults]=await Promise.all([windows,screens]);
    report.fixturePreviewAvailable=!!windowResults.find(s=>s.id===fixtureId)?.thumbnail;
    report.screenPreviews=screenResults.filter(s=>s.thumbnail).length;
    assert.equal(report.fixturePreviewAvailable,true);assert.ok(report.screenPreviews>0);
    report.passed=true;
  }catch(error){report.error=error.stack;}
  finally{
    for(const w of [main,fixture])if(w&&!w.isDestroyed())w.destroy();
    writeFileSync(join(base,'result.json'),JSON.stringify(report,null,2));writeFileSync('artifacts/capture-native-test.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(report.passed?0:1);
  }
});
