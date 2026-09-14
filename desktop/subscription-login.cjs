const {spawn}=require('node:child_process');
const {tmpdir}=require('node:os');
const {join}=require('node:path');

const psLiteral=value=>"'"+value.replaceAll("'","''")+"'";
// Windows native command-line quoting, then a PowerShell literal. No caller
// text becomes shell syntax; the model name is not used for authentication.
const winArg=value=>'"'+value.replace(/(\\*)"/g,'$1$1\\"').replace(/(\\+)$/,'$1$1')+'"';
function loginScript(command,kind){
  const args=[...command.prefix,...(kind==='claude-cli'?['auth','login']:[])];
  return `Start-Process -FilePath ${psLiteral(command.bin)}${args.length?' -ArgumentList '+psLiteral(args.map(winArg).join(' ')):''} -WorkingDirectory ${psLiteral(tmpdir())}`;
}
async function openSubscriptionLogin(config){
  if(process.platform!=='win32')throw Error('공식 CLI 터미널에서 직접 로그인해주세요.');
  const {cliCommand,subscriptionEnv}=await import('../server/subscription-provider.js');
  const command=cliCommand(config.kind,config.bin),env=subscriptionEnv();delete env.NO_BROWSER;
  const script=loginScript(command,config.kind);
  const powershell=join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  await new Promise((done,fail)=>{
    const child=spawn(powershell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{env,windowsHide:true,stdio:'ignore'});
    child.on('error',()=>fail(Error('공식 CLI 로그인 창을 열지 못했습니다.')));child.on('close',code=>code===0?done():fail(Error('공식 CLI 로그인 창을 열지 못했습니다.')));
  });
}
module.exports={openSubscriptionLogin,loginScript};
