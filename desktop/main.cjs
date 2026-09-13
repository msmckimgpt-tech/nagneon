const {app,BrowserWindow,desktopCapturer,session,ipcMain,globalShortcut,screen,dialog,shell}=require('electron');
const {join}=require('node:path');
const {pathToFileURL}=require('node:url');
const {createStudioSession}=require('./session.cjs');
const {packagedRuntime,profileDirectory}=require('./runtime.cjs');
const {AccountLogin}=require('./account-login.cjs');
const {createOverlayInput}=require('./overlay-input.cjs');
const profile=profileDirectory(process.argv);if(profile)app.setPath('userData',profile);
const networkRecovery=require('./network-recovery.cjs').createNetworkRecovery(app);
let main,overlay,service,studioSession,account,overlayInput;
const preload=join(__dirname,'preload.cjs');
function secure(win){win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(service.url+'/'))event.preventDefault();});}
function trusted(event,mainOnly=false){if(!event.senderFrame?.url.startsWith(service.url+'/')||(mainOnly&&event.sender!==main.webContents))throw new Error('허용되지 않은 창 요청');}
function publishThrough(value){for(const win of [main,overlay])if(win&&!win.isDestroyed())win.webContents.send('overlay:state',value);}
function through(){if(!overlay||overlay.isDestroyed())return false;return overlayInput.toggle();}
function closeOverlay(){const win=overlay;overlay=null;if(win&&!win.isDestroyed())win.close();}
async function openOverlay(){
  if(overlay&&!overlay.isDestroyed()){overlay.showInactive();return;}
  const area=screen.getPrimaryDisplay().workArea;
  overlay=new BrowserWindow({width:390,height:650,x:area.x+area.width-415,y:area.y+55,transparent:true,frame:false,alwaysOnTop:true,skipTaskbar:true,resizable:true,hasShadow:false,backgroundColor:'#00000000',webPreferences:{session:studioSession,preload,contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  overlayInput=createOverlayInput(overlay,publishThrough);
  const created=overlay;const input=overlayInput;created.once('closed',()=>{if(overlay===created)overlay=null;publishThrough(false);});
  created.on('blur',()=>input.reset());
  created.webContents.on('did-finish-load',()=>{input.reset();publishThrough(input.state());});
  secure(overlay);overlay.setAlwaysOnTop(true,'screen-saver');overlay.setContentProtection(true);publishThrough(false);await overlay.loadURL(service.url+'/overlay');overlay.setTitle('BACKSEAT Chat Overlay');overlay.showInactive();
}
if(!app.requestSingleInstanceLock())app.quit();else{
  app.on('second-instance',()=>{main?.show();main?.focus();});
  app.whenReady().then(async()=>{
    if(!app.isPackaged){try{process.loadEnvFile(join(__dirname,'../.env'));}catch{}}
    const {startServer}=await import(pathToFileURL(join(__dirname,'../server/index.js')).href);
    service=await startServer({port:0,dataDir:app.isPackaged||profile?join(app.getPath('userData'),'data'):join(__dirname,'../data'),runtime:app.isPackaged?packagedRuntime(process.resourcesPath):{}});
    studioSession=createStudioSession(session,service);
    main=new BrowserWindow({width:1440,height:980,minWidth:850,minHeight:650,title:'BACKSEAT Studio',backgroundColor:'#101216',autoHideMenuBar:true,webPreferences:{session:studioSession,preload,contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});secure(main);
    const provider=service.studio.provider;
    const checkAccount=async()=>{if(provider.check)await provider.check();service.studio.publish();return provider.status();};
    account=new AccountLogin({bin:provider.bin,env:provider.env,check:checkAccount,openExternal:url=>shell.openExternal(url),onChange:value=>{if(main&&!main.isDestroyed())main.webContents.send('account:state',value);}});
    ipcMain.handle('account:status',event=>{trusted(event,true);return account.snapshot();});
    ipcMain.handle('account:start',(event,method)=>{trusted(event,true);if(service.studio.running||service.studio.busy||service.studio.training.active)throw new Error('방송과 연습을 마친 뒤 계정을 연결하세요.');if(provider.status().kind!=='codex')throw new Error('현재 제공처는 ChatGPT 구독 연결을 지원하지 않습니다.');return account.start(method);});
    ipcMain.handle('account:cancel',event=>{trusted(event,true);return account.stop();});
    ipcMain.handle('account:open',event=>{trusted(event,true);return account.open();});
    studioSession.setPermissionRequestHandler((contents,permission,callback)=>callback(contents===main.webContents&&['media','display-capture'].includes(permission)));
    studioSession.setPermissionCheckHandler((contents,permission)=>contents===main.webContents&&['media','display-capture'].includes(permission));
    require('./capture.cjs').attachCapture({session:studioSession,ipcMain,desktopCapturer,main});
    ipcMain.handle('overlay:open',event=>{trusted(event);return openOverlay();});ipcMain.handle('overlay:through',event=>{trusted(event);return through();});ipcMain.handle('overlay:close',event=>{trusted(event);closeOverlay();});
    ipcMain.on('overlay:interactive',(event,value)=>{if(overlay&&!overlay.isDestroyed()&&event.sender===overlay.webContents&&event.senderFrame===overlay.webContents.mainFrame)overlayInput.interactive(value);});
    globalShortcut.register('CommandOrControl+Shift+F10',through);
    globalShortcut.register('CommandOrControl+Shift+F9',()=>{service.studio.stop();main.webContents.send('studio:panic');});
    main.on('closed',()=>{closeOverlay();app.quit();});
    if(await networkRecovery.load(main,service.url+'/'))main.show();
  }).catch(error=>{console.error(error.message);dialog.showErrorBox('BACKSEAT 시작 오류',error.message+'\n\n저장 기록을 임의로 초기화하지 않았습니다. data 폴더의 원본과 백업을 보존한 상태로 오류 내용을 확인해주세요.');app.quit();});
  app.on('will-quit',()=>{globalShortcut.unregisterAll();account?.dispose();void service?.close();});
}
