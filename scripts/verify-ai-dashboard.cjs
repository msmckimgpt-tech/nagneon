// Synthetic providers + real local HTTP server and Electron renderer. No account/device access.
const {app,BrowserWindow,session}=require('electron');
const {resolve,join}=require('node:path');
const {pathToFileURL}=require('node:url');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {createStudioSession}=require('../desktop/session.cjs');
const out=resolve('artifacts/ai-dashboard/renderer');fs.mkdirSync(out,{recursive:true});app.setPath('userData',join(out,'profile'));
let service,win;const checks=[],errors=[];
app.whenReady().then(async()=>{
 try{
  const {startServer}=await import(pathToFileURL(resolve('server/index.js')).href);let calls=0;
  service=await startServer({port:0,persist:false,localSpeech:false,provider:{model:'synthetic-ui',status:()=>({kind:'codex',configured:true}),react:async()=>{calls++;return {observation:{messages:[{personaId:'probe',text:'합성 응답'}]},usage:{input_tokens:12,output_tokens:3,total_tokens:15}};}}});
  const headers={Authorization:'Bearer '+service.accessToken,'X-Backseat-Client':'studio','Content-Type':'application/json'};
  assert.equal((await fetch(service.url+'/api/onboarding',{method:'POST',headers,body:JSON.stringify({skip:true})})).status,200);
  win=new BrowserWindow({width:1440,height:1000,show:false,webPreferences:{offscreen:true,backgroundThrottling:false,session:createStudioSession(session,service),contextIsolation:true,sandbox:true}});
  win.webContents.on('console-message',(_e,level,message)=>{if(level===3)errors.push(message);});
  const js=code=>win.webContents.executeJavaScript(code);
  const until=async code=>{for(let i=0;i<150;i++){if(await js(code))return;await new Promise(r=>setTimeout(r,40));}throw Error('Timed out: '+code);};
  const click=async label=>{assert.equal(await js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)return false;b.click();return true;})()`),true,label);};
  const shot=async name=>{await new Promise(r=>setTimeout(r,250));fs.writeFileSync(join(out,name+'.png'),(await win.webContents.capturePage()).toPNG());};
  await win.loadURL(service.url);await until(`!!document.querySelector('.app-shell')`);await click('AI 대시보드');await until(`!!document.querySelector('.ai-dashboard')`);
  assert.equal(service.studio.ai.data.policy.background,false);assert.equal(calls,0);assert.match(await js('document.querySelector(".ai-overview").innerText'),/방송 밖 자동 AI 차단/);checks.push('dashboard opens without model call; background default is blocked');
  await click('모든 AI 호출 차단');await until(`document.querySelector('.ai-overview').innerText.includes('모든 AI 호출 차단 중')`);assert.equal(service.studio.ai.data.policy.paused,true);
  await win.reload();await until(`!!document.querySelector('.app-shell')`);await click('AI 대시보드');await until(`document.querySelector('.ai-overview')?.innerText.includes('모든 AI 호출 차단 중')`);await click('AI 호출 차단 해제');await until(`!document.querySelector('.ai-overview').innerText.includes('모든 AI 호출 차단 중')`);checks.push('master pause reaches server and survives renderer reload');
  await until(`!document.querySelector('.ai-policy input[role=switch]').disabled`);await js(`document.querySelector('.ai-policy input[role=switch]').click()`);await until(`document.querySelector('.ai-overview').innerText.includes('방송 밖 자동 AI 허용 중')`);assert.equal(service.studio.ai.data.policy.background,true);assert.equal(calls,0);
  await until(`!document.querySelector('[aria-label="관객 취향 인터뷰 실행 허용"]').disabled`);await js(`document.querySelector('[aria-label="관객 취향 인터뷰 실행 허용"]').click()`);await until(`!document.querySelector('[aria-label="관객 취향 인터뷰 실행 허용"]').checked`);assert.equal(service.studio.ai.allowed('interview'),false);checks.push('background and per-feature controls are confirmed by server');
  assert.equal(await js(`document.querySelector('#ai-call-limit')===null`),true);assert.equal('dailyLimit' in service.studio.ai.data.policy,false);checks.push('no usage cap controls or policy field');
  await js(`document.querySelector('[aria-label="모델 연결 시험 화면으로 이동"]').click()`);await until(`document.querySelector('#settings-tab-connection')?.getAttribute('aria-selected')==='true'`);checks.push('feature link opens exact connection settings tab');
  await click('AI 대시보드에서 전체 사용량·실행 허용 관리');await until(`!document.querySelector('[role=dialog]')`);
  await fetch(service.url+'/api/connection/probe',{method:'POST',headers,body:'{}'});await until(`document.querySelector('.ai-dashboard').innerText.includes('synthetic-ui')`);assert.equal(calls,1);assert.equal(service.studio.ai.data.recent[0].usage.total,15);checks.push('probe usage appears in shared recent ledger and totals');
  await click('실행 중');await until(`document.querySelector('.ai-empty')?.textContent.includes('해당하는')`);await click('전체');
  for(const width of [1440,1000,850,420]){win.setSize(width,1000);await shot('dashboard-'+width);assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'),true,'no page overflow '+width);}
  checks.push('1440/1000/850/420 layouts have no page overflow');
  win.setSize(1440,1000);await shot('dashboard-final');
  await service.close();service=null;await until(`document.querySelector('.ai-overview').innerText.includes('연결 끊김')`);assert.equal(await js(`document.querySelector('.ai-overview button').disabled`),true);assert.equal(await js(`document.querySelector('.ai-policy input').disabled`),true);checks.push('disconnection labels last-known state and disables mutations');
  assert.deepEqual(errors,[]);fs.writeFileSync(join(out,'result.json'),JSON.stringify({passed:true,synthetic:true,checks,errors},null,2));console.log(JSON.stringify({passed:true,checks}));
 }catch(error){fs.writeFileSync(join(out,'result.json'),JSON.stringify({passed:false,synthetic:true,checks,error:error.stack,errors},null,2));console.error(error);process.exitCode=1;}
 finally{win?.destroy();await service?.close();app.exit(process.exitCode||0);}
});
