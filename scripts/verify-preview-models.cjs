const {app,BrowserWindow,session}=require('electron');
const {createStudioSession}=require('../desktop/session.cjs');
const {resolve}=require('node:path');
const {mkdirSync,writeFileSync}=require('node:fs');
const assert=require('node:assert/strict');
const folder=resolve('artifacts/preview-model-ui-'+Date.now());mkdirSync(folder,{recursive:true});app.setPath('userData',resolve(folder,'profile'));
let service,win;const watchdog=setTimeout(()=>app.exit(2),60000);
app.whenReady().then(async()=>{
  const report={passed:false,synthetic:true,checks:[]};let code=0,login;
  try{
    const {startServer}=await import('../server/index.js');
    const factory=kind=>config=>({status:()=>({configured:true,model:config?.model||'gpt-6-astra',effort:config?.effort||'low',kind}),check:async()=>{},react:async()=>({observation:{game:'',scene:'',confidence:0,excitement:0,messages:[]}})});
    service=await startServer({port:0,persist:false,localSpeech:false,openSubscriptionLogin:async config=>{login=config;},providerFactories:Object.fromEntries(['codex','openai','claude','gemini','claude-cli','gemini-cli'].map(k=>[k,factory(k)]))});
    const headers={Authorization:'Bearer '+service.accessToken,'Content-Type':'application/json','X-Backseat-Client':'studio'};
    await fetch(service.url+'/api/onboarding',{method:'POST',headers,body:'{"skip":true}'});
    win=new BrowserWindow({width:1200,height:960,show:true,webPreferences:{session:createStudioSession(session,service),sandbox:true,contextIsolation:true}});
    const js=code=>win.webContents.executeJavaScript(code,true);
    const until=async code=>{for(let i=0;i<200;i++){if(await js(code))return;await new Promise(r=>setTimeout(r,30));}throw Error('UI timeout: '+code);};
    const click=label=>js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)throw Error('button unavailable: '+${JSON.stringify(label)});b.click();})()`);
    const set=(label,value)=>js(`(()=>{const e=document.querySelector('[aria-label="'+${JSON.stringify(label)}+'"]');if(e.tagName==='SELECT'){e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));}else{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
    await win.loadURL(service.url);await until(`!!document.querySelector('button[title="방송 설정"]')`);await js(`document.querySelector('button[title="방송 설정"]').click()`);await click('연결·사용량');assert.equal(await js(`!!document.querySelector('[aria-label="AI 제공처"]')`),false);
    await click('디버그');await until(`!document.querySelector('[aria-label="디버그 모드"]').matches(':disabled')`);
    await js(`document.querySelector('[aria-label="신규 기능 사용해보기"]').click()`);await until(`!document.querySelector('[aria-label="디버그 모드"]').matches(':disabled')`);assert.equal(service.studio.state().debug.previewEnabled,false);
    await click('연결·사용량');assert.equal(await js(`!!document.querySelector('[aria-label="AI 제공처"]')`),false);
    await click('디버그');await until(`!document.querySelector('[aria-label="디버그 모드"]').matches(':disabled')`);await js(`document.querySelector('[aria-label="디버그 모드"]').click()`);await until(`!!document.querySelector('[aria-label="디버그 사용자 프롬프트"]')`);
    await click('연결·사용량');await until(`!!document.querySelector('[aria-label="AI 제공처"]')`);await js(`document.querySelector('[aria-label="AI 제공처"]').closest('details').open=true`);
    for(const kind of ['claude-cli','gemini-cli','claude','gemini','codex']){
      await set('AI 제공처',kind);await set('AI 모델명','fixture-model');if(kind==='codex')await set('AI 추론 수준','high');
      await click('선택한 제공처 적용');await until(`!document.querySelector('[aria-label="AI 제공처"]').matches(':disabled')`);
      assert.equal(service.studio.state().providerChoice.config.kind,kind);assert.equal(service.studio.state().providerChoice.config.model,'fixture-model');
      if(kind.endsWith('-cli')){await click('공식 CLI 로그인 창 열기');await until(`!document.querySelector('[aria-label="AI 제공처"]').matches(':disabled')`);assert.equal(login.kind,kind);}
    }
    assert.equal(service.studio.state().providerChoice.config.effort,'high');
    report.checks.push('off and experiment-only gates hide model selection; both opt-ins reveal it','CLI/API provider and model selections reach the server; Codex effort persists','official CLI login button dispatches selected provider without API keys');
    await click('디버그');await until(`!document.querySelector('[aria-label="신규 기능 사용해보기"]').matches(':disabled')`);await js(`document.querySelector('[aria-label="신규 기능 사용해보기"]').click()`);await until(`!document.querySelector('[aria-label="디버그 사용자 프롬프트"]')`);
    assert.equal(service.studio.provider.status().model,'gpt-6-astra');assert.equal(service.studio.provider.status().effort,'low');await click('연결·사용량');assert.equal(await js(`!!document.querySelector('[aria-label="AI 제공처"]')`),false);report.checks.push('disabling one opt-in restores gpt-6-astra/low and hides all selectors');
    report.passed=true;
  }catch(error){report.error=error.stack;code=1;}finally{writeFileSync(resolve(folder,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,folder}));win?.destroy();await service?.close();clearTimeout(watchdog);app.exit(code);}
});
