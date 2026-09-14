import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm, symlink, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  sanitizeRelativePath, toWinPath, winToWsl, wslToWin,
  validateVersion, validateBuildId, resolveIdentity,
  parseManifest, buildFileEntries, estimatedSizeKb,
  renderInstallList, renderUninstallList, renderNsi, escapeNsiLiteral,
  verifyPackage, generateInstaller, createSyntheticPackage,
  deriveBuildId, REQUIRED_RUNTIME_FILES,
} from '../scripts/build-installer.mjs';

const tmp = () => mkdtemp(join(tmpdir(), 'backseat-installer-'));

// Matches an actual `RMDir ... /r` COMMAND line (recursive delete), while
// ignoring the words "RMDir /r" that legitimately appear in explanatory
// comments (comment lines start with `;`).
const RECURSIVE_RMDIR = /^[ \t]*RMDir\b[^\n]*\/r\b/mi;

test('sanitizeRelativePath accepts safe relative paths and rejects escapes', () => {
  assert.equal(sanitizeRelativePath('Nagneon.exe'), 'Nagneon.exe');
  assert.equal(sanitizeRelativePath('resources/app/index.txt'), 'resources/app/index.txt');
  for (const bad of [
    '', '..', '../x', 'a/../b', 'a/./b', 'a//b', '/etc/passwd', 'C:/Windows/x',
    'C:\\Windows', 'a\\b', 'a/b\0c', 'a/CON', 'CON.txt', 'a/PRN', 'com1', 'lpt9.dat',
    'name ', ' name', 'name.', 'a/b?/c', 'a/<x>', 'a/"q"', 'a/*',
  ]) {
    assert.throws(() => sanitizeRelativePath(bad), new RegExp('.'), `should reject: ${JSON.stringify(bad)}`);
  }
});

test('path mapping helpers round-trip Windows/WSL', () => {
  assert.equal(toWinPath('a/b/c'), 'a\\b\\c');
  assert.equal(winToWsl('G:\\dev\\ai\\x'), '/mnt/g/dev/ai/x');
  assert.equal(wslToWin('/mnt/g/dev/ai/x'), 'G:\\dev\\ai\\x');
  assert.equal(wslToWin('/tmp/x'), null);
});

test('version and build id validation', () => {
  for (const ok of ['0.1.0', '1.2.3', '0.0.0-fixture', '1.0.0-rc.1', '1.0.0+build.7']) validateVersion(ok);
  for (const bad of ['', '1', '1.2', 'v1.2.3', '1.2.3 ', 'x.y.z', '1.2.3;rm']) assert.throws(() => validateVersion(bad));
  for (const ok of ['2026-09-12T22-02-56-448Z', 'fixture', 'build_7.1']) validateBuildId(ok);
  for (const bad of ['', 'a/b', 'a\\b', 'a b', 'x'.repeat(65), 'a;b']) assert.throws(() => validateBuildId(bad));
});

test('deriveBuildId sanitises an ISO timestamp into a path-safe id', () => {
  assert.equal(deriveBuildId('2026-09-12T22:02:56.448Z'), '2026-09-12T22-02-56-448Z');
  assert.throws(() => deriveBuildId('////'));
});

test('resolveIdentity fully isolates test identity from production', () => {
  const prod = resolveIdentity({mode: 'production', version: '0.1.0', buildId: 'b1'});
  const testId = resolveIdentity({mode: 'test', version: '0.1.0', buildId: 'b1'});
  // Every field that determines *where* things land must differ.
  for (const key of ['appName', 'appId', 'installSubdir', 'shortcutGroup', 'regUninstallKey', 'uninstallerName']) {
    assert.notEqual(prod[key], testId[key], `identity field ${key} must differ`);
  }
  // Test identity is clearly marked; production is not.
  assert.match(testId.appName, /Test/);
  assert.match(testId.installSubdir, /Test/);
  assert.match(testId.shortcutGroup, /Test/);
  assert.match(testId.regUninstallKey, /Test/);
  assert.doesNotMatch(prod.appName, /Test/);
  assert.doesNotMatch(prod.regUninstallKey, /Test/);
  // Publisher stays a development marker in BOTH; never a real/signed publisher.
  assert.match(prod.publisher, /development/i);
  assert.match(testId.publisher, /development/i);
  // Payload dir binds version+build; both registry keys are per-user HKCU Uninstall keys.
  assert.equal(prod.payloadDirname, '0.1.0+b1');
  assert.match(prod.regUninstallKey, /^Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\/);
  assert.throws(() => resolveIdentity({mode: 'nope', version: '0.1.0', buildId: 'b1'}));
});

test('buildFileEntries validates, sorts, and rejects bad manifests', () => {
  const entries = buildFileEntries({version: '0.1.0', files: [
    {path: 'resources/app/z.txt', bytes: 1, sha256: 'a'.repeat(64)},
    {path: 'Nagneon.exe', bytes: 2, sha256: 'b'.repeat(64)},
  ]});
  assert.deepEqual(entries.map(e => e.path), ['Nagneon.exe', 'resources/app/z.txt']);
  assert.equal(entries[1].dir, 'resources/app');
  assert.equal(entries[1].name, 'z.txt');
  // bad sha256 / bad size / traversal / duplicate
  assert.throws(() => buildFileEntries({version: '0.1.0', files: [{path: 'a', bytes: 1, sha256: 'xyz'}]}));
  assert.throws(() => buildFileEntries({version: '0.1.0', files: [{path: 'a', bytes: -1, sha256: 'a'.repeat(64)}]}));
  assert.throws(() => buildFileEntries({version: '0.1.0', files: [{path: '../a', bytes: 1, sha256: 'a'.repeat(64)}]}));
  assert.throws(() => buildFileEntries({version: '0.1.0', files: [
    {path: 'a', bytes: 1, sha256: 'a'.repeat(64)}, {path: 'a', bytes: 1, sha256: 'a'.repeat(64)},
  ]}));
  assert.throws(() => parseManifest({version: '0.1.0'})); // no files array
});

test('renderInstallList groups by dir with SetOutPath into staging, no wildcards', () => {
  const entries = buildFileEntries({version: '0.1.0', files: [
    {path: 'Nagneon.exe', bytes: 1, sha256: 'a'.repeat(64)},
    {path: 'resources/app.asar', bytes: 1, sha256: 'b'.repeat(64)},
    {path: 'resources/app/index.txt', bytes: 1, sha256: 'c'.repeat(64)},
  ]});
  const list = renderInstallList(entries, {baseVar: '$StageDir'});
  assert.match(list, /SetOutPath "\$StageDir"/);
  assert.match(list, /SetOutPath "\$StageDir\\resources"/);
  assert.match(list, /SetOutPath "\$StageDir\\resources\\app"/);
  assert.match(list, /File "\/oname=Nagneon.exe" "\$\{BACKSEAT_SRC\}\\Nagneon\.exe"/);
  assert.match(list, /File "\/oname=index.txt" "\$\{BACKSEAT_SRC\}\\resources\\app\\index\.txt"/);
  // one File per entry, one SetOutPath per unique dir, no wildcard globbing.
  assert.equal((list.match(/^File /gm) || []).length, 3);
  assert.equal((list.match(/^SetOutPath /gm) || []).length, 3);
  assert.doesNotMatch(list, /File .*\*/);
  // parent dir SetOutPath precedes child dir SetOutPath (deterministic order).
  assert.ok(list.indexOf('"$StageDir\\resources"') < list.indexOf('"$StageDir\\resources\\app"'));
});

test('renderUninstallList removes only owned paths, deepest-first, never RMDir /r', () => {
  const entries = buildFileEntries({version: '0.1.0', files: [
    {path: 'Nagneon.exe', bytes: 1, sha256: 'a'.repeat(64)},
    {path: 'resources/app/index.txt', bytes: 1, sha256: 'b'.repeat(64)},
  ]});
  const list = renderUninstallList(entries, {baseExpr: '$PayloadDir'});
  assert.match(list, /Delete "\$PayloadDir\\Nagneon\.exe"/);
  assert.match(list, /Delete "\$PayloadDir\\resources\\app\\index\.txt"/);
  // Never a recursive delete (match the COMMAND form, not the word in comments).
  assert.doesNotMatch(list, RECURSIVE_RMDIR);
  // Deepest dir removed before its parent; payload root removed last.
  assert.ok(list.indexOf('RMDir "$PayloadDir\\resources\\app"') < list.indexOf('RMDir "$PayloadDir\\resources"'));
  assert.ok(list.trimEnd().endsWith('RMDir "$PayloadDir"'));
  // Only owned files: no path outside the two entries.
  const deletes = (list.match(/^Delete .*/gm) || []);
  assert.equal(deletes.length, 2);
});

test('renderNsi replaces every token and rejects leftovers', () => {
  assert.equal(renderNsi('a=@X@ b=@Y@', {X: '1', Y: '2'}), 'a=1 b=2');
  assert.throws(() => renderNsi('a=@X@ b=@MISSING@', {X: '1'}), /unresolved template tokens: @MISSING@/);
});

test('verifyPackage passes on a good fixture and flags every corruption', async t => {
  const dir = await tmp();
  t.after(() => rm(dir, {recursive: true, force: true}));
  const {manifest} = await createSyntheticPackage(dir);
  const entries = buildFileEntries(manifest);

  const good = await verifyPackage(dir, entries, {hash: true});
  assert.ok(good.ok, JSON.stringify(good.errors));
  assert.equal(good.checked, entries.length);

  // Tamper: same size, different bytes -> hash mismatch (size check passes).
  const exeBytes = entries.find(e => e.path === 'Nagneon.exe').bytes;
  await writeFile(join(dir, 'Nagneon.exe'), Buffer.alloc(exeBytes, 0x58));
  const badHash = await verifyPackage(dir, entries, {hash: true});
  assert.ok(!badHash.ok);
  assert.ok(badHash.errors.some(e => /sha256 mismatch: Nagneon\.exe/.test(e)), JSON.stringify(badHash.errors));

  // Different size -> size mismatch caught even without hashing (structural).
  await writeFile(join(dir, 'resources', 'app', 'index.txt'), 'longer content than the fixture original');
  const badSize = await verifyPackage(dir, entries, {hash: false});
  assert.ok(badSize.errors.some(e => /size mismatch: resources\/app\/index\.txt/.test(e)), JSON.stringify(badSize.errors));

  // Missing file.
  await rm(join(dir, 'locales', 'en-US.txt'));
  assert.ok((await verifyPackage(dir, entries, {hash: false})).errors.some(e => /missing: locales\/en-US\.txt/.test(e)));
});

test('verifyPackage rejects symlinks and path escapes (defence in depth)', async t => {
  const dir = await tmp();
  t.after(() => rm(dir, {recursive: true, force: true}));
  await mkdir(join(dir, 'resources'), {recursive: true});
  await mkdir(join(dir, 'outside'));
  await writeFile(join(dir, 'outside', 'secret.txt'), 'secret');
  // Directory junctions do not require Windows symlink privileges. This also
  // exercises a linked ancestor instead of checking only the leaf file.
  await symlink(join(dir, 'outside'), join(dir, 'resources', 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  const entries = [{path: 'resources/link/secret.txt', dir: 'resources/link', name: 'secret.txt', bytes: 6, sha256: 'a'.repeat(64)}];
  const res = await verifyPackage(dir, entries, {hash: false});
  assert.ok(res.errors.some(e => /symlink not allowed/.test(e)));
  // A raw traversal entry (bypassing buildFileEntries) must be rejected by the escape guard.
  const escape = await verifyPackage(dir, [{path: '../x', bytes: 1, sha256: 'a'.repeat(64)}], {hash: false});
  assert.ok(escape.errors.some(e => /escapes package/.test(e)));
});

test('generateInstaller binds exact payload and engine hashes to an isolated NSIS project', async t => {
  const pkg = await tmp();
  const out = await tmp();
  t.after(() => Promise.all([rm(pkg, {recursive: true, force: true}), rm(out, {recursive: true, force: true})]));
  const {manifest, folder} = await createSyntheticPackage(pkg);

  const engineFile=join(pkg,'fixture-engine.exe');await writeFile(engineFile,'non-executable test engine');
  const {identity, meta} = await generateInstaller({
    engineFile,
    manifest, packageFolder: folder, outDir: out, mode: 'test', buildId: 'testbuild',
    outFileWin: 'C:\\out\\Nagneon-Setup.exe',
  });
  assert.equal(identity.marker, 'test');
  assert.equal(meta.claims.signed, false);
  assert.equal(meta.claims.retailReady, false);
  assert.equal(meta.claims.steamReviewed, false);

  const nsi = await readFile(join(out, 'backseat.nsi'), 'utf8');
  // Self-contained: static includes copied next to the rendered script.
  for (const f of ['InstallEngine.exe','install-request.json','install-files.generated.nsh','build-metadata.json']) {
    await readFile(join(out, f), 'utf8');
  }
  // Per-user, no elevation; isolated test install root (define expanded by makensis).
  assert.match(nsi, /RequestExecutionLevel user/);
  assert.match(nsi, /!define INSTALL_SUBDIR\s+"Nagneon \(Test\)"/);
  assert.match(nsi, /InstallDir "\$LOCALAPPDATA\\Programs\\\$\{INSTALL_SUBDIR\}"/);
  assert.match(nsi, /!define REG_UNINSTALL_KEY "[^"]*Nagneon-Test"/);
  // No token left behind.
  assert.doesNotMatch(nsi, /@[A-Z0-9_]+@/);
  // Uninstall list is owned-only, no recursive delete.
  const un = await readFile(join(out, 'uninstall-files.generated.nsh'), 'utf8');
  assert.doesNotMatch(un, RECURSIVE_RMDIR);
  const request=JSON.parse(await readFile(join(out,'install-request.json'),'utf8'));
  assert.equal(request.identity.appId,identity.appId);
  assert.match(request.engineSha256,/^[a-f0-9]{64}$/);
  assert.deepEqual(request.files,buildFileEntries(manifest).map(({path,bytes,sha256})=>({path,bytes,sha256})));
  for(const rf of REQUIRED_RUNTIME_FILES)assert.ok(request.files.some(f=>f.path===rf));
  assert.equal(meta.claims.runnable,false);
  await assert.rejects(()=>generateInstaller({manifest,packageFolder:folder,outDir:out,mode:'production',buildId:'testbuild',outFileWin:'C:\\out\\setup.exe',engineFile,enableTestInstall:true}),/test identity/);
  // estimatedSize is a positive integer.
  assert.ok(estimatedSizeKb(buildFileEntries(manifest)) >= 1);
});

test('NSIS only extracts to its private directory and delegates state mutation to engine',async()=>{
  const tmpl=await readFile(new URL('../installer/backseat.nsi.in',import.meta.url),'utf8');
  assert.match(tmpl,/RequestExecutionLevel user/);assert.match(tmpl,/SetRegView 64/);
  assert.match(tmpl,/StrCpy \$StageDir "\$PLUGINSDIR/);
  assert.match(tmpl,/nsExec::ExecToStack.* install /);assert.match(tmpl,/nsExec::ExecToStack.* uninstall /);
  assert.doesNotMatch(tmpl,/^\s*(?:Delete|RMDir|WriteReg|DeleteReg|CreateShortCut)/m);
  assert.match(tmpl,/SetErrorLevel 10/);assert.match(tmpl,/MUI_LANGUAGE "Korean"/);
});
test('NSIS literals escape dollar variables instead of redirecting extraction',()=>{
  assert.equal(escapeNsiLiteral('cash$0'),'cash$$0');assert.throws(()=>escapeNsiLiteral('bad"line'));
  const value=renderInstallList([{path:'cash$0/file$INSTDIR.txt',dir:'cash$0',name:'file$INSTDIR.txt'}],{errorLabel:'extract_failed'});
  assert.match(value,/cash\$\$0/);assert.match(value,/file\$\$INSTDIR/);assert.match(value,/IfErrors extract_failed/);
});
test('manifest rejects Windows case aliases',()=>{
  assert.throws(()=>buildFileEntries({files:[{path:'a.dll',bytes:1,sha256:'a'.repeat(64)},{path:'A.dll',bytes:1,sha256:'a'.repeat(64)}]}),/duplicate path/);
});

test('manifest rejects file-directory aliases and trailing-dot build names',()=>{
  assert.throws(()=>buildFileEntries({files:[{path:'Resources',bytes:1,sha256:'a'.repeat(64)},{path:'resources/app.bin',bytes:1,sha256:'b'.repeat(64)}]}),/file\/directory alias/);
  assert.throws(()=>resolveIdentity({mode:'test',version:'0.1.0',buildId:'build.'}),/invalid build id/);
});
