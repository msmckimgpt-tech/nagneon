// Real Electron DOM, input and layout; synthetic model; isolated local profile.
const {app,BrowserWindow,session,ipcMain}=require('electron');
const {createStudioSession}=require('../desktop/session.cjs');
const {resolve,join}=require('node:path');
const {pathToFileURL}=require('node:url');
const {mkdirSync,writeFileSync}=require('node:fs');
const assert=require('node:assert/strict');
const base=resolve('artifacts/autonomy-ui-'+Date.now());mkdirSync(base);app.setPath('userData',join(base,'profile'));
const report={base,passed:false,syntheticModel:true,nativeCapture:false,checks:[],layouts:[],errors:[]};let service,win,restoreSave;
ipcMain.handle('account:status',()=>({status:'idle'}));
ipcMain.handle('capture:sources',()=>[]);ipcMain.handle('capture:previews',()=>[]);
app.on('window-all-closed',()=>{});setTimeout(()=>app.exit(2),120000).unref();
app.whenReady().then(async()=>{
  try{
    const {startServer}=await import(pathToFileURL(resolve('server/index.js')));
    const {JsonStore}=await import(pathToFileURL(resolve('server/storage.js')));
    const birth={name:'이끼수첩',personality:'HIDDEN_PERSONALITY 탐험을 좋아함',values:'HIDDEN_VALUES 발견하는 재미',sociability:.6,expertise:.4};
    service=await startServer({port:0,dataDir:join(base,'data'),localSpeech:false,provider:{status:()=>({configured:true,kind:'codex',model:'Synthetic acceptance',effort:'low'}),react:async()=>({observation:{game:'Just Chatting',scene:'synthetic',confidence:1,excitement:.2,messages:[],arrival:birth}})}});
    clearInterval(service.studio.timer);
    await fetch(service.url+'/api/onboarding',{method:'POST',headers:{Authorization:'Bearer '+service.accessToken,'X-Backseat-Client':'studio','Content-Type':'application/json'},body:JSON.stringify({skip:true})});
    win=new BrowserWindow({width:1426,height:973,show:true,webPreferences:{session:createStudioSession(session,service),preload:resolve('desktop/preload.cjs'),sandbox:true,contextIsolation:true,backgroundThrottling:false}});
    win.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message);});await win.loadURL(service.url);
    const js=code=>win.webContents.executeJavaScript(code,true),pause=ms=>new Promise(r=>setTimeout(r,ms));
    const until=async(code,timeout=8000)=>{const at=Date.now();while(Date.now()-at<timeout){if(await js(code))return;await pause(40);}throw Error('UI timeout: '+code);};
    const click=async selector=>{await until(`!!document.querySelector(${JSON.stringify(selector)})`);await js(`{const e=document.querySelector(${JSON.stringify(selector)});e.focus();e.click();}`);};
    const textButton=async text=>{await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===${JSON.stringify(text)})`);await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`);};
    const input=(selector,value,type='HTMLInputElement')=>js(`{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${type}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}`);
    const key=async code=>{win.focus();win.webContents.focus();await pause(80);win.webContents.sendInputEvent({type:'keyDown',keyCode:code});win.webContents.sendInputEvent({type:'keyUp',keyCode:code});await pause(100);};
    await until(`!!document.querySelector('.app-shell')`);await click('[title="방송 설정"]');await until(`document.querySelectorAll('[role=tab]').length===6`);
    assert.equal(await js(`document.querySelectorAll('[role=tabpanel]:not([hidden])').length`),1);
    await click('#settings-tab-broadcast');await key('Right');assert.equal(await js('document.activeElement.id'),'settings-tab-mood');await key('End');assert.equal(await js('document.activeElement.id'),'settings-tab-games');await key('Home');assert.equal(await js('document.activeElement.id'),'settings-tab-broadcast');
    report.checks.push('six tabs have a single visible panel and real arrow/Home/End keys move selection and focus');
    await input('#settings-panel-broadcast input','탭 사이에 남는 초안');
    await input('#settings-panel-broadcast select','live','HTMLSelectElement');
    await click('#settings-tab-media');await click('#settings-tab-broadcast');assert.equal(await js(`document.querySelector('#settings-panel-broadcast input').value`),'탭 사이에 남는 초안');
    restoreSave=JsonStore.prototype.save;JsonStore.prototype.save=function(value){if(this.file===join(base,'data','world.json')&&value.settings.title==='탭 사이에 남는 초안')throw Error('테스트 저장 공간 오류');return restoreSave.call(this,value);};
    await textButton('설정 저장');await until(`!!document.querySelector('.settings-error')`);assert.equal(await js(`document.querySelector('#settings-panel-broadcast input').value`),'탭 사이에 남는 초안');
    JsonStore.prototype.save=restoreSave;restoreSave=null;
    report.checks.push('draft survives tab changes and real persistence failure; error stays inside the open dialog');
    for(const [width,height,zoom] of [[1426,973,1],[800,720,1],[380,650,1],[1280,900,2]]){
      win.setSize(width,height);win.webContents.setZoomFactor(zoom);await pause(100);
      for(const tab of ['broadcast','mood','connection','manager','media','games']){
        await click('#settings-tab-'+tab);await pause(40);
        const m=await js(`(()=>{const d=document.querySelector('.settings-dialog'),p=d.querySelector('[role=tabpanel]:not([hidden])'),f=d.querySelector('.modal-footer'),r=d.getBoundingClientRect(),fr=f.getBoundingClientRect();return {viewport:[innerWidth,innerHeight],bounds:[r.left,r.top,r.right,r.bottom],panelHeight:p.clientHeight,overflow:p.scrollWidth-p.clientWidth,footerBottom:fr.bottom,bad:Array.from(p.querySelectorAll('input,textarea,select')).filter(e=>e.getBoundingClientRect().right>r.right+1).length};})()`);
        assert.ok(m.bounds[0]>=-1&&m.bounds[1]>=-1&&m.bounds[2]<=m.viewport[0]+1&&m.bounds[3]<=m.viewport[1]+1,JSON.stringify(m));assert.ok(m.panelHeight>=120,JSON.stringify(m));assert.ok(m.overflow<=1,JSON.stringify(m));assert.equal(m.bad,0);assert.ok(m.footerBottom<=m.bounds[3]+1);
        report.layouts.push({width,height,zoom,tab,...m});
      }writeFileSync(join(base,`settings-${width}-${height}-${zoom}.png`),(await win.webContents.capturePage()).toPNG());
    }
    report.checks.push('24 tab/viewport/zoom layouts keep footer and errors visible without horizontal overflow');
    win.setSize(1426,973);win.webContents.setZoomFactor(1);await textButton('설정 저장');await until(`!document.querySelector('.settings-dialog')`);assert.equal(service.studio.settings.title,'탭 사이에 남는 초안');
    await click('[title="방송 설정"]');await until(`!!document.querySelector('.settings-dialog')`);await key('Escape');assert.equal(await js(`document.activeElement.getAttribute('title')`),'방송 설정');
    report.checks.push('retry saves the same draft and Escape restores focus to the settings trigger');
    await click('.stage-controls>button');await until(`document.querySelector('.stop-button')!==null`);await textButton('나의 관객');
    await until(`document.querySelector('main').textContent.includes('아직 만나기 전이에요')`);assert.equal(await js(`document.querySelectorAll('.persona-card').length`),0);
    await textButton('한 명과 첫 만남 · 50P');await until(`document.querySelectorAll('.persona-card').length===1`);
    assert.equal(await js(`document.querySelector('.persona-card h2').textContent`),'이끼수첩');assert.ok(!(await js(`document.querySelector('main').textContent`)).includes('HIDDEN_'));
    await input('.persona-card textarea','이름이 바뀌어도 기억할 메모','HTMLTextAreaElement');await textButton('메모 저장');await until(`document.querySelector('.persona-card').textContent.includes('메모를 저장했습니다.')`);
    const person=service.studio.settings.personas.find(p=>!p.system);service.studio.world.change(d=>{d.audience.members[person.id].seconds=600;});
    service.studio.autonomy.evolve([{personaId:person.id,preference:'식물을 더 좋아하게 됨',nickname:'이끼친구',reason:'취향 대화',evidence:'같이 식물을 키워보자',sociabilityDelta:.03}],'같이 식물을 키워보자',[person.id]);service.studio.publish();
    await until(`document.querySelector('.persona-card h2').textContent==='이끼친구'`);assert.equal(await js(`document.querySelector('.persona-card textarea').value`),'이름이 바뀌어도 기억할 메모');
    report.checks.push('fresh empty roster becomes one generated viewer and personal notes survive an autonomous nickname change');
    service.studio.economy.change(d=>{d.balance=100;});service.studio.publish();await textButton('관객 수첩 열기 · 30P');await until(`document.querySelector('.persona-card').textContent.includes('HIDDEN_PERSONALITY')`);
    writeFileSync(join(base,'unlocked-viewer.png'),(await win.webContents.capturePage()).toPNG());
    await textButton('관객 제거');await until(`document.querySelectorAll('.persona-card').length===0`);assert.equal(service.studio.audience.data.members[person.id].note,'이름이 바뀌어도 기억할 메모');
    report.checks.push('paid profile unlock changes the public card and removal retains the viewer ID and private note in history');
    await textButton('핫클립');await until(`document.querySelector('main').textContent.includes('첫 핫클립을 기다려요')`);assert.ok(!(await js(`document.querySelector('main').textContent`)).includes('지금 순간 저장'));
    assert.equal(await js(`document.querySelector('nav').textContent.includes('방송 놀이터')`),false);
    report.checks.push('hotclips have no manual-create action and ordinary experiences have no stage or mode selector');
    assert.deepEqual(report.errors,[]);report.passed=true;
  }catch(error){report.error=error.stack;console.error(error.stack);}
  finally{if(restoreSave){const {JsonStore}=await import(pathToFileURL(resolve('server/storage.js')));JsonStore.prototype.save=restoreSave;}if(win&&!win.isDestroyed())win.destroy();if(service)await service.close();writeFileSync(join(base,'result.json'),JSON.stringify(report,null,2));writeFileSync('artifacts/audience-autonomy-ui.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,base,checks:report.checks,layouts:report.layouts.length}));app.exit(report.passed?0:1);}
});
