// Render our original SVG to a Windows PNG-backed ICO and the desktop PNG.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');const {resolve}=require('node:path');
app.setPath('userData',resolve('artifacts/nagneon/icon-profile'));
app.whenReady().then(async()=>{
 let win;
 try{
  win=new BrowserWindow({width:256,height:256,useContentSize:true,show:false,transparent:true,webPreferences:{sandbox:true}});
  const svg=fs.readFileSync('public/nagneon.svg','utf8');
  await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<html style="background:transparent"><body style="margin:0">'+svg+'</body></html>'));
  await new Promise(r=>setTimeout(r,350));
  const png=(await win.webContents.capturePage()).resize({width:256,height:256}).toPNG();
  fs.mkdirSync('branding',{recursive:true});fs.writeFileSync('public/nagneon-icon.png',png);
  const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18);
  fs.writeFileSync('branding/nagneon.ico',Buffer.concat([header,png]));console.log('Nagneon icon: PNG + ICO');
 }catch(error){console.error(error);process.exitCode=1;}finally{win?.destroy();app.exit(process.exitCode||0);}
});
