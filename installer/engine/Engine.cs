// installer/engine/Engine.cs
// ---------------------------------------------------------------------------
// The per-user installer transaction engine: install / uninstall / recover.
//
// Transaction model (honest scope — NOT a single atomic multi-resource txn):
//   * A durable JOURNAL (pending.json) is written before anything user-visible
//     is published, and is updated as each resource is published.
//   * The single COMMIT point is state.json's lastTxnId, written atomically
//     (fsync + File.Replace) only when the whole publication is in place.
//   * RECOVERY compares journal.txnId to state.lastTxnId:
//        equal  -> the commit happened -> ROLL FORWARD (idempotent re-publish,
//                  clean staging, drop journal).
//        differ -> the commit did NOT happen -> ROLL BACK (remove the
//                  uncommitted new payload + staging, restore prior publication,
//                  drop journal). state.json is untouched, so it is still the
//                  prior truth.
//   * If recovery cannot finish, the journal is retained and failure reported;
//     a launch refuses while an unresolved pending exists.
//
// Filesystem layout of an owned install root:
//   <root>\BACKSEAT Launcher.exe          stable launcher (this engine binary)
//   <root>\Uninstall BACKSEAT ....exe      NSIS uninstaller (placed by engine)
//   <root>\app\<version>+<buildId>\...     immutable versioned payload
//   <root>\app\.pending-<buildId>\...      staging (transient)
//   <root>\.backseat\state.json[.bak]      committed state (+ backup)
//   <root>\.backseat\pending.json          journal (iff unresolved)
// ---------------------------------------------------------------------------

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;

namespace Backseat.Installer
{
    internal sealed class ResolveResult
    {
        public bool Resolved;
        public string Error;
        public static ResolveResult Ok() { var r = new ResolveResult(); r.Resolved = true; return r; }
        public static ResolveResult Fail(string e) { var r = new ResolveResult(); r.Resolved = false; r.Error = e; return r; }
    }

    internal sealed class Engine
    {
        private const string AppSubdir = "app";

        // ===================================================================
        //  INSTALL
        // ===================================================================
        public int Install(string requestPath, string sourceArg, string rootArg,
            string newUninstallerExe, OpReport report)
        {
            if (!File.Exists(requestPath))
                throw EngineError.Validation("REQUEST_JSON not found: " + PathSafety.Clip(requestPath));
            InstallRequest req = InstallRequest.Parse(File.ReadAllText(requestPath));
            report.Step("validated-request");
            Identity id = req.Identity;

            // The running engine must be exactly the binary the request was built
            // for (its SHA-256 is computed by the builder). This also becomes the
            // stable launcher, so the launcher hash equals engineSha256 too.
            string self = SelfPath();
            string selfHash = Hashing.Sha256File(self);
            if (!string.Equals(selfHash, req.EngineSha256, StringComparison.OrdinalIgnoreCase))
                throw EngineError.Validation("engine hash mismatch (running binary != request.engineSha256)");
            report.Step("verified-engine-hash");

            string root = PathSafety.NormalizeAbsoluteLocalDir(rootArg, "INSTALL_ROOT");
            report.Root = root;
            string source = PathSafety.NormalizeAbsoluteLocalDir(sourceArg, "SOURCE_DIRECTORY");
            if (!Directory.Exists(source))
                throw EngineError.Validation("SOURCE_DIRECTORY not found: " + PathSafety.Clip(source));
            var reparseCache = new HashSet<string>();
            PathSafety.AssertNoReparseInChain(source, reparseCache);
            PathSafety.AssertNoReparseInChain(root, reparseCache);

            string uninSrc = ValidateExistingFile(newUninstallerExe, "NEW_UNINSTALLER_EXE", reparseCache);
            report.Step("validated-paths");

            using (var mx = new RootMutex(root))
            {
                if (!mx.TryAcquire(0))
                    throw EngineError.Busy("another BACKSEAT install/uninstall/launch is in progress for this root");
                report.Step("acquired-mutex");
                return InstallLocked(req, id, source, root, uninSrc, reparseCache, report);
            }
        }

        private int InstallLocked(InstallRequest req, Identity id, string source, string root,
            string uninSrc, HashSet<string> reparseCache, OpReport report)
        {
            var store = new StateStore(root);
            AssertPublicationOwnership(id.RegUninstallKey, id.AppId, id.ShortcutGroup, id.AppName, root);
            store.ValidateBackup(id.AppId);

            // Resolve any pending transaction first (could be our own crashed run).
            if (store.HasJournal())
            {
                Journal jr0 = store.ReadJournal();
                if (!string.Equals(jr0.AppId, id.AppId, StringComparison.Ordinal) ||
                    !SamePath(jr0.Root, root))
                    throw EngineError.Ownership("pending transaction belongs to a different identity/root; refusing");
                ResolveResult rr = ResolvePendingLocked(store, root, report);
                if (!rr.Resolved)
                    throw EngineError.Unrecoverable("unresolved pending transaction; run recover first: " + rr.Error);
            }

            EnsureOwnedOrClaimable(store, id, root, report);
            store.EnsureControlDir();

            InstalledState prior = store.ReadState();

            string appDir = Path.Combine(root, AppSubdir);
            string payloadDir = Path.Combine(appDir, id.PayloadDirname);
            string stageDir = Path.Combine(appDir, ".pending-" + id.BuildId);
            if (!PathSafety.IsInsideRoot(root, payloadDir) || !PathSafety.IsInsideRoot(root, stageDir))
                throw EngineError.Validation("computed payload/stage path escapes root");

            // No journal claims an existing stage after pending recovery above.
            // A familiar name alone never grants permission to delete its data.
            if (Directory.Exists(stageDir) || File.Exists(stageDir))
                throw EngineError.Ownership("unowned staging path already exists; preserve it and choose a new build or inspect it");

            bool payloadPresent = Directory.Exists(payloadDir);
            if (payloadPresent)
            {
                // Immutable payload already exists (so the root is already owned — a
                // same-build refresh, never a first install): it must match the
                // manifest EXACTLY (never trust the exe alone). This check is
                // read-only and runs BEFORE the journal, so refusing a corrupt
                // same-build payload mutates nothing and needs no rollback.
                if (PathSafety.IsReparsePoint(payloadDir))
                    throw EngineError.Ownership("existing payload dir is a reparse point");
                string verr = VerifyPayloadDir(payloadDir, req.Files, root);
                if (verr != null)
                    throw EngineError.Validation("existing same-build payload failed integrity (" + verr +
                        "); manual repair or recover required");
                report.Step("same-build-verified");
            }

            // Durable pending transaction is written BEFORE any staging or
            // publication. Writing it this early (rather than after staging) means a
            // crash OR a validation error at ANY later point — including part-way
            // through staging a first install — always leaves a recoverable journal.
            // A fresh/empty root can then be reclaimed by the next install/recover
            // (which rolls the journal back and tidies the root) instead of being
            // permanently refused as an unrecognised non-empty directory. The
            // journal write itself is atomic (temp + fsync + rename).
            var jr = new Journal();
            jr.TxnId = NewTxnId();
            jr.Op = "install";
            jr.Phase = payloadPresent ? "promoted" : "staging";
            jr.AppId = id.AppId; jr.AppName = id.AppName; jr.Marker = id.Marker;
            jr.RegUninstallKey = id.RegUninstallKey; jr.ShortcutGroup = id.ShortcutGroup;
            jr.UninstallerName = id.UninstallerName; jr.ExeName = id.ExeName; jr.Publisher = id.Publisher;
            jr.Root = root; jr.ControlDir = store.ControlDir; jr.StageDir = stageDir; jr.NewPayloadDir = payloadDir;
            jr.Target = req.ToVersionRecord();
            jr.FirstInstall = (prior == null);
            jr.PriorPayloadDirname = (prior != null && prior.Current != null) ? prior.Current.PayloadDirname : null;
            store.WriteJournal(jr);
            report.Step("journaled");

            InstalledState next = BuildNextState(id, req, root, prior);
            bool committed = false;
            try
            {
                // Fresh staging happens INSIDE the transaction try, so a failure
                // here rolls back — removing staging and, for a first install,
                // tidying the freshly-claimed root — rather than leaving orphans
                // that would make the root unclaimable on the next attempt.
                if (!payloadPresent)
                {
                    Directory.CreateDirectory(stageDir);
                    StageAndVerify(source, stageDir, req.Files, root, reparseCache, report);
                    report.Step("staged-verified");
                }

                MaybeFault(req, FaultPoints.ThrowAfterStage);

                if (!payloadPresent)
                {
                    Directory.Move(stageDir, payloadDir);
                    jr.Phase = "promoted"; store.WriteJournal(jr);
                    report.Step("promoted");
                    MaybeFault(req, FaultPoints.ThrowAfterPromote);
                }

                string launcherPath = Path.Combine(root, Identity.LauncherName);
                string uninstallerPath = Path.Combine(root, id.UninstallerName);
                ControlBackups.Prepare(root, jr);
                jr.Phase = "controls-backed-up"; store.WriteJournal(jr);
                PlaceControlBinary(SelfPath(), launcherPath);
                PlaceControlBinary(uninSrc, uninstallerPath);
                jr.Phase = "files"; store.WriteJournal(jr);
                report.Step("placed-launcher-and-uninstaller");

                string lnk = ShortcutOps.ShortcutPath(id.ShortcutGroup, id.AppName);
                ShortcutOps.Create(lnk, launcherPath, root, id.AppName);
                jr.Phase = "shortcut"; store.WriteJournal(jr);
                report.Step("published-shortcut");
                MaybeFault(req, FaultPoints.ThrowAfterShortcut);
                MaybeFault(req, FaultPoints.CrashAfterShortcut);

                RegistryOps.WriteUninstallEntry(next, root, launcherPath, uninstallerPath,
                    EstimatedSizeKb(req.Files));
                jr.Phase = "registry"; store.WriteJournal(jr);
                report.Step("published-registry");
                MaybeFault(req, FaultPoints.ThrowAfterRegistry);

                MaybeFault(req, FaultPoints.ThrowBeforeState);
                MaybeFault(req, FaultPoints.CrashBeforeState);

                next.LastTxnId = jr.TxnId;
                store.CommitState(next);
                committed = true;
                report.Step("committed-state");

                MaybeFault(req, FaultPoints.CrashAfterState);
            }
            catch (Exception ex)
            {
                if (committed) throw; // commit is the last statement; should not happen
                bool rolled = TryRollbackUncommitted(store, jr, root, report);
                report.Ok = false;
                report.Error = CleanMessage(ex);
                report.Recovered = rolled;
                return rolled ? CodeOf(ex, ExitCodes.RolledBack) : ExitCodes.Unrecoverable;
            }

            // Committed. Journal cleanup + best-effort prune are post-commit and
            // must never turn a committed install into a failure.
            try { ControlBackups.Cleanup(root, jr); store.DeleteJournal(); report.Step("cleaned-journal"); }
            catch (Exception) { report.Step("journal-cleanup-deferred"); }
            try { PostCommitPrune(store, next, root, report); }
            catch (Exception) { report.Step("prune-deferred"); }

            report.Ok = true;
            report.Current = next.Current.ToBrief();
            report.Previous = next.Previous != null ? next.Previous.ToBrief() : null;
            return ExitCodes.Success;
        }

        // ===================================================================
        //  UNINSTALL
        // ===================================================================
        public int Uninstall(string rootArg, string expectedAppId, OpReport report)
        {
            string root = PathSafety.NormalizeAbsoluteLocalDir(rootArg, "INSTALL_ROOT");
            report.Root = root;
            var cache = new HashSet<string>();
            PathSafety.AssertNoReparseInChain(root, cache);

            using (var mx = new RootMutex(root))
            {
                if (!mx.TryAcquire(0))
                    throw EngineError.Busy("another BACKSEAT install/uninstall/launch is in progress for this root");
                report.Step("acquired-mutex");

                var store = new StateStore(root);
                InstalledState st = store.ReadState();
                if (st == null)
                    throw EngineError.Ownership("no owned install state at root; refusing to modify");
                if (!string.Equals(st.AppId, expectedAppId, StringComparison.Ordinal))
                    throw EngineError.Ownership("state appId does not match EXPECTED_APP_ID; refusing");
                if (!SamePath(st.InstallRoot, root))
                    throw EngineError.Ownership("state install root mismatch; refusing");
                report.Step("validated-ownership");

                if (store.HasJournal())
                {
                    ResolveResult rr = ResolvePendingLocked(store, root, report);
                    if (!rr.Resolved)
                        throw EngineError.Unrecoverable("unresolved pending transaction; run recover first: " + rr.Error);
                    st = store.ReadState();
                    if (st == null)
                    {
                        // pending was a first-install that rolled back: nothing owned remains
                        report.Ok = true; report.Recovered = true;
                        report.Step("nothing-to-uninstall-after-rollback");
                        return ExitCodes.Success;
                    }
                }

                return UninstallLocked(store, st, root, report);
            }
        }

        private int UninstallLocked(StateStore store, InstalledState st, string root, OpReport report)
        {
            AssertPublicationOwnership(st.RegUninstallKey, st.AppId, st.ShortcutGroup, st.AppName, root);
            store.ValidateBackup(st.AppId);
            var metadataPaths = new[] { store.StatePath, store.BakPath };
            foreach (string path in metadataPaths)
                if (File.Exists(path) && (File.GetAttributes(path) & FileAttributes.ReadOnly) != 0)
                    throw EngineError.Busy("install metadata is read-only; nothing removed");
            using (var metadata = new DeleteLockBatch())
            {
                if (!metadata.TryOpenAll(metadataPaths)) throw EngineError.Busy("install metadata is locked; nothing removed");
                return UninstallPayload(store, st, root, report, metadata);
            }
        }

        private int UninstallPayload(StateStore store, InstalledState st, string root, OpReport report, DeleteLockBatch metadata)
        {
            // Gather ALL owned files across ALL owned versions + the launcher.
            var ownedFiles = new List<string>();
            var exePaths = new List<string>();
            foreach (VersionRecord v in st.AllVersions())
            {
                string pdir = Path.Combine(Path.Combine(root, AppSubdir), v.PayloadDirname);
                if (!PathSafety.IsInsideRoot(root, pdir))
                    throw EngineError.Validation("owned payload path escapes root: " + PathSafety.Clip(pdir));
                if (PathSafety.IsReparsePoint(pdir))
                    throw EngineError.Ownership("owned payload dir is a reparse point: " + PathSafety.Clip(pdir));
                foreach (FileEntry f in v.Files)
                    ownedFiles.Add(PathSafety.CombineInsideRoot(pdir, f.Path, "owned-file"));
                exePaths.Add(PathSafety.CombineInsideRoot(pdir, v.ExeName, "owned-exe"));
            }
            string launcherPath = Path.Combine(root, Identity.LauncherName);
            string uninstallerPath = Path.Combine(root, st.UninstallerName);
            ownedFiles.Add(launcherPath);
            ownedFiles.Add(uninstallerPath);
            exePaths.Add(launcherPath);

            // Informational running-process scan (the lock batch is authoritative).
            RunningScan scan = ProcessScan.ScanForOwnedExes(exePaths);

            // Preflight: exclusive delete-on-close handles on EVERY owned file.
            // All open -> nothing is locked and nothing new can be started while we
            // hold them; closing deletes. Any lock -> cancel all, delete nothing.
            using (var batch = new DeleteLockBatch())
            {
                bool allOpen = batch.TryOpenAll(ownedFiles);
                if (!allOpen || scan.AnyRunning)
                {
                    report.Ok = false;
                    report.Recovered = false;
                    report.Error = scan.AnyRunning
                        ? "app appears to be running (" + string.Join(", ", scan.Details.ToArray()) +
                          "); nothing was removed. Close the app and re-run uninstall."
                        : "an owned file is locked (" +
                          (batch.LockedPath != null ? Path.GetFileName(batch.LockedPath) : "unknown") +
                          "); nothing was removed. Close the app and re-run uninstall.";
                    report.Current = st.Current != null ? st.Current.ToBrief() : null;
                    return ExitCodes.Busy;
                }
                report.Step("preflight-locked-all-owned-files");
                List<string> stillThere = batch.CommitDeletions();
                report.Step("deleted-owned-files");
                foreach (string p in stillThere) report.AddLeftover(RelOrName(root, p));
                if (stillThere.Count > 0)
                {
                    report.Ok = false;
                    report.Error = "owned files remain after deletion; install metadata retained for retry";
                    return ExitCodes.Unrecoverable;
                }
            }

            // Remove now-empty owned dirs (deepest-first). Non-empty dirs with
            // unknown/user files survive and are reported as leftovers.
            foreach (VersionRecord v in st.AllVersions())
                RemoveEmptyTreeWithin(Path.Combine(Path.Combine(root, AppSubdir), v.PayloadDirname), root);

            // Start Menu shortcut (only if it still points at our launcher) + group.
            string lnk = ShortcutOps.ShortcutPath(st.ShortcutGroup, st.AppName);
            if (ShortcutOps.DeleteIfOwned(lnk, launcherPath))
            {
                report.Step("removed-shortcut");
                TryRemoveEmptyDir(ShortcutOps.GroupDir(st.ShortcutGroup));
            }
            else if (File.Exists(lnk))
            {
                report.AddLeftover("startmenu:" + st.AppName + ".lnk (target not owned)");
            }

            // HKCU uninstall entry (owned validation).
            if (RegistryOps.DeleteUninstallEntryIfOwned(st.RegUninstallKey, st.AppId, root))
                report.Step("removed-registry");
            else
                report.AddLeftover("hkcu:" + st.RegUninstallKey + " (not owned)");

            // Uninstaller binary (the running uninstall engine is a temp copy).
            TryDeleteFile(uninstallerPath);

            // Control metadata LAST so an interrupted uninstall stays re-runnable.
            if (metadata.CommitDeletions().Count > 0)
                throw EngineError.Unrecoverable("install metadata could not be removed completely");
            report.Step("removed-control-metadata");
            TryRemoveEmptyDir(store.ControlDir);
            TryRemoveEmptyDir(Path.Combine(root, AppSubdir));

            CollectLeftovers(root, report);
            TryRemoveEmptyDir(root);

            report.Ok = true;
            report.Recovered = false;
            report.Current = null;
            return ExitCodes.Success;
        }

        // ===================================================================
        //  RECOVER
        // ===================================================================
        public int Recover(string rootArg, string expectedAppId, OpReport report)
        {
            string root = PathSafety.NormalizeAbsoluteLocalDir(rootArg, "INSTALL_ROOT");
            report.Root = root;
            var cache = new HashSet<string>();
            PathSafety.AssertNoReparseInChain(root, cache);

            using (var mx = new RootMutex(root))
            {
                if (!mx.TryAcquire(0))
                    throw EngineError.Busy("another BACKSEAT install/uninstall/launch is in progress for this root");
                report.Step("acquired-mutex");

                var store = new StateStore(root);
                InstalledState st = store.ReadState();
                if (st != null)
                {
                    if (!string.Equals(st.AppId, expectedAppId, StringComparison.Ordinal))
                        throw EngineError.Ownership("state appId does not match EXPECTED_APP_ID; refusing");
                    if (!SamePath(st.InstallRoot, root))
                        throw EngineError.Ownership("state install root mismatch; refusing");
                }

                if (!store.HasJournal())
                {
                    report.Ok = true;
                    report.Recovered = false;
                    if (st != null)
                    {
                        report.Current = st.Current != null ? st.Current.ToBrief() : null;
                        report.Previous = st.Previous != null ? st.Previous.ToBrief() : null;
                    }
                    report.Step("no-pending-transaction");
                    return ExitCodes.Success;
                }

                Journal jr = store.ReadJournal();
                if (!string.Equals(jr.AppId, expectedAppId, StringComparison.Ordinal))
                    throw EngineError.Ownership("journal appId does not match EXPECTED_APP_ID; refusing");
                if (!SamePath(jr.Root, root))
                    throw EngineError.Ownership("journal root mismatch; refusing");

                ResolveResult rr = ResolvePendingLocked(store, root, report);
                if (!rr.Resolved)
                {
                    report.Ok = false;
                    report.Recovered = false;
                    report.Error = "recovery could not finish; journal retained: " + rr.Error;
                    return ExitCodes.Unrecoverable;
                }

                report.Ok = true;
                report.Recovered = true;
                InstalledState st2 = store.ReadState();
                if (st2 != null)
                {
                    report.Current = st2.Current != null ? st2.Current.ToBrief() : null;
                    report.Previous = st2.Previous != null ? st2.Previous.ToBrief() : null;
                }
                return ExitCodes.Success;
            }
        }

        // Resolve one pending transaction. Roll forward if committed, else roll
        // back. Returns Ok on success; Fail (journal retained) otherwise.
        private ResolveResult ResolvePendingLocked(StateStore store, string root, OpReport report)
        {
            Journal jr = store.ReadJournal();
            if (jr == null) return ResolveResult.Ok();
            InstalledState st = store.ReadState();
            StoredValidation.Relationship(jr, st, root);
            AssertPublicationOwnership(jr.RegUninstallKey, jr.AppId, jr.ShortcutGroup, jr.AppName, root);

            // Fail-closed identity/root guard BEFORE any recovery write. This is the
            // single choke point every rollback / roll-forward passes through, so
            // enforcing it here covers install, uninstall AND recover uniformly (the
            // uninstall path validated only state, not the journal). A journal whose
            // root does not match, or whose identity does not match the committed
            // state, is refused outright rather than acted upon. Thrown before the
            // try below, so it surfaces as an ownership refusal, not a Fail result.
            if (!SamePath(jr.Root, root))
                throw EngineError.Ownership("pending transaction root mismatch; refusing to recover");
            if (st != null && !string.Equals(jr.AppId, st.AppId, StringComparison.Ordinal))
                throw EngineError.Ownership("pending transaction identity mismatch; refusing to recover");

            bool committed = st != null && st.LastTxnId != null &&
                string.Equals(st.LastTxnId, jr.TxnId, StringComparison.Ordinal);
            try
            {
                if (committed)
                {
                    RepublishResources(st, root);
                    if (!string.IsNullOrEmpty(jr.StageDir) && Directory.Exists(jr.StageDir))
                        RemoveOwnedStage(jr, root);
                    ControlBackups.Cleanup(root, jr);
                    store.DeleteJournal();
                    report.Step("recover-roll-forward");
                }
                else
                {
                    RollbackUncommittedCore(store, jr, root, report);
                    report.Step("recover-roll-back");
                }
                return ResolveResult.Ok();
            }
            catch (Exception e)
            {
                return ResolveResult.Fail(CleanMessage(e));
            }
        }

        // ===================================================================
        //  Transaction helpers
        // ===================================================================
        private bool TryRollbackUncommitted(StateStore store, Journal jr, string root, OpReport report)
        {
            try { RollbackUncommittedCore(store, jr, root, report); return true; }
            catch (Exception e) { report.Step("rollback-failed:" + CleanMessage(e)); return false; }
        }

        private void RollbackUncommittedCore(StateStore store, Journal jr, string root, OpReport report)
        {
            InstalledState prior = store.ReadState(); // committed prior (may be null)
            StoredValidation.Relationship(jr, prior, root);
            AssertPublicationOwnership(jr.RegUninstallKey, jr.AppId, jr.ShortcutGroup, jr.AppName, root);

            // 1) Remove the uncommitted new payload dir, unless it is a version the
            //    committed state still references (e.g. same-build refresh).
            if (!string.IsNullOrEmpty(jr.NewPayloadDir) && Directory.Exists(jr.NewPayloadDir) &&
                jr.Target != null && !IsReferencedByState(prior, jr.Target))
            {
                RemoveVersionFilesStrict(jr.Target, root);
                RemoveEmptyTreeWithin(jr.NewPayloadDir, root);
            }

            // 2) Remove staging.
            if (!string.IsNullOrEmpty(jr.StageDir) && Directory.Exists(jr.StageDir))
                RemoveOwnedStage(jr, root);

            // 3) Restore both stable binaries before republishing old metadata.
            ControlBackups.Restore(root, jr);
            if (prior == null || jr.FirstInstall)
                UnpublishAll(jr, root);
            else
                RepublishResources(prior, root);

            // 4) Drop backups and the journal only after restoration succeeded.
            ControlBackups.Cleanup(root, jr);
            store.DeleteJournal();

            // 5) On a rolled-back first install, tidy empty owned dirs.
            if (prior == null || jr.FirstInstall)
            {
                TryRemoveEmptyDir(Path.Combine(root, AppSubdir));
                TryRemoveEmptyDir(store.ControlDir);
                TryRemoveEmptyDir(root);
            }
        }

        private void EnsureOwnedOrClaimable(StateStore store, Identity id, string root, OpReport report)
        {
            if (!Directory.Exists(root))
            {
                Directory.CreateDirectory(root);
                report.Step("created-fresh-root");
                return;
            }
            if (PathSafety.IsReparsePoint(root))
                throw EngineError.Ownership("install root is a reparse point; refusing");
            if (Directory.GetFileSystemEntries(root).Length == 0)
            {
                report.Step("claimed-empty-root");
                return;
            }
            InstalledState st = store.ReadState();
            if (st == null)
                throw EngineError.Ownership("install root is not empty and carries no BACKSEAT ownership marker; refusing");
            if (!string.Equals(st.AppId, id.AppId, StringComparison.Ordinal))
                throw EngineError.Ownership("install root is owned by a different appId; refusing");
            if (!SamePath(st.InstallRoot, root))
                throw EngineError.Ownership("ownership record install root mismatch; refusing");
            report.Step("validated-existing-ownership");
        }

        private InstalledState BuildNextState(Identity id, InstallRequest req, string root, InstalledState prior)
        {
            var st = new InstalledState();
            st.AppId = id.AppId; st.AppName = id.AppName; st.Marker = id.Marker; st.InstallRoot = root;
            st.RegUninstallKey = id.RegUninstallKey; st.ShortcutGroup = id.ShortcutGroup;
            st.LauncherName = Identity.LauncherName; st.UninstallerName = id.UninstallerName;
            st.ExeName = id.ExeName; st.Publisher = id.Publisher;
            st.Current = req.ToVersionRecord();

            if (prior != null && prior.Current != null &&
                !string.Equals(prior.Current.PayloadDirname, st.Current.PayloadDirname, StringComparison.OrdinalIgnoreCase))
            {
                st.Previous = prior.Current;
                var older = new List<VersionRecord>();
                if (prior.Previous != null) older.Add(prior.Previous);
                older.AddRange(prior.Retained);
                st.Retained = DedupExcept(older, st.Current.PayloadDirname, st.Previous.PayloadDirname);
            }
            else if (prior != null && prior.Current != null)
            {
                // same-build refresh: keep prior previous + retained
                st.Previous = prior.Previous;
                st.Retained = prior.Retained;
            }
            else
            {
                st.Previous = null;
                st.Retained = new List<VersionRecord>();
            }
            return st;
        }

        private static List<VersionRecord> DedupExcept(List<VersionRecord> list, string keepA, string keepB)
        {
            var outp = new List<VersionRecord>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (VersionRecord v in list)
            {
                if (string.Equals(v.PayloadDirname, keepA, StringComparison.OrdinalIgnoreCase)) continue;
                if (string.Equals(v.PayloadDirname, keepB, StringComparison.OrdinalIgnoreCase)) continue;
                if (seen.Add(v.PayloadDirname)) outp.Add(v);
            }
            return outp;
        }

        private void PostCommitPrune(StateStore store, InstalledState next, string root, OpReport report)
        {
            if (next.Retained.Count == 0) return;
            var remaining = new List<VersionRecord>();
            foreach (VersionRecord v in next.Retained)
            {
                if (TryRemoveVersion(v, root)) report.Step("pruned:" + v.PayloadDirname);
                else remaining.Add(v);
            }
            if (remaining.Count != next.Retained.Count)
            {
                next.Retained = remaining;
                store.CommitState(next); // secondary commit reflecting the prune
            }
        }

        private void RepublishResources(InstalledState st, string root)
        {
            AssertPublicationOwnership(st.RegUninstallKey, st.AppId, st.ShortcutGroup, st.AppName, root);
            string launcherPath = Path.Combine(root, Identity.LauncherName);
            string uninstallerPath = Path.Combine(root, st.UninstallerName);
            if (!File.Exists(launcherPath))
                throw new Exception("launcher binary missing during republish: " + PathSafety.Clip(launcherPath));
            string lnk = ShortcutOps.ShortcutPath(st.ShortcutGroup, st.AppName);
            ShortcutOps.Create(lnk, launcherPath, root, st.AppName);
            RegistryOps.WriteUninstallEntry(st, root, launcherPath, uninstallerPath,
                EstimatedSizeKb(st.Current.Files));
        }

        private void UnpublishAll(Journal jr, string root)
        {
            string launcherPath = Path.Combine(root, Identity.LauncherName);
            string uninstallerPath = Path.Combine(root, jr.UninstallerName);
            string lnk = ShortcutOps.ShortcutPath(jr.ShortcutGroup, jr.AppName);
            ShortcutOps.DeleteIfOwned(lnk, launcherPath);
            TryRemoveEmptyDir(ShortcutOps.GroupDir(jr.ShortcutGroup));
            RegistryOps.DeleteUninstallEntryIfOwned(jr.RegUninstallKey, jr.AppId, root);
            TryDeleteFile(launcherPath);
            TryDeleteFile(uninstallerPath);
        }

        private static void AssertPublicationOwnership(string registryKey, string appId, string group, string appName, string root)
        {
            RegistryOps.AssertPublishable(registryKey, appId, root);
            ShortcutOps.AssertPublishable(ShortcutOps.ShortcutPath(group, appName), Path.Combine(root, Identity.LauncherName));
        }

        private void RemoveOwnedStage(Journal journal, string root)
        {
            StoredValidation.Journal(journal, root);
            // Remove only manifest-owned paths. Notes/recordings added beside
            // an interrupted stage are not installer property.
            var paths = new List<string>(); var cache = new HashSet<string>();
            foreach (FileEntry file in journal.Target.Files)
            {
                string path = PathSafety.CombineInsideRoot(journal.StageDir, file.Path, "staged file");
                PathSafety.AssertNoReparseInChain(path, cache); paths.Add(path);
            }
            using (var batch = new DeleteLockBatch())
            {
                if (!batch.TryOpenAll(paths)) throw EngineError.Busy("a staged file is locked; journal retained");
                if (batch.CommitDeletions().Count != 0) throw EngineError.Unrecoverable("staged files remain; journal retained");
            }
            RemoveEmptyTreeWithin(journal.StageDir, root);
        }

        private static bool IsReferencedByState(InstalledState prior, VersionRecord target)
        {
            if (prior == null) return false;
            string p = target.PayloadDirname;
            if (prior.Current != null && Eq(prior.Current.PayloadDirname, p)) return true;
            if (prior.Previous != null && Eq(prior.Previous.PayloadDirname, p)) return true;
            foreach (VersionRecord v in prior.Retained) if (Eq(v.PayloadDirname, p)) return true;
            return false;
        }

        // ===================================================================
        //  Staging / verification / removal
        // ===================================================================
        private void StageAndVerify(string source, string stageDir, List<FileEntry> files,
            string root, HashSet<string> reparseCache, OpReport report)
        {
            foreach (FileEntry f in files)
            {
                string srcAbs = PathSafety.CombineInsideRoot(source, f.Path, "source-file");
                PathSafety.AssertNoReparseInChain(srcAbs, reparseCache);
                if (!PathSafety.IsRegularFile(srcAbs))
                    throw EngineError.Validation("source file missing or not a regular file: " + f.Path);
                long slen = new FileInfo(srcAbs).Length;
                if (slen != f.Bytes)
                    throw EngineError.Validation("source size mismatch: " + f.Path + " (" + slen + " != " + f.Bytes + ")");

                string destAbs = PathSafety.CombineInsideRoot(stageDir, f.Path, "stage-file");
                string destDir = Path.GetDirectoryName(destAbs);
                if (!Directory.Exists(destDir)) Directory.CreateDirectory(destDir);
                File.Copy(srcAbs, destAbs, false);

                // Verify the STAGED bytes (authoritative: this is what goes live).
                long dlen = new FileInfo(destAbs).Length;
                if (dlen != f.Bytes)
                    throw EngineError.Validation("staged size mismatch: " + f.Path);
                string h = Hashing.Sha256File(destAbs);
                if (!string.Equals(h, f.Sha256, StringComparison.Ordinal))
                    throw EngineError.Validation("staged sha256 mismatch: " + f.Path);
            }
        }

        // Verify an existing payload dir against the manifest. Returns null if OK,
        // else the first error message.
        private string VerifyPayloadDir(string payloadDir, List<FileEntry> files, string root)
        {
            foreach (FileEntry f in files)
            {
                string abs;
                try { abs = PathSafety.CombineInsideRoot(payloadDir, f.Path, "verify-file"); }
                catch (EngineError e) { return e.Message; }
                if (PathSafety.IsReparsePoint(abs)) return "reparse point: " + f.Path;
                if (!PathSafety.IsRegularFile(abs)) return "missing: " + f.Path;
                if (new FileInfo(abs).Length != f.Bytes) return "size mismatch: " + f.Path;
                if (!string.Equals(Hashing.Sha256File(abs), f.Sha256, StringComparison.Ordinal))
                    return "sha256 mismatch: " + f.Path;
            }
            return null;
        }

        private void RemoveVersionFilesStrict(VersionRecord v, string root)
        {
            string pdir = Path.Combine(Path.Combine(root, AppSubdir), v.PayloadDirname);
            foreach (FileEntry f in v.Files)
            {
                string abs = PathSafety.CombineInsideRoot(pdir, f.Path, "rollback-file");
                if (File.Exists(abs)) File.Delete(abs); // propagates on lock -> rollback fails safely
            }
            RemoveEmptyTreeWithin(pdir, root);
        }

        private bool TryRemoveVersion(VersionRecord v, string root)
        {
            string pdir = Path.Combine(Path.Combine(root, AppSubdir), v.PayloadDirname);
            if (!Directory.Exists(pdir)) return true;
            if (PathSafety.IsReparsePoint(pdir)) return false;
            var files = new List<string>();
            foreach (FileEntry f in v.Files)
                files.Add(PathSafety.CombineInsideRoot(pdir, f.Path, "prune-file"));
            using (var batch = new DeleteLockBatch())
            {
                if (!batch.TryOpenAll(files)) return false; // locked -> keep this version
                batch.CommitDeletions();
            }
            RemoveEmptyTreeWithin(pdir, root);
            return true;
        }

        // ===================================================================
        //  Filesystem utilities (all bounded to the owned root)
        // ===================================================================
        private void PlaceControlBinary(string sourceFile, string destFile)
        {
            string dir = Path.GetDirectoryName(destFile);
            if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
            if (File.Exists(destFile))
            {
                // Overwrite is safe: we hold the root mutex, so the launcher cannot
                // be running (it holds the mutex across the child's lifetime).
                File.Copy(sourceFile, destFile, true);
            }
            else
            {
                File.Copy(sourceFile, destFile, false);
            }
        }

        private void RemoveEmptyTreeWithin(string dir, string root)
        {
            if (!Directory.Exists(dir)) return;
            if (!PathSafety.IsInsideRoot(root, dir)) return;
            if (PathSafety.IsReparsePoint(dir)) return;
            foreach (string sub in Directory.GetDirectories(dir))
            {
                if (PathSafety.IsReparsePoint(sub)) continue;
                RemoveEmptyTreeWithin(sub, root);
            }
            try
            {
                if (Directory.GetFileSystemEntries(dir).Length == 0)
                    Directory.Delete(dir, false);
            }
            catch { /* non-empty or locked: leave it (leftover) */ }
        }

        private static void TryRemoveEmptyDir(string dir)
        {
            try
            {
                if (Directory.Exists(dir) && !PathSafety.IsReparsePoint(dir) &&
                    Directory.GetFileSystemEntries(dir).Length == 0)
                    Directory.Delete(dir, false);
            }
            catch { }
        }

        private static void TryDeleteFile(string path)
        {
            try { if (File.Exists(path)) File.Delete(path); } catch { }
        }

        // Report any regular files left under the root after removal (bounded).
        private void CollectLeftovers(string root, OpReport report)
        {
            try { WalkLeftovers(root, root, report); } catch { }
        }

        private void WalkLeftovers(string dir, string root, OpReport report)
        {
            if (report.Leftovers.Count >= Limits.MaxLeftoversReported) return;
            if (PathSafety.IsReparsePoint(dir)) return;
            foreach (string f in Directory.GetFiles(dir))
            {
                report.AddLeftover(RelOrName(root, f));
                if (report.Leftovers.Count >= Limits.MaxLeftoversReported) return;
            }
            foreach (string sub in Directory.GetDirectories(dir))
            {
                if (PathSafety.IsReparsePoint(sub)) continue;
                WalkLeftovers(sub, root, report);
                if (report.Leftovers.Count >= Limits.MaxLeftoversReported) return;
            }
        }

        private static string RelOrName(string root, string abs)
        {
            string r = PathSafety.TrimTrailingSep(root);
            if (abs.StartsWith(r + "\\", StringComparison.OrdinalIgnoreCase))
                return abs.Substring(r.Length + 1);
            return Path.GetFileName(abs);
        }

        // ===================================================================
        //  Misc helpers
        // ===================================================================
        private string ValidateExistingFile(string input, string label, HashSet<string> cache)
        {
            if (string.IsNullOrEmpty(input))
                throw EngineError.Validation(label + ": empty path");
            if (input.StartsWith("\\\\") || input.StartsWith("//"))
                throw EngineError.Validation(label + ": UNC path not allowed");
            if (input.StartsWith("\\\\?\\") || input.StartsWith("\\\\.\\"))
                throw EngineError.Validation(label + ": device path not allowed");
            string full;
            try { full = Path.GetFullPath(input); }
            catch (Exception e) { throw EngineError.Validation(label + ": invalid path: " + e.Message); }
            PathSafety.AssertNoReparseInChain(full, cache);
            if (!PathSafety.IsRegularFile(full))
                throw EngineError.Validation(label + ": not an existing regular file: " + PathSafety.Clip(full));
            return full;
        }

        private static long EstimatedSizeKb(List<FileEntry> files)
        {
            long sum = 0;
            foreach (FileEntry f in files) sum += f.Bytes;
            long kb = (sum + 512) / 1024;
            return kb < 1 ? 1 : kb;
        }

        private void MaybeFault(InstallRequest req, string point)
        {
            if (req.TestFault == null || req.TestFault != point) return;
            if (!req.Identity.IsTest) return; // defence in depth (parse already enforces)
            if (point.StartsWith("crash:"))
                Environment.Exit(ExitCodes.CrashFault); // leave journal; no report
            throw new EngineError(ExitCodes.RolledBack, "test fault injected: " + point);
        }

        private static string NewTxnId()
        {
            return "txn-" + Guid.NewGuid().ToString("N");
        }

        private static string SelfPath()
        {
            using (Process p = Process.GetCurrentProcess())
                return p.MainModule.FileName;
        }

        private static bool Eq(string a, string b)
        {
            return string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
        }

        private static bool SamePath(string a, string b)
        {
            if (a == null || b == null) return false;
            return string.Equals(PathSafety.TrimTrailingSep(a), PathSafety.TrimTrailingSep(b),
                StringComparison.OrdinalIgnoreCase);
        }

        private static int CodeOf(Exception ex, int fallback)
        {
            EngineError ee = ex as EngineError;
            return ee != null ? ee.Code : fallback;
        }

        private static string CleanMessage(Exception ex)
        {
            string m = (ex is EngineError) ? ex.Message : (ex.GetType().Name + ": " + ex.Message);
            if (m == null) m = "";
            return m.Length > 400 ? m.Substring(0, 400) + "..." : m;
        }

        // ===================================================================
        //  Launcher mode (no CLI args)
        // ===================================================================
        public int RunLauncher(string[] args)
        {
            try
            {
                string root = PathSafety.NormalizeAbsoluteLocalDir(Path.GetDirectoryName(SelfPath()), "launcher root");
                PathSafety.AssertNoReparseInChain(root, new HashSet<string>());
                using (var mutex = new RootMutex(root))
                {
                    if (!mutex.TryAcquire(TimeSpan.FromSeconds(2)))
                    {
                        ShowError("이미 실행 중이거나 설치 작업이 진행 중입니다.");
                        return ExitCodes.Busy;
                    }
                    // Load and validate the current state only after the lock is
                    // held. An update cannot make an earlier read stale here.
                    var store = new StateStore(root);
                    InstalledState state = store.ReadState();
                    if (state == null) throw EngineError.Ownership("설치 상태를 찾을 수 없습니다.");
                    if (store.HasJournal()) throw EngineError.Unrecoverable("이전 설치 작업의 복구가 필요합니다.");
                    string payload = Path.Combine(Path.Combine(root, AppSubdir), state.Current.PayloadDirname);
                    string exe = Path.Combine(payload, state.Current.ExeName);
                    FileEntry expected = FindExeEntry(state.Current);
                    if (!PathSafety.IsRegularFile(exe) || expected == null || new FileInfo(exe).Length != expected.Bytes)
                        throw EngineError.Validation("실행 파일 검증에 실패했습니다.");
                    var launch = new ProcessStartInfo();
                    launch.FileName = exe; launch.WorkingDirectory = payload;
                    launch.UseShellExecute = false; launch.Arguments = JoinArgs(args);
                    using (Process child = Process.Start(launch))
                    {
                        if (child == null) throw EngineError.Unrecoverable("앱을 시작하지 못했습니다.");
                        child.WaitForExit(); return child.ExitCode;
                    }
                }
            }
            catch (Exception error)
            {
                ShowError("실행 중 오류가 발생했습니다.\n" + error.Message);
                return ExitCodes.LaunchError;
            }
        }

        private static FileEntry FindExeEntry(VersionRecord v)
        {
            foreach (FileEntry f in v.Files)
                if (string.Equals(f.Path, v.ExeName, StringComparison.OrdinalIgnoreCase))
                    return f;
            return null;
        }

        private static void ShowError(string msg)
        {
            try
            {
                System.Windows.Forms.MessageBox.Show(msg, "BACKSEAT Launcher",
                    System.Windows.Forms.MessageBoxButtons.OK,
                    System.Windows.Forms.MessageBoxIcon.Error);
            }
            catch { Console.Error.WriteLine(msg); }
        }

        private static string JoinArgs(string[] args)
        {
            if (args == null || args.Length == 0) return "";
            var sb = new StringBuilder();
            for (int i = 0; i < args.Length; i++)
            {
                if (i > 0) sb.Append(' ');
                sb.Append(QuoteArg(args[i]));
            }
            return sb.ToString();
        }

        // CommandLineToArgvW-compatible quoting.
        private static string QuoteArg(string a)
        {
            if (a.Length > 0 && a.IndexOfAny(new char[] { ' ', '\t', '"' }) < 0) return a;
            var sb = new StringBuilder();
            sb.Append('"');
            int backslashes = 0;
            foreach (char c in a)
            {
                if (c == '\\') { backslashes++; }
                else if (c == '"') { sb.Append('\\', backslashes * 2 + 1); sb.Append('"'); backslashes = 0; }
                else { if (backslashes > 0) { sb.Append('\\', backslashes); backslashes = 0; } sb.Append(c); }
            }
            sb.Append('\\', backslashes * 2);
            sb.Append('"');
            return sb.ToString();
        }
    }
}
