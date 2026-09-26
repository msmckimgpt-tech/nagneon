// Synthetic real-renderer verification; isolated profile/data, no account or model calls.
const {app,BrowserWindow,session}=require('electron');
const {createStudioSession}=require('../desktop/session.cjs');
const {resolve,join}=require('node:path');
const {mkdirSync,writeFileSync,readFileSync}=require('node:fs');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const out=resolve('artifacts/gemini-settings-ui-'+Date.now());mkdirSync(out,{recursive:true});app.setPath('userData',join(out,'profile'));
app.on('window-all-closed',()=>{});
const report={passed:false,synthetic:true,isolated:true,visible:false,checks:[],calls:[]};let service,win;
const save=()=>writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2));
const watchdog=setTimeout(()=>{report.error='timeout';save();app.exit(2);},90000);
app.whenReady().then(async()=>{
  try{
    const {startServer}=await import(pathToFileURL(resolve('server/index.js')));
    const models=[{id:'gemini-3.8-flash-low',label:'Gemini 3.8 Flash · 낮음'},{id:'gemini-fixture-live',label:'Gemini 계정 모델 · 테스트'}];
    const factory=kind=>config=>({model:config?.model||(kind==='antigravity'?models[0].id:'gpt-6-astra'),effort:config?.effort||'low',check:async()=>{},status(){return {configured:true,model:this.model,effort:this.effort,authMessage:kind+' 테스트 연결',...(kind==='antigravity'?{models}:{})};},async react(){report.calls.push({kind,model:this.model});return {observation:{messages:[{personaId:'probe',text:kind+' 테스트 응답'}]},usage:{total_tokens:1}};}});
    const options={port:0,dataDir:join(out,'data'),localSpeech:false,providerFactories:{codex:factory('codex'),antigravity:factory('antigravity')}};
    const js=code=>win.webContents.executeJavaScript(code);
    const until=async code=>{const end=Date.now()+12000;while(Date.now()<end){if(await js(code))return;await new Promise(r=>setTimeout(r,40));}throw Error('Timed out: '+code);};
    const click=async text=>{const query=`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`;await until(`!!(${query})`);await js(`(${query}).click()`);};
    const choose=async(label,value)=>{await js(`(()=>{const e=document.querySelector('[aria-label="${label}"]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);};
    const value=label=>js(`document.querySelector('[aria-label="${label}"]').value`);
    const saved=()=>JSON.parse(readFileSync(join(out,'data/provider-choice.json'),'utf8'));
    const start=async()=>{service=await startServer(options);await fetch(service.url+'/api/onboarding',{method:'POST',headers:{Authorization:'Bearer '+service.accessToken,'Content-Type':'application/json','X-Backseat-Client':'studio'},body:JSON.stringify({skip:true})});win=new BrowserWindow({width:1100,height:1100,show:false,webPreferences:{session:createStudioSession(session,service),contextIsolation:true,sandbox:true,backgroundThrottling:false}});await win.loadURL(service.url);await until(`!!document.querySelector('[data-tutorial="settings"]')`);await js(`document.querySelector('[data-tutorial="settings"]').click()`);await until(`!!document.getElementById('settings-tab-connection')`);await js(`document.getElementById('settings-tab-connection').click()`);await until(`!!document.querySelector('[aria-label="AI 제공처"]')`);};
    const apply=async kind=>{await click('선택한 설정 적용');await until(`document.body.textContent.includes('설정을 저장했습니다. 다음 관객 요청부터 적용됩니다.')`);await until(`document.querySelector('.account-summary').textContent.includes(${JSON.stringify(kind+' 테스트 연결')})`);assert.equal(service.studio.state().provider.kind,kind);};
    const probe=async kind=>{const before=report.calls.length;await click('모델 응답 확인 · 1회 사용');await until(`!!document.querySelector('.probe-result.success')`);assert.equal(service.studio.state().connectionProbe.status,'ready');assert.equal(report.calls.length,before+1);assert.equal(report.calls.at(-1).kind,kind);};
    await start();assert.equal(await js(`document.querySelector('[aria-label="AI 제공처"]').closest('details').open`),true);
    await choose('관객 모델','gpt-5.4-mini');await choose('관객 추론 수준','none');await apply('codex');assert.deepEqual(saved(),{kind:'codex',model:'gpt-5.4-mini',effort:'none'});
    await choose('AI 제공처','antigravity');assert.equal(await value('Gemini 모델'),models[0].id);await choose('AI 제공처','codex');assert.equal(await value('관객 모델'),'gpt-5.4-mini');assert.equal(await value('관객 추론 수준'),'none');report.checks.push('provider picker opens; Codex model and effort survive Gemini draft switch');
    await choose('AI 제공처','antigravity');await apply('antigravity');assert.deepEqual(saved(),{kind:'antigravity',model:models[0].id});assert.equal(await js(`document.body.textContent.includes('OpenAI API 키 (앱 종료 시 삭제)')`),false);assert.equal(await js(`document.body.textContent.includes('역할별 모델 라우팅')`),false);assert.equal(await js(`!!document.querySelector('[aria-label="관객 추론 수준"]')`),false);assert.equal(await js(`document.querySelector('[aria-label="Gemini 모델"] option[value="gemini-fixture-live"]').textContent`),models[1].label);await probe('antigravity');report.checks.push('Gemini saves exact provider/model, uses live account model list, hides API key/routing/effort, probe reaches Gemini');
    // Let the compositor paint the asserted UI before capturing the evidence.
    await new Promise((resolve) => setTimeout(resolve, 250));
    writeFileSync(join(out,'gemini.png'),(await win.webContents.capturePage()).toPNG());
    await choose('AI 제공처','codex');assert.equal(await value('관객 모델'),'gpt-5.4-mini');assert.equal(await value('관객 추론 수준'),'none');await choose('AI 제공처','antigravity');
    win.destroy();await service.close();await start();assert.equal(await value('AI 제공처'),'antigravity');assert.equal(await value('Gemini 모델'),models[0].id);assert.equal(service.studio.state().provider.kind,'antigravity');report.checks.push('server and renderer restart restore Gemini selection');
    service.studio.running=true;service.studio.publish();await until(`document.querySelector('[aria-label="AI 제공처"]').matches(':disabled')`);assert.equal(await js(`document.querySelector('[aria-label="Gemini 모델"]').matches(':disabled')`),true);service.studio.running=false;service.studio.publish();await until(`!document.querySelector('[aria-label="AI 제공처"]').matches(':disabled')`);report.checks.push('broadcast locks provider and Gemini model switches');
    await choose('AI 제공처','codex');await choose('관객 모델','gpt-5.4-mini');await choose('관객 추론 수준','none');await apply('codex');assert.deepEqual(saved(),{kind:'codex',model:'gpt-5.4-mini',effort:'none'});assert.equal(service.studio.state().connectionProbe.status,'untested');await probe('codex');assert.equal(report.calls.at(-1).model,'gpt-5.4-mini');report.checks.push('switch back to Codex clears stale probe and reaches Codex backend');
    // Let the compositor paint the asserted UI before capturing the evidence.
    await new Promise((resolve) => setTimeout(resolve, 250));
    writeFileSync(join(out,'codex.png'),(await win.webContents.capturePage()).toPNG());report.passed=true;
  }catch(error){report.error=error.stack;}
  finally{if(win&&!win.isDestroyed())win.destroy();await service?.close();clearTimeout(watchdog);save();console.log(JSON.stringify({out,...report}));app.exit(report.passed?0:1);}
});
