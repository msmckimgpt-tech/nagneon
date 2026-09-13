import {readFile,writeFile,mkdir,copyFile,readdir} from 'node:fs/promises';
import {resolve,join,relative,dirname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const root=resolve('.');
const json=async p=>JSON.parse((await readFile(p,'utf8')).replace(/^\uFEFF/,''));
const sha=b=>createHash('sha256').update(b).digest('hex');
const native=await json('artifacts/autonomy-native-result.json');
const ui=await json('artifacts/audience-autonomy-ui.json');
const astra=await json('artifacts/audience-autonomy-astra.json');
const runtime=await json('artifacts/autonomy-packaged-runtime.json');
const integrity=await json('artifacts/autonomy-package-integrity.json');
const sound=await json('artifacts/sound-loopback-test.json');
const mixed=await json(join(sound.folder,'mixed-audio-test.json'));
for(const report of [native,ui,astra,runtime,integrity,sound,mixed])assert.equal(report.passed,true);
assert.equal(native.closed,true);assert.deepEqual(await json('artifacts/autonomy-native-processes-after.json'),[]);
assert.equal(native.folder,integrity.folder);assert.equal(runtime.folder,integrity.folder);
assert.equal(ui.checks.length,7);assert.equal(ui.layouts.length,24);
assert.equal(astra.realModel,true);assert.equal(astra.calls.length,2);
assert.equal(sound.nativeLoopback,true);assert.equal(mixed.oneAudioTrack,true);
const fullCheck=await readFile('artifacts/autonomy-release-final-check.log','utf8');
assert.match(fullCheck,/# pass 234\r?\n# fail 0/);assert.match(fullCheck,/tsc --noEmit && vite build/);assert.match(fullCheck,/built in/);
const dialogLog=await readFile('artifacts/autonomy-dialog-regression-retry.log','utf8');
const dialog=JSON.parse(dialogLog.slice(dialogLog.indexOf('{')));
assert.equal(dialog.passed,true);assert.equal(dialog.checks.length,13);assert.deepEqual(dialog.consoleErrors,[]);
const claude=await json('artifacts/claude-settings-tabs-output.json');
assert.equal(claude.is_error,false);assert.equal((await readFile('artifacts/claude-settings-tabs-exit.txt','utf8')).trim(),'0');
const packageInfo=await json('artifacts/latest-package.json');assert.equal(packageInfo.folder,integrity.folder);

const snapshot=resolve('artifacts','audience-autonomy-source-'+new Date().toISOString().replace(/[:.]/g,'-'));
await mkdir(snapshot);
const paths=new Set([
  'HANDOFF.md','docs/AUDIENCE-AUTONOMY.md','package.json','package-lock.json',
  'scripts/record-audience-autonomy-evidence.mjs','scripts/verify-audience-autonomy.cjs',
  'scripts/verify-audience-astra.mjs','scripts/verify-sound-desktop.cjs','scripts/verify-clip-sound.py',
  'scripts/verify-dialog-accessibility.cjs','scripts/verify-package-integrity.mjs','scripts/verify-packaged-runtime.mjs',
  'test/audience-autonomy.test.js','test/fixtures/arrival-crash.mjs','test/helpers/met-audience.js',
  'test/conversation-journal.test.js','test/seasons.test.js','test/sound.test.js','test/experiences.test.js','test/storage-integration.test.js',
  'artifacts/autonomy-release-final-check.log','artifacts/audience-autonomy-ui.json','artifacts/autonomy-ui-layout-final.log',
  'artifacts/autonomy-dialog-regression-retry.log','artifacts/autonomy-dialog-regression.log',
  'artifacts/audience-autonomy-astra.json','artifacts/autonomy-astra-test.log',
  'artifacts/sound-loopback-test.json','artifacts/autonomy-loopback-retry.log','artifacts/autonomy-loopback-mix.log','artifacts/autonomy-loopback.log',
  'artifacts/autonomy-package-final.log','artifacts/autonomy-packaged-runtime.json','artifacts/autonomy-packaged-runtime.log','artifacts/autonomy-package-integrity.json',
  'artifacts/autonomy-native-launch.json','artifacts/autonomy-native-result.json','artifacts/autonomy-native-processes-after.json',
  'artifacts/autonomy-native-studio.txt','artifacts/autonomy-native-studio.jpg','artifacts/autonomy-native-settings.txt','artifacts/autonomy-native-settings.jpg',
  'artifacts/autonomy-native-mood.txt','artifacts/autonomy-native-audience.txt','artifacts/autonomy-native-audience.jpg',
  'artifacts/autonomy-native-output.log','artifacts/autonomy-native-error.log',
  'artifacts/claude-settings-tabs-prompt.txt','artifacts/run-claude-settings-tabs.sh','artifacts/claude-settings-tabs-output.json','artifacts/claude-settings-tabs-error.log','artifacts/claude-settings-tabs-exit.txt',
  'artifacts/latest-package.json',relative(root,packageInfo.manifest),
]);
async function sourceTree(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())await sourceTree(p);else if(e.isFile()&&/\.(cjs|mjs|js|tsx|ts|css|json)$/.test(e.name))paths.add(p);}}
for(const dir of ['server','src','desktop','shared'])await sourceTree(dir);
for(const base of [ui.base,astra.base,sound.folder,dialog.folder,'artifacts/autonomy-ui-1789266322776','artifacts/autonomy-ui-1789266361545','artifacts/sound-ui-1789266517880']){
  for(const e of await readdir(base,{withFileTypes:true}))if(e.isFile()&&/\.(json|txt|log|png)$/.test(e.name))paths.add(join(base,e.name));
}
const files=[];
for(const path of paths){
  const absolute=resolve(path);assert.ok(absolute.startsWith(root+sep),absolute);
  const rel=relative(root,absolute),bytes=await readFile(absolute),to=join(snapshot,rel);
  await mkdir(dirname(to),{recursive:true});await copyFile(absolute,to);
  assert.equal(sha(await readFile(to)),sha(bytes));
  files.push({path:rel.replaceAll('\\','/'),bytes:bytes.length,sha256:sha(bytes)});
}
const evidence={at:new Date().toISOString(),scope:'Audience autonomy, paid reveals, spectator clips, ordinary broadcast flow and tabbed settings. Retail goal remains active; physical microphone/Steam/long-term realism acceptance is separate.',sourceSnapshot:snapshot,package:integrity.folder,files,acceptance:{node:234,newAutonomyTests:15,renderer:ui.checks.length,layouts:ui.layouts.length,dialog:dialog.checks.length,loopback:sound.checks.length,sourceAstraCalls:astra.calls.length,deliveredRuntime:true,nativeClosed:true},claude:{sessionId:claude.session_id,exitCode:0,scope:'two settings component files; parent integration and acceptance'},limitations:['Synthetic streamer speech and microphone input; actual Windows loopback and actual Astra calls are distinguished in reports.','New full package is unsigned; NSIS was not rebuilt or installed for this generation.','Original user app and profile were not restarted or reset.']};
await writeFile(join(snapshot,'evidence.json'),JSON.stringify(evidence,null,2));
await writeFile('artifacts/audience-autonomy-evidence.json',JSON.stringify(evidence,null,2));
console.log(JSON.stringify({snapshot,files:files.length,acceptance:evidence.acceptance},null,2));
