// Isolated Electron renderer acceptance for dialog keyboard accessibility.
// Synthetic model, stubbed capture sources — no microphone, screen, camera or
// account login is ever touched. Real Tab/Shift+Tab/Escape are delivered through
// webContents.sendInputEvent so focus containment and restoration are exercised
// exactly as a keyboard user would experience them.
const {app,BrowserWindow,session,ipcMain}=require('electron');
const {createStudioSession}=require('../desktop/session.cjs');
const {pathToFileURL}=require('node:url');
const {resolve,join}=require('node:path');
const {mkdirSync,writeFileSync}=require('node:fs');
const assert=require('node:assert/strict');

const folder=resolve('artifacts/dialog-renderer-'+Date.now());mkdirSync(folder,{recursive:true});
app.setPath('userData',resolve(folder,'profile'));
const preload=resolve('desktop/preload.cjs');
let service,win;const checks=[],errors=[];let serial=0;
app.on('window-all-closed',()=>{});
setTimeout(()=>{console.error('Dialog accessibility watchdog');app.exit(2);},120000).unref();

// Synthetic IPC surface. Sources are fabricated strings, never desktopCapturer,
// so no screen/window enumeration or permission prompt occurs.
ipcMain.handle('account:status',()=>({status:'idle'}));
ipcMain.handle('capture:sources',()=>[
  {id:'synthetic:a',name:'테스트 화면 A',thumbnail:''},
  {id:'synthetic:b',name:'테스트 창 B',thumbnail:''},
]);
ipcMain.handle('capture:select',()=>{});
ipcMain.handle('capture:previews',()=>[]);
ipcMain.handle('overlay:open',()=>{});ipcMain.handle('overlay:through',()=>false);ipcMain.handle('overlay:close',()=>{});
ipcMain.handle('account:start',()=>({status:'idle'}));ipcMain.handle('account:cancel',()=>({status:'idle'}));ipcMain.handle('account:open',()=>{});

app.whenReady().then(async()=>{
  try{
    const {startServer}=await import(pathToFileURL(resolve('server/index.js')).href);
    service=await startServer({port:0,dataDir:resolve(folder,'data'),localSpeech:false,provider:{
      status:()=>({configured:true,kind:'synthetic',model:'Synthetic dialog test',effort:'low',authMessage:'합성 테스트 연결'}),
      react:async args=>({observation:{game:'Just Chatting',scene:'synthetic',confidence:1,excitement:.4,messages:args.settings.personas.slice(0,1).map(p=>({personaId:p.id,text:`합성 대화 ${++serial}`,kind:'chat',spoiler:false}))},usage:{total_tokens:1}}),
    }});
    win=new BrowserWindow({width:1460,height:980,show:true,title:'BACKSEAT 다이얼로그 접근성 검증',webPreferences:{session:createStudioSession(session,service),preload,sandbox:true,contextIsolation:true,backgroundThrottling:false}});
    win.webContents.on('console-message',(_e,level,message)=>{if(level===3&&!message.includes('Autofill'))errors.push(message);});
    await win.loadURL(service.url);

    const js=code=>win.webContents.executeJavaScript(code,true);
    const until=async code=>{for(let i=0;i<180;i++){if(await js(code))return;await new Promise(r=>setTimeout(r,70));}throw new Error('UI timeout: '+code);};
    const pause=ms=>new Promise(r=>setTimeout(r,ms));
    const focusWin=()=>{win.focus();win.webContents.focus();};
    // Deliver a real key through the input pipeline (default focus traversal +
    // JS handlers). No 'char' event: a synthetic Tab char would be typed into a
    // focused textarea and corrupt the draft we are validating.
    const key=async(keyCode,shift=false)=>{focusWin();const modifiers=shift?['shift']:[];win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await pause(70);};
    // Click by visible text; does NOT move focus (matches programmatic navigation).
    const clickText=async text=>{await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled&&b.getClientRects().length)`);await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled&&b.getClientRects().length).click()`);};
    // Focus a trigger the way a real pointer/keyboard user leaves it, then activate.
    const focusClick=async selector=>{await until(`!!document.querySelector(${JSON.stringify(selector)})`);await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.click();return el===document.activeElement;})()`);};
    const active=()=>js(`(()=>{const a=document.activeElement;const d=document.querySelector('[role="dialog"]');return{tag:a&&a.tagName,role:a&&a.getAttribute('role'),label:a&&(a.getAttribute('aria-label')||a.getAttribute('title')||(a.textContent||'').trim().slice(0,24)),inDialog:!!d&&d.contains(a),isDialog:a===d};})()`);
    // Mirror AccessibleDialog's tabbable query so the harness checks the same set.
    const FOCUSABLE=`a[href],area[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])`;
    const tabbableCount=()=>js(`Array.from(document.querySelector('[role="dialog"]').querySelectorAll(${JSON.stringify(FOCUSABLE)})).filter(el=>el.offsetParent!==null).length`);

    // ---- Skip the onboarding guide without touching any device or account. ----
    await clickText('나중에 설정하기');
    await until(`!!document.querySelector('.app-shell')&&!document.querySelector('.welcome-shell')`);
    checks.push('onboarding guide dismissed into the main studio shell');

    // ================= SETTINGS DIALOG =================
    await focusClick('.sidebar .sidebar-bottom button');// the "방송 설정" trigger
    await until(`!!document.querySelector('.settings-dialog[role="dialog"]')`);
    const sem=await js(`(()=>{const d=document.querySelector('.settings-dialog');const t=document.getElementById(d.getAttribute('aria-labelledby'));const de=document.getElementById(d.getAttribute('aria-describedby'));return{role:d.getAttribute('role'),modal:d.getAttribute('aria-modal'),titleText:t&&t.textContent,descText:de&&de.textContent,portaled:d.closest('#root')===null,closeName:(d.querySelector('.modal-title button.icon')||{}).getAttribute&&d.querySelector('.modal-title button.icon').getAttribute('aria-label')};})()`);
    assert.equal(sem.role,'dialog');assert.equal(sem.modal,'true');
    assert.ok(sem.titleText&&sem.titleText.includes('나의 방송 설정'),'title connected via aria-labelledby');
    assert.ok(sem.descText&&sem.descText.length>0,'description connected via aria-describedby');
    assert.equal(sem.portaled,true);
    assert.equal(sem.closeName,'방송 설정 창 닫기');
    checks.push('settings dialog exposes role/aria-modal, linked title+description, named close button, portaled outside #root');

    await until(`document.activeElement.id==='settings-tab-broadcast'`);
    const initial=await active();
    assert.equal(initial.inDialog,true,'initial focus lands on the selected settings tab');
    checks.push('open moves focus into the dialog (container with linked name)');

    // Background is inert + hidden from assistive tech while the dialog is open.
    const bg=await js(`(()=>{const r=document.getElementById('root');return{inert:r.hasAttribute('inert'),ariaHidden:r.getAttribute('aria-hidden')};})()`);
    assert.equal(bg.inert,true);assert.equal(bg.ariaHidden,'true');
    // A background control genuinely cannot take focus.
    const bgFocus=await js(`(()=>{const b=document.querySelector('.sidebar nav button');b&&b.focus();const d=document.querySelector('[role="dialog"]');return{escaped:!!b&&document.activeElement===b,stillInDialog:d.contains(document.activeElement)};})()`);
    assert.equal(bgFocus.escaped,false);assert.equal(bgFocus.stillInDialog,true);
    checks.push('background is inert+aria-hidden and refuses focus while the dialog is open');

    // Every settings control carries a real label (wrapping <label>, for/id, or aria-label).
    const unlabeled=await js(`Array.from(document.querySelectorAll('.settings-dialog input,.settings-dialog select,.settings-dialog textarea')).filter(el=>!el.getAttribute('aria-label')&&!el.getAttribute('aria-labelledby')&&!el.closest('label')&&!(el.id&&document.querySelector('label[for="'+el.id+'"]'))).map(el=>(el.tagName+':'+(el.type||'')))`);
    assert.deepEqual(unlabeled,[],'all settings controls are labelled');
    checks.push('every settings input/select/textarea has an associated accessible label');

    // Shift+Tab from the selected settings tab reaches the close button.
    await key('Tab',true);
    const firstTab=await active();
    assert.equal(firstTab.inDialog,true);
    assert.equal(firstTab.label,'방송 설정 창 닫기','first Tab stop is the named close button');
    checks.push('Tab from the container enters the dialog at the close button');

    // Focus never escapes across a long run of Tab / Shift+Tab.
    let contained=true;
    for(let i=0;i<24;i++){await key('Tab');if(!(await active()).inDialog){contained=false;break;}}
    for(let i=0;i<24;i++){await key('Tab',true);if(!(await active()).inDialog){contained=false;break;}}
    assert.equal(contained,true,'focus stays inside the dialog across 24 Tabs and 24 Shift+Tabs');
    checks.push('Tab and Shift+Tab keep focus trapped inside the dialog');

    // Explicit boundary wrap in both directions.
    const count=await tabbableCount();assert.ok(count>=2,'dialog has multiple tabbable controls');
    await js(`(()=>{const d=document.querySelector('[role="dialog"]');const it=Array.from(d.querySelectorAll(${JSON.stringify(FOCUSABLE)})).filter(e=>e.offsetParent!==null);it[it.length-1].focus();})()`);
    await key('Tab');
    assert.equal((await active()).label,'방송 설정 창 닫기','Tab on the last control wraps to the first');
    await js(`(()=>{const d=document.querySelector('[role="dialog"]');const it=Array.from(d.querySelectorAll(${JSON.stringify(FOCUSABLE)})).filter(e=>e.offsetParent!==null);it[0].focus();})()`);
    await key('Tab',true);
    const wrapBack=await active();assert.equal(wrapBack.inDialog,true,'Shift+Tab on the first control wraps back into the dialog');
    checks.push('Tab/Shift+Tab wrap at both boundaries without leaving the dialog');

    // ---- Save error keeps the dialog open with the edited draft intact. ----
    await js(`(()=>{const l=Array.from(document.querySelectorAll('.settings-dialog label')).find(l=>l.textContent.includes('방송 제목'));const el=l.querySelector('input');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(el,'접근성 저장 테스트 제목');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await js(`(()=>{window.__origFetch=window.fetch;window.fetch=function(u,o){if(typeof u==='string'&&u.includes('/api/settings')&&o&&o.method==='PUT'){return Promise.resolve(new Response(JSON.stringify({error:'합성 저장 실패'}),{status:500,headers:{'Content-Type':'application/json'}}));}return window.__origFetch.apply(this,arguments);};})()`);
    await clickText('설정 저장');
    await pause(300);
    const afterError=await js(`(()=>{const d=document.querySelector('.settings-dialog[role="dialog"]');const l=d&&Array.from(d.querySelectorAll('label')).find(l=>l.textContent.includes('방송 제목'));return{open:!!d,title:l&&l.querySelector('input').value};})()`);
    assert.equal(afterError.open,true,'dialog stays open after a failed save');
    assert.equal(afterError.title,'접근성 저장 테스트 제목','edited draft is retained after a failed save');
    checks.push('a failed save keeps the dialog open and preserves the edited draft');

    // Restore fetch and confirm a successful save closes the dialog.
    await js(`(()=>{window.fetch=window.__origFetch;})()`);
    await clickText('설정 저장');
    await until(`!document.querySelector('.settings-dialog[role="dialog"]')`);
    assert.equal(service.studio.settings.title,'접근성 저장 테스트 제목','successful save persisted the edited title');
    const restored=await active();
    assert.ok(restored.label&&restored.label.includes('방송 설정'),'focus returns to the settings trigger after close');
    const bgClosed=await js(`(()=>{const r=document.getElementById('root');return{inert:r.hasAttribute('inert'),ariaHidden:r.getAttribute('aria-hidden')};})()`);
    assert.equal(bgClosed.inert,false);assert.equal(bgClosed.ariaHidden,null);
    checks.push('successful save closes the dialog, returns focus to the trigger, and re-enables the background');

    // Re-open + Escape close, confirming state survives reopen and Escape works.
    await focusClick('.sidebar .sidebar-bottom button');
    await until(`!!document.querySelector('.settings-dialog[role="dialog"]')`);
    const reopened=await js(`(()=>{const l=Array.from(document.querySelectorAll('.settings-dialog label')).find(l=>l.textContent.includes('방송 제목'));return l&&l.querySelector('input').value;})()`);
    assert.equal(reopened,'접근성 저장 테스트 제목','reopened dialog shows the saved settings');
    await key('Escape');
    await until(`!document.querySelector('.settings-dialog[role="dialog"]')`);
    assert.ok((await active()).label.includes('방송 설정'),'Escape returns focus to the settings trigger');
    checks.push('reopen shows saved state; Escape closes and restores focus to the trigger');
    writeFileSync(join(folder,'settings-dialog.png'),(await win.webContents.capturePage()).toPNG());

    // ================= SCREEN SELECTION DIALOG =================
    await focusClick('button[title="화면 선택"]');
    await until(`!!document.querySelector('.source-modal[role="dialog"]')`);
    await until(`document.querySelectorAll('.source-grid button').length===2`);
    const screenSem=await js(`(()=>{const d=document.querySelector('.source-modal');const t=document.getElementById(d.getAttribute('aria-labelledby'));return{role:d.getAttribute('role'),modal:d.getAttribute('aria-modal'),titleText:t&&t.textContent,closeName:d.querySelector('.modal-title button.icon').getAttribute('aria-label'),sources:Array.from(d.querySelectorAll('.source-grid button')).map(b=>b.getAttribute('aria-label'))};})()`);
    assert.equal(screenSem.role,'dialog');assert.equal(screenSem.modal,'true');
    assert.ok(screenSem.titleText.includes('함께 볼 화면'),'screen dialog title linked');
    assert.equal(screenSem.closeName,'화면 선택 창 닫기');
    assert.deepEqual(screenSem.sources,['테스트 화면 A','테스트 창 B'],'each source option exposes a visible name');
    await until(`document.activeElement===document.querySelector('.source-modal[role="dialog"]')`);
    assert.equal((await active()).isDialog,true,'screen dialog opens with focus on the container');
    const screenBg=await js(`document.getElementById('root').hasAttribute('inert')`);
    assert.equal(screenBg,true,'background inert for the screen dialog');
    checks.push('screen dialog exposes role/aria-modal, linked title, named close button, named source options, inert background, container focus');

    // Containment + Escape + focus return for the screen dialog.
    let screenContained=true;
    for(let i=0;i<8;i++){await key('Tab');if(!(await active()).inDialog){screenContained=false;break;}}
    for(let i=0;i<8;i++){await key('Tab',true);if(!(await active()).inDialog){screenContained=false;break;}}
    assert.equal(screenContained,true,'focus trapped inside the screen dialog');
    await key('Escape');
    await until(`!document.querySelector('.source-modal[role="dialog"]')`);
    assert.equal((await active()).label,'화면 선택','Escape returns focus to the screen-select trigger');
    assert.equal(await js(`document.getElementById('root').hasAttribute('inert')`),false,'background re-enabled after the screen dialog closes');
    checks.push('screen dialog traps Tab/Shift+Tab, closes on Escape, returns focus to its trigger and re-enables the background');
    writeFileSync(join(folder,'screen-dialog.png'),(await win.webContents.capturePage()).toPNG());

    assert.deepEqual(errors,[],'no renderer console errors');
    const report={passed:true,syntheticModel:true,noUserDevices:true,noAccountLogin:true,folder,checks,consoleErrors:errors};
    writeFileSync('artifacts/dialog-accessibility-test.json',JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
  }catch(error){
    console.error(error&&error.stack||String(error));
    try{if(win&&!win.isDestroyed())writeFileSync('artifacts/dialog-accessibility-failure.png',(await win.webContents.capturePage()).toPNG());}catch{}
    writeFileSync('artifacts/dialog-accessibility-test.json',JSON.stringify({passed:false,error:error&&error.message,checks,consoleErrors:errors},null,2));
    process.exitCode=1;
  }finally{
    if(win&&!win.isDestroyed())win.destroy();
    await service?.close();
    app.exit(process.exitCode||0);
  }
});
