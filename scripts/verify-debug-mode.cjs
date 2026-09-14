// Real isolated Electron UI and production prompt builder, synthetic responses.
const {app,BrowserWindow,session}=require('electron');
const {createStudioSession}=require('../desktop/session.cjs');
const {resolve}=require('node:path');
const {mkdirSync,writeFileSync}=require('node:fs');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const folder=resolve('artifacts/debug-ui-'+Date.now());mkdirSync(folder,{recursive:true});app.setPath('userData',resolve(folder,'profile'));
let service,win;const watchdog=setTimeout(()=>app.exit(2),60000);
app.whenReady().then(async()=>{
  const report={passed:false,synthetic:true,checks:[]};let code=0;
  try{
    const {startServer}=await import(pathToFileURL(resolve('server/index.js')).href),{OpenAIProvider}=await import(pathToFileURL(resolve('server/provider.js')).href);let payload;
    const provider=new OpenAIProvider({OPENAI_API_KEY:'fixture'},async(_url,options)=>{payload=JSON.parse(options.body);return new Response(JSON.stringify({output_text:JSON.stringify({game:'',scene:'연결 시험',confidence:0,excitement:0,messages:[{personaId:'probe',text:'디버그 확인',kind:'chat',spoiler:false}]})}));});
    service=await startServer({port:0,persist:false,localSpeech:false,provider});await fetch(service.url+'/api/onboarding',{method:'POST',headers:{Authorization:'Bearer '+service.accessToken,'Content-Type':'application/json','X-Backseat-Client':'studio'},body:JSON.stringify({skip:true})});
    win=new BrowserWindow({width:1200,height:960,show:true,title:'Debug mode QA',webPreferences:{session:createStudioSession(session,service),sandbox:true,contextIsolation:true,backgroundThrottling:false}});
    const js=code=>win.webContents.executeJavaScript(code,true),until=async code=>{for(let i=0;i<200;i++){if(await js(code))return;await new Promise(r=>setTimeout(r,25));}throw Error('UI timeout: '+code);};
    const click=label=>js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)throw Error('button unavailable');b.click();})()`);
    await win.loadURL(service.url);await until(`!!document.querySelector('button[title="방송 설정"]')`);await js(`document.querySelector('button[title="방송 설정"]').click()`);await click('디버그');
    await until(`!document.querySelector('[aria-label="디버그 모드"]').matches(':disabled')`);assert.equal(await js(`!!document.querySelector('[aria-label="디버그 전체 설정"]')`),false);
    await js(`document.querySelector('[aria-label="디버그 모드"]').click()`);await until(`!document.querySelector('[aria-label="신규 기능 사용해보기"]').matches(':disabled')`);assert.equal(await js(`!!document.querySelector('[aria-label="디버그 사용자 프롬프트"]')`),false);await js(`document.querySelector('[aria-label="신규 기능 사용해보기"]').click()`);await until(`!!document.querySelector('[aria-label="디버그 사용자 프롬프트"]')`);
    await js(`(()=>{const s=document.querySelector('[aria-label="디버그 프롬프트 방식"]');s.value='replace';s.dispatchEvent(new Event('change',{bubbles:true}));const t=document.querySelector('[aria-label="디버그 사용자 프롬프트"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'디버그에서 작성한 시험 지침');t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    for(const width of [1200,720,420]){win.setSize(width,960);await new Promise(r=>setTimeout(r,100));assert.equal(await js(`document.documentElement.scrollWidth<=innerWidth`),true,'debug fits '+width);}
    win.setSize(1200,960);win.show();await new Promise(r=>setTimeout(r,300));try{writeFileSync(resolve(folder,'debug-editor.png'),(await win.webContents.capturePage()).toPNG());}catch(error){report.screenshotError=error.message;}
    await click('프롬프트 적용');await until(`document.querySelector('.debug-panel').textContent.includes('디버그 설정을 적용했습니다.')`);
    await click('연결·사용량');await click('모델 응답 확인 · 1회 사용');await until(`document.body.textContent.includes('디버그 확인')`);assert.equal(payload.instructions,'디버그에서 작성한 시험 지침');report.checks.push('debug-only editor saves and fully replaces the actual provider request');
    await click('디버그');await until(`!!document.querySelector('[aria-label="디버그 전체 설정"]')`);
    await js(`(()=>{const t=document.querySelector('[aria-label="디버그 전체 설정"]');t.closest('details').open=true;const settings=JSON.parse(t.value);settings.personas[0].name='디버그 매니저';settings.personas[0].personality='사용자가 직접 편집한 성격';Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,JSON.stringify(settings,null,2));t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await click('고급 설정 적용');await until(`!document.querySelector('[role="dialog"]')`);assert.equal(service.studio.settings.personas[0].name,'디버그 매니저');assert.equal(service.studio.settings.personas[0].personality,'사용자가 직접 편집한 성격');report.checks.push('previously locked persona fields are editable and persisted through World');
    await js(`document.querySelector('button[title="방송 설정"]').click()`);await click('디버그');await until(`!!document.querySelector('[aria-label="디버그 사용자 프롬프트"]')`);await click('프롬프트 기본값 복원');await until(`document.querySelector('[aria-label="디버그 사용자 프롬프트"]').value===''`);
    await js(`document.querySelector('[aria-label="디버그 모드"]').click()`);await until(`!document.querySelector('[aria-label="디버그 사용자 프롬프트"]')`);assert.equal(service.studio.state().debug.enabled,false);report.checks.push('default prompt restore and debug disable hide the private editor');report.passed=true;
  }catch(error){report.error=error.stack;code=1;}finally{writeFileSync(resolve(folder,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,folder}));win?.destroy();await service?.close();clearTimeout(watchdog);app.exit(code);}
});
