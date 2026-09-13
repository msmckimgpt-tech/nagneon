# BACKSEAT per-user installer engine

2026-09-13. Windows x64 / .NET Framework, unsigned development build.
NSIS extracts files into a private temporary folder and invokes this engine.
The production identity remains disabled. docs/INSTALLER.md is the release
status; executable fixtures in artifacts are not the BACKSEAT app.

## Current acceptance

The parent ran isolated Windows transactions after the bounded Claude audit
finished (session23220, exit0). Current evidence:

- artifacts/latest-installer-unit-test.json: 104 passed, 0 failed, including
  an actual directory junction. The permanent test source is
  test/installer/EngineTests.cs; scripts/test-installer-engine.mjs compiles it
  with current engine sources and verifies their hashes before/after.
- artifacts/latest-installer-guards-test.json: 51 real Windows checks of stored
  state/journals, request aliases, unknown staging files, registry/shortcut
  ownership, junctions, metadata locks and read-only files. Refusal tests
  compare target file hashes and TEST publication before/after all operations.
- artifacts/latest-installer-transaction-test.json and
  installer-ownership-transactions-current.log: 18 actual engine checks, including
  full hashes, app/direct-exe/data/uninstaller locks, read-only failure, argument
  forwarding, updates, five rollback faults, three crash/recover faults,
  HKCU/Start Menu state, and preservation of an unknown user file.
- artifacts/latest-installer-nsis-test.json: actual NSIS install/refresh,
  busy failure and normal temporary-copy uninstall. Unicode/dollar paths,
  fresh reports, payload hashes and external state checked. Four flows passed.
  Latest log: installer-ownership-nsis-current.log.

The above fault suites use small synthetic packages with a real Windows
fixture executable. Additionally, artifacts/latest-full-installer-test.json
records full 1.6 GB/2444-file installation, all file hashes, native installed
launcher startup/normal close, delivered speech/sound/runtime plus two real
Astra low calls, and normal NSIS uninstall preserving a user file. Runtime
modules are extracted from the installed ASAR for plain Node; native launch
uses the original installed ASAR. See docs/INSTALLER.md for exact scope and
remaining UI findings. This is not fresh Windows acceptance, arbitrary failure
recovery, signing or retail readiness.

The audit's claim that changed launcher/uninstaller backup restoration and
uninstall partial-failure ordering had no defects was **disproved by the
parent's actual tests**. Preserve the original audit output as review evidence,
not acceptance. The previous README is preserved as
artifacts/installer-engine-readme-before-parent-acceptance.md.

## Build and CLI

scripts/build-installer-engine.mjs compiles all *.cs files with Framework csc.exe,
/target:winexe /platform:x64, and references System.Web.Extensions.dll,
Microsoft.CSharp.dll and System.Windows.Forms.dll. It records compiler
exit/output and source hashes before and after compilation. The Windows GUI
subsystem avoids a launcher console flash; actual parent process tests also
received the CLI stdout JSON from this build.

    InstallEngine.exe install REQUEST_JSON SOURCE_DIRECTORY INSTALL_ROOT NEW_UNINSTALLER_EXE REPORT_JSON
    InstallEngine.exe uninstall INSTALL_ROOT EXPECTED_APP_ID REPORT_JSON
    InstallEngine.exe recover INSTALL_ROOT EXPECTED_APP_ID REPORT_JSON
    <INSTALL_ROOT>\BACKSEAT Launcher.exe [application arguments...]

The installed launcher forwards all arguments, including operation-like words,
quoted text, empty values, Unicode and trailing backslashes. It holds the root
mutex for the child lifetime. Profile semantics remain the app's job. The engine
checks executable size on launch; full hashes are verified during installation
and refresh, not every launch.

Exit codes: 0 success, 2 usage, 3 validation, 4 ownership, 5 busy, 6 rolled back,
7 unrecoverable/needs inspection, 8 launch failure, 79 intentional test crash.
Reports contain ok, operation, root, error, current, previous, recovered,
leftovers and steps. Optional fields may be absent. Direct CLI report writes
are best-effort; NSIS requires the fresh private report and separately reports
diagnostic export failure. An intentional crash exits79 without a final report.

## Transaction and control backups

State/journal schema1 and the JS request identity contract are unchanged. The
required payload includes the app, Codex, Python, speech worker/model and sound
worker/model (seven mandatory files, plus every manifest-listed file).

The journal precedes staging. An update backs up the previous stable launcher
and uninstaller in .backseat/controls-txn-<guid> with durable writes and a SHA256
manifest. The journal enters controls-backed-up before overwriting either file.
State lastTxnId is the commit point. Before commit, recovery restores both
control files from verified backups using per-file atomic replacement, then
republishes the prior state. After commit, recovery keeps the new version and
cleans backups. Failed restoration retains the journal and returns failure.
Older journals that reached control replacement without these backups can
require manual recovery; do not claim byte-exact restoration for those cases.

Uninstall locks the launcher, uninstaller and every tracked payload file before
deleting. Delete disposition errors trigger cancellation while handles remain
open. If cancellation cannot be confirmed or owned files remain, failure is
reported and control metadata retained. This is not an atomic transaction
across NTFS, registry and shortcuts. Unknown files are retained/reported.

## Stored ownership and preservation

StoredValidation checks the complete fixed identity, root/control/stage/payload
paths, transaction IDs, phases, version/build relationships, manifests and
state/journal relationships before mutation. Historical versions require their
own executable; only new installation requests require today's seven runtime
files. File/directory aliases and case aliases are rejected. State and journal
reads are bounded regular-file reads, and Windows sharing violations return
busy (5). Unique CreateNew metadata temporaries preserve unknown legacy .tmp
files, and foreign/corrupt state backups are rejected before installation.

Staging cleanup has no recursive deletion. It removes only manifest-listed
files and then empty directories; unknown notes are retained. A preexisting
unowned stage is refused. Existing registry and shortcut resources must belong
to this exact app/root before publication or deletion. Owned shortcut custom
arguments survive updates. Uninstall validates and locks state and backup
metadata before deleting payloads. The launcher acquires the root mutex before
reading state, then holds it through the launched child's lifetime.

## Remaining gates before general release

1. The empty control-directory interruption gap now permits a retry without
   deleting anything. The file-only suite has 140 passing checks, including an
   actual child-process interruption and preservation of unknown data/junctions.
   See docs/INSTALLER-BOOTSTRAP-RECOVERY.md for current evidence and limits.
   Partial initial-journal temporary writes still fail closed. Test the remaining
   first-install faults and actual power loss; managed file flush does not
   separately fsync directory entries. Earlier full installation evidence above
   predates this change; external publication/NSIS tests have not been rerun.
2. Late publication/metadata failures during uninstall; locks and read-only
   metadata are tested before deletion, not every post-deletion combination.
3. Image-section races, hostile concurrent path swaps, Windows short aliases and
   simultaneous Windows sessions. The root mutex is currently session-local.
4. Long paths, disk exhaustion, corrupted control backups, reparse/mount variants,
   interruption during staging/control restore, visible NSIS
   UI, new Windows/runtime dependencies, signing and Steam review.
5. Recovering a stage with unknown notes preserves them, but currently refuses
   the same build's retry until that stage is dealt with. This is conservative
   preservation, not seamless recovery UX.

No personal profiles, audio recordings, credentials or Steam saves were test
data. The live user app remained running unchanged during this installer-only
stage. The audit's no-HKCU rule applied only to that delegated task; the parent's
isolated TEST publication tests are authorized.
