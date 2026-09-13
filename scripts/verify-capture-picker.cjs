// Real Electron renderer/layout with delayed synthetic IPC. No user's screen,
// microphone, account or model calls. Production desktop policy is unit-tested
// separately and exercised again by the native Windows acceptance.
const {app,BrowserWindow,session,ipcMain}=require('electron');
const {createStudioSession}=require('../desktop/session.cjs');
const {resolve,join}=require('node:path');
const {pathToFileURL}=require('node:url');
const {mkdirSync,writeFileSync}=require('node:fs');
const assert=require('node:assert/strict');
const base=resolve('artifacts/capture-picker-'+Date.now());mkdirSync(base);app.setPath('userData',join(base,'profile'));
const report={passed:false,base,syntheticSources:true,checks:[],layouts:[],errors:[]};
const fixtureImage='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="170"><rect width="300" height="170" fill="#23413f"/><text x="20" y="90" fill="white">Synthetic preview</text></svg>');
let listing='pending',nameVersion=0;const metadata=[],previews=[],selections=[];let service,win;
const sources=()=>[
  {id:'screen:1',name:'화면 1',kind:'screen',thumbnail:''},
  {id:'window:1',name:nameVersion?'새로 열린 게임 창':'아주 긴 게임 제목 '+ '붙어있는긴이름'.repeat(16),kind:'window',thumbnail:''},
  ...Array.from({length:7},(_,i)=>({id:'window:'+(i+2),name:'방송 테스트 창 '+(i+2),kind:'window',thumbnail:''})),
];
ipcMain.handle('capture:sources',()=>listing==='pending'?new Promise(r=>metadata.push(r)):listing==='error'?Promise.reject(Error('Synthetic enumeration failure')):sources());
ipcMain.handle('capture:previews',(_e,kind)=>new Promise(resolve=>previews.push({kind,resolve,version:nameVersion})));
ipcMain.handle('capture:select',(_e,id,systemAudio)=>selections.push({id,systemAudio}));
ipcMain.handle('account:status',()=>({status:'idle'}));
setTimeout(()=>{console.error('Capture picker watchdog');app.exit(2);},100000).unref();
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
  try{
    const {startServer}=await import(pathToFileURL(resolve('server/index.js')).href);
    service=await startServer({port:0,dataDir:join(base,'data'),localSpeech:false,provider:{status:()=>({configured:true,kind:'synthetic',model:'Capture picker test',effort:'low'})}});
    win=new BrowserWindow({width:1426,height:973,show:true,webPreferences:{session:createStudioSession(session,service),preload:resolve('desktop/preload.cjs'),sandbox:true,contextIsolation:true,backgroundThrottling:false}});
    win.webContents.on('console-message',event=>{if(event.level==='error')report.errors.push(event.message);});
    await win.loadURL(service.url);
    const js=code=>win.webContents.executeJavaScript(code,true),pause=ms=>new Promise(r=>setTimeout(r,ms));
    const until=async(code,timeout=8000)=>{const at=Date.now();while(Date.now()-at<timeout){if(await js(code))return;await pause(50);}throw Error('UI timeout: '+code);};
    const click=async selector=>{await until(`!!document.querySelector(${JSON.stringify(selector)})`);await js(`{const e=document.querySelector(${JSON.stringify(selector)});e.focus();e.click();}`);};
    const key=async keyCode=>{win.focus();win.webContents.focus();win.webContents.sendInputEvent({type:'keyDown',keyCode});win.webContents.sendInputEvent({type:'keyUp',keyCode});await pause(70);};
    const input=async(value)=>js(`{const el=document.querySelector('.source-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));}`);
    await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='나중에 설정하기')`);
    await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='나중에 설정하기').click()`);await until(`!!document.querySelector('.app-shell')`);
    await click('[title="화면 선택"]');await until(`!!document.querySelector('.source-modal')`);
    assert.equal(await js(`!!document.querySelector('.source-status')`),true);
    await key('Escape');await until(`!document.querySelector('.source-modal')`);
    metadata.splice(0).forEach(resolve=>resolve(sources()));await pause(150);
    assert.equal(await js(`!!document.querySelector('.source-modal')`),false);
    assert.equal(await js(`document.getElementById('root').hasAttribute('inert')`),false);
    report.checks.push('picker opens before enumeration, closes during pending work and ignores late results');

    listing='ready';await click('[title="시스템 출력 소리"]');await until(`document.querySelectorAll('.source-card').length===9`);
    assert.equal(await js(`document.querySelectorAll('.source-card img').length`),0);
    assert.equal(await js(`Array.from(document.querySelectorAll('.source-card')).every(b=>!b.disabled&&!!b.getAttribute('aria-label'))`),true);
    assert.equal(await js(`document.querySelector('.source-options input').checked`),true);
    await click('.source-options .source-option:nth-child(2) input');await until(`document.querySelector('.source-footer').textContent.includes('시스템 소리만 공유')`);
    await click('.source-options .source-option:first-child input');
    assert.deepEqual(await js(`Array.from(document.querySelectorAll('.source-options input')).map(e=>({checked:e.checked,disabled:e.disabled}))`),[{checked:false,disabled:false},{checked:true,disabled:true}]);
    report.checks.push('names are immediately selectable without previews and the sound/picture invariant is preserved');

    await pause(4200);assert.equal(await js(`document.querySelectorAll('.source-placeholder small').length`),9);
    assert.equal(await js(`document.querySelectorAll('.source-placeholder small')[0].textContent`),'이름으로 선택할 수 있어요');
    previews.filter(p=>p.kind==='screen').splice(0).forEach(p=>p.resolve([{...sources()[0],thumbnail:fixtureImage}]));
    await until(`document.querySelectorAll('.source-card img').length===1`);
    assert.equal(await js(`document.querySelectorAll('.source-card').length`),9);
    report.checks.push('stalled window thumbnails leave usable placeholders and late screen previews arrive independently');

    await input('없는 창');await until(`document.querySelectorAll('.source-card').length===0`);assert.match(await js(`document.querySelector('.source-status').textContent`),/검색 결과가 없어요/);
    await input('방송 테스트 창 3');await until(`document.querySelectorAll('.source-card').length===1`);assert.equal(await js(`document.querySelector('.source-card').getAttribute('aria-label')`),'방송 테스트 창 3');
    await input('');await until(`document.querySelectorAll('.source-card').length===9`);
    report.checks.push('search handles long titles, a matching window and empty results');

    for(const [width,height,zoom] of [[1426,973,1],[1280,720,1],[800,720,1],[620,700,1],[380,650,1],[1280,900,2]]){
      win.setSize(width,height);win.webContents.setZoomFactor(zoom);await pause(150);
      const metrics=await js(`(()=>{const d=document.querySelector('.source-modal'),body=d.querySelector('.source-body'),r=d.getBoundingClientRect(),b=body.getBoundingClientRect();return{viewport:[innerWidth,innerHeight],dialog:{left:r.left,top:r.top,right:r.right,bottom:r.bottom},body:{client:body.clientWidth,scroll:body.scrollWidth},overflowingCards:Array.from(d.querySelectorAll('.source-card')).filter(e=>{const a=e.getBoundingClientRect();return a.left<b.left-1||a.right>b.right+1||e.scrollWidth>e.clientWidth+1}).map(e=>e.getAttribute('aria-label')),options:Array.from(d.querySelectorAll('.source-option')).map(e=>({width:e.clientWidth,scroll:e.scrollWidth})),headerHeight:d.querySelector('.modal-title').clientHeight,footerHeight:d.querySelector('.source-footer').clientHeight,scrollHeight:body.clientHeight};})()`);
      assert.ok(metrics.dialog.left>=-1&&metrics.dialog.top>=-1&&metrics.dialog.right<=metrics.viewport[0]+1&&metrics.dialog.bottom<=metrics.viewport[1]+1,JSON.stringify(metrics));
      assert.ok(metrics.body.scroll<=metrics.body.client+1,JSON.stringify(metrics));assert.deepEqual(metrics.overflowingCards,[]);assert.ok(metrics.options.every(o=>o.scroll<=o.width+1));assert.ok(metrics.scrollHeight>50);
      report.layouts.push({width,height,zoom,metrics});writeFileSync(join(base,`layout-${width}-${height}-${zoom}.png`),(await win.webContents.capturePage()).toPNG());
    }
    report.checks.push('six real viewport/zoom layouts keep long-title cards, options, header and footer within the dialog');
    win.setSize(1426,973);win.webContents.setZoomFactor(1);await pause(100);
    const oldPreview=previews.find(p=>p.kind==='window'&&p.version===0);
    await key('Escape');await until(`!document.querySelector('.source-modal')`);nameVersion=1;
    await click('[title="화면 선택"]');await until(`Array.from(document.querySelectorAll('.source-name')).some(e=>e.textContent==='새로 열린 게임 창')`);
    oldPreview.resolve([{id:'window:1',name:'Old closed title',thumbnail:fixtureImage}]);await pause(100);
    assert.equal(await js(`Array.from(document.querySelectorAll('.source-card')).find(e=>e.getAttribute('aria-label')==='새로 열린 게임 창').querySelectorAll('img').length`),0);
    report.checks.push('a closed picker cannot inject stale thumbnails into a later opening with a reused window ID');

    listing='error';await click('.source-toolbar button');await until(`!!document.querySelector('.source-error')`);assert.equal(await js(`document.querySelector('.source-toolbar button').disabled`),false);
    listing='ready';await click('.source-toolbar button');await until(`document.querySelectorAll('.source-card').length===9&&!document.querySelector('.source-error')`);
    report.checks.push('enumeration failure stays in the dialog with a working refresh recovery');
    await js(`navigator.mediaDevices.getDisplayMedia=async options=>{window.__captureOptions=options;throw new DOMException('Synthetic cancellation','NotAllowedError');};void 0;`);
    await click('.source-card');await until(`!document.querySelector('.source-modal')`);
    assert.deepEqual(selections.at(-1),{id:'screen:1',systemAudio:false});assert.equal(await js(`window.__captureOptions.audio`),false);
    report.checks.push('choosing a named source uses its exact ID and current audio consent without waiting for previews');
    assert.deepEqual(report.errors,[]);report.passed=true;
  }catch(error){report.error=error.stack;if(win&&!win.isDestroyed())writeFileSync(join(base,'failure.png'),(await win.webContents.capturePage()).toPNG());}
  finally{
    if(win&&!win.isDestroyed())win.destroy();await service?.close();
    writeFileSync(join(base,'result.json'),JSON.stringify(report,null,2));writeFileSync('artifacts/capture-picker-test.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(report.passed?0:1);
  }
});
