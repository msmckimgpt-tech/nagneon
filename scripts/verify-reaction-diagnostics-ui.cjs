// Actual Electron renderer and download; synthetic metrics, no model/device use.
const {app,BrowserWindow,session}=require('electron');
const {resolve,join}=require('node:path');
const {pathToFileURL}=require('node:url');
const {mkdirSync,writeFileSync,readFileSync}=require('node:fs');
const {createHash}=require('node:crypto');
const assert=require('node:assert/strict');
const base=resolve('artifacts/reaction-diagnostics-ui-'+Date.now());mkdirSync(base);app.setPath('userData',join(base,'profile'));
const report={base,passed:false,syntheticMetrics:true,modelCalls:0,checks:[],stage:'boot'};let service,win;
const mark=stage=>{report.stage=stage;writeFileSync(join(base,'progress.json'),JSON.stringify(report,null,2));console.log(stage);};
setTimeout(async()=>{report.error='UI watchdog at '+report.stage;writeFileSync(join(base,'result.json'),JSON.stringify(report,null,2));if(win&&!win.isDestroyed())writeFileSync(join(base,'timeout-page.txt'),await win.webContents.executeJavaScript('document.body.innerText'));app.exit(2);},60000).unref();
app.whenReady().then(async()=>{try{
 let sourceRoot=resolve('.');const delivered=process.argv.find(a=>a.startsWith('--package='))?.slice(10);
 if(delivered){
  const folder=resolve(delivered),archive=join(folder,'resources/app.asar'),manifest=JSON.parse(readFileSync(resolve(folder,'../../manifest.json'),'utf8'));
  const {verifyPackageSources}=await import('./lib/package-sources.mjs');report.sourceCheck=await verifyPackageSources(sourceRoot,folder,manifest.sourceManifest);assert.equal(report.sourceCheck.passed,true);
  report.package=folder;report.archiveSha256=createHash('sha256').update(require('original-fs').readFileSync(archive)).digest('hex');report.deliveredExecutable=false;
  sourceRoot=join(base,'delivered-source');require('@electron/asar').extractAll(archive,sourceRoot);
 }
 const {createStudioSession}=require(join(sourceRoot,'desktop/session.cjs'));
 const {startServer}=await import(pathToFileURL(join(sourceRoot,'server/index.js')));
 service=await startServer({port:0,dataDir:join(base,'data'),localSpeech:false,provider:{status:()=>({configured:true}),react:async()=>{report.modelCalls++;throw Error('Unexpected model call');}}});
 const d=service.studio.reactions,id=d.begin({hasSpeech:true,present:2,eligible:1});d.generated(id,3);d.reject(id,'duplicate');d.reject(id,'advice');d.admit(id);d.delivered(id);d.finish(id,'accepted');
 const quiet=d.begin();d.generated(quiet,0);d.finish(quiet,'accepted');
 const studioSession=createStudioSession(session,service);
 win=new BrowserWindow({width:1260,height:850,show:true,webPreferences:{session:studioSession,sandbox:true,contextIsolation:true,backgroundThrottling:false}});await win.loadURL(service.url);
 const js=code=>win.webContents.executeJavaScript(code,true),pause=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async code=>{const start=Date.now();while(Date.now()-start<8000){if(await js(code))return;await pause(50);}throw Error('UI deadline: '+code);};
 const button=async text=>{await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`);await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled).click()`);};
 await button('나중에 설정하기');await button('매니저');mark('manager-open');
 await until(`!!document.querySelector('.reaction-diagnostics summary')`);await js(`document.querySelector('.reaction-diagnostics summary').click()`);
 await until(`document.querySelector('.reaction-diagnostics').textContent.includes('모델 호출 2회')`);
 assert.equal(await js(`document.querySelector('.reaction-diagnostics').textContent.includes('표시 1개')&&document.querySelector('.reaction-diagnostics').textContent.includes('중복: 1개')`),true);
 report.checks.push('manager diagnostics loads real endpoint metrics and separates silence, delivery and filters');
 mark('metrics-loaded');const download=join(base,'download.json');const saved=new Promise((done,fail)=>studioSession.once('will-download',(_event,item)=>{mark('download-started');item.setSavePath(download);item.once('done',(_e,state)=>state==='completed'?done():fail(Error(state)));}));
 await js(`document.querySelector('.reaction-diagnostics a[download]').click()`);mark('download-clicked');await saved;mark('download-saved');
 const exported=JSON.parse(readFileSync(download,'utf8'));assert.equal(exported.summary.generated,3);assert.equal(exported.summary.delivered,1);assert.equal(exported.summary.modelSilent,1);
 report.checks.push('download link saves authenticated JSON containing the actual metadata');
 await js(`window.actualFetch=window.fetch;window.fetch=(url,...args)=>String(url).includes('/api/diagnostics/reactions')?Promise.resolve(new Response(JSON.stringify({error:'합성 진단 연결 오류'}),{status:409,headers:{'Content-Type':'application/json'}})):actualFetch(url,...args);void 0`);
 await button('새로 확인');await until(`document.querySelector('.reaction-diagnostics [role=alert]')?.textContent==='합성 진단 연결 오류'`);mark('refresh-failure-visible');
 await js(`window.fetch=actualFetch;void 0`);await button('새로 확인');await until(`!document.querySelector('.reaction-diagnostics [role=alert]')&&!document.querySelector('.reaction-diagnostics button').disabled`);
 report.checks.push('refresh failure is visible and the same panel recovers without restarting');
 mark('refresh-recovered');
 await js(`document.querySelector('.reaction-diagnostics').scrollIntoView({block:'center'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
 writeFileSync(join(base,'panel.png'),(await win.webContents.capturePage()).toPNG());
 assert.equal(report.modelCalls,0);report.passed=true;
}catch(error){report.error=error.stack;}
finally{win?.destroy();await service?.close();writeFileSync(join(base,'result.json'),JSON.stringify(report,null,2));writeFileSync('artifacts/reaction-diagnostics-ui-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(report.passed?0:1);}});
