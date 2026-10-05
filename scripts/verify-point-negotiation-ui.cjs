// Owned Electron renderer + authenticated server + persistent synthetic profile.
// No real account, microphone, screen capture, or user profile is accessed.
const {app,BrowserWindow,session,ipcMain}=require('electron');
const {createStudioSession}=require('../desktop/session.cjs');
const {resolve,join}=require('node:path');
const {pathToFileURL}=require('node:url');
const {mkdirSync,writeFileSync,readFileSync}=require('node:fs');
const assert=require('node:assert/strict');
const base=resolve('artifacts/point-negotiation-ui-'+Date.now());
mkdirSync(base,{recursive:true});app.setPath('userData',join(base,'profile'));
const report={base,passed:false,syntheticModel:true,nativeDevices:false,realAccount:false,checks:[],errors:[]};
let service,win,modelMode='success',release,releaseQuoteResponse;
ipcMain.handle('account:status',()=>({status:'idle'}));
ipcMain.handle('capture:sources',()=>[]);ipcMain.handle('capture:previews',()=>[]);
ipcMain.handle('storage:status',()=>({profile:join(base,'profile'),defaultProfile:join(base,'profile'),isolated:true}));
app.on('window-all-closed',()=>{});setTimeout(()=>app.exit(2),120000).unref();
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const provider={status:()=>({configured:true,kind:'codex',model:'Synthetic point acceptance',effort:'low'}),react:async args=>{
  if(modelMode==='failure')throw Error('합성 관객 연결 오류');
  if(modelMode==='deferred')return new Promise(r=>release=()=>r({observation:{messages:args.settings.personas.map(p=>({personaId:p.id,text:'종료된 방송의 늦은 응원',kind:'chat',spoiler:false}))}}));
  return {observation:{game:'Just Chatting',scene:'synthetic',confidence:1,excitement:.2,messages:args.settings.personas.map(p=>({personaId:p.id,text:args.special.kind==='interview'?'편안하게 얘기하는 방송이 좋아요.':'도전 계속 가자!',kind:'chat',spoiler:false}))}};
}};
const js=code=>win.webContents.executeJavaScript(code,true);
async function until(code,timeout=8000){const at=Date.now();while(Date.now()-at<timeout){if(await js(code))return;await pause(30);}throw Error('UI timeout: '+code);}
async function textButton(text){await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`);await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`);}
async function click(selector){await until(`!!document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled`);await js(`document.querySelector(${JSON.stringify(selector)}).click()`);}
async function screenshot(name){await js('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');await pause(100);writeFileSync(join(base,name),(await win.webContents.capturePage()).toPNG());}
async function openWindow(){
  const uiSession=createStudioSession(session,service);
  // SSE can render a quote while its initiating HTTP response is still pending.
  uiSession.webRequest.onHeadersReceived({urls:[service.url+'/api/special/quote']},(_details,callback)=>{
    releaseQuoteResponse=()=>{releaseQuoteResponse=null;callback({});};
  });
  win=new BrowserWindow({width:1360,height:960,show:false,webPreferences:{session:uiSession,preload:resolve('desktop/preload.cjs'),sandbox:true,contextIsolation:true,backgroundThrottling:false}});
  win.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message);});
  await win.loadURL(service.url);await until(`!!document.querySelector('.app-shell')`);
}
async function post(path,body={}){
  const response=await fetch(service.url+'/api/'+path,{method:'POST',headers:{Authorization:'Bearer '+service.accessToken,'X-Backseat-Client':'studio','Content-Type':'application/json'},body:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
}
async function negotiate(name){
  await js(`{const l=Array.from(document.querySelectorAll('.target-pills label')).find(e=>e.textContent.trim()===${JSON.stringify(name)});for(const e of document.querySelectorAll('.target-pills input:checked'))e.click();if(!l.querySelector('input').checked)l.querySelector('input').click();}`);
  const count=service.studio.economy.data.quotes.length;
  await textButton('요구 가격 물어보기');await until(`document.querySelectorAll('.quote-card').length===${Math.min(5,count+1)}`);
  const q=service.studio.economy.data.quotes.at(-1);
  const heldAt=Date.now();while(typeof releaseQuoteResponse!=='function'&&Date.now()-heldAt<8000)await pause(30);
  assert.equal(typeof releaseQuoteResponse,'function','quote response must be held');
  assert.equal(await js(`document.querySelector('.quote-card .secondary').disabled`),true,'pending quote must disable bidding');
  assert.equal(q.round,0);assert.equal(q.status,'open');
  releaseQuoteResponse();
  await click('.quote-card .secondary');
  await until(`document.querySelector('.quote-card').textContent.includes('합의한 행동 실행')`);
  assert.equal(service.studio.economy.data.quotes.find(v=>v.id===q.id).round,1,'one enabled click submits one bid');
  report.pendingQuoteCases=(report.pendingQuoteCases||0)+1;
  assert.equal(service.studio.economy.data.quotes.find(v=>v.id===q.id).status,'agreed');return service.studio.economy.data.quotes.find(v=>v.id===q.id);
}
app.whenReady().then(async()=>{
  try {
    const {startServer}=await import(pathToFileURL(resolve('server/index.js')));
    const {Settings}=await import(pathToFileURL(resolve('server/schema.js')));
    const {defaults}=await import(pathToFileURL(resolve('shared/defaults.js')));
    const start=async()=>{service=await startServer({port:0,dataDir:join(base,'data'),localSpeech:false,provider});clearInterval(service.studio.timer);service.studio.audience.random=()=>.1;};
    await start();
    service.studio.world.change(d=>{d.settings=Settings.parse({...defaults,mode:'live',lurkRatio:0,communityActivityEnabled:false});for(const p of d.settings.personas)d.audience.members[p.id]={sessions:1,seconds:300,recognized:0,affinity:.5,peers:{},memories:[]};});
    assert.equal((await post('onboarding',{skip:true})).status,200);
    await openWindow();assert.equal((await post('start')).status,200);await until(`!!document.querySelector('.stop-button')`);
    await textButton('마음과 포인트');await until(`!!document.querySelector('.special-studio')`);
    assert.ok((await js(`document.querySelector('.special-studio').textContent`)).includes('새 프로필은 첫 방송 응원 200P'));
    assert.equal(service.studio.economy.data.balance,200);
    await textButton('상세 수첩 · 30P');await until(`!!document.querySelector('.feature-result')`);
    assert.equal(service.studio.economy.data.balance,170);
    await textButton('상세 수첩 · 30P');await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='상세 수첩 · 30P'&&!b.disabled)`);
    assert.equal(service.studio.economy.data.balance,170);
    report.checks.push('new profile displays 200P, profile unlock costs 30P exactly once');
    modelMode='failure';await textButton('질문하기 · 40P');
    await until(`document.querySelector('.special-studio').textContent.includes('질문하기 · 40P')&&!document.querySelector('.feature-body .primary').disabled`);
    assert.equal(service.studio.economy.data.balance,170);
    assert.equal(service.studio.economy.data.purchases.at(-1).status,'failed');
    report.checks.push('failed private interview returns its full 40P hold');
    modelMode='success';const q=await negotiate('모모');
    const cost=q.agreed,beforeBalance=service.studio.economy.data.balance,beforeWallet=service.studio.economy.snapshot(service.studio.settings.personas).wallets.momo.balance;
    await textButton('합의한 행동 실행 · '+cost+'P');await until(`document.querySelector('.quote-card').textContent.includes('실행 완료')`);
    assert.equal(service.studio.economy.data.balance,beforeBalance-cost);
    assert.equal(service.studio.economy.data.wallets.momo.balance,beforeWallet+cost);
    assert.ok(service.studio.messages.some(m=>m.personaId==='momo'&&m.text==='도전 계속 가자!'));
    report.checks.push('agreed action deducts only its agreed price, transfers it once and publishes the viewer reply');
    const expired=await negotiate('모모');
    service.studio.economy.change(d=>d.quotes.find(q=>q.id===expired.id).expiresAt=Date.now()-1);service.studio.publish();
    await until(`document.querySelector('.quote-card').textContent.includes('만료')`);
    assert.equal(await js(`Array.from(document.querySelector('.quote-card').querySelectorAll('button')).some(b=>b.textContent.includes('합의한 행동 실행')||b.textContent==='가격 제안')`),false);
    assert.equal((await post('special/generate',{kind:'contract',quoteId:expired.id,requestId:require('node:crypto').randomUUID()})).status,409);
    assert.equal(service.studio.economy.data.balance,beforeBalance-cost);
    report.checks.push('expired agreement loses execution and bid controls and the server rejects it without charging');
    const stopped=await negotiate('각보는고양이');
    await textButton('방송실');await click('.stop-button');await textButton('마음과 포인트');
    await until(`document.querySelector('.quote-card').textContent.includes('취소')`);
    assert.equal(await js(`Array.from(document.querySelector('.quote-card').querySelectorAll('button')).some(b=>b.textContent.includes('합의한 행동 실행')||b.textContent==='가격 제안')`),false);
    assert.equal((await post('special/bid',{id:stopped.id,amount:99})).status,409);
    await textButton('방송실');assert.equal((await post('start')).status,200);await textButton('마음과 포인트');
    const fresh=await negotiate('각보는고양이');assert.notEqual(fresh.sessionId,stopped.sessionId);
    report.checks.push('stopped quotes lose controls, offline bids fail, and the same viewer can negotiate in a new broadcast');
    assert.equal(report.pendingQuoteCases,4);report.checks.push('four held quote responses keep bids disabled, then each enabled click submits exactly once');
    modelMode='deferred';const startingBalance=service.studio.economy.data.balance;
    await textButton('합의한 행동 실행 · '+fresh.agreed+'P');await until(`document.querySelector('.quote-card').textContent.includes('실행 중')`);
    assert.equal(service.studio.economy.data.balance,startingBalance-fresh.agreed);
    await textButton('방송실');await click('.stop-button');await until(`!document.querySelector('.stop-button')`);assert.equal(service.studio.running,false);release();
    await until(`Array.from(document.querySelectorAll('.stat')).find(e=>e.textContent.includes('응원 포인트'))?.querySelector('b').textContent===${JSON.stringify(startingBalance+'P')}`);
    const at=Date.now();while(service.studio.economy.data.purchases.at(-1).status==='pending'&&Date.now()-at<8000)await pause(30);
    assert.equal(service.studio.economy.data.balance,startingBalance);
    assert.equal(service.studio.economy.data.purchases.at(-1).status,'failed');
    assert.ok(!service.studio.messages.some(m=>m.text==='종료된 방송의 늦은 응원'));
    await textButton('마음과 포인트');await until(`document.querySelector('.quote-card').textContent.includes('반환됨')`);
    report.checks.push('stopping a held execution refunds exactly once and discards its late model reply');
    await screenshot('points-stopped.png');
    const stored=JSON.parse(readFileSync(join(base,'data','world.json'),'utf8')).economy;
    win.destroy();win=null;await service.close();service=null;modelMode='success';await start();await openWindow();await textButton('마음과 포인트');
    assert.equal(service.studio.economy.data.balance,stored.balance);
    assert.deepEqual(service.studio.economy.data.purchases,stored.purchases);
    assert.deepEqual(service.studio.economy.data.ledger,stored.ledger);
    assert.equal(service.studio.state().economy.quotes.find(v=>v.id===q.id).status,'completed');
    assert.equal(service.studio.state().economy.quotes.find(v=>v.id===expired.id).status,'expired');
    assert.ok((await js(`document.querySelector('.special-studio').textContent`)).includes(stored.balance.toLocaleString()+'P'));
    assert.ok(service.studio.world.revealed('momo','profile'));
    report.checks.push('real service restart preserves balance, settlement, refund, profile grant and completed/expired statuses');
    await screenshot('points-restored.png');
    assert.deepEqual(report.errors,[]);report.passed=true;
  }catch(error){report.error=error.stack;console.error(error.stack);if(win&&!win.isDestroyed()){writeFileSync(join(base,'failure-dom.txt'),await js('document.body.innerText'));writeFileSync(join(base,'failure.png'),(await win.webContents.capturePage()).toPNG());}}
  finally{if(releaseQuoteResponse)releaseQuoteResponse();if(win&&!win.isDestroyed())win.destroy();if(service)await service.close();writeFileSync(join(base,'result.json'),JSON.stringify(report,null,2));writeFileSync(resolve('artifacts/point-negotiation-ui.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,base,checks:report.checks,error:report.error}));app.exit(report.passed?0:1);}
});
