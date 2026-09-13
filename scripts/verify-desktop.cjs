// Automated renderer acceptance tests. Synthetic media only; no physical device access.
const {app,BrowserWindow}=require('electron');
const {pathToFileURL}=require('node:url');
const {resolve}=require('node:path');
const {writeFileSync,mkdirSync}=require('node:fs');
const assert=require('node:assert/strict');
app.setPath('userData',resolve('artifacts/desktop-test-profile'));
let service,win;
app.whenReady().then(async()=>{
  try{
    const {startServer}=await import(pathToFileURL(resolve('server/index.js')).href);
    const seen=[];
    service=await startServer({port:0,persist:false,localSpeech:false,provider:{status:()=>({configured:true,model:'test',effort:'low'}),react:async args=>{seen.push(args);return {observation:{game:'Synthetic',scene:'test',confidence:0.9,excitement:0,messages:[]}};}}});
    service.studio.configure({...service.studio.settings,mode:'live',intervalSeconds:5});
    win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,sandbox:true,backgroundThrottling:false}});
    await win.loadURL(service.url);
    const js=async code=>{try{return await win.webContents.executeJavaScript(code);}catch(error){throw new Error(code.slice(0,180)+' :: '+error.message);}};
    const until=async code=>{for(let i=0;i<100;i++){if(await js(code))return;await new Promise(r=>setTimeout(r,30));}throw new Error('Timed out: '+code);};
    await until(`!!document.querySelector('[title="마이크"]')`);
    await js(`window.mediaRequests=0; window.testAudio=new AudioContext(); window.testMic=testAudio.createMediaStreamDestination().stream; navigator.mediaDevices.getUserMedia=()=>{mediaRequests++;return new Promise(resolve=>window.resolveMic=resolve)}; navigator.mediaDevices.getDisplayMedia=()=>new Promise(resolve=>window.resolveScreen=resolve);void 0;`);
    service.studio.start();await until(`document.body.textContent.includes('방송 종료')`);
    await js(`document.querySelector('[title="마이크"]').click();document.querySelector('[title="마이크"]').click();`);
    assert.equal(await js('mediaRequests'),1,'double click must acquire only once');
    service.studio.stop();await until(`document.body.textContent.includes('방송 시작')`);
    await js(`resolveMic(testMic)`);await until(`testMic.getTracks().every(t=>t.readyState==='ended')`);
    // Capture survives switching away from the preview tab.
    await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='게임 화면 연결').click(); window.canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;canvas.getContext('2d').fillRect(0,0,640,360);window.testScreen=canvas.captureStream(5);resolveScreen(testScreen);`);
    await until(`document.body.textContent.includes('선택한 화면 미리보기')`);
    service.studio.start();await until(`document.body.textContent.includes('방송 종료')`);
    await js(`Array.from(document.querySelectorAll('nav button')).find(b=>b.textContent.includes('나의 관객')).click()`);
    seen.length=0;service.studio.lastRequest=0;
    await new Promise(r=>setTimeout(r,2100));
    assert.ok(seen.some(args=>args.image?.startsWith('data:image/jpeg;base64,')),'tab switch must retain image capture');
    service.studio.stop();await until(`testScreen.getTracks().every(t=>t.readyState==='ended')`);
    // A pending screen picker must not reactivate capture after stop.
    await js(`Array.from(document.querySelectorAll('nav button')).find(b=>b.textContent==='방송실').click()`);
    service.studio.start();await until(`document.body.textContent.includes('방송 종료')`);
    await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='게임 화면 연결').click();window.lateScreen=canvas.captureStream(5)`);
    service.studio.stop();await until(`document.body.textContent.includes('방송 시작')`);
    await js(`resolveScreen(lateScreen)`);await until(`lateScreen.getTracks().every(t=>t.readyState==='ended')`);
    // Configure a bounded newcomer pool through real React controls and the HTTP settings route.
    await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='방송 설정').click()`);
    await until(`!!document.querySelector('.discovery-settings')`);
    await js(`document.querySelector('.discovery-settings input[type="checkbox"]').click();document.querySelector('.discovery-settings button').click()`);
    await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='설정 저장').click()`);
    await until(`!document.querySelector('.settings-modal')`);
    assert.equal(service.studio.settings.discovery.enabled,true);
    assert.equal(service.studio.settings.personas.length,11);
    await js(`Array.from(document.querySelectorAll('nav button')).find(b=>b.textContent.includes('나의 관객')).click()`);
    await until(`!!document.querySelector('.acquisition')`);
    service.studio.start();await until(`document.querySelector('.acquisition').textContent.includes('현재 대기')`);
    assert.ok(Object.values(service.studio.audience.presence).includes('waiting'));
    service.studio.stop();
    await win.loadURL(service.url+'/overlay');await until(`!!document.querySelector('.overlay-shell')`);
    assert.equal(await js(`getComputedStyle(document.documentElement).backgroundColor`),'rgba(0, 0, 0, 0)');
    assert.equal(await js(`getComputedStyle(document.body).backgroundColor`),'rgba(0, 0, 0, 0)');
    const report={passed:true,syntheticMedia:true,checks:['single microphone acquisition','stop during microphone acquisition','capture on another tab','external stop releases screen','late screen acquisition released','discovery configuration and newcomer pool through UI','acquisition status panel','transparent overlay html and body']};
    mkdirSync('artifacts',{recursive:true});writeFileSync('artifacts/desktop-test.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  }catch(error){console.error(error.stack);process.exitCode=1;}
  finally{win?.destroy();await service?.close();app.exit(process.exitCode || 0);}
});


