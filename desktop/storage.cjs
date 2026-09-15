const fs=require('node:fs');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function storagePaths(appData){return {defaultProfile:path.join(appData,'backseat-studio'),configFile:path.join(appData,'Nagneon','storage.json')};}
function readProfile(appData){
  const {defaultProfile,configFile}=storagePaths(appData);
  if(!fs.existsSync(configFile))return defaultProfile;
  const value=JSON.parse(fs.readFileSync(configFile,'utf8').replace(/^\uFEFF/,''));
  if(typeof value.profile!=='string'||!path.isAbsolute(value.profile)||!fs.existsSync(path.join(value.profile,'data')))throw Error('설정된 저장 위치를 찾을 수 없습니다. 저장 장치를 연결한 뒤 다시 실행하세요.');
  return value.profile;
}
function validateDestination(source,target){
  if(typeof target!=='string'||!path.isAbsolute(target))throw Error('저장 위치는 절대 경로여야 합니다.');
  source=path.resolve(source);target=path.resolve(target);
  const a=source.toLowerCase()+path.sep,b=target.toLowerCase()+path.sep;
  if(a.startsWith(b)||b.startsWith(a))throw Error('현재 저장 폴더와 분리된 빈 폴더를 선택하세요.');
  for(let item=target;;item=path.dirname(item)){
    if(fs.existsSync(item)&&fs.lstatSync(item).isSymbolicLink())throw Error('링크 폴더는 저장 위치로 사용할 수 없습니다.');
    if(path.dirname(item)===item)break;
  }
  if(fs.existsSync(target)&&fs.readdirSync(target).length)throw Error('기존 기록을 덮어쓰지 않도록 빈 폴더를 선택하세요.');
  return target;
}
function inventory(root,prefix=''){
  const rows=[];
  for(const entry of fs.readdirSync(path.join(root,prefix),{withFileTypes:true})){
    const name=path.join(prefix,entry.name);
    if(entry.isSymbolicLink())throw Error('저장 데이터의 링크를 먼저 확인해주세요.');
    if(entry.isDirectory())rows.push(...inventory(root,name));
    else if(entry.isFile())rows.push({path:name,sha256:hash(path.join(root,name))});
  }
  return rows.sort((a,b)=>a.path.localeCompare(b.path));
}
// Called only after the server has drained and closed. Keep the entire source
// as a recovery copy; publish the new pointer only after byte verification.
function migrateStorage({source,target,configFile}){
  target=validateDestination(source,target);
  const data=path.join(source,'data');
  const before=inventory(data);
  fs.mkdirSync(target,{recursive:true});
  fs.cpSync(data,path.join(target,'data'),{recursive:true,errorOnExist:true,force:false});
  if(JSON.stringify(before)!==JSON.stringify(inventory(path.join(target,'data')))||JSON.stringify(before)!==JSON.stringify(inventory(data)))throw Error('저장 기록 복사 검증에 실패했습니다. 기존 위치를 유지합니다.');
  fs.mkdirSync(path.dirname(configFile),{recursive:true});
  const temp=configFile+'.'+randomUUID()+'.tmp';
  const fd=fs.openSync(temp,'wx');
  try{fs.writeFileSync(fd,JSON.stringify({profile:target,previousProfile:source,changedAt:new Date().toISOString()},null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(temp,configFile);
  return {profile:target,files:before.length};
}
module.exports={storagePaths,readProfile,validateDestination,migrateStorage};
