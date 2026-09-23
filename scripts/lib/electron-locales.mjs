import {readdir,lstat,unlink} from 'node:fs/promises';
import {join} from 'node:path';

export const electronLocales=Object.freeze(['en-US','ko']);

// Only call on a newly generated Windows package, before its inventory is hashed.
// Keep ICU/fonts and all non-locale resources so Unicode content stays supported.
export async function pruneElectronLocales(folder){
 const directory=join(folder,'locales'),stat=await lstat(directory);
 if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('올바른 Electron 언어 폴더가 아닙니다.');
 const entries=await readdir(directory,{withFileTypes:true});
 const packs=entries.filter(entry=>entry.name.endsWith('.pak'));
 for(const entry of packs)if(!entry.isFile()||entry.isSymbolicLink())throw Error('Electron 언어 파일 형식을 확인하세요: '+entry.name);
 for(const locale of electronLocales)if(!packs.some(entry=>entry.name===locale+'.pak'))throw Error('필수 Electron 언어 파일이 없습니다: '+locale);
 const removed=[];
 for(const entry of packs){
  if(electronLocales.some(locale=>entry.name===locale+'.pak'))continue;
  const path=join(directory,entry.name),file=await lstat(path);
  if(!file.isFile()||file.isSymbolicLink())throw Error('Electron 언어 파일이 변경되었습니다: '+entry.name);
  removed.push({name:entry.name,bytes:file.size});await unlink(path);
 }
 return {kept:[...electronLocales],removed,removedBytes:removed.reduce((sum,file)=>sum+file.bytes,0)};
}
