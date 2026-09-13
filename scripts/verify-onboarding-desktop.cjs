// Isolated product UI test: simulated authentication/model; no account login,
// microphone, screen capture or personal profile is accessed by this harness.
const {app,BrowserWindow,session,ipcMain}=require('electron');
const {createStudioSession}=require('../desktop/session.cjs');
const {pathToFileURL}=require('node:url');
const {resolve}=require('node:path');
const {mkdirSync,writeFileSync}=require('node:fs');
const assert=require('node:assert/strict');
const folder=resolve('artifacts/onboarding-renderer-'+Date.now());mkdirSync(folder,{recursive:true});app.setPath('userData',resolve(folder,'profile'));
let service,win,connected=false,login={status:'idle'},modelCalls=0;const checks=[],errors=[];
const report=()=>({folder,checkedAt:new Date().toISOString(),simulatedAuthentication:true,simulatedModel:true,checks,errors});
setTimeout(()=>{writeFileSync('artifacts/onboarding-desktop-test.json',JSON.stringify({...report(),passed:false,error:'Watchdog expired'},null,2));app.exit(2);},90000).unref();
app.whenReady().then(async()=>{
  try{
    const {startServer}=await import(pathToFileURL(resolve('server/index.js')).href);
    service=await startServer({port:0,dataDir:resolve(folder,'data'),localSpeech:false,provider:{model:'gpt-6-astra',effort:'low',status:()=>({configured:connected,kind:'codex',model:'gpt-6-astra',effort:'low',authMessage:connected?'ChatGPT 구독 연결됨':'ChatGPT 계정 연결이 필요합니다.'}),check:async()=>{},react:async()=>{modelCalls++;return {observation:{game:'Just Chatting',scene:'검증 인사',confidence:1,excitement:0,messages:[{personaId:'probe',text:'방장 어서 와요! 같이 놀 준비 됐어요.',kind:'chat',spoiler:false}]},usage:{total_tokens:7}};}}});
    ipcMain.handle('account:status',()=>login);ipcMain.handle('account:start',()=>{login={status:'waiting',method:'browser',url:'https://auth.openai.com/oauth/authorize',expiresAt:Date.now()+900000};return login;});
    ipcMain.handle('account:cancel',()=>login={status:'cancelled'});ipcMain.handle('account:open',()=>({ok:true}));
    win=new BrowserWindow({width:1440,height:980,show:true,title:'BACKSEAT Onboarding QA',webPreferences:{session:createStudioSession(session,service),preload:resolve('desktop/preload.cjs'),sandbox:true,contextIsolation:true,backgroundThrottling:false}});
    win.webContents.on('console-message',(_event,level,message)=>{if(level===3)errors.push(message);});
    await win.loadURL(service.url);win.setTitle('BACKSEAT Onboarding QA');win.show();
    const js=code=>win.webContents.executeJavaScript(code,true);
    async function until(expression){const deadline=Date.now()+7000;while(!await js(expression)){if(Date.now()>deadline)throw new Error('UI timeout '+expression);await new Promise(r=>setTimeout(r,40));}}
    async function button(text){await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`);await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled).click()`);}
    async function fill(selector,value){await js(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);}
    await until(`!!document.querySelector('#welcome-name')`);assert.equal(service.studio.state().onboarding.status,'new');
    await fill('#welcome-name','하늘방장');await fill('#welcome-title','처음부터 같이 웃는 방송');
    await continueFlow();
  }catch(error){
    await finish(error);return;
  }
});
async function continueFlow(){
  const js=code=>win.webContents.executeJavaScript(code,true);
  const until=async expression=>{const deadline=Date.now()+7000;while(!await js(expression)){if(Date.now()>deadline)throw new Error('UI timeout '+expression);await new Promise(r=>setTimeout(r,40));}};
  const button=async text=>{await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`);await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled).click()`);};
  await js(`Array.from(document.querySelectorAll('.category-options button')).find(b=>b.textContent.includes('Just Chatting')).click()`);await button('다음');await until(`!!document.querySelector('#welcome-style')`);await js(`Array.from(document.querySelectorAll('.vibe-options button')).find(b=>b.textContent.includes('티키타카')).click()`);await button('다음');await until(`!!document.querySelector('.account-panel')`);
  await button('ChatGPT 계정 연결');await until(`document.body.textContent.includes('브라우저에서 ChatGPT 로그인을 마쳐주세요')`);await button('공식 로그인 페이지 열기');await button('로그인 취소');await until(`document.body.textContent.includes('로그인을 취소했습니다')`);assert.equal(modelCalls,0);checks.push('new profile configures identity/category/vibe and can cancel simulated login without model usage');
  connected=true;await button('연결 상태 새로고침');await until(`document.body.textContent.includes('ChatGPT 구독 연결됨')`);await button('Astra 응답 확인 · 1회 사용');await until(`document.body.textContent.includes('Astra 응답 확인됨')`);assert.equal(modelCalls,1);assert.equal(service.studio.calls,0);assert.equal(service.studio.messages.length,0);checks.push('explicit synthetic model probe makes one isolated call and displays readiness');
  await js(`window.originalFetch=window.fetch;window.fetch=async(...args)=>{const response=await window.originalFetch(...args);if(args[0]==='/api/onboarding'){window.completionDelivered=true;await new Promise(resolve=>window.releaseCompletion=resolve);}return response;};void 0;`);
  await button('리허설로 입장');await until(`window.completionDelivered===true`);assert.equal(service.studio.state().onboarding.status,'completed');assert.equal(await js(`!!document.querySelector('.welcome-shell')`),true);assert.equal(await js(`!!document.querySelector('.app-shell')`),false);await js(`window.releaseCompletion();window.fetch=window.originalFetch;void 0;`);
  await until(`!!document.querySelector('.studio-starter')`);checks.push('completion waits for its save response even when SSE publishes completion first');assert.equal(service.studio.running,false);assert.equal(service.studio.settings.title,'처음부터 같이 웃는 방송');assert.equal(service.studio.settings.streamer,'하늘방장');assert.equal(service.studio.settings.category,'just-chatting');assert.equal(service.studio.settings.crowdStyle,'lively');assert.equal(service.studio.settings.personas.length,5);
  await button('리허설 시작');await until(`document.body.textContent.includes('방송 종료')`);await js(`fetch('/api/react',{method:'POST',headers:{'Content-Type':'application/json','X-Backseat-Client':'studio'},body:JSON.stringify({speech:'첫 방송 인사입니다'})})`);await until(`document.querySelectorAll('.chat-line').length>1`);assert.equal(modelCalls,1);await button('방송 종료');checks.push('completion preserves all five personas, enters stopped studio and rehearsal responds without another model call');
  await win.reload();await until(`!!document.querySelector('.app-shell')`);assert.equal(await js(`!!document.querySelector('.welcome-shell')`),false);await js(`document.querySelector('.sidebar-bottom button').click()`);await until(`!!document.querySelector('.settings-modal')`);await button('처음 시작 안내 다시 보기 →');await until(`!!document.querySelector('#welcome-name')`);assert.equal(await js(`document.querySelector('#welcome-name').value`),'하늘방장');checks.push('saved completion survives reload and setup can be reopened without resetting personalization');
  win.setSize(900,750);await new Promise(r=>setTimeout(r,150));assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'),true);assert.equal(await js('document.activeElement.tagName'), 'H1');checks.push('900px first-run layout remains contained and step heading receives keyboard focus');
  await button('나중에 설정하기');await until(`!!document.querySelector('.app-shell')`);assert.equal(service.studio.settings.title,'처음부터 같이 웃는 방송');assert.equal(service.studio.running,false);assert.deepEqual(errors.filter(e=>!e.includes('Autofill')),[]);
  await finish();
}
async function finish(error){
  const value={...report(),passed:!error,...(error?{error:error.message}:{})};writeFileSync('artifacts/onboarding-desktop-test.json',JSON.stringify(value,null,2));console.log(JSON.stringify(value));win?.destroy();await service?.close();app.exit(error?1:0);
}
