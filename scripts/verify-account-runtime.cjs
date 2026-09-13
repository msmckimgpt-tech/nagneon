// Real desktop entrypoint, native CLI and renderer. Never completes OAuth or
// generates a model response. A separate app profile protects the user's data.
const {app,dialog}=require('electron');
const {mkdirSync,writeFileSync,mkdtempSync}=require('node:fs');
const {resolve,join}=require('node:path');
const assert=require('node:assert/strict');
const existing=process.argv.includes('--existing-account');
mkdirSync('artifacts',{recursive:true});
const folder=mkdtempSync(resolve('artifacts/account-runtime-'));
process.argv.push('--backseat-profile='+join(folder,'profile'));
process.env.BACKSEAT_PYTHON=join(folder,'speech-disabled.exe');
process.env.CODEX_BIN='';
process.env.AI_PROVIDER='codex';
for(const key of Object.keys(process.env))if(key.toLowerCase()==='path')process.env[key]=resolve('node_modules/.bin');
if(!existing){
  const home=join(folder,'codex-home');mkdirSync(home);
  writeFileSync(join(home,'config.toml'),'cli_auth_credentials_store = "file"\n');process.env.CODEX_HOME=home;
}
const report={checkedAt:new Date().toISOString(),folder,existingAccount:existing,loginCompleted:false,modelCalls:0,checks:[]};
let main,closing=false,failed=false;
const save=()=>writeFileSync(join(folder,'result.json'),JSON.stringify(report,null,2));
function fail(error){if(failed)return;failed=true;report.passed=false;report.error=error.message;save();console.error(JSON.stringify(report));app.exit(1);}
process.on('uncaughtException',fail);process.on('unhandledRejection',fail);
dialog.showErrorBox=(title,message)=>fail(new Error(title+': '+message));
const js=code=>main.webContents.executeJavaScript(code,true);
async function until(code){const deadline=Date.now()+30000;while(!await js(code)){if(Date.now()>deadline)throw new Error('Account UI timeout');await new Promise(r=>setTimeout(r,100));}}
async function click(text){await js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)throw new Error('Expected enabled button');b.click();})()`);}
app.on('quit',()=>{if(failed)return;report.passed=closing;save();console.log(JSON.stringify(report));});
app.on('browser-window-created',(_event,win)=>{
  if(main)return;main=win;
  win.webContents.once('did-finish-load',async()=>{try{
    await until(`!!document.querySelector('.welcome-shell')`);
    await click('나중에 설정하기');await until(`!!document.querySelector('.app-shell')`);
    await js(`document.querySelector('.sidebar-bottom button').click()`);
    await until(`!!document.querySelector('.account-panel')`);
    const state=await js(`fetch('/api/state').then(r=>r.json())`);
    assert.equal(state.provider.authState,existing?'connected':'signed-out');assert.equal(state.running,false);assert.equal(state.calls,0);
    report.checks.push('actual desktop selects installed CLI without global PATH');
    if(existing){
      await until(`document.querySelector('.account-panel').textContent.includes('ChatGPT 구독 연결됨')`);
      await click('연결 상태 새로고침');
      assert.equal((await js(`backseat.startAccountLogin('browser')`)).status,'connected');
      await until(`!document.querySelector('.login-progress')&&[...document.querySelectorAll('.account-panel button')].some(b=>b.textContent.includes('연결 상태 새로고침')&&!b.disabled)`);
      report.checks.push('existing ChatGPT login is confirmed without opening or replacing OAuth');
    }else{
      await js(`document.querySelector('.login-alternative').open=true`);await click('기기 코드로 연결');
      await until(`!!document.querySelector('.device-code')`);
      // Record only the validation result, never the temporary code or URL.
      assert.equal(await js(`backseat.accountStatus().then(s=>s.status==='waiting'&&s.method==='device'&&!!s.code)`),true);
      await click('로그인 취소');await until(`document.querySelector('.account-panel').textContent.includes('로그인을 취소했습니다.')`);
      assert.equal(await js(`backseat.accountStatus().then(s=>s.code===undefined&&s.status==='cancelled')`),true);
      report.checks.push('real device code reaches renderer and cancellation clears it');
    }
    const finalState=await js(`fetch('/api/state').then(r=>r.json())`);assert.equal(finalState.running,false);assert.equal(finalState.calls,0);
    await new Promise(r=>setTimeout(r,150));
    writeFileSync(join(folder,'account-panel.png'),(await win.webContents.capturePage()).toPNG());
    closing=true;win.close();
  }catch(error){fail(error);}});
});
setTimeout(()=>fail(new Error('Account desktop watchdog expired')),65000).unref();
require('../desktop/main.cjs');
