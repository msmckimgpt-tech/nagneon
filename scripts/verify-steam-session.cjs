// Interactive acceptance: real game window, Windows output and Astra; no seeded viewers.
// Game input is operated separately with the native Computer Use tool.
const {app,BrowserWindow,session,ipcMain,desktopCapturer}=require('electron');
const {createStudioSession}=require('../desktop/session.cjs');
const {attachCapture}=require('../desktop/capture.cjs');
const {packagedRuntime}=require('../desktop/runtime.cjs');
const {resolve,join}=require('node:path');
const {pathToFileURL}=require('node:url');
const {mkdirSync,readFileSync,writeFileSync,readdirSync}=require('node:fs');
const assert=require('node:assert/strict');
const gameTitle=process.argv.find(a=>a.startsWith('--game='))?.slice(7);
if(!gameTitle)throw Error('Provide the exact observed game window title with --game=');
const base=resolve('artifacts/steam-session-'+Date.now());mkdirSync(base);mkdirSync(join(base,'commands'));app.setPath('userData',join(base,'profile'));
const report={base,gameTitle,startedAt:new Date().toISOString(),completed:false,realModel:true,realGameCapture:true,realWindowsLoopback:true,physicalMicrophone:false,seededViewers:false,calls:[],sounds:[],commands:[],errors:[]};
writeFileSync('artifacts/active-steam-session.json',JSON.stringify({base,pid:process.pid,gameTitle},null,2));
let service,win,timer,closing=false;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const save=()=>writeFileSync(join(base,'session.json'),JSON.stringify(report,null,2));
async function close(reason){if(closing)return;closing=true;clearInterval(timer);report.endedAt=new Date().toISOString();report.reason=reason;report.finalState=service?.studio.state();service?.studio.stop();if(win&&!win.isDestroyed())win.destroy();await service?.close();report.completed=reason==='requested';save();console.log(JSON.stringify({base,completed:report.completed,calls:report.calls.length,sounds:report.sounds.length,errors:report.errors}));app.exit(report.completed?0:1);}
app.on('window-all-closed',()=>{});
setTimeout(()=>void close('25-minute watchdog'),25*60000).unref();
app.whenReady().then(async()=>{try{
  const runtimeFolder=process.argv.find(a=>a.startsWith('--runtime-folder='))?.slice(17)||JSON.parse(readFileSync('artifacts/latest-package.json','utf8')).folder;
  const runtime=packagedRuntime(join(runtimeFolder,'resources'));report.runtimeFolder=runtimeFolder;
  const {CodexProvider}=await import(pathToFileURL(resolve('server/codex-provider.js')));
  const {LocalSound}=await import(pathToFileURL(resolve('server/local-sound.js')));
  const {startServer}=await import(pathToFileURL(resolve('server/index.js')));
  const provider=new CodexProvider({...process.env,CODEX_BIN:runtime.codexBin,OPENAI_MODEL:'gpt-6-astra',OPENAI_REASONING_EFFORT:'low'}),originalReact=provider.react.bind(provider);
  provider.react=async(args,signal)=>{
    const call={id:report.calls.length+1,at:Date.now(),kind:args.special?.kind||'ordinary',speech:args.speech,adviceRequested:args.adviceRequested,hasImage:!!args.image,viewerContext:args.viewerContext,viewerIds:args.settings.personas.map(p=>p.id)};report.calls.push(call);
    if(args.image){call.frame='frame-'+String(call.id).padStart(3,'0')+'.jpg';writeFileSync(join(base,call.frame),Buffer.from(args.image.split(',')[1],'base64'));}
    save();try{const result=await originalReact(args,signal);call.ms=Date.now()-call.at;call.observation=result.observation;call.usage=result.usage;save();return result;}catch(e){call.error=e.message;call.ms=Date.now()-call.at;save();throw e;}
  };
  const sound=new LocalSound(runtime.sound),analyze=sound.analyze.bind(sound);
  sound.analyze=async(buffer,signal)=>{const at=Date.now(),result=await analyze(buffer,signal);report.sounds.push({at,ms:Date.now()-at,result});return result;};
  service=await startServer({port:0,dataDir:join(base,'data'),runtime,provider,soundWorker:sound,localSpeech:false});
  const s=service.studio;assert.equal(s.settings.personas.filter(p=>!p.system).length,0);
  s.configure({...s.settings,title:gameTitle+' · 실제 방송 수용',mode:'live',category:'gaming',lurkRatio:0,intervalSeconds:60,maxCalls:24,chatPace:3,clipBufferEnabled:true,autoHighlights:true});
  const studioSession=createStudioSession(session,service);
  win=new BrowserWindow({title:'BACKSEAT Steam acceptance',width:1260,height:900,show:true,webPreferences:{session:studioSession,preload:resolve('desktop/preload.cjs'),sandbox:true,contextIsolation:true,backgroundThrottling:false}});
  win.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message);});
  studioSession.setPermissionRequestHandler((contents,p,cb)=>cb(contents===win.webContents&&['media','display-capture'].includes(p)));
  studioSession.setPermissionCheckHandler((contents,p)=>contents===win.webContents&&['media','display-capture'].includes(p));
  attachCapture({session:studioSession,ipcMain,desktopCapturer,main:win});ipcMain.handle('account:status',()=>({status:'idle'}));
  await win.loadURL(service.url);win.show();
  const js=code=>new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Renderer did not answer: '+code.slice(0,140))),10000);win.webContents.executeJavaScript(code,true).then(value=>{clearTimeout(timeout);resolve(value);},error=>{clearTimeout(timeout);reject(Error(code.slice(0,140)+': '+error.message));});});
  const until=async(fn,timeout=90000)=>{const at=Date.now();while(Date.now()-at<timeout){if(await fn())return;await pause(100);}throw Error('Acceptance condition timeout');};
  const button=async text=>{await until(()=>js(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled);if(!b)return false;b.click();return true;})()`));};
  await button('나중에 설정하기');
  await until(()=>js(`!!document.querySelector('[title="시스템 출력 소리"]')`));await js(`document.querySelector('[title="시스템 출력 소리"]').click()`);
  await until(()=>js(`Array.from(document.querySelectorAll('.source-grid button')).some(b=>b.getAttribute('aria-label')===${JSON.stringify(gameTitle)})`));
  assert.equal(await js(`document.querySelector('.source-options input').checked`),true);
  await js(`Array.from(document.querySelectorAll('.source-grid button')).find(b=>b.getAttribute('aria-label')===${JSON.stringify(gameTitle)}).click()`);
  await until(()=>js(`document.body.textContent.includes('소리 공유 중')`));
  report.captureConnectedAt=new Date().toISOString();await button('방송 시작');await button('나의 관객');
  await until(()=>js(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('한 명과 첫 만남')&&!b.disabled);if(!b)return false;b.click();return true;})()`));
  await until(()=>s.settings.personas.some(p=>!p.system));report.generatedViewer=s.settings.personas.find(p=>!p.system);await button('방송실');
  report.readyAt=new Date().toISOString();save();writeFileSync(join(base,'ready.json'),JSON.stringify({base,viewer:report.generatedViewer.name,calls:s.calls},null,2));
  console.log('STEAM_SESSION_READY '+base);
  const seen=new Set();let commandBusy=false;
  timer=setInterval(async()=>{if(closing||commandBusy)return;commandBusy=true;try{
    writeFileSync(join(base,'state.json'),JSON.stringify(s.state(),null,2));save();
    for(const file of readdirSync(join(base,'commands')).filter(n=>/^[\w-]+\.json$/.test(n)).sort()){
      if(seen.has(file))continue;seen.add(file);const cmd=JSON.parse(readFileSync(join(base,'commands',file),'utf8'));
      const entry={file,at:Date.now(),type:cmd.type};report.commands.push(entry);
      if(cmd.type==='say'){
        assert.equal(typeof cmd.text,'string');assert.ok(cmd.text.length<=3000);entry.text=cmd.text;
        await js(`{const e=document.querySelector('input[aria-label="관객에게 말하기"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(cmd.text)});e.dispatchEvent(new Event('input',{bubbles:true}));}`);
        await until(()=>js(`!document.querySelector('[title="보내기"]').disabled`));await js(`document.querySelector('[title="보내기"]').click()`);
      }else if(cmd.type==='snapshot'){
        const name=file.slice(0,-5);writeFileSync(join(base,name+'-state.json'),JSON.stringify(s.state(),null,2));writeFileSync(join(base,name+'-ui.png'),(await win.webContents.capturePage()).toPNG());
      }else if(cmd.type==='stop'){await close('requested');return;}
      else throw Error('Unknown acceptance command');entry.doneAt=Date.now();save();
    }
  }catch(error){report.errors.push(error.stack);save();}finally{commandBusy=false;}},1000);
}catch(error){report.errors.push(error.stack);await close('setup error');}});
