import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';import {join,resolve,sep,basename} from 'node:path';import {tmpdir} from 'node:os';
import {pruneElectronLocales} from '../scripts/lib/electron-locales.mjs';
async function fixture(fn){const root=await mkdtemp(join(tmpdir(),'nagneon-locales-'));try{await mkdir(join(root,'locales'));await fn(root);}finally{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&basename(root).startsWith('nagneon-locales-'));await rm(root,{recursive:true});}}

test('locale pruning keeps Korean/English and non-locale resources',()=>fixture(async root=>{
 for(const [name,text] of [['ko.pak','korean'],['en-US.pak','english'],['ja.pak','japanese'],['README.txt','notice']])await writeFile(join(root,'locales',name),text);
 await writeFile(join(root,'icudtl.dat'),'unicode');
 const result=await pruneElectronLocales(root);assert.deepEqual(result.kept,['en-US','ko']);assert.equal(result.removedBytes,8);assert.deepEqual(result.removed,[{name:'ja.pak',bytes:8}]);
 assert.deepEqual((await readdir(join(root,'locales'))).sort(),['README.txt','en-US.pak','ko.pak']);assert.equal(await readFile(join(root,'icudtl.dat'),'utf8'),'unicode');assert.equal(await readFile(join(root,'locales','ko.pak'),'utf8'),'korean');
 assert.equal((await pruneElectronLocales(root)).removedBytes,0);
}));
test('missing required locale fails before deleting another language',()=>fixture(async root=>{
 await writeFile(join(root,'locales','en-US.pak'),'english');await writeFile(join(root,'locales','ja.pak'),'japanese');
 await assert.rejects(pruneElectronLocales(root),/필수 Electron 언어/);assert.equal(await readFile(join(root,'locales','ja.pak'),'utf8'),'japanese');
}));
test('non-file locale entry fails before pruning',()=>fixture(async root=>{
 await writeFile(join(root,'locales','ko.pak'),'korean');await writeFile(join(root,'locales','en-US.pak'),'english');await writeFile(join(root,'locales','ja.pak'),'japanese');await mkdir(join(root,'locales','fr.pak'));
 await assert.rejects(pruneElectronLocales(root),/파일 형식/);assert.equal(await readFile(join(root,'locales','ja.pak'),'utf8'),'japanese');
}));
