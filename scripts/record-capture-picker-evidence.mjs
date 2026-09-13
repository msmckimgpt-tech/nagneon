import {readFile,writeFile,mkdir,copyFile,readdir} from 'node:fs/promises';
import {resolve,join,relative,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const json=async p=>JSON.parse((await readFile(p,'utf8')).replace(/^\uFEFF/,''));
const sha=b=>createHash('sha256').update(b).digest('hex');
const reports=['capture-picker-test','capture-native-test','capture-picker-package-integrity','capture-picker-packaged-runtime','capture-picker-native-result'];
const checked=await Promise.all(reports.map(n=>json('artifacts/'+n+'.json')));
for(const report of checked)assert.equal(report.passed,true);
assert.equal(checked[4].closed,true);assert.deepEqual(await json('artifacts/capture-picker-native-processes-after.json'),[]);
const sound=await json('artifacts/sound-loopback-test.json');assert.ok(sound.passed&&sound.nativeLoopback);
const mixed=await json(join(sound.folder,'mixed-audio-test.json'));assert.ok(mixed.passed&&mixed.oneAudioTrack);
const claude=await json('artifacts/claude-audience-autonomy-output.json');assert.equal(claude.is_error,false);assert.equal((await readFile('artifacts/claude-audience-autonomy-exit.txt','utf8')).trim(),'0');
const sourceNames=['src/App.tsx','src/CapturePicker.tsx','src/capture-picker.css','src/types.ts','desktop/capture.cjs','desktop/preload.cjs','test/capture-policy.test.js','scripts/verify-capture-picker.cjs','scripts/verify-capture-native.cjs','scripts/verify-dialog-accessibility.cjs','scripts/verify-sound-desktop.cjs'];
const snapshot=resolve('artifacts','capture-picker-source-'+new Date().toISOString().replace(/[:.]/g,'-'));await mkdir(snapshot);
const paths=new Set(['HANDOFF.md','docs/CAPTURE-PICKER.md','docs/AUDIENCE-AUTONOMY.md','docs/SYSTEM-SOUND.md',
  'artifacts/capture-picker-check.log','artifacts/capture-picker-policy-test.log','artifacts/capture-picker-build-final.log','artifacts/capture-picker-renderer-final.log','artifacts/capture-picker-dialog-current.log',
  'artifacts/capture-picker-native-enumeration.log','artifacts/capture-picker-loopback.log','artifacts/capture-picker-loopback-mix.log','artifacts/capture-picker-package.log','artifacts/capture-picker-package-integrity.log','artifacts/capture-picker-packaged-runtime.log',
  'artifacts/capture-picker-native-dialog.txt','artifacts/capture-picker-native-dialog.jpg','artifacts/capture-picker-native-error.log','artifacts/capture-picker-native-output.log','artifacts/capture-picker-native-processes-after.json',
  'artifacts/claude-audience-autonomy-prompt.txt','artifacts/run-claude-audience-autonomy.sh','artifacts/claude-audience-autonomy-output.json','artifacts/claude-audience-autonomy-review.md','artifacts/claude-audience-autonomy-error.log','artifacts/claude-audience-autonomy-exit.txt',
  'artifacts/capture-picker-1789263566461/result.json','artifacts/capture-native-1789263788908/result.json','artifacts/capture-native-1789263788908/initial-enumeration.log',
  'scripts/record-capture-picker-evidence.mjs']);
for(const name of sourceNames){const to=join(snapshot,name);await mkdir(dirname(to),{recursive:true});await copyFile(name,to);paths.add(to);}
for(const name of reports)paths.add('artifacts/'+name+'.json');
for(const base of [checked[0].base,checked[1].base,sound.folder])for(const file of await readdir(base,{withFileTypes:true}))if(file.isFile()&&/\.(png|json|txt|log)$/.test(file.name))paths.add(join(base,file.name));
const root=resolve('.'),files=[];
for(const path of paths){const absolute=resolve(path);assert.ok(absolute.startsWith(root+'\\'));const bytes=await readFile(absolute);files.push({path:relative(root,absolute).replaceAll('\\','/'),bytes:bytes.length,sha256:sha(bytes)});}
const evidence={at:new Date().toISOString(),scope:'Capture picker UI and production enumeration plus real loopback/new package acceptance. Audience autonomy migration remains pending; retail goal active.',sourceSnapshot:snapshot,package:checked[2].folder,files,claude:{sessionId:claude.session_id,exitCode:0,readOnlyReview:true,recommendationsNotAllAdopted:true},acceptance:{node:219,policy:6,renderer:checked[0].checks.length,layouts:checked[0].layouts.length,dialog:13,loopback:sound.checks.length,nativeClosed:true}};
await writeFile(join(snapshot,'evidence.json'),JSON.stringify(evidence,null,2));await writeFile('artifacts/capture-picker-evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify({snapshot,files:files.length,acceptance:evidence.acceptance},null,2));
