// Real Windows display streams from two owned fixture windows through the app
// picker and production media hook. No user microphone, system audio or AI call.
const {app,BrowserWindow,session,ipcMain,desktopCapturer}=require('electron');
const {resolve,join}=require('node:path');
const {pathToFileURL}=require('node:url');
const {mkdirSync,writeFileSync,readFileSync}=require('node:fs');
const {createHash}=require('node:crypto');
const assert=require('node:assert/strict');
const base=resolve('artifacts/capture-preparation-native-'+Date.now());mkdirSync(base);app.setPath('userData',join(base,'profile'));
const componentDelay=Number(process.argv.find(a=>a.startsWith('--component-delay='))?.slice(18)||0);
const report={base,passed:false,nativeWindows:true,systemAudio:false,microphone:false,liveModel:false,syntheticComponentDelayMs:componentDelay,checks:[],connections:[]};let service,main;const fixtures=[];
setTimeout(()=>app.exit(2),120000).unref();app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{try{
 let sourceRoot=resolve('.');const delivered=process.argv.find(a=>a.startsWith('--package='))?.slice(10);
 if(delivered){
  const folder=resolve(delivered),archive=join(folder,'resources/app.asar'),manifest=JSON.parse(readFileSync(resolve(folder,'../../manifest.json'),'utf8'));
  const {verifyPackageSources}=await import('./lib/package-sources.mjs');report.sourceCheck=await verifyPackageSources(sourceRoot,folder,manifest.sourceManifest);assert.equal(report.sourceCheck.passed,true);
  report.package=folder;report.archiveSha256=createHash('sha256').update(require('original-fs').readFileSync(archive)).digest('hex');report.deliveredExecutable=false;
  sourceRoot=join(base,'delivered-source');require('@electron/asar').extractAll(archive,sourceRoot);
 }
 const {createStudioSession}=require(join(sourceRoot,'desktop/session.cjs')),{attachCapture}=require(join(sourceRoot,'desktop/capture.cjs'));
 const {startServer}=await import(pathToFileURL(join(sourceRoot,'server/index.js')));let seenFrames=0;
 const runtime=componentDelay?{speech:{},sound:{},clips:{},clipPerception:{},components:{catalog:require(join(sourceRoot,'shared/runtime-catalog.json')),cache:join(base,'runtime'),download:async({signal,onProgress,component})=>{await require('node:timers/promises').setTimeout(componentDelay,undefined,{signal});onProgress({downloadedBytes:component.archive.bytes});return {path:'synthetic'};},install:async()=>({path:'synthetic'})}}:{};
 service=await startServer({port:0,dataDir:join(base,'data'),localSpeech:false,runtime,provider:{status:()=>({configured:!componentDelay}),react:async args=>{if(args.image)seenFrames++;return {observation:{game:'Owned native fixture',scene:'Local fixture validation',confidence:1,excitement:0,messages:[]}};}}});
 service.studio.configure({...service.studio.settings,mode:componentDelay?'rehearsal':'live',intervalSeconds:5,clipBufferEnabled:!!componentDelay});
 const studioSession=createStudioSession(session,service);
 main=new BrowserWindow({width:1426,height:973,show:false,webPreferences:{session:studioSession,preload:join(sourceRoot,'desktop/preload.cjs'),sandbox:true,contextIsolation:true,backgroundThrottling:false}});
 attachCapture({session:studioSession,ipcMain,desktopCapturer,main});ipcMain.handle('account:status',()=>({status:'idle'}));
 for(const [name,color] of [['Capture readiness red fixture','#d02030'],['Capture readiness blue fixture','#2050d0']]){
  const fixture=new BrowserWindow({width:500,height:350,show:false,webPreferences:{sandbox:true,backgroundThrottling:false}});fixtures.push(fixture);
  await fixture.loadURL('data:text/html,'+encodeURIComponent(`<title>${name}</title><body style="margin:0;background:${color};color:white;font:28px sans-serif"><p style="padding:30px">Owned capture test</p><script>setInterval(()=>document.querySelector('p').textContent='Owned capture test '+Date.now(),100)</script>`));fixture.showInactive();
 }
 await main.loadURL(service.url);main.showInactive();
 const js=code=>main.webContents.executeJavaScript(code,true).catch(error=>{throw Error(code.slice(0,160)+': '+error.message);}),pause=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async(fn,timeout=20000)=>{const start=Date.now();while(Date.now()-start<timeout){if(await fn())return;await pause(80);}throw Error('Native capture readiness deadline');};
 const button=async text=>{await until(()=>js(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled);if(!b)return false;b.click();return true;})()`));};
 await until(()=>js(`!!document.querySelector('.welcome-shell')||!!document.querySelector('.app-shell')`));
 if(await js(`!!document.querySelector('.welcome-shell')`)){await button('다음');await button('다음');await button('직접 조작하며 배우기');await button('나중에 계속하기');}
 await until(()=>js(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='이어서 배우기')`));
 service.studio.configure({...service.studio.settings,mode:componentDelay?'rehearsal':'live',clipBufferEnabled:!!componentDelay});
 await button(componentDelay?'리허설 시작':'방송 시작');
 await until(()=>Promise.resolve(service.studio.running));
 for(const [index,fixture] of fixtures.entries()){
  await js(`(document.querySelector('[title="화면 선택"]')||Array.from(document.querySelectorAll('button')).find(b=>/^(게임 화면 연결|화면 연결 \(선택\))$/.test(b.textContent.trim()))).click();`);
  const label=fixture.getTitle();await until(()=>js(`Array.from(document.querySelectorAll('.source-card')).some(b=>b.getAttribute('aria-label')===${JSON.stringify(label)})`));
  assert.equal(await js(`document.querySelector('.source-options input').checked`),false);
  const start=Date.now();await js(`Array.from(document.querySelectorAll('.source-card')).find(b=>b.getAttribute('aria-label')===${JSON.stringify(label)}).click();`);
  await until(()=>js(`(()=>{const v=document.querySelector('.preview video');if(!v?.srcObject||v.readyState<2||!v.videoWidth||document.body.textContent.includes('화면 연결 준비 중'))return false;const c=document.createElement('canvas');c.width=1;c.height=1;const x=c.getContext('2d');x.drawImage(v,v.videoWidth*.7,v.videoHeight*.7,1,1,0,0,1,1);const p=x.getImageData(0,0,1,1).data;return ${index===0?'p[0]>150&&p[2]<100':'p[2]>150&&p[0]<100'};})()`));
  const metrics=await js(`(()=>{const v=document.querySelector('.preview video');const old=window.previousCapture;window.previousCapture=v.srcObject;return{width:v.videoWidth,height:v.videoHeight,tracks:v.srcObject.getTracks().map(t=>({kind:t.kind,state:t.readyState})),previousEnded:old?old.getTracks().every(t=>t.readyState==='ended'):null};})()`);
  assert.ok(metrics.tracks.every(t=>t.kind==='video'&&t.state==='live'));if(index===1)assert.equal(metrics.previousEnded,true);
  report.connections.push({fixture:index===0?'red':'blue',ms:Date.now()-start,...metrics});
  if(index===0&&!componentDelay)await until(()=>Promise.resolve(seenFrames>0));
 }
 if(componentDelay)assert.ok(report.connections[0].ms>=componentDelay);
 report.checks.push(componentDelay?'actual native capture starts after delayed synthetic component preparation and matches fixture pixels':'actual selected native frames reach the live observation path and match fixture pixels');
 report.checks.push('second native source replaces the first only when ready and stops the old track');
 fixtures[1].close();await until(()=>js(`!document.querySelector('.preview video')?.srcObject&&previousCapture.getTracks().every(t=>t.readyState==='ended')`));
 report.checks.push('closing the selected native window ends the capture and clears preview');
 await button('방송 종료');await until(()=>Promise.resolve(!service.studio.running));assert.equal(service.studio.running,false);
 writeFileSync(join(base,'page.png'),(await main.webContents.capturePage()).toPNG());report.observedFrameRequests=seenFrames;report.passed=true;
}catch(error){report.error=error.stack;if(main&&!main.isDestroyed())writeFileSync(join(base,'failure-page.txt'),await main.webContents.executeJavaScript('document.body.innerText'));}
finally{for(const w of [...fixtures,main])if(w&&!w.isDestroyed())w.destroy();await service?.close();writeFileSync(join(base,'result.json'),JSON.stringify(report,null,2));writeFileSync('artifacts/capture-preparation-native-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(report.passed?0:1);}});
