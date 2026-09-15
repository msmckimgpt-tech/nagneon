const {app,BrowserWindow,desktopCapturer,session,ipcMain,globalShortcut,screen,dialog,shell}=require('electron');
const {join}=require('node:path');
const {pathToFileURL}=require('node:url');
const {createStudioSession}=require('./session.cjs');
const {packagedRuntime,profileDirectory}=require('./runtime.cjs');
const {AccountLogin}=require('./account-login.cjs');
const {createOverlayInput}=require('./overlay-input.cjs');
const {applyOverlayPrivacy}=require('./overlay-privacy.cjs');
const storage=require('./storage.cjs');
const profile=profileDirectory(process.argv);
const storageDefaults=storage.storagePaths(app.getPath('appData'));
try{app.setPath('userData',profile||storage.readProfile(app.getPath('appData')));}catch(error){dialog.showErrorBox('저장 위치 확인',error.message);app.exit(1);}
let pendingStorage;
app.setName('Nagneon');
const networkRecovery=require('./network-recovery.cjs').createNetworkRecovery(app);
let main,overlay,service,startingService,studioSession,account,overlayInput;
const preload=join(__dirname,'preload.cjs');
function secure(win){win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(service.url+'/'))event.preventDefault();});}
function trusted(event,mainOnly=false){if(!event.senderFrame?.url.startsWith(service.url+'/')||(mainOnly&&event.sender!==main.webContents))throw new Error('허용되지 않은 창 요청');}
function publishThrough(value){for(const win of [main,overlay])if(win&&!win.isDestroyed())win.webContents.send('overlay:state',value);}
function through(){if(!overlay||overlay.isDestroyed())return false;return overlayInput.toggle();}
function closeOverlay(){const win=overlay;overlay=null;if(win&&!win.isDestroyed())win.close();}
function syncOverlayPrivacy(){
  applyOverlayPrivacy(overlay,service.studio.settings);
}
async function openOverlay(){
  if(overlay&&!overlay.isDestroyed()){overlay.showInactive();return;}
  const area=screen.getPrimaryDisplay().workArea;
  overlay=new BrowserWindow({width:390,height:650,x:area.x+area.width-415,y:area.y+55,transparent:true,frame:false,alwaysOnTop:true,skipTaskbar:true,resizable:true,hasShadow:false,backgroundColor:'#00000000',webPreferences:{session:studioSession,preload,contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  overlayInput=createOverlayInput(overlay,publishThrough);
  const created=overlay;const input=overlayInput;created.once('closed',()=>{if(overlay===created)overlay=null;publishThrough(false);});
  created.on('blur',()=>input.reset());
  created.webContents.on('did-finish-load',()=>{input.reset();publishThrough(input.state());});
  secure(overlay);overlay.setAlwaysOnTop(true,'screen-saver');syncOverlayPrivacy();publishThrough(false);await overlay.loadURL(service.url+'/overlay');overlay.setTitle('Nagneon Chat Overlay');overlay.showInactive();
}
if(!app.requestSingleInstanceLock())app.quit();else{
  const shutdown=require('./graceful-quit.cjs').installGracefulQuit(app,async()=>{
    globalShortcut.unregisterAll();account?.dispose();
    const active=service||await startingService?.catch(()=>undefined);
    await active?.close();
    if(pendingStorage){
      try{
        storage.migrateStorage({source:app.getPath('userData'),target:pendingStorage,configFile:storageDefaults.configFile});
        app.relaunch();
      }catch(error){dialog.showErrorBox('저장 위치 변경 실패',error.message+'\n기존 기록은 원래 위치에 보존되어 있습니다. 앱을 다시 실행해주세요.');}
    }
  });
  app.on('second-instance',()=>{if(!shutdown.quitting&&main&&!main.isDestroyed()){main.show();main.focus();}});
  app.whenReady().then(async()=>{
    if(!app.isPackaged){try{process.loadEnvFile(join(__dirname,'../.env'));}catch{}}
    const {startServer}=await import(pathToFileURL(join(__dirname,'../server/index.js')).href);
    if(shutdown.quitting)return;
    startingService=startServer({providerSwitchAllowed:()=>!account?.active,openExternalAuth:url=>shell.openExternal(url),port:0,dataDir:join(app.getPath('userData'),'data'),runtime:app.isPackaged?packagedRuntime(process.resourcesPath,{cache:profile?join(profile,'runtime'):join(app.getPath('appData'),'..','Local','Nagneon','runtime')}):{}});
    service=await startingService;
    service.studio.on('state',syncOverlayPrivacy);
    if(shutdown.quitting)return;
    studioSession=createStudioSession(session,service);
    main=new BrowserWindow({width:1440,height:980,minWidth:420,minHeight:650,title:'Nagneon · 나그네온',icon:join(__dirname,'../dist/nagneon-icon.png'),backgroundColor:'#10151e',autoHideMenuBar:true,webPreferences:{session:studioSession,preload,contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});secure(main);
    const provider=service.studio.provider;
    ipcMain.handle('storage:status',event=>{trusted(event,true);return {profile:app.getPath('userData'),defaultProfile:storageDefaults.defaultProfile,isolated:!!profile};});
    ipcMain.handle('storage:change',async(event,useDefault)=>{
      trusted(event,true);
      if(profile)throw Error('검증용 별도 프로필에서는 전역 저장 위치를 변경할 수 없습니다.');
      const assertIdle=()=>{if(service.studio.running||service.studio.busy||account?.active||shutdown.quitting||pendingStorage)throw Error('방송·계정 연결을 마친 뒤 다시 시도하세요.');};
      assertIdle();
      let target=storageDefaults.defaultProfile;
      if(useDefault!==true){const chosen=await dialog.showOpenDialog(main,{title:'기록을 복사할 빈 저장 폴더 선택',properties:['openDirectory','createDirectory']});if(chosen.canceled)return false;target=chosen.filePaths[0];}
      target=storage.validateDestination(app.getPath('userData'),target);
      const answer=await dialog.showMessageBox(main,{type:'question',buttons:['기록 복사 후 재시작','취소'],defaultId:1,cancelId:1,message:'저장 위치를 변경할까요?',detail:target+'\n기록을 복사하고 앱을 재시작합니다. 원래 기록은 복구용으로 남깁니다. 아직 저장하지 않은 설정은 먼저 저장해주세요.'});
      if(answer.response!==0)return false;
      assertIdle();pendingStorage=target;app.quit();return true;
    });
    const checkAccount=async()=>{if(provider.check)await provider.check();service.studio.publish();return provider.status();};
    account=new AccountLogin({bin:provider.bin,env:provider.env,check:checkAccount,openExternal:url=>shell.openExternal(url),onChange:value=>{if(main&&!main.isDestroyed())main.webContents.send('account:state',value);}});
    ipcMain.handle('account:status',event=>{trusted(event,true);return account.snapshot();});
    ipcMain.handle('account:start',(event,method)=>{trusted(event,true);if(service.studio.running||service.studio.busy)throw new Error('방송을 마친 뒤 계정을 연결하세요.');if(provider.status().kind!=='codex')throw new Error('현재 제공처는 ChatGPT 구독 연결을 지원하지 않습니다.');return account.start(method);});
    ipcMain.handle('account:cancel',event=>{trusted(event,true);return account.stop();});
    ipcMain.handle('account:open',event=>{trusted(event,true);return account.open();});
    studioSession.setPermissionRequestHandler((contents,permission,callback)=>callback(contents===main.webContents&&['media','display-capture'].includes(permission)));
    studioSession.setPermissionCheckHandler((contents,permission)=>contents===main.webContents&&['media','display-capture'].includes(permission));
    require('./capture.cjs').attachCapture({session:studioSession,ipcMain,desktopCapturer,main});
    ipcMain.handle('overlay:open',event=>{trusted(event);return openOverlay();});ipcMain.handle('overlay:through',event=>{trusted(event);return through();});ipcMain.handle('overlay:close',event=>{trusted(event);closeOverlay();});
    ipcMain.on('overlay:interactive',(event,value)=>{if(overlay&&!overlay.isDestroyed()&&event.sender===overlay.webContents&&event.senderFrame===overlay.webContents.mainFrame)overlayInput.interactive(value);});
    globalShortcut.register('CommandOrControl+Shift+F10',through);
    main.on('closed',()=>{closeOverlay();app.quit();});
    if(await networkRecovery.load(main,service.url+'/')&&!shutdown.quitting&&!main.isDestroyed())main.show();
  }).catch(error=>{console.error(error.message);if(shutdown.quitting)return;dialog.showErrorBox('Nagneon 시작 오류',error.message+'\n\n저장 기록을 임의로 초기화하지 않았습니다. data 폴더의 원본과 백업을 보존한 상태로 오류 내용을 확인해주세요.');app.quit();});
}
