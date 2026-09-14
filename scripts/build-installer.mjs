// scripts/build-installer.mjs
// ---------------------------------------------------------------------------
// Generates a reviewable NSIS installer project for the existing full-folder
// Windows package (the one pointed to by artifacts/latest-package.json).
//
// It is intentionally split into small PURE functions (path handling, list
// generation, identity resolution, template rendering) so test/installer-build
// .test.js can validate the risky logic deterministically without a compiler
// or the real 1.5 GB package. The CLI at the bottom wires them to real I/O:
//   1. load + validate the package manifest,
//   2. verify the package folder against the manifest (size + sha256),
//   3. generate the file lists + rendered .nsi into an output folder,
//   4. (optional) compile with makensis if a verified compiler is available.
//
// It NEVER executes a produced installer, never installs/uninstalls anything,
// and never touches user data. See docs/INSTALLER.md.
// ---------------------------------------------------------------------------

import {buildInstallerEngine} from './build-installer-engine.mjs';
import {cp, mkdir, readFile, writeFile, readdir, lstat, stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {dirname, resolve, join, isAbsolute} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INSTALLER_SRC = join(ROOT, 'installer');

// --- Constants describing the payload contract -----------------------------

// Runtime files desktop/runtime.cjs requires; the installer refuses to publish
// unless all of these are present after extraction. Forward-slash relative.
export const REQUIRED_RUNTIME_FILES = [
  'Nagneon.exe',
  'resources/codex/bin/codex.exe',
  'resources/speech/python/python.exe',
  'resources/speech/speech_worker.py',
  'resources/speech/model/model.bin',
  'resources/sound/sound_worker.py',
  'resources/sound/model/yamnet.onnx',
];

// Windows reserved device names (case-insensitive, with or without extension).
const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

// --- Identity resolution (test mode is fully isolated from production) ------

const IDENTITIES = {
  production: {
    marker: 'production',
    appName: 'Nagneon',
    appId: '{9D4F2B31-8250-4BFC-AE43-3C27B5E8F092}',
    installSubdir: 'Nagneon',
    shortcutGroup: 'Nagneon',
    regUninstallKey: 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Nagneon',
    exeName: 'Nagneon.exe',
    uninstallerName: 'Uninstall Nagneon.exe',
    // Publisher stays a development marker until a real publisher is specified.
    publisher: 'Unspecified publisher (development build)',
  },
  test: {
    marker: 'test',
    appName: 'Nagneon (Test)',
    appId: '{8C2EFA10-5B76-4D83-AB91-7F3064D82E51}',
    installSubdir: 'Nagneon (Test)',
    shortcutGroup: 'Nagneon (Test)',
    regUninstallKey: 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Nagneon-Test',
    exeName: 'Nagneon.exe',
    uninstallerName: 'Uninstall Nagneon (Test).exe',
    publisher: 'Unspecified publisher (development build)',
  },
};

export function resolveIdentity({mode = 'production', version, buildId} = {}) {
  const base = IDENTITIES[mode];
  if (!base) throw new Error(`unknown installer mode: ${mode}`);
  validateVersion(version);
  validateBuildId(buildId);
  const payloadDirname = `${version}+${buildId}`;
  if (!/^[0-9A-Za-z._+-]+$/.test(payloadDirname)) {
    throw new Error(`unsafe payload dir name: ${payloadDirname}`);
  }
  return {...base, version, buildId, payloadDirname};
}

// --- Validation of version / build identifiers -----------------------------

export function validateVersion(version) {
  if (typeof version !== 'string' || version.length > 128 || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`invalid VERSION: ${JSON.stringify(version)}`);
  }
  return version;
}

export function validateBuildId(buildId) {
  // Derived from an ISO timestamp by package-windows.mjs; keep it path-safe.
  if (typeof buildId !== 'string' || !/^[0-9A-Za-z._-]{1,64}$/.test(buildId) || buildId.endsWith('.')) {
    throw new Error(`invalid build id: ${JSON.stringify(buildId)}`);
  }
  return buildId;
}

// --- Path handling ---------------------------------------------------------

// Accept ONLY a safe, forward-slash relative path from the manifest. Reject
// absolute paths, drive letters, backslashes, empty/`.`/`..` segments, control
// chars, Windows-illegal characters, reserved device names, and trailing
// dot/space segments (which Windows silently strips, enabling confusion).
export function sanitizeRelativePath(p) {
  if (typeof p !== 'string' || p.length === 0) throw new Error(`empty path`);
  if (p.includes('\\')) throw new Error(`backslash not allowed: ${p}`);
  if (p.includes('\0')) throw new Error(`NUL in path: ${p}`);
  if (isAbsolute(p) || /^[A-Za-z]:/.test(p) || p.startsWith('/')) {
    throw new Error(`absolute path not allowed: ${p}`);
  }
  const segments = p.split('/');
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') throw new Error(`unsafe segment in path: ${p}`);
    if (/[\x00-\x1f<>:"|?*]/.test(seg)) throw new Error(`illegal character in path: ${p}`);
    if (seg !== seg.trim() || seg.endsWith('.')) throw new Error(`trailing dot/space segment: ${p}`);
    if (WIN_RESERVED.test(seg)) throw new Error(`reserved device name in path: ${p}`);
  }
  return segments.join('/');
}

export const toWinPath = p => p.replaceAll('/', '\\');

// Map a Windows path from latest-package.json (e.g. G:\dev\...) to the WSL
// mount so this Linux-side script can read the files.
export function winToWsl(p) {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  if (!m) return p;
  return '/mnt/' + m[1].toLowerCase() + '/' + m[2].replaceAll('\\', '/');
}

// Map a WSL /mnt/<drive>/ path back to a Windows path so a Windows makensis.exe
// (run via WSL interop) can consume it. Returns null if not under /mnt.
export function wslToWin(p) {
  const m = /^\/mnt\/([a-z])\/(.*)$/.exec(p);
  if (!m) return null;
  return m[1].toUpperCase() + ':\\' + m[2].replaceAll('/', '\\');
}

// --- Manifest -> file entries ----------------------------------------------

export function parseManifest(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('manifest is not an object');
  if (!Array.isArray(obj.files)) throw new Error('manifest.files is not an array');
  validateVersion(obj.version);
  return obj;
}

// Turn manifest.files into validated, sorted entries. Throws on the first bad
// path, sha256, or size — a bad manifest must never yield an installer.
export function buildFileEntries(manifest) {
  const entries = manifest.files.map(f => {
    if (!f || typeof f !== 'object') throw new Error('bad file entry');
    const path = sanitizeRelativePath(f.path);
    if (!/^[a-f0-9]{64}$/i.test(f.sha256 || '')) throw new Error(`bad sha256 for ${path}`);
    if (!Number.isInteger(f.bytes) || f.bytes < 0) throw new Error(`bad size for ${path}`);
    const slash = path.lastIndexOf('/');
    return {
      path,
      dir: slash === -1 ? '' : path.slice(0, slash),
      name: slash === -1 ? path : path.slice(slash + 1),
      bytes: f.bytes,
      sha256: f.sha256.toLowerCase(),
    };
  });
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e.path.toLowerCase())) throw new Error(`duplicate path in manifest: ${e.path}`);
    seen.add(e.path.toLowerCase());
  }
  for(const entry of entries){
    const pieces=entry.path.split('/');pieces.pop();
    while(pieces.length){if(seen.has(pieces.join('/').toLowerCase()))throw Error('file/directory alias in manifest: '+entry.path);pieces.pop();}
  }
  return entries;
}

export function estimatedSizeKb(entries) {
  return Math.max(1, Math.round(entries.reduce((s, e) => s + e.bytes, 0) / 1024));
}

export function escapeNsiLiteral(value){
  return nsiCompilerPath(value).replaceAll('$',()=> '$$');
}
// File sources and OutFile are compiler inputs: $$ would mean two actual dollars.
// Reject preprocessor syntax rather than allowing a path to expand a define.
function nsiCompilerPath(value){
  if(/[\r\n\x00"]|\$[{}]/.test(String(value)))throw Error('Invalid NSIS literal');
  return String(value);
}

// --- Generated NSIS file lists ---------------------------------------------

// install list: group by directory, one SetOutPath per directory (sorted so
// parents precede children), then explicit `File` per manifest entry. Source
// files are addressed via ${BACKSEAT_SRC}; targets via a base variable
// (default $StageDir) so extraction lands in staging, never over a live copy.
export function renderInstallList(entries, {baseVar = '$StageDir', errorLabel} = {}) {
  const byDir = new Map();
  for (const e of entries) {
    if (!byDir.has(e.dir)) byDir.set(e.dir, []);
    byDir.get(e.dir).push(e);
  }
  const dirs = [...byDir.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const lines = [
    '; AUTO-GENERATED by scripts/build-installer.mjs — do not edit.',
    `; ${entries.length} owned files across ${dirs.length} directories.`,
  ];
  for (const dir of dirs) {
    const outPath = dir ? `${baseVar}\\${escapeNsiLiteral(toWinPath(dir))}` : baseVar;
    lines.push('', `SetOutPath "${outPath}"`);if(errorLabel)lines.push(`IfErrors ${errorLabel}`);
    for (const e of byDir.get(dir)) {
      lines.push(`File "/oname=${escapeNsiLiteral(e.name)}" "\${BACKSEAT_SRC}\\${nsiCompilerPath(toWinPath(e.path))}"`);if(errorLabel)lines.push(`IfErrors ${errorLabel}`);
    }
  }
  return lines.join('\n') + '\n';
}

// uninstall list: delete each owned file, then RMDir (non-recursive) each owned
// directory deepest-first. Non-recursive RMDir leaves any directory that still
// holds unknown/user/locked files. NEVER emits `RMDir /r`. Targets a base
// expression (default the versioned payload dir).
export function renderUninstallList(entries, {baseExpr = '$PayloadDir'} = {}) {
  const lines = [
    '; AUTO-GENERATED by scripts/build-installer.mjs — do not edit.',
    '; Removes ONLY these owned files, then owned empty dirs (deepest first).',
    '; No RMDir /r: unknown, user-created, or locked files are always kept.',
    '',
  ];
  for (const e of entries) lines.push(`Delete "${baseExpr}\\${escapeNsiLiteral(toWinPath(e.path))}"`);
  const dirs = new Set();
  for (const e of entries) {
    const parts = e.dir ? e.dir.split('/') : [];
    for (let i = 1; i <= parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  const ordered = [...dirs].sort((a, b) => b.split('/').length - a.split('/').length || (a < b ? 1 : -1));
  lines.push('');
  for (const d of ordered) lines.push(`RMDir "${baseExpr}\\${escapeNsiLiteral(toWinPath(d))}"`);
  lines.push(`RMDir "${baseExpr}"`);
  return lines.join('\n') + '\n';
}

// --- Template rendering -----------------------------------------------------

export function renderNsi(template, tokens) {
  let out = template;
  for (const [k, v] of Object.entries(tokens)) {
    out = out.split(`@${k}@`).join(String(v));
  }
  const leftover = out.match(/@[A-Z0-9_]+@/g);
  if (leftover) throw new Error(`unresolved template tokens: ${[...new Set(leftover)].join(', ')}`);
  return out;
}

// --- Package verification (I/O) --------------------------------------------

const sha256File = async file => {
  const h = createHash('sha256');
  for await (const data of createReadStream(file)) h.update(data);
  return h.digest('hex');
};

// Verify the package folder against the manifest entries. Rejects symlinks and
// any path that escapes the folder. `hash:false` checks presence + size only
// (fast structural check); `hash:true` also verifies sha256 (authoritative).
export async function verifyPackage(folder, entries, {hash = true} = {}) {
  const root = resolve(folder);
  const errors = [];
  const checkedDirs = new Set();
  let checked = 0;
  try{let dir=root;while(true){const info=await lstat(dir);if(info.isSymbolicLink()||!info.isDirectory())throw Error('symlink not allowed in package root chain');const parent=dirname(dir);if(parent===dir)break;dir=parent;}}
  catch(error){return {ok:false,checked:0,total:entries.length,errors:[error.message]};}
  for (const e of entries) {
    const target = resolve(root, ...e.path.split('/'));
    if (target !== root && !target.startsWith(root + '/') && !target.startsWith(root + '\\')) {
      errors.push(`path escapes package: ${e.path}`);
      continue;
    }
    let st;
    try {
      const parts = e.path.split('/');
      for (let i = 0; i < parts.length; i++) {
        const parent = resolve(root, ...parts.slice(0, i));
        if (checkedDirs.has(parent)) continue;
        const parentStat = await lstat(parent);
        if (parentStat.isSymbolicLink()) throw new Error('linked parent');
        if (!parentStat.isDirectory()) throw new Error('invalid parent');
        checkedDirs.add(parent);
      }
      st = await lstat(target);
    } catch (error) {
      errors.push(`${error.message === 'linked parent' ? 'symlink not allowed' : error.code === 'ENOENT' ? 'missing' : 'invalid parent'}: ${e.path}`);
      continue;
    }
    if (st.isSymbolicLink()) { errors.push(`symlink not allowed: ${e.path}`); continue; }
    if (!st.isFile()) { errors.push(`not a regular file: ${e.path}`); continue; }
    if (st.size !== e.bytes) { errors.push(`size mismatch: ${e.path} (${st.size} != ${e.bytes})`); continue; }
    if (hash) {
      const got = await sha256File(target);
      if (got !== e.sha256) { errors.push(`sha256 mismatch: ${e.path}`); continue; }
    }
    checked++;
  }
  return {ok: errors.length === 0, checked, total: entries.length, errors};
}

// --- Whole-project generation ----------------------------------------------

export async function generateInstaller({manifest, packageFolder, outDir, mode, buildId, outFileWin,engineFile,enableTestInstall=false,testFault}) {
  if(enableTestInstall&&mode!=='test')throw Error('Runnable transaction preview currently requires test identity');
  if(testFault&&(!enableTestInstall||mode!=='test'))throw Error('Fault injection requires runnable test identity');
  parseManifest(manifest);
  const version = manifest.version;
  const identity = resolveIdentity({mode, version, buildId});
  const entries = buildFileEntries(manifest);
  for(const path of REQUIRED_RUNTIME_FILES)if(!entries.some(e=>e.path===path))throw Error('Missing required runtime file: '+path);

  await mkdir(outDir, {recursive: true});
  if(!engineFile)throw Error('A compiled installer engine is required');
  const engineBytes=await readFile(engineFile),engineSha256=createHash('sha256').update(engineBytes).digest('hex');
  await writeFile(join(outDir,'InstallEngine.exe'),engineBytes);
  await writeFile(join(outDir,'install-request.json'),JSON.stringify({schema:1,identity,engineSha256,files:entries.map(({path,bytes,sha256})=>({path,bytes,sha256})),...(testFault?{testFault}:{})},null,2));
  const installList = renderInstallList(entries, {baseVar: '$StageDir',errorLabel:'extract_failed'});
  const uninstallList = renderUninstallList(entries, {baseExpr: '$PayloadDir'});
  await writeFile(join(outDir, 'install-files.generated.nsh'), installList);
  await writeFile(join(outDir, 'uninstall-files.generated.nsh'), uninstallList);

  const srcWin = wslToWin(resolve(packageFolder)) || resolve(packageFolder);
  const template = await readFile(join(INSTALLER_SRC, 'backseat.nsi.in'), 'utf8');
  const nsi = renderNsi(template, Object.fromEntries(Object.entries({
    ENABLE_TEST_INSTALL:enableTestInstall?1:0,
    APP_NAME: identity.appName,
    APP_ID: identity.appId,
    APP_VERSION: identity.version,
    BUILD_ID: identity.buildId,
    BUILD_MODE: identity.marker,
    PAYLOAD_DIRNAME: identity.payloadDirname,
    INSTALL_SUBDIR: identity.installSubdir,
    SHORTCUT_GROUP: identity.shortcutGroup,
    REG_UNINSTALL_KEY: identity.regUninstallKey,
    PUBLISHER: identity.publisher,
    EXE_NAME: identity.exeName,
    UNINSTALLER_NAME: identity.uninstallerName,
    BACKSEAT_SRC: srcWin,
    ESTIMATED_SIZE_KB: estimatedSizeKb(entries),
    OUTFILE: outFileWin,
  }).map(([key,value])=>[key,['BACKSEAT_SRC','OUTFILE'].includes(key)?nsiCompilerPath(value):escapeNsiLiteral(value)])));
  await writeFile(join(outDir, 'backseat.nsi'), nsi);

  const meta = {
    generatedFrom: 'scripts/build-installer.mjs',
    mode: identity.marker,
    identity: {
      appName: identity.appName, appId: identity.appId, installSubdir: identity.installSubdir,
      shortcutGroup: identity.shortcutGroup, regUninstallKey: identity.regUninstallKey,
      publisher: identity.publisher, payloadDirname: identity.payloadDirname,
    },
    version, buildId: identity.buildId, files: entries.length,
    estimatedSizeKb: estimatedSizeKb(entries), signed: false,
    claims: {signed: false, retailReady: false, steamReviewed: false, reviewOnly: !enableTestInstall, runnable: enableTestInstall},
    outFile: outFileWin, packageSource: srcWin,
  };
  await writeFile(join(outDir, 'build-metadata.json'), JSON.stringify(meta, null, 2));
  return {identity, entries, meta, outDir};
}

// --- Synthetic fixture (tiny, verifiable, compilable) ----------------------

// Builds a tiny package folder + matching manifest so the toolchain and the
// generated NSIS can be verified/compiled without the real 1.5 GB payload.
export async function createSyntheticPackage(dir) {
  const files = [
    ...REQUIRED_RUNTIME_FILES,
    'resources/app/index.txt',
    'locales/en-US.txt',
    'assets/cash$0.txt',
    'assets/한글 folder/안내.txt',
  ];
  const manifestFiles = [];
  for (const rel of files) {
    const target = join(dir, ...rel.split('/'));
    await mkdir(dirname(target), {recursive: true});
    const body = `synthetic ${rel}\n`;
    await writeFile(target, body);
    manifestFiles.push({path: rel, bytes: Buffer.byteLength(body), sha256: createHash('sha256').update(body).digest('hex')});
  }
  const manifest = {version: '0.0.0-fixture', builtAt: '1970-01-01T00:00:00.000Z', platform: 'win32-x64', signed: false, files: manifestFiles};
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return {folder: dir, manifest};
}

// --- makensis discovery + compile (never executes the output) --------------

export async function findMakensis() {
  const candidates = [
    process.env.MAKENSIS,
    join(ROOT, 'artifacts', 'installer-tools', 'nsis', 'makensis.exe'),
    join(ROOT, 'artifacts', 'installer-tools', 'nsis', 'Bin', 'makensis.exe'),
  ].filter(Boolean);
  for (const c of candidates) {
    try { await stat(c); return c; } catch {}
  }
  return null;
}

function run(bin, args, cwd) {
  return new Promise(done => {
    let out = '';
    const child = spawn(bin, args, {cwd, windowsHide: true});
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (out += d));
    child.on('error', e => done({code: -1, out: out + '\n' + e.message}));
    child.on('exit', code => done({code, out}));
  });
}

// --- CLI --------------------------------------------------------------------

async function main(argv) {
  const arg = (name, def) => {
    const hit = argv.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : def;
  };
  const flag = name => argv.includes(`--${name}`);

  const mode = arg('mode', 'production');
  const fixture = flag('fixture');
  const doHash = !flag('skip-hash');
  const compile = flag('compile');
  if (compile && !doHash) throw new Error('Compilation requires package SHA-256 verification; --skip-hash cannot be combined with --compile.');
  const outDir = resolve(arg('out', join(ROOT, 'artifacts', fixture ? 'claude-installer-fixture' : 'claude-installer-build')));

  let packageFolder, manifest, buildId;
  if (fixture) {
    const fxDir = join(outDir, 'fixture-pkg');
    await mkdir(fxDir, {recursive: true});
    ({folder: packageFolder, manifest} = await createSyntheticPackage(fxDir));
    buildId = arg('build-id', 'fixture');
  } else {
    const latest = JSON.parse(await readFile(join(ROOT, 'artifacts', 'latest-package.json'), 'utf8'));
    packageFolder = process.platform==='win32'?arg('package',latest.folder):winToWsl(arg('package',latest.folder));
    const manifestPath = process.platform==='win32'?arg('manifest',latest.manifest):winToWsl(arg('manifest',latest.manifest));
    manifest = JSON.parse((await readFile(manifestPath, 'utf8')).replace(/^﻿/, ''));
    buildId = arg('build-id', deriveBuildId(manifest.builtAt));
  }

  const entries = buildFileEntries(parseManifest(manifest));
  const verify = await verifyPackage(packageFolder, entries, {hash: doHash});
  if (!verify.ok) {
    console.error(`package verification FAILED (${verify.errors.length} problems):`);
    for (const e of verify.errors.slice(0, 20)) console.error('  - ' + e);
    process.exitCode = 1;
    return;
  }

  const outFileWin = (wslToWin(join(outDir, 'Nagneon-Setup.exe')) || join(outDir, 'Nagneon-Setup.exe'));
  const engine=await buildInstallerEngine(join(outDir,'engine-build'));
  const enableTestInstall=flag('enable-test-install');
  const {identity, meta} = await generateInstaller({manifest, packageFolder, outDir, mode, buildId, outFileWin,engineFile:engine.file,enableTestInstall,testFault:arg('test-fault')});

  const result = {
    ok: true, mode, reviewOnly: !enableTestInstall, runnable: enableTestInstall, verifiedFiles: verify.checked, hashed: doHash,
    identity: meta.identity, outDir, outFile: outFileWin, compiled: false, compiler: null,
  };

  if (compile) {
    const makensis = await findMakensis();
    if (!makensis) {
      result.compiler = 'unavailable';
      result.ok = false;
      process.exitCode = 1;
      console.error('makensis not found; requested compile failed (see docs/INSTALLER.md).');
    } else {
      const nsiWin = wslToWin(join(outDir, 'backseat.nsi')) || join(outDir, 'backseat.nsi');
      const r = await run(makensis, ['/INPUTCHARSET', 'UTF8', nsiWin], outDir);
      result.compiler = makensis;
      result.compiled = r.code === 0;
      result.compileExitCode = r.code;
      await writeFile(join(outDir, 'makensis-output.log'), r.out);
      if (r.code !== 0) { result.ok = false; console.error('makensis failed; see makensis-output.log'); process.exitCode = 1; }
    }
  }

  await writeFile(join(outDir,'build-result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result, null, 2));
}

export function deriveBuildId(builtAt) {
  // Throws (rather than inventing a colliding fallback) if builtAt cannot yield
  // a path-safe id — the operator must then pass --build-id explicitly.
  const raw = String(builtAt || '').replace(/[:.]/g, '-').replace(/[^0-9A-Za-z._-]/g, '');
  return validateBuildId(raw);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(e => { console.error(e.stack || String(e)); process.exitCode = 1; });
}
