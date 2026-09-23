// Hidden real Electron UI/server, isolated saves. --live enables subscription probes; --gpt6 includes Sol/Luna.
const {app,BrowserWindow,session}=require('electron');
const {resolve,join}=require('node:path');
const {pathToFileURL}=require('node:url');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createStudioSession}=require('../desktop/session.cjs');
const option=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const appRoot=resolve(option('app-root')||'.');
const out=resolve('artifacts/model-settings-ui-'+Date.now());fs.mkdirSync(out,{recursive:true});
app.setPath('userData',join(out,'profile'));
app.on('window-all-closed',()=>{}); // Keep the harness alive while reopening the isolated server.
const live=process.argv.includes('--live'),luna=process.argv.includes('--luna'),report={live,appRoot,isolated:true,visible:false,devices:false,checks:[],probes:[],modelErrors:[]};
let service,win;
const watchdog=setTimeout(()=>{report.error='timeout';fs.writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2));app.exit(2);},180000);
app.whenReady().then(async()=>{
  try{
    const {startServer}=await import(pathToFileURL(join(appRoot,'server/index.js')));
    const {CodexProvider}=await import(pathToFileURL(join(appRoot,'server/codex-provider.js')));
    const {hostedModelEnv}=await import(pathToFileURL(join(appRoot,'server/provider-choice.js')));
    const factory=config=>{
      if(live)return new CodexProvider({...process.env,...hostedModelEnv(config),...(option('codex-bin')?{CODEX_BIN:option('codex-bin')}:{})},(bin,args,options)=>{
        const child=spawn(bin,args,options);let buffer='';
        if(args[0]==='exec')child.stdout.on('data',chunk=>{buffer+=chunk;let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);try{const event=JSON.parse(line),message=event.message||event.error?.message||'';if(['error','turn.failed'].includes(event.type)&&/model.*(support|access|available|exist)/i.test(message))report.modelErrors.push(String(message).slice(0,1000).replace(/sk-[\w-]+/g,'[redacted]'));}catch{}}});
        return child;
      });
      return {model:config?.model||'gpt-6-astra',effort:config?.effort||'low',check:async()=>{},status(){return {configured:true,model:this.model,effort:this.effort};},react:async()=>({observation:{messages:[{personaId:'probe',text:'안녕하세요!'}]},usage:{total_tokens:1}})};
    };
    const options={port:0,dataDir:join(out,'data'),localSpeech:false,providerFactories:{codex:factory,openai:factory}};
    const start=async()=>{
      service=await startServer(options);
      await fetch(service.url+'/api/onboarding',{method:'POST',headers:{Authorization:'Bearer '+service.accessToken,'Content-Type':'application/json','X-Backseat-Client':'studio'},body:JSON.stringify({skip:true})});
      win=new BrowserWindow({width:1100,height:1000,show:false,webPreferences:{session:createStudioSession(session,service),contextIsolation:true,sandbox:true,backgroundThrottling:false}});
      await win.loadURL(service.url);
    };
    const js=code=>win.webContents.executeJavaScript(code);
    const until=async(code,timeout=12000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await js(code))return;await new Promise(r=>setTimeout(r,60));}throw Error('Timed out: '+code);};
    const click=async text=>{await until(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`);await js(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`);};
    const choose=async(label,value)=>{await js(`(()=>{const e=document.querySelector('[aria-label="${label}"]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);};
    const open=async()=>{
      await until(`!!document.querySelector('[data-tutorial="settings"]')`);
      await js(`document.querySelector('[data-tutorial="settings"]').click()`);
      await until(`!!document.getElementById('settings-tab-connection')`);await js(`document.getElementById('settings-tab-connection').click()`);
      await until(`!!document.querySelector('[aria-label="관객 모델"]')`);
      await js(`document.querySelector('[aria-label="관객 모델"]').closest('details').open=true`);
    };
    await start();await open();
    await choose('관객 모델','gpt-5.4-mini');await choose('관객 추론 수준','none');await click('선택한 설정 적용');
    await until(`document.querySelector('.account-summary').textContent.includes('gpt-5.4-mini')&&document.querySelector('.account-summary').textContent.includes('none')`);
    assert.deepEqual(JSON.parse(fs.readFileSync(join(out,'data/provider-choice.json'),'utf8')),{kind:'codex',model:'gpt-5.4-mini',effort:'none'});
    report.checks.push('real renderer selects mini/none and server persists exact nonsecret config');
    win.destroy();await service.close();await start();await open();
    assert.equal(await js(`document.querySelector('[aria-label="관객 모델"]').value`),'gpt-5.4-mini');assert.equal(await js(`document.querySelector('[aria-label="관객 추론 수준"]').value`),'none');
    report.checks.push('server and renderer restart restores model and effort');
    const probe=async()=>{await click('모델 응답 확인 · 1회 사용');await until(`!!document.querySelector('.probe-result.success')||!!document.querySelector('.connection-problem')`,100000);report.probes.push(service.studio.state().connectionProbe);};
    await probe();
    if(live){const result=report.probes.at(-1);assert.ok(result.status==='ready'||(result.status==='failed'&&result.reason==='model'));if(result.status==='failed')assert.match(await js('document.body.innerText'),/선택한 관객 모델/);}
    fs.writeFileSync(join(out,'mini.png'),(await win.webContents.capturePage()).toPNG());
    // --gpt6 uses synthetic providers unless --live is explicitly supplied.
    if(process.argv.includes('--gpt6')){
      for(const [model,label] of [['gpt-6-sol','GPT-6 Sol · 경량'],['gpt-6-luna','GPT-6 Luna · 초경량']]){
        await choose('관객 모델',model);
        assert.equal(await js(`document.querySelector('[aria-label="관객 모델"]').selectedOptions[0].textContent`),label);
        assert.deepEqual(await js(`[...document.querySelector('[aria-label="관객 추론 수준"]').options].map(o=>o.value).filter(Boolean)`),['none','low','medium','high','xhigh','max']);
        for(const effort of ['none','max']){
          await choose('관객 추론 수준',effort);await click('선택한 설정 적용');
          await until(`document.querySelector('.account-summary').textContent.includes(${JSON.stringify(model)})&&document.querySelector('.account-summary').textContent.includes(${JSON.stringify(effort)})`);
          assert.deepEqual(JSON.parse(fs.readFileSync(join(out,'data/provider-choice.json'),'utf8')),{kind:'codex',model,effort});
          assert.equal(service.studio.provider.model,model);assert.equal(service.studio.provider.effort,effort);
          assert.equal(service.studio.state().connectionProbe.status,'untested');
          win.destroy();await service.close();await start();await open();
          assert.equal(await js(`document.querySelector('[aria-label="관객 모델"]').value`),model);
          assert.equal(await js(`document.querySelector('[aria-label="관객 추론 수준"]').value`),effort);
          await probe();assert.equal(report.probes.at(-1).status,'ready');assert.equal(report.probes.at(-1).model,model);
          report.checks.push(`${model}/${effort}: exact tier label, effort list, saved config, server/renderer restart and ${live?'subscription':'synthetic'} probe`);
        }
        win.setSize(540,960);await new Promise(r=>setTimeout(r,250));assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'),true);
        fs.writeFileSync(join(out,`${model}.png`),(await win.webContents.capturePage()).toPNG());win.setSize(1100,1000);
      }
    }
    if(luna){
      await choose('관객 모델','gpt-5.6-luna');await choose('관객 추론 수준','low');await click('선택한 설정 적용');
      await until(`document.querySelector('.account-summary').textContent.includes('gpt-5.6-luna')&&!document.querySelector('.connection-problem')`);
      await probe();assert.equal(report.probes.at(-1).status,'ready');
      assert.equal(report.probes.at(-1).model,'gpt-5.6-luna');
      fs.writeFileSync(join(out,'luna.png'),(await win.webContents.capturePage()).toPNG());
      await choose('관객 추론 수준','max');report.checks.push('Luna selection reaches the backend and its max effort is available');
    }
    await choose('관객 모델','gpt-6-astra');assert.equal(await js(`document.querySelector('[aria-label="관객 추론 수준"]').value`),'low');
    assert.equal(await js(`!!document.querySelector('[aria-label="관객 추론 수준"] option[value="none"]')`),false);
    await click('선택한 설정 적용');await until(`document.querySelector('.account-summary').textContent.includes('gpt-6-astra')&&!document.querySelector('.connection-problem')`);
    assert.equal(service.studio.state().connectionProbe.status,'untested');await probe();assert.equal(report.probes.at(-1).status,'ready');
    report.checks.push('unsupported effort resets to low, stale probe cleared, Astra responds through selected backend');
    win.setSize(540,960);await new Promise(r=>setTimeout(r,250));assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'),true);
    fs.writeFileSync(join(out,'narrow.png'),(await win.webContents.capturePage()).toPNG());
    service.studio.running=true;service.studio.publish();await until(`document.querySelector('[aria-label="관객 모델"]').matches(':disabled')`);service.studio.running=false;
    report.checks.push('narrow layout and model controls locked during broadcast');report.passed=true;
  }catch(error){report.error=error.stack;report.passed=false;}
  finally{if(win&&!win.isDestroyed())win.destroy();await service?.close();clearTimeout(watchdog);fs.writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,...report}));app.exit(report.passed?0:1);}
});
