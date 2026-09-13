// Permanent engine regression suite, adapted from the preserved 2026-09-13 audit.
// ---------------------------------------------------------------------------
// Focused, side-effect-bounded unit harness for the BACKSEAT install engine.
// Compiled together with the engine sources EXCEPT Program.cs (this file owns
// Main). It exercises ONLY pure/read-only logic plus filesystem fixtures created
// strictly under the audit prefix passed as argv[0]. It NEVER writes HKCU, the
// Start Menu, %APPDATA%, or any user data — those mutating paths are the parent's
// isolated tests. C# 5 only (legacy Framework csc).
// ---------------------------------------------------------------------------

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;

namespace Backseat.Installer.Tests
{
    internal static class TestMain
    {
        private static int _pass = 0;
        private static int _fail = 0;
        private static string _fixtureRoot;

        private static int Main(string[] args)
        {
            _fixtureRoot = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "fixtures");
            if (args.Length == 1 && args[0].StartsWith("--mutex-child-", StringComparison.Ordinal)) return MutexChild(args[0]);
            if (args.Length == 1 && args[0] == "--crash-before-first-journal")
            {
                // The child can only touch a fixed directory beside its own binary.
                // No Engine.Install/Recover call: no registry or shortcut publication.
                string crashRoot = Path.Combine(_fixtureRoot, "bootstrap-crash-child");
                var crashStore = new StateStore(crashRoot);
                new Engine().EnsureOwnedOrClaimable(crashStore, Identity.ExpectedFor("test"), crashRoot,
                    new OpReport("unit-bootstrap", crashRoot));
                crashStore.EnsureControlDir();
                Environment.Exit(ExitCodes.CrashFault);
            }
            if (args.Length == 1 && args[0] == "--crash-after-uninstall-payload")
            {
                string crashRoot = Path.Combine(_fixtureRoot, "uninstall-crash-child");
                InstalledState st = new StateStore(crashRoot).ReadState();
                var host = new FileOnlyUninstallHost(); host.Fault = "crash";
                new Engine(host).Uninstall(crashRoot, st.AppId, new OpReport("uninstall", crashRoot));
                return 1; // the injected publication boundary must terminate the child
            }
            if (args.Length != 1 || !string.Equals(Path.GetFullPath(args[0]), _fixtureRoot, StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("Expected the fixture directory beside this test binary");
            Directory.CreateDirectory(_fixtureRoot);
            Console.WriteLine("fixture root: " + _fixtureRoot);
            Console.WriteLine("=========================================================");

            try { PathSanitizeTests(); } catch (Exception e) { Blew("PathSanitizeTests", e); }
            try { NormalizeRootTests(); } catch (Exception e) { Blew("NormalizeRootTests", e); }
            try { InsideRootTests(); } catch (Exception e) { Blew("InsideRootTests", e); }
            try { JsonTests(); } catch (Exception e) { Blew("JsonTests", e); }
            try { IdentityTests(); } catch (Exception e) { Blew("IdentityTests", e); }
            try { RequestParseTests(); } catch (Exception e) { Blew("RequestParseTests", e); }
            try { StateJournalRoundTripTests(); } catch (Exception e) { Blew("StateJournalRoundTripTests", e); }
            try { StateStoreFsTests(); } catch (Exception e) { Blew("StateStoreFsTests", e); }
            try { FirstInstallBootstrapTests(); } catch (Exception e) { Blew("FirstInstallBootstrapTests", e); }
            try { UninstallLateFailureTests(); } catch (Exception e) { Blew("UninstallLateFailureTests", e); }
            try { UninstallControlPreflightTests(); } catch (Exception e) { Blew("UninstallControlPreflightTests", e); }
            try { DeleteLockBatchTests(); } catch (Exception e) { Blew("DeleteLockBatchTests", e); }
            try { ReparseTests(); } catch (Exception e) { Blew("ReparseTests", e); }
            try { MutexTests(); } catch (Exception e) { Blew("MutexTests", e); }
            try { MutexProcessTests(); } catch (Exception e) { Blew("MutexProcessTests", e); }
            try { MutexSecurityTests(); } catch (Exception e) { Blew("MutexSecurityTests", e); }
            try { AllVersionsTests(); } catch (Exception e) { Blew("AllVersionsTests", e); }
            try { HashingTests(); } catch (Exception e) { Blew("HashingTests", e); }

            Console.WriteLine("=========================================================");
            Console.WriteLine("RESULT: " + _pass + " passed, " + _fail + " failed");
            return _fail == 0 ? 0 : 1;
        }

        // ------------------------------------------------------------------ asserts
        private static void Ok(bool cond, string name)
        {
            if (cond) { _pass++; Console.WriteLine("  PASS  " + name); }
            else { _fail++; Console.WriteLine("  FAIL  " + name); }
        }

        private static void Eq(string got, string want, string name)
        {
            Ok(string.Equals(got, want, StringComparison.Ordinal),
                name + (string.Equals(got, want, StringComparison.Ordinal) ? "" : "  [got='" + got + "' want='" + want + "']"));
        }

        // Assert that `body` throws an EngineError.
        private static void Throws(Action body, string name)
        {
            try { body(); _fail++; Console.WriteLine("  FAIL  " + name + "  [no throw]"); }
            catch (EngineError) { _pass++; Console.WriteLine("  PASS  " + name); }
            catch (Exception e) { _fail++; Console.WriteLine("  FAIL  " + name + "  [wrong ex " + e.GetType().Name + "]"); }
        }

        private static void Blew(string group, Exception e)
        {
            _fail++;
            Console.WriteLine("  FAIL  " + group + " threw " + e.GetType().Name + ": " + e.Message);
        }

        private static void Section(string s) { Console.WriteLine("[" + s + "]"); }

        // ------------------------------------------------------------------ tests
        private static void PathSanitizeTests()
        {
            Section("PathSafety.SanitizeRelative");
            Eq(PathSafety.SanitizeRelative("a/b/c.txt"), "a/b/c.txt", "valid nested");
            Eq(PathSafety.SanitizeRelative("resources/sound/model/yamnet.onnx"),
                "resources/sound/model/yamnet.onnx", "valid runtime path");
            Throws(delegate { PathSafety.SanitizeRelative("a\\b"); }, "reject backslash");
            Throws(delegate { PathSafety.SanitizeRelative("/a"); }, "reject leading slash");
            Throws(delegate { PathSafety.SanitizeRelative("C:/a"); }, "reject drive-qualified");
            Throws(delegate { PathSafety.SanitizeRelative("a/../b"); }, "reject ..");
            Throws(delegate { PathSafety.SanitizeRelative("a/./b"); }, "reject .");
            Throws(delegate { PathSafety.SanitizeRelative("a//b"); }, "reject empty segment");
            Throws(delegate { PathSafety.SanitizeRelative("a/b:stream"); }, "reject ADS colon");
            Throws(delegate { PathSafety.SanitizeRelative("con"); }, "reject reserved CON");
            Throws(delegate { PathSafety.SanitizeRelative("dir/NUL.txt"); }, "reject reserved NUL name");
            Throws(delegate { PathSafety.SanitizeRelative("com1/x"); }, "reject reserved COM1");
            Throws(delegate { PathSafety.SanitizeRelative("a/b."); }, "reject trailing dot");
            Throws(delegate { PathSafety.SanitizeRelative("a/b "); }, "reject trailing space");
            Throws(delegate { PathSafety.SanitizeRelative("a/" + ((char)0) + "b"); }, "reject NUL char");
            Throws(delegate { PathSafety.SanitizeRelative("a/" + ((char)1) + "b"); }, "reject control char");
            Throws(delegate { PathSafety.SanitizeRelative(new string('x', 241)); }, "reject too long");
            var many = new System.Text.StringBuilder();
            for (int i = 0; i < 65; i++) { if (i > 0) many.Append('/'); many.Append('s'); }
            Throws(delegate { PathSafety.SanitizeRelative(many.ToString()); }, "reject too many segments");
            Throws(delegate { PathSafety.SanitizeRelative(""); }, "reject empty");
        }

        private static void NormalizeRootTests()
        {
            Section("PathSafety.NormalizeAbsoluteLocalDir");
            Throws(delegate { PathSafety.NormalizeAbsoluteLocalDir("\\\\server\\share", "R"); }, "reject UNC \\\\");
            Throws(delegate { PathSafety.NormalizeAbsoluteLocalDir("//server/share", "R"); }, "reject UNC //");
            Throws(delegate { PathSafety.NormalizeAbsoluteLocalDir("\\\\?\\C:\\x", "R"); }, "reject \\\\?\\ device");
            Throws(delegate { PathSafety.NormalizeAbsoluteLocalDir("\\\\.\\C:", "R"); }, "reject \\\\.\\ device");
            Throws(delegate { PathSafety.NormalizeAbsoluteLocalDir("\\??\\C:\\x", "R"); }, "reject \\??\\ device");
            Throws(delegate { PathSafety.NormalizeAbsoluteLocalDir("foo\\bar", "R"); }, "reject relative");
            Throws(delegate { PathSafety.NormalizeAbsoluteLocalDir("C:foo", "R"); }, "reject drive-relative");
            Throws(delegate { PathSafety.NormalizeAbsoluteLocalDir("C:\\a\\..\\b", "R"); }, "reject .. in input");
            Throws(delegate { PathSafety.NormalizeAbsoluteLocalDir("C:\\", "R"); }, "reject drive root");
            Throws(delegate { PathSafety.NormalizeAbsoluteLocalDir("", "R"); }, "reject empty");
            // Positive: C: exists and is a fixed drive on Windows; normalization trims trailing sep.
            Eq(PathSafety.NormalizeAbsoluteLocalDir("C:\\Program Files\\Foo\\", "R"),
                "C:\\Program Files\\Foo", "normalize trims trailing sep");
            Eq(PathSafety.TrimTrailingSep("C:\\"), "C:\\", "TrimTrailingSep keeps drive root");
        }

        private static void InsideRootTests()
        {
            Section("PathSafety.IsInsideRoot / CombineInsideRoot");
            Ok(PathSafety.IsInsideRoot("C:\\root", "C:\\root\\a\\b"), "child is inside");
            Ok(PathSafety.IsInsideRoot("C:\\root", "C:\\root"), "root itself is inside");
            Ok(!PathSafety.IsInsideRoot("C:\\root", "C:\\rootother\\a"), "sibling prefix not inside");
            Ok(!PathSafety.IsInsideRoot("C:\\root", "C:\\other"), "unrelated not inside");
            Eq(PathSafety.CombineInsideRoot("C:\\root", "a/b/c", "x"), "C:\\root\\a\\b\\c", "combine joins under root");
            Throws(delegate { PathSafety.CombineInsideRoot("C:\\root", "../evil", "x"); }, "combine rejects escape");
        }

        private static void JsonTests()
        {
            Section("Json");
            var o = Json.AsObject(Json.Parse("{\"a\":\"x\",\"n\":7,\"b\":true}"), "t");
            Eq(Json.GetString(o, "a", "t"), "x", "GetString");
            Ok(Json.GetLong(o, "n", "t") == 7, "GetLong");
            Throws(delegate { Json.GetLong(o, "b", "t"); }, "GetLong rejects bool");
            Throws(delegate { Json.GetString(o, "n", "t"); }, "GetString rejects number");
            Throws(delegate { Json.Parse("{not json"); }, "reject malformed");
            var b = Json.AsObject(Json.Parse("﻿{\"a\":\"1\"}"), "t"); // BOM prefix
            Eq(Json.GetString(b, "a", "t"), "1", "strips leading BOM");
        }

        private static void IdentityTests()
        {
            Section("Identity");
            var prod = Identity.ParseAndValidate(ProdIdentityMap("1.2.3", "build9", "1.2.3+build9"));
            Eq(prod.AppId, "{7E3A9C21-4B6D-4F2E-9A1C-8D5F0B2E6A34}", "production appId");
            Ok(!prod.IsTest, "production not test");
            var test = Identity.ParseAndValidate(TestIdentityMap("0.0.1", "t1", "0.0.1+t1"));
            Ok(test.IsTest, "test IsTest");
            Ok(!string.Equals(test.AppId, prod.AppId, StringComparison.Ordinal), "test appId differs");
            // cross contamination: production marker with test appId
            var cross = ProdIdentityMap("1.0.0", "b", "1.0.0+b");
            cross["appId"] = "{2F8B1D04-9E3A-4C77-B6A2-1C0E5D9F4B88}";
            Throws(delegate { Identity.ParseAndValidate(cross); }, "reject prod marker + test appId");
            Throws(delegate { Identity.ParseAndValidate(ProdIdentityMap("bad", "b", "bad+b")); }, "reject bad version");
            Throws(delegate { Identity.ParseAndValidate(ProdIdentityMap("1.0.0", "b", "9.9.9+b")); }, "reject payload!=v+b");
            var badMarker = ProdIdentityMap("1.0.0", "b", "1.0.0+b");
            badMarker["marker"] = "staging";
            Throws(delegate { Identity.ParseAndValidate(badMarker); }, "reject unknown marker");
        }

        private static void RequestParseTests()
        {
            Section("InstallRequest.Parse (F1: required runtime files)");
            InstallRequest req = InstallRequest.Parse(BuildRequest(Identity.RequiredRuntimeFiles, null, "production"));
            Ok(req.Files.Count == Identity.RequiredRuntimeFiles.Length, "valid request parses all required files");
            Ok(req.Files.Count == 7, "required runtime file count is 7");

            // F1 regression: dropping either newly-required sound file must be rejected.
            Throws(delegate { InstallRequest.Parse(BuildRequest(Without("resources/sound/model/yamnet.onnx"), null, "production")); },
                "reject manifest missing yamnet.onnx");
            Throws(delegate { InstallRequest.Parse(BuildRequest(Without("resources/sound/sound_worker.py"), null, "production")); },
                "reject manifest missing sound_worker.py");
            Throws(delegate { InstallRequest.Parse(BuildRequest(Without("BACKSEAT.exe"), null, "production")); },
                "reject manifest missing BACKSEAT.exe");

            // duplicate path (case-insensitive)
            var dup = new List<string>(Identity.RequiredRuntimeFiles);
            dup.Add("BACKSEAT.EXE");
            Throws(delegate { InstallRequest.Parse(BuildRequest(dup.ToArray(), null, "production")); }, "reject case-insensitive duplicate");

            // testFault only for test identity
            Throws(delegate { InstallRequest.Parse(BuildRequest(Identity.RequiredRuntimeFiles, "throw:after-stage", "production")); },
                "reject testFault on production identity");
            InstallRequest tf = InstallRequest.Parse(BuildRequest(Identity.RequiredRuntimeFiles, "throw:after-stage", "test"));
            Eq(tf.TestFault, "throw:after-stage", "accept testFault on test identity");
            Throws(delegate { InstallRequest.Parse(BuildRequest(Identity.RequiredRuntimeFiles, "boom", "test")); },
                "reject unknown testFault");

            // empty files
            Throws(delegate { InstallRequest.Parse(BuildRequest(new string[0], null, "production")); }, "reject empty files");
            // bad schema
            Throws(delegate { InstallRequest.Parse(BuildRequestSchema(2)); }, "reject schema!=1");
        }

        private static void StateJournalRoundTripTests()
        {
            Section("State / Journal round-trip");
            var st = new InstalledState();
            st.AppId = "{7E3A9C21-4B6D-4F2E-9A1C-8D5F0B2E6A34}";
            st.AppName = "BACKSEAT Studio"; st.Marker = "production"; st.InstallRoot = "C:\\Games\\BK";
            st.RegUninstallKey = "Software\\X"; st.ShortcutGroup = "BACKSEAT Studio";
            st.UninstallerName = "Uninstall BACKSEAT Studio.exe"; st.ExeName = "BACKSEAT.exe";
            st.Publisher = "Unspecified publisher (development build)";
            st.Current = MakeVR("1.2.3+b1", "1.2.3", "b1");
            st.Previous = MakeVR("1.2.2+b0", "1.2.2", "b0");
            st.LastTxnId = "txn-abc";
            var rt = InstalledState.FromMap(Json.AsObject(Json.Parse(Json.Serialize(st.ToMap())), "state"));
            Eq(rt.AppId, st.AppId, "state appId round-trip");
            Eq(rt.Current.PayloadDirname, "1.2.3+b1", "state current round-trip");
            Eq(rt.Previous.PayloadDirname, "1.2.2+b0", "state previous round-trip");
            Eq(rt.LastTxnId, "txn-abc", "state lastTxnId round-trip");

            // ownership marker enforcement
            var tampered = Json.AsObject(Json.Parse(Json.Serialize(st.ToMap())), "state");
            tampered["ownerGuid"] = "{DEADBEEF-0000-0000-0000-000000000000}";
            Throws(delegate { InstalledState.FromMap(tampered); }, "reject foreign ownerGuid");

            var j = new Journal();
            j.TxnId = "txn-1"; j.Op = "install"; j.Phase = "staging";
            j.AppId = st.AppId; j.AppName = st.AppName; j.Marker = "production";
            j.RegUninstallKey = "Software\\X"; j.ShortcutGroup = "G"; j.UninstallerName = "U.exe";
            j.ExeName = "BACKSEAT.exe"; j.Publisher = "P"; j.Root = "C:\\Games\\BK";
            j.ControlDir = "C:\\Games\\BK\\.backseat"; j.StageDir = "C:\\Games\\BK\\app\\.pending-b1";
            j.NewPayloadDir = "C:\\Games\\BK\\app\\1.2.3+b1"; j.Target = st.Current;
            j.FirstInstall = true; j.PriorPayloadDirname = null;
            var jr = Journal.FromMap(Json.AsObject(Json.Parse(Json.Serialize(j.ToMap())), "journal"));
            Eq(jr.TxnId, "txn-1", "journal txnId round-trip");
            Eq(jr.Phase, "staging", "journal phase round-trip (staging)");
            Ok(jr.FirstInstall, "journal firstInstall round-trip");
            Eq(jr.Target.PayloadDirname, "1.2.3+b1", "journal target round-trip");
        }

        private static void StateStoreFsTests()
        {
            Section("StateStore validates identities and atomically writes owned metadata");
            string root = NewFixtureDir("statestore"); var store = new StateStore(root);
            Identity identity = Identity.ExpectedFor("test");
            var journal = new Journal();
            journal.TxnId = "txn-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; journal.Op = "install"; journal.Phase = "staging";
            journal.AppId = identity.AppId; journal.AppName = identity.AppName; journal.Marker = identity.Marker;
            journal.RegUninstallKey = identity.RegUninstallKey; journal.ShortcutGroup = identity.ShortcutGroup;
            journal.UninstallerName = identity.UninstallerName; journal.ExeName = identity.ExeName; journal.Publisher = identity.Publisher;
            journal.Root = root; journal.ControlDir = store.ControlDir;
            journal.StageDir = Path.Combine(Path.Combine(root,"app"),".pending-x");
            journal.NewPayloadDir = Path.Combine(Path.Combine(root,"app"),"0.1.0+x");
            journal.Target = MakeVR("0.1.0+x","0.1.0","x"); journal.FirstInstall = true;
            store.EnsureControlDir();
            File.WriteAllText(store.JournalPath + ".tmp", "user temporary file");
            store.WriteJournal(journal); Ok(File.Exists(store.JournalPath), "journal written");
            Eq(store.ReadJournal().TxnId, journal.TxnId, "canonical transaction round-trip");
            journal.Phase = "promoted"; store.WriteJournal(journal);
            Eq(store.ReadJournal().Phase, "promoted", "journal atomically replaced");
            Eq(File.ReadAllText(store.JournalPath + ".tmp"), "user temporary file", "unowned fixed temporary file preserved");
            Ok(Directory.GetFiles(store.ControlDir,"*.write-*").Length == 0, "owned atomic-write temporaries cleaned");
            var state = new InstalledState();
            state.AppId = identity.AppId; state.AppName = identity.AppName; state.Marker = identity.Marker;
            state.InstallRoot = root; state.RegUninstallKey = identity.RegUninstallKey; state.ShortcutGroup = identity.ShortcutGroup;
            state.UninstallerName = identity.UninstallerName; state.ExeName = identity.ExeName; state.Publisher = identity.Publisher;
            state.Current = journal.Target; state.LastTxnId = journal.TxnId;
            store.CommitState(state); Ok(File.Exists(store.StatePath), "state committed");
            var ownedReport = new OpReport("unit-bootstrap", root);
            new Engine().EnsureOwnedOrClaimable(store, identity, root, ownedReport);
            Ok(ownedReport.Steps.Contains("validated-existing-ownership"), "committed install still requires validated ownership");
            Throws(delegate { new Engine().EnsureOwnedOrClaimable(store, Identity.ExpectedFor("production"), root,
                new OpReport("unit-bootstrap", root)); }, "another product identity cannot claim an installed root");
            state.LastTxnId = "txn-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"; store.CommitState(state);
            Ok(File.Exists(store.BakPath), "commit keeps previous valid state");
            Eq(store.ReadState().LastTxnId, state.LastTxnId, "latest state restored");
            store.DeleteJournal(); Ok(!store.HasJournal(), "owned journal deleted");
            Eq(File.ReadAllText(store.JournalPath + ".tmp"), "user temporary file", "journal cleanup preserves unowned temporary file");
        }

        private static void FirstInstallBootstrapTests()
        {
            Section("First-install interrupted before journal; file-only ownership gate");
            var engine = new Engine(); Identity identity = Identity.ExpectedFor("test");
            string empty = NewFixtureDir("bootstrap-empty"); var emptyReport = new OpReport("unit-bootstrap", empty);
            engine.EnsureOwnedOrClaimable(new StateStore(empty), identity, empty, emptyReport);
            Ok(emptyReport.Steps.Contains("claimed-empty-root"), "ordinary empty install root remains claimable");
            string root = Path.Combine(_fixtureRoot, "bootstrap-crash-child");
            var store = new StateStore(root);
            string executable = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "tests.exe");
            var start = new ProcessStartInfo(executable, "--crash-before-first-journal");
            start.UseShellExecute = false; start.CreateNoWindow = true;
            using (Process child = Process.Start(start))
            {
                if (!child.WaitForExit(15000)) throw new Exception("bootstrap child did not exit in time");
                Ok(child.ExitCode == ExitCodes.CrashFault, "child actually interrupted before initial journal");
            }
            Ok(Directory.Exists(store.ControlDir) && Directory.GetFileSystemEntries(store.ControlDir).Length == 0,
                "interruption leaves exactly an empty control directory");
            Ok(!store.HasJournal() && !store.HasState(), "interruption has no claimed transaction or committed state");
            var report = new OpReport("unit-bootstrap", root);
            engine.EnsureOwnedOrClaimable(store, identity, root, report);
            Ok(report.Steps.Contains("reclaimed-empty-bootstrap-root"), "retry accepts empty bootstrap shell");
            var journal = BootstrapJournal(root);
            store.WriteJournal(journal);
            Eq(store.ReadJournal().TxnId, journal.TxnId, "retry publishes a valid initial journal");
            Ok(!Directory.Exists(Path.Combine(root, "app")), "retry does not stage payload before journaling");
            store.DeleteJournal();
            engine.EnsureOwnedOrClaimable(store, identity, root, new OpReport("unit-bootstrap", root));
            Ok(true, "empty bootstrap shell is reusable after another interruption");

            string[] reserved = { "note.txt", "pending.json.write-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "pending.json", "state.json", "state.json.bak" };
            foreach (string name in reserved)
            {
                string occupied = NewFixtureDir("bootstrap-occupied"); var occupiedStore = new StateStore(occupied);
                occupiedStore.EnsureControlDir(); string file = Path.Combine(occupiedStore.ControlDir, name);
                File.WriteAllText(file, "Unowned data, including a possible partial write");
                string before = Hashing.Sha256File(file);
                Throws(delegate { engine.EnsureOwnedOrClaimable(occupiedStore, identity, occupied, new OpReport("unit-bootstrap", occupied)); },
                    "nonempty control directory refused: " + name);
                Eq(Hashing.Sha256File(file), before, "refusal preserves file bytes: " + name);
                Ok(Directory.GetFileSystemEntries(occupiedStore.ControlDir).Length == 1, "refusal creates no extra metadata: " + name);
            }

            string nested = NewFixtureDir("bootstrap-nested"); var nestedStore = new StateStore(nested);
            Directory.CreateDirectory(Path.Combine(nestedStore.ControlDir, "notes"));
            Throws(delegate { engine.EnsureOwnedOrClaimable(nestedStore, identity, nested, new OpReport("unit-bootstrap", nested)); },
                "empty nested user directory is still unowned");
            Ok(Directory.Exists(Path.Combine(nestedStore.ControlDir, "notes")), "nested user directory preserved");

            string extra = NewFixtureDir("bootstrap-extra"); var extraStore = new StateStore(extra);
            extraStore.EnsureControlDir(); string note = Path.Combine(extra, "note.txt"); File.WriteAllText(note, "keep me");
            Throws(delegate { engine.EnsureOwnedOrClaimable(extraStore, identity, extra, new OpReport("unit-bootstrap", extra)); },
                "empty control directory does not claim other root contents");
            Eq(File.ReadAllText(note), "keep me", "root note preserved");

            string controlFile = NewFixtureDir("bootstrap-control-file"); var fileStore = new StateStore(controlFile);
            File.WriteAllText(fileStore.ControlDir, "not a directory");
            Throws(delegate { engine.EnsureOwnedOrClaimable(fileStore, identity, controlFile, new OpReport("unit-bootstrap", controlFile)); },
                "control name occupied by regular file is refused");
            Eq(File.ReadAllText(fileStore.ControlDir), "not a directory", "control-name file preserved");

            string junction = Path.Combine(_fixtureRoot, "bootstrap-junction"); var junctionStore = new StateStore(junction);
            Throws(delegate { engine.EnsureOwnedOrClaimable(junctionStore, identity, junction, new OpReport("unit-bootstrap", junction)); },
                "empty control junction cannot be claimed");
            Ok(PathSafety.IsReparsePoint(junctionStore.ControlDir), "control junction itself preserved");
            Ok(Directory.GetFileSystemEntries(Path.Combine(_fixtureRoot, "bootstrap-junction-target")).Length == 0,
                "control junction target not written");
            string throughJunction = Path.Combine(_fixtureRoot, "jx", "must-not-create");
            Throws(delegate { engine.EnsureOwnedOrClaimable(new StateStore(throughJunction), identity, throughJunction,
                new OpReport("unit-bootstrap", throughJunction)); }, "missing root through ancestor junction refused");
            Ok(!Directory.Exists(Path.Combine(_fixtureRoot, "junction-target", "must-not-create")), "ancestor junction target preserved");
        }

        private static Journal BootstrapJournal(string root)
        {
            Identity id = Identity.ExpectedFor("test"); var journal = new Journal();
            journal.TxnId = "txn-cccccccccccccccccccccccccccccccc"; journal.Op = "install"; journal.Phase = "staging";
            journal.AppId = id.AppId; journal.AppName = id.AppName; journal.Marker = id.Marker;
            journal.RegUninstallKey = id.RegUninstallKey; journal.ShortcutGroup = id.ShortcutGroup;
            journal.UninstallerName = id.UninstallerName; journal.ExeName = id.ExeName; journal.Publisher = id.Publisher;
            journal.Root = root; journal.ControlDir = Path.Combine(root, StateStore.ControlDirName);
            journal.StageDir = Path.Combine(Path.Combine(root, "app"), ".pending-x");
            journal.NewPayloadDir = Path.Combine(Path.Combine(root, "app"), "0.1.0+x");
            journal.Target = MakeVR("0.1.0+x", "0.1.0", "x"); journal.FirstInstall = true;
            return journal;
        }

        private static void DeleteLockBatchTests()
        {
            Section("DeleteLockBatch (fixture; atomic preflight + reparse-safe flag)");
            // commit deletes all (also proves FILE_FLAG_OPEN_REPARSE_POINT does not
            // break ordinary regular-file deletion)
            string d1 = NewFixtureDir("lock-commit");
            string[] f = new string[] { d1 + "\\a.bin", d1 + "\\b.bin", d1 + "\\c.bin" };
            foreach (string p in f) File.WriteAllBytes(p, new byte[] { 1, 2, 3 });
            using (var batch = new DeleteLockBatch())
            {
                Ok(batch.TryOpenAll(f), "open all owned files");
                Ok(batch.OpenedCount == 3, "opened count == 3");
                List<string> still = batch.CommitDeletions();
                Ok(still.Count == 0, "commit reports nothing left");
            }
            Ok(!File.Exists(f[0]) && !File.Exists(f[1]) && !File.Exists(f[2]), "all files deleted at commit");

            // abort deletes nothing
            string d2 = NewFixtureDir("lock-abort");
            string g = d2 + "\\keep.bin";
            File.WriteAllBytes(g, new byte[] { 9 });
            using (var batch = new DeleteLockBatch())
            {
                Ok(batch.TryOpenAll(new string[] { g }), "open for abort");
            } // Dispose without CommitDeletions
            Ok(File.Exists(g), "aborted batch deletes nothing");

            // missing skipped
            string d3 = NewFixtureDir("lock-missing");
            string real = d3 + "\\real.bin"; File.WriteAllBytes(real, new byte[] { 1 });
            string ghost = d3 + "\\ghost.bin";
            using (var batch = new DeleteLockBatch())
            {
                Ok(batch.TryOpenAll(new string[] { real, ghost }), "missing file skipped (still true)");
                Ok(batch.Missing.Contains(ghost), "missing recorded");
            }
            Ok(File.Exists(real), "missing-skip aborts (no commit) -> real survives");

            // lock refused: hold an exclusive handle first
            string d4 = NewFixtureDir("lock-refused");
            string locked = d4 + "\\locked.bin"; File.WriteAllBytes(locked, new byte[] { 7 });
            using (var hold = new FileStream(locked, FileMode.Open, FileAccess.Read, FileShare.None))
            {
                using (var batch = new DeleteLockBatch())
                {
                    bool all = batch.TryOpenAll(new string[] { locked });
                    Ok(!all, "locked file refused (TryOpenAll false)");
                    Eq(batch.LockedPath, locked, "LockedPath is the locked file");
                }
            }
            Ok(File.Exists(locked), "locked file not deleted");
        }

        private static void ReparseTests()
        {
            Section("PathSafety reparse detection");
            // regular chain: no throw
            string reg = NewFixtureDir("reparse-reg");
            string sub = reg + "\\sub"; Directory.CreateDirectory(sub);
            string file = sub + "\\f.bin"; File.WriteAllBytes(file, new byte[] { 1 });
            bool threw = false;
            try { PathSafety.AssertNoReparseInChain(file, new HashSet<string>()); }
            catch (EngineError) { threw = true; }
            Ok(!threw, "regular chain passes reparse check");
            Ok(PathSafety.IsRegularFile(file), "IsRegularFile true for real file");
            Ok(!PathSafety.IsReparsePoint(file), "IsReparsePoint false for real file");

            // junction (if one was created by the harness setup under fixtures\jx)
            string jx = Path.Combine(_fixtureRoot, "jx");
            if (Directory.Exists(jx) && PathSafety.IsReparsePoint(jx))
            {
                Ok(true, "junction fixture detected as reparse point");
                Throws(delegate { PathSafety.AssertNoReparseInChain(jx + "\\anything.bin", new HashSet<string>()); },
                    "AssertNoReparseInChain throws through junction");
            }
            else
            {
                Console.WriteLine("  SKIP  junction fixture unavailable (mklink /J not run or unsupported)");
            }
        }

        private static void MutexTests()
        {
            Section("RootMutex cross-thread contention");
            string root = Path.Combine(_fixtureRoot, "mutex-basic");
            using (var m = new RootMutex(root))
            {
                Ok(m.TryAcquire(0), "acquire on main thread");
                string name = "Global\\Backseat.Installer." + Hashing.Sha256Bytes(System.Text.Encoding.Unicode.GetBytes(PathSafety.TrimTrailingSep(root).ToLowerInvariant())).Substring(0, 40);
                bool globalFound = false;
                try { using (var opened = Mutex.OpenExisting(name)) globalFound = true; }
                catch (WaitHandleCannotBeOpenedException) { }
                Ok(globalFound, "same-root lock is published in the cross-session namespace");
                bool otherGot = true;
                var t = new Thread(delegate ()
                {
                    using (var m2 = new RootMutex(root))
                    {
                        otherGot = m2.TryAcquire(0);
                    }
                });
                t.Start(); t.Join();
                Ok(!otherGot, "second thread cannot acquire same-root mutex");
                m.Release();
            }
            // after release a fresh acquire succeeds
            using (var m3 = new RootMutex(root))
            {
                Ok(m3.TryAcquire(0), "reacquire after release");
                m3.Release();
            }
        }

        private static string LegacyMutexName(string root)
        {
            return "Backseat.Installer." + Hashing.Sha256Bytes(Encoding.Unicode.GetBytes(PathSafety.TrimTrailingSep(root).ToLowerInvariant())).Substring(0, 40);
        }

        private static int MutexChild(string mode)
        {
            string root = Path.Combine(_fixtureRoot, "mutex-process");
            Console.WriteLine("mutex fixture child: " + mode + ", session=" + Process.GetCurrentProcess().SessionId);
            if (mode == "--mutex-child-global" || mode == "--mutex-child-legacy")
            {
                string name = (mode == "--mutex-child-global" ? "Global\\" : "") + LegacyMutexName(root);
                using (var native = new Mutex(false, name))
                {
                    bool acquired = native.WaitOne(0); if (acquired) native.ReleaseMutex();
                    return acquired ? ExitCodes.Success : ExitCodes.Busy;
                }
            }
            if (mode != "--mutex-child-root" && mode != "--mutex-child-other" && mode != "--mutex-child-crash") return ExitCodes.Usage;
            using (var mutex = new RootMutex(mode == "--mutex-child-other" ? root + "-other" : root))
            {
                if (!mutex.TryAcquire(0)) return ExitCodes.Busy;
                if (mode == "--mutex-child-crash") Environment.Exit(ExitCodes.CrashFault);
                return ExitCodes.Success;
            }
        }

        private static int RunMutexChild(string mode)
        {
            var start = new ProcessStartInfo(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "tests.exe"), "--mutex-child-" + mode);
            start.UseShellExecute = false; start.CreateNoWindow = true; start.RedirectStandardOutput = true; start.RedirectStandardError = true;
            using (Process child = Process.Start(start))
            {
                if (!child.WaitForExit(15000)) throw new Exception("mutex fixture child exceeded deadline");
                Console.Write(child.StandardOutput.ReadToEnd()); string error = child.StandardError.ReadToEnd();
                if (error.Length > 0) throw new Exception("mutex fixture child error: " + error);
                return child.ExitCode;
            }
        }

        private static bool AcquireElsewhere(string root)
        {
            bool acquired = false; Exception failure = null;
            var thread = new Thread(delegate () { try { using (var mutex = new RootMutex(root)) acquired = mutex.TryAcquire(0); } catch (Exception e) { failure = e; } });
            thread.Start(); if (!thread.Join(10000)) throw new Exception("mutex fixture thread exceeded deadline");
            if (failure != null) throw failure; return acquired;
        }

        private static void MutexProcessTests()
        {
            Section("Global and legacy root locks with actual child processes");
            Console.WriteLine("mutex fixture parent session=" + Process.GetCurrentProcess().SessionId);
            string root = Path.Combine(_fixtureRoot, "mutex-process"), name = LegacyMutexName(root);
            using (var mutex = new RootMutex(root))
            {
                Ok(mutex.TryAcquire(0), "parent owns the root lock pair");
                Ok(RunMutexChild("global") == ExitCodes.Busy, "independent Global namespace client is blocked");
                Ok(RunMutexChild("legacy") == ExitCodes.Busy, "legacy client in this session is blocked");
                Ok(RunMutexChild("root") == ExitCodes.Busy, "another upgraded process is blocked");
                Ok(RunMutexChild("other") == ExitCodes.Success, "different install root remains independent");
                Ok(!AcquireElsewhere(root.ToUpperInvariant() + "\\"), "case and trailing separator use the same root pair");
                Ok(mutex.TryAcquire(0), "repeat acquisition on one object is idempotent");
                bool wrongThreadRefused = false;
                var t = new Thread(delegate () { try { mutex.Release(); } catch (SynchronizationLockException) { wrongThreadRefused = true; } });
                t.Start(); t.Join(); Ok(wrongThreadRefused, "another thread cannot release or clear the owner flag");
                mutex.Release(); Ok(AcquireElsewhere(root), "one release leaves no recursive ownership behind");
            }
            using (var old = new Mutex(false, name))
            using (var globalObserver = new Mutex(false, "Global\\" + name))
            {
                old.WaitOne();
                try
                {
                    Ok(RunMutexChild("root") == ExitCodes.Busy, "legacy owner blocks the upgraded process");
                    bool abandoned = false, acquired;
                    try { acquired = globalObserver.WaitOne(0); } catch (AbandonedMutexException) { abandoned = true; acquired = true; }
                    Ok(acquired && !abandoned, "failure to get legacy lock releases Global without abandonment");
                    if (acquired) globalObserver.ReleaseMutex();
                }
                finally { old.ReleaseMutex(); }
            }
            using (var globalOnly = new Mutex(false, "Global\\" + name))
            {
                globalOnly.WaitOne(); try { Ok(RunMutexChild("root") == ExitCodes.Busy, "Global-only owner blocks upgraded process"); }
                finally { globalOnly.ReleaseMutex(); }
            }
            using (var globalObserver = new Mutex(false, "Global\\" + name))
            using (var legacyObserver = new Mutex(false, name))
            {
                Ok(RunMutexChild("crash") == ExitCodes.CrashFault, "owning child really exits with both locks held");
                using (var recovered = new RootMutex(root)) Ok(recovered.TryAcquire(0), "abandoned Global and legacy locks can be acquired for state revalidation");
                Ok(RunMutexChild("root") == ExitCodes.Success, "normal acquisition succeeds after abandonment recovery");
            }
            using (var invalid = new RootMutex(root))
            {
                bool range = false; try { invalid.TryAcquire(TimeSpan.FromMilliseconds(-2)); } catch (ArgumentOutOfRangeException) { range = true; }
                Ok(range, "invalid timeout is rejected before acquisition");
            }
        }

        private static void MutexSecurityTests()
        {
            Section("Per-user kernel object permissions; no weaker fallback");
            string root = NewFixtureDir("mutex-acl"), name = LegacyMutexName(root);
            using (WindowsIdentity current = WindowsIdentity.GetCurrent())
            using (var mutex = new RootMutex(root))
            using (var opened = Mutex.OpenExisting("Global\\" + name, MutexRights.ReadPermissions))
            {
                var security = opened.GetAccessControl(); bool userGranted = false, limited = true;
                var system = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
                foreach (MutexAccessRule rule in security.GetAccessRules(true, true, typeof(SecurityIdentifier)))
                {
                    if (!rule.IdentityReference.Equals(current.User) && !rule.IdentityReference.Equals(system)) limited = false;
                    if (rule.IdentityReference.Equals(current.User) && rule.AccessControlType == AccessControlType.Allow && (rule.MutexRights & MutexRights.FullControl) == MutexRights.FullControl) userGranted = true;
                }
                Ok(userGranted, "account SID has FullControl on the created Global object");
                Ok(limited && security.AreAccessRulesProtected, "new Global object grants only account and SYSTEM rights");
            }
            string deniedRoot = NewFixtureDir("mutex-denied");
            var denied = new MutexSecurity();
            using (WindowsIdentity current = WindowsIdentity.GetCurrent()) denied.AddAccessRule(new MutexAccessRule(current.User, MutexRights.FullControl, AccessControlType.Deny));
            bool created;
            using (var obstruction = new Mutex(false, "Global\\" + LegacyMutexName(deniedRoot), out created, denied))
            {
                bool refused = false; try { using (var mutex = new RootMutex(deniedRoot)) mutex.TryAcquire(0); } catch (EngineError e) { refused = e.Code == ExitCodes.Busy; }
                Ok(refused, "inaccessible Global object refuses instead of falling back to Local");
            }
            string collisionRoot = NewFixtureDir("mutex-collision");
            using (var obstruction = new EventWaitHandle(false, EventResetMode.ManualReset, "Global\\" + LegacyMutexName(collisionRoot)))
            {
                bool refused = false; try { using (var mutex = new RootMutex(collisionRoot)) mutex.TryAcquire(0); } catch (EngineError e) { refused = e.Code == ExitCodes.Busy; }
                Ok(refused, "wrong object type in Global refuses instead of using another name");
                obstruction.Set(); Ok(obstruction.WaitOne(0), "refusal leaves the existing object intact");
            }
        }

        private static void AllVersionsTests()
        {
            Section("InstalledState.AllVersions dedup");
            var st = new InstalledState();
            st.Current = MakeVR("v3+b", "v3", "b");
            st.Previous = MakeVR("v2+b", "v2", "b");
            st.Retained = new List<VersionRecord>();
            st.Retained.Add(MakeVR("v1+b", "v1", "b"));
            st.Retained.Add(MakeVR("v3+b", "v3", "b")); // dup of current
            List<VersionRecord> all = st.AllVersions();
            Ok(all.Count == 3, "AllVersions dedups by payloadDirname");
        }

        private static void HashingTests()
        {
            Section("Hashing.Sha256File streaming");
            string d = NewFixtureDir("hash");
            string p = d + "\\empty.bin"; File.WriteAllBytes(p, new byte[0]);
            // known SHA-256 of the empty input
            Eq(Hashing.Sha256File(p), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                "sha256 of empty file");
            string p2 = d + "\\abc.bin"; File.WriteAllBytes(p2, System.Text.Encoding.ASCII.GetBytes("abc"));
            Eq(Hashing.Sha256File(p2), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
                "sha256 of 'abc'");
        }

        // In-memory publication only; Engine.Uninstall still exercises actual
        // state validation, mutex, Win32 delete locks and filesystem deletion.
        private sealed class FileOnlyUninstallHost : IUninstallHost
        {
            public string Fault;
            public bool Shortcut = true, Registration = true, SawRetryExecutable;
            public int PublicationCalls;
            public void AssertOwned(InstalledState st, string root) { }
            public RunningScan Scan(IEnumerable<string> paths) { return new RunningScan(); }
            public void RemovePublished(InstalledState st, string root, OpReport report)
            {
                PublicationCalls++;
                SawRetryExecutable = File.Exists(Path.Combine(root, st.UninstallerName));
                if (Fault == "crash") Environment.Exit(ExitCodes.CrashFault);
                if (Fault == "shortcut") throw new IOException("synthetic late shortcut failure");
                Shortcut = false;
                if (Fault == "registry") throw new IOException("synthetic late registry failure");
                Registration = false;
                if (Fault == "metadata") File.SetAttributes(new StateStore(root).StatePath, FileAttributes.ReadOnly);
                if (Fault == "final-control") File.SetAttributes(Path.Combine(root, st.UninstallerName), FileAttributes.ReadOnly);
            }
        }

        private static InstalledState FixtureInstalledState(string root)
        {
            Identity id = Identity.ExpectedFor("test");
            var st = new InstalledState();
            st.AppId = id.AppId; st.AppName = id.AppName; st.Marker = id.Marker; st.InstallRoot = root;
            st.RegUninstallKey = id.RegUninstallKey; st.ShortcutGroup = id.ShortcutGroup;
            st.UninstallerName = id.UninstallerName; st.ExeName = id.ExeName; st.Publisher = id.Publisher;
            st.Current = MakeVR("0.1.0+x", "0.1.0", "x"); st.LastTxnId = "txn-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
            string dir = Path.Combine(Path.Combine(root, "app"), st.Current.PayloadDirname);
            Directory.CreateDirectory(dir); File.WriteAllBytes(Path.Combine(dir, st.ExeName), new byte[10]);
            File.WriteAllText(Path.Combine(dir, "user-note.txt"), "user-owned note");
            File.WriteAllText(Path.Combine(root, Identity.LauncherName), "synthetic launcher bytes");
            File.WriteAllText(Path.Combine(root, st.UninstallerName), "synthetic uninstaller bytes");
            var store = new StateStore(root); store.CommitState(st);
            st.LastTxnId = "txn-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"; store.CommitState(st);
            return st;
        }

        private static void UninstallLateFailureTests()
        {
            Section("Uninstall keeps the retry program and ownership metadata through late failures");
            foreach (string fault in new[] { "shortcut", "registry", "metadata", "final-control" })
            {
                string root = NewFixtureDir("uninstall-late-" + fault); InstalledState st = FixtureInstalledState(root);
                var store = new StateStore(root); var host = new FileOnlyUninstallHost(); host.Fault = fault;
                var engine = new Engine(host); var report = new OpReport("uninstall", root);
                var paths = new[] { store.StatePath, store.BakPath, Path.Combine(root, Identity.LauncherName), Path.Combine(root, st.UninstallerName) };
                var hashes = new Dictionary<string, string>(); foreach (string p in paths) hashes[p] = Hashing.Sha256File(p);
                bool failed = false; try { engine.Uninstall(root, st.AppId, report); } catch (IOException) { failed = true; } catch (EngineError) { failed = true; }
                Ok(failed && !report.Ok, fault + " failure is reported");
                Ok(report.Steps.Contains("deleted-owned-files"), fault + " fails after actual payload deletion");
                Ok(host.SawRetryExecutable, fault + " retry executable exists during publication cleanup");
                foreach (string p in paths) Ok(File.Exists(p) && Hashing.Sha256File(p) == hashes[p], fault + " preserves " + Path.GetFileName(p));
                foreach (string p in paths) if (File.Exists(p)) File.SetAttributes(p, FileAttributes.Normal); host.Fault = null;
                var retry = new OpReport("uninstall", root); int code = engine.Uninstall(root, st.AppId, retry);
                Ok(code == ExitCodes.Success && retry.Ok, fault + " same-root retry completes");
                Ok(!host.Shortcut && !host.Registration, fault + " publication cleanup completes");
                foreach (string p in paths) Ok(!File.Exists(p), fault + " removes " + Path.GetFileName(p) + " only after success");
                string note = Path.Combine(Path.Combine(Path.Combine(root, "app"), st.Current.PayloadDirname), "user-note.txt");
                Eq(File.ReadAllText(note), "user-owned note", fault + " preserves unknown user note");
            }

            string crashRoot = Path.Combine(_fixtureRoot, "uninstall-crash-child"); Directory.CreateDirectory(crashRoot);
            InstalledState installed = FixtureInstalledState(crashRoot); var crashStore = new StateStore(crashRoot);
            var controls = new[] { crashStore.StatePath, crashStore.BakPath, Path.Combine(crashRoot, Identity.LauncherName), Path.Combine(crashRoot, installed.UninstallerName) };
            var before = new Dictionary<string, string>(); foreach (string p in controls) before[p] = Hashing.Sha256File(p);
            var start = new ProcessStartInfo(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "tests.exe"), "--crash-after-uninstall-payload");
            start.UseShellExecute = false; start.CreateNoWindow = true;
            using (Process child = Process.Start(start))
            {
                if (!child.WaitForExit(15000)) throw new Exception("uninstall child did not exit in time");
                Ok(child.ExitCode == ExitCodes.CrashFault, "real process terminates at post-payload publication boundary");
            }
            Ok(!File.Exists(Path.Combine(Path.Combine(Path.Combine(crashRoot, "app"), installed.Current.PayloadDirname), installed.ExeName)), "crash happened after actual payload deletion");
            foreach (string p in controls) Ok(File.Exists(p) && Hashing.Sha256File(p) == before[p], "process interruption preserves " + Path.GetFileName(p));
            var recovered = new OpReport("uninstall", crashRoot);
            Ok(new Engine(new FileOnlyUninstallHost()).Uninstall(crashRoot, installed.AppId, recovered) == ExitCodes.Success && recovered.Ok, "new process can retry after prior process interruption");
            foreach (string p in controls) Ok(!File.Exists(p), "post-interruption retry removes " + Path.GetFileName(p));
        }

        private static void UninstallControlPreflightTests()
        {
            Section("Uninstall preflight protects payload and controls before any removal");
            foreach (string name in new[] { "state", "backup", "launcher", "uninstaller" })
            foreach (bool readOnly in new[] { false, true })
            {
                string root = NewFixtureDir("uninstall-control-preflight"); InstalledState st = FixtureInstalledState(root); var store = new StateStore(root);
                string file = name == "state" ? store.StatePath : name == "backup" ? store.BakPath : name == "launcher" ? Path.Combine(root, Identity.LauncherName) : Path.Combine(root, st.UninstallerName);
                var hashes = new Dictionary<string, string>(); foreach (string p in Directory.GetFiles(root, "*", SearchOption.AllDirectories)) hashes[p] = Hashing.Sha256File(p);
                var host = new FileOnlyUninstallHost(); bool blocked = false; FileStream held = null;
                try
                {
                    if (readOnly) File.SetAttributes(file, FileAttributes.ReadOnly);
                    else held = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read);
                    try { var report = new OpReport("uninstall", root); blocked = new Engine(host).Uninstall(root, st.AppId, report) == ExitCodes.Busy; }
                    catch (EngineError e) { blocked = e.Code == ExitCodes.Busy; }
                }
                finally { if (held != null) held.Dispose(); if (readOnly) File.SetAttributes(file, FileAttributes.Normal); }
                Ok(blocked, name + (readOnly ? " read-only" : " sharing lock") + " prevents uninstall");
                Ok(host.PublicationCalls == 0, name + " preflight failure never removes publication");
                bool preserved = true; foreach (var p in hashes) if (!File.Exists(p.Key) || Hashing.Sha256File(p.Key) != p.Value) preserved = false;
                Ok(preserved && Directory.GetFiles(root, "*", SearchOption.AllDirectories).Length == hashes.Count, name + " preflight preserves all files byte-for-byte");
            }
        }

        // ------------------------------------------------------------------ helpers
        private static VersionRecord MakeVR(string payload, string ver, string build)
        {
            var v = new VersionRecord();
            v.PayloadDirname = payload; v.Version = ver; v.BuildId = build; v.ExeName = "BACKSEAT.exe";
            var e = new FileEntry();
            e.Path = "BACKSEAT.exe"; e.Bytes = 10;
            e.Sha256 = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
            v.Files = new List<FileEntry>(); v.Files.Add(e);
            return v;
        }

        private static Dictionary<string, object> ProdIdentityMap(string ver, string build, string payload)
        {
            var m = new Dictionary<string, object>();
            m["marker"] = "production";
            m["version"] = ver; m["buildId"] = build; m["payloadDirname"] = payload;
            m["appId"] = "{7E3A9C21-4B6D-4F2E-9A1C-8D5F0B2E6A34}";
            m["appName"] = "BACKSEAT Studio";
            m["installSubdir"] = "BACKSEAT Studio";
            m["shortcutGroup"] = "BACKSEAT Studio";
            m["regUninstallKey"] = "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\BACKSEAT-Studio";
            m["exeName"] = "BACKSEAT.exe";
            m["uninstallerName"] = "Uninstall BACKSEAT Studio.exe";
            m["publisher"] = "Unspecified publisher (development build)";
            return m;
        }

        private static Dictionary<string, object> TestIdentityMap(string ver, string build, string payload)
        {
            var m = new Dictionary<string, object>();
            m["marker"] = "test";
            m["version"] = ver; m["buildId"] = build; m["payloadDirname"] = payload;
            m["appId"] = "{2F8B1D04-9E3A-4C77-B6A2-1C0E5D9F4B88}";
            m["appName"] = "BACKSEAT Studio (Test)";
            m["installSubdir"] = "BACKSEAT Studio (Test)";
            m["shortcutGroup"] = "BACKSEAT Studio (Test)";
            m["regUninstallKey"] = "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\BACKSEAT-Studio-Test";
            m["exeName"] = "BACKSEAT.exe";
            m["uninstallerName"] = "Uninstall BACKSEAT Studio (Test).exe";
            m["publisher"] = "Unspecified publisher (development build)";
            return m;
        }

        private static string[] Without(string drop)
        {
            var list = new List<string>();
            foreach (string s in Identity.RequiredRuntimeFiles)
                if (!string.Equals(s, drop, StringComparison.Ordinal)) list.Add(s);
            return list.ToArray();
        }

        // Build a request JSON string with the given file paths.
        private static string BuildRequest(string[] paths, string testFault, string marker)
        {
            var root = new Dictionary<string, object>();
            root["schema"] = 1;
            root["identity"] = string.Equals(marker, "test", StringComparison.Ordinal)
                ? (object)TestIdentityMap("0.0.1", "t1", "0.0.1+t1")
                : (object)ProdIdentityMap("1.2.3", "b9", "1.2.3+b9");
            root["engineSha256"] = "abababababababababababababababababababababababababababababababab";
            var files = new List<object>();
            foreach (string p in paths)
            {
                var fe = new Dictionary<string, object>();
                fe["path"] = p; fe["bytes"] = 4;
                fe["sha256"] = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
                files.Add(fe);
            }
            root["files"] = files;
            if (testFault != null) root["testFault"] = testFault;
            return Json.Serialize(root);
        }

        private static string BuildRequestSchema(int schema)
        {
            var root = new Dictionary<string, object>();
            root["schema"] = schema;
            root["identity"] = ProdIdentityMap("1.2.3", "b9", "1.2.3+b9");
            root["engineSha256"] = "abababababababababababababababababababababababababababababababab";
            var files = new List<object>();
            foreach (string p in Identity.RequiredRuntimeFiles)
            {
                var fe = new Dictionary<string, object>();
                fe["path"] = p; fe["bytes"] = 4;
                fe["sha256"] = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
                files.Add(fe);
            }
            root["files"] = files;
            return Json.Serialize(root);
        }

        private static int _fx = 0;
        private static string NewFixtureDir(string label)
        {
            _fx++;
            string d = Path.Combine(_fixtureRoot, label + "-" + _fx);
            if (Directory.Exists(d)) throw new InvalidOperationException("Fixture directory already exists");
            Directory.CreateDirectory(d);
            return d;
        }
    }
}
