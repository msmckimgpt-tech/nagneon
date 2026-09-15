// Real Electron renderer, isolated in-memory world; no account or device access.
const {app,BrowserWindow,session}=require('electron');
const {resolve,join}=require('node:path');
const {pathToFileURL}=require('node:url');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {createStudioSession}=require('../desktop/session.cjs');
const out=resolve('artifacts/nagneon');fs.mkdirSync(out,{recursive:true});
app.setPath('userData',join(out,'renderer-profile'));
let service,win;const checks=[],errors=[];
app.whenReady().then(async()=>{
 try{
  const {startServer}=await import(pathToFileURL(resolve('server/index.js')).href);
  service=await startServer({port:0,persist:false,localSpeech:false,provider:{status:()=>({kind:'codex',configured:false,model:'test',effort:'low',authMessage:'검증용 · 계정 연결 없음'})}});
  win=new BrowserWindow({width:1440,height:980,show:false,webPreferences:{offscreen:true,backgroundThrottling:false,session:createStudioSession(session,service),contextIsolation:true,sandbox:true}});
  win.webContents.on('console-message',(_event,level,message)=>{if(level===3)errors.push(message);});
  const js=code=>win.webContents.executeJavaScript(code);
  const until=async code=>{for(let i=0;i<150;i++){if(await js(code))return;await new Promise(r=>setTimeout(r,40));}throw Error('Timed out: '+code);};
  const click=async label=>{assert.equal(await js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)return false;b.click();return true})()`),true,label);};
  const shot=async name=>{await new Promise(r=>setTimeout(r,250));fs.writeFileSync(join(out,name+'.png'),(await win.webContents.capturePage()).toPNG());};
  await win.loadURL(service.url);await until(`!!document.querySelector('.welcome-shell')`);
  assert.match(await js('document.title'),/Nagneon/);await shot('welcome');checks.push('branded first-run onboarding');
  await click('다음');await until(`document.querySelector('.welcome-intro').textContent.includes('어떤 채팅창')`);await shot('atmosphere');
  await click('다음');await until(`document.querySelector('.welcome-intro').textContent.includes('인사할 준비')`);await shot('connection');
  await click('직접 조작하며 배우기');await until(`!!document.querySelector('.app-shell')`);
  await until(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='나중에 계속하기')`);
  assert.equal(service.studio.running,false);assert.equal(service.studio.state().tutorial.status,'active');
  await click('나중에 계속하기');await until(`![...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='나중에 계속하기')`);
  checks.push('three-step onboarding enters guided tutorial without starting broadcast; pause works');
  // Remaining assertions exercise rehearsal layout, independently of account setup.
  service.studio.configure({...service.studio.settings,mode:'rehearsal'});
  await until(`document.body.innerText.includes('리허설 시작')`);
  for(const width of [1440,1000,850]){win.setSize(width,980);await shot('studio-'+width);assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'),true,'no horizontal overflow '+width);}
  checks.push('studio fits 1440, 1000 and 850 pixel windows');
  for(const [width,height] of [[1080,1920],[850,1500],[540,960],[420,900]]){
   win.setSize(width,height);await shot('portrait-'+width+'x'+height);
   assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'),true,'portrait no horizontal overflow '+width);
   assert.equal(await js('getComputedStyle(document.querySelector(".sidebar")).display!=="none"'),true,'navigation available '+width);
   if(width>620){
    assert.equal(await js('document.querySelector(".chat-panel").getBoundingClientRect().top>=document.querySelector(".stage").getBoundingClientRect().bottom-2'),true,'portrait stacks stage above chat');
    assert.equal(await js('document.querySelector(".chat-panel").getBoundingClientRect().bottom<=innerHeight'),true,'portrait composer visible without page scroll');
   }
  }
  checks.push('portrait 1080x1920 and 850x1500 keep stage and composer visible; 540 and 420 keep navigation accessible');win.setSize(1440,980);
  for(const label of ['나의 관객','게임 라이브러리','매니저','방송 밖 이야기','마음과 포인트','핫클립','방송실']){
   await js(`[...document.querySelectorAll('nav button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`);
   await new Promise(r=>setTimeout(r,150));
   assert.equal(await js('/BACKSEAT|backseat/.test(document.body.innerText)'),false,'visible legacy name '+label);
   assert.equal(await js('/무료|검증|가상|시뮬레이션/.test(document.body.innerText)'),false,'immersive platform wording '+label);
   assert.equal(await js('!!document.querySelector("h1")'),true,label);
  }
  checks.push('all seven navigation pages render with Nagneon branding');
  assert.equal(await js(`document.body.textContent.includes('방송 놀이터')`),false);
  checks.push('broadcast playground and scripted practice navigation are absent');
  for(const width of [850,420]){
   win.setSize(width,width===850?1500:900);
   for(const label of ['나의 관객','게임 라이브러리','매니저','방송 밖 이야기','마음과 포인트','핫클립','방송실']){
    await js(`[...document.querySelectorAll('nav button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`);await new Promise(r=>setTimeout(r,120));
    assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'),true,'page fits '+width+' '+label);
   }
  }
  checks.push('all seven pages avoid horizontal overflow at 850 and 420 pixels');win.setSize(1440,980);
  await click('리허설 시작');await until(`document.body.innerText.includes('방송 종료')`);assert.equal(service.studio.running,true);await shot('rehearsal');
  await click('방송 종료');await until(`document.body.innerText.includes('리허설 시작')`);checks.push('rehearsal start and stop through controls');
  await win.loadURL(service.url+'/overlay');await until(`!!document.querySelector('.overlay-shell')`);
  assert.match(await js('document.body.innerText'),/NAGNEON/);
  assert.equal(await js('getComputedStyle(document.documentElement).backgroundColor'),'rgba(0, 0, 0, 0)');
  assert.equal(await js('getComputedStyle(document.body).backgroundColor'),'rgba(0, 0, 0, 0)');await shot('overlay');checks.push('branded transparent overlay');
  assert.deepEqual(errors,[]);checks.push('no renderer console errors');
  fs.writeFileSync(join(out,'renderer-result.json'),JSON.stringify({passed:true,synthetic:true,checks},null,2));console.log(JSON.stringify({passed:true,checks}));
 }catch(error){fs.writeFileSync(join(out,'renderer-result.json'),JSON.stringify({passed:false,checks,error:error.stack,errors},null,2));console.error(error);process.exitCode=1;}
 finally{win?.destroy();await service?.close();app.exit(process.exitCode||0);}
});
