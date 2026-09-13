// installer/engine/StateStore.cs
// ---------------------------------------------------------------------------
// Persistent, owned control metadata for one install root.
//
//   <root>\.backseat\state.json       authoritative committed state
//   <root>\.backseat\state.json.bak   previous committed state (rollback aid)
//   <root>\.backseat\pending.json     the transaction journal (present iff a
//                                      transaction is unresolved)
//
// The single durable COMMIT point is state.json: its lastTxnId is written only
// when the whole transaction is being published. Recovery compares the journal
// txnId to state.lastTxnId to decide roll-forward vs roll-back. We do NOT claim
// a single atomic multi-resource transaction — see Engine.cs / README.
//
// state.json is committed with fsync + File.Replace (atomic rename on NTFS,
// preserving the .bak). This is durable for the FILE; NTFS directory-entry
// durability is not separately fsync-able from managed code (documented limit).
// ---------------------------------------------------------------------------

using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace Backseat.Installer
{
    internal sealed class InstalledState
    {
        public const int Schema = 1;

        public string Owner = Identity.OwnerMarker;
        public string OwnerGuid = Identity.OwnerGuid;
        public string AppId;
        public string AppName;
        public string Marker;
        public string InstallRoot;      // normalized
        public string RegUninstallKey;
        public string ShortcutGroup;
        public string LauncherName = Identity.LauncherName;
        public string UninstallerName;
        public string ExeName;
        public string Publisher;

        public VersionRecord Current;
        public VersionRecord Previous;                       // may be null
        public List<VersionRecord> Retained = new List<VersionRecord>();
        public string LastTxnId;

        public Dictionary<string, object> ToMap()
        {
            var m = new Dictionary<string, object>();
            m["schema"] = Schema;
            m["owner"] = Owner;
            m["ownerGuid"] = OwnerGuid;
            m["appId"] = AppId;
            m["appName"] = AppName;
            m["marker"] = Marker;
            m["installRoot"] = InstallRoot;
            m["regUninstallKey"] = RegUninstallKey;
            m["shortcutGroup"] = ShortcutGroup;
            m["launcherName"] = LauncherName;
            m["uninstallerName"] = UninstallerName;
            m["exeName"] = ExeName;
            m["publisher"] = Publisher;
            m["current"] = Current != null ? Current.ToMap() : null;
            m["previous"] = Previous != null ? Previous.ToMap() : null;
            var ret = new List<object>();
            foreach (var v in Retained) ret.Add(v.ToMap());
            m["retained"] = ret;
            m["lastTxnId"] = LastTxnId;
            return m;
        }

        public static InstalledState FromMap(Dictionary<string, object> m)
        {
            long schema = Json.GetLong(m, "schema", "state");
            if (schema != Schema) throw EngineError.Validation("unsupported state schema: " + schema);
            var s = new InstalledState();
            s.Owner = Json.GetString(m, "owner", "state");
            s.OwnerGuid = Json.GetString(m, "ownerGuid", "state");
            if (s.Owner != Identity.OwnerMarker || s.OwnerGuid != Identity.OwnerGuid)
                throw EngineError.Ownership("state owner marker does not belong to this engine");
            s.AppId = Json.GetString(m, "appId", "state");
            s.AppName = Json.GetString(m, "appName", "state");
            s.Marker = Json.GetString(m, "marker", "state");
            s.InstallRoot = Json.GetString(m, "installRoot", "state");
            s.RegUninstallKey = Json.GetString(m, "regUninstallKey", "state");
            s.ShortcutGroup = Json.GetString(m, "shortcutGroup", "state");
            s.LauncherName = Json.GetString(m, "launcherName", "state");
            s.UninstallerName = Json.GetString(m, "uninstallerName", "state");
            s.ExeName = Json.GetString(m, "exeName", "state");
            s.Publisher = Json.GetStringOrNull(m, "publisher");
            object cur = Json.Get(m, "current");
            s.Current = cur == null ? null : VersionRecord.FromMap(Json.AsObject(cur, "state.current"));
            object prev = Json.Get(m, "previous");
            s.Previous = prev == null ? null : VersionRecord.FromMap(Json.AsObject(prev, "state.previous"));
            object ret = Json.Get(m, "retained");
            if (ret != null)
                foreach (object o in Json.AsArray(ret, "state.retained"))
                    s.Retained.Add(VersionRecord.FromMap(Json.AsObject(o, "state.retained[]")));
            s.LastTxnId = Json.GetStringOrNull(m, "lastTxnId");
            return s;
        }

        // Every owned version (current + previous + retained), de-duplicated by
        // payload dir name. Uninstall must remove ALL of these.
        public List<VersionRecord> AllVersions()
        {
            var list = new List<VersionRecord>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (Current != null && seen.Add(Current.PayloadDirname)) list.Add(Current);
            if (Previous != null && seen.Add(Previous.PayloadDirname)) list.Add(Previous);
            foreach (var v in Retained) if (seen.Add(v.PayloadDirname)) list.Add(v);
            return list;
        }
    }

    // The durable transaction journal. Carries everything recovery needs even
    // if state.json does not yet exist (first install).
    internal sealed class Journal
    {
        public const int Schema = 1;

        public string TxnId;
        public string Op;            // "install"
        public string Phase;         // staged|promoted|files|shortcut|registry
        public string AppId;
        public string AppName;
        public string Marker;
        public string RegUninstallKey;
        public string ShortcutGroup;
        public string UninstallerName;
        public string ExeName;
        public string Publisher;
        public string Root;
        public string ControlDir;
        public string StageDir;
        public string NewPayloadDir;
        public VersionRecord Target;
        public bool FirstInstall;
        public string PriorPayloadDirname;   // committed current before this txn

        public Dictionary<string, object> ToMap()
        {
            var m = new Dictionary<string, object>();
            m["schema"] = Schema;
            m["txnId"] = TxnId;
            m["op"] = Op;
            m["phase"] = Phase;
            m["appId"] = AppId;
            m["appName"] = AppName;
            m["marker"] = Marker;
            m["regUninstallKey"] = RegUninstallKey;
            m["shortcutGroup"] = ShortcutGroup;
            m["uninstallerName"] = UninstallerName;
            m["exeName"] = ExeName;
            m["publisher"] = Publisher;
            m["root"] = Root;
            m["controlDir"] = ControlDir;
            m["stageDir"] = StageDir;
            m["newPayloadDir"] = NewPayloadDir;
            m["target"] = Target != null ? Target.ToMap() : null;
            m["firstInstall"] = FirstInstall;
            m["priorPayloadDirname"] = PriorPayloadDirname;
            return m;
        }

        public static Journal FromMap(Dictionary<string, object> m)
        {
            long schema = Json.GetLong(m, "schema", "journal");
            if (schema != Schema) throw EngineError.Validation("unsupported journal schema: " + schema);
            var j = new Journal();
            j.TxnId = Json.GetString(m, "txnId", "journal");
            j.Op = Json.GetString(m, "op", "journal");
            j.Phase = Json.GetString(m, "phase", "journal");
            j.AppId = Json.GetString(m, "appId", "journal");
            j.AppName = Json.GetString(m, "appName", "journal");
            j.Marker = Json.GetString(m, "marker", "journal");
            j.RegUninstallKey = Json.GetString(m, "regUninstallKey", "journal");
            j.ShortcutGroup = Json.GetString(m, "shortcutGroup", "journal");
            j.UninstallerName = Json.GetString(m, "uninstallerName", "journal");
            j.ExeName = Json.GetString(m, "exeName", "journal");
            j.Publisher = Json.GetStringOrNull(m, "publisher");
            j.Root = Json.GetString(m, "root", "journal");
            j.ControlDir = Json.GetString(m, "controlDir", "journal");
            j.StageDir = Json.GetString(m, "stageDir", "journal");
            j.NewPayloadDir = Json.GetString(m, "newPayloadDir", "journal");
            object t = Json.Get(m, "target");
            j.Target = t == null ? null : VersionRecord.FromMap(Json.AsObject(t, "journal.target"));
            object fi = Json.Get(m, "firstInstall");
            if (!(fi is bool)) throw EngineError.Validation("journal.firstInstall must be a boolean");
            j.FirstInstall = (bool)fi;
            j.PriorPayloadDirname = Json.GetStringOrNull(m, "priorPayloadDirname");
            return j;
        }
    }

    internal sealed class StateStore
    {
        private readonly string Root;
        public readonly string ControlDir;
        public readonly string StatePath;
        public readonly string BakPath;
        public readonly string JournalPath;

        public const string ControlDirName = ".backseat";

        public StateStore(string root)
        {
            Root = PathSafety.NormalizeAbsoluteLocalDir(root, "state store root");
            ControlDir = Path.Combine(root, ControlDirName);
            StatePath = Path.Combine(ControlDir, "state.json");
            BakPath = Path.Combine(ControlDir, "state.json.bak");
            JournalPath = Path.Combine(ControlDir, "pending.json");
        }

        public void EnsureControlDir()
        {
            if (Directory.Exists(ControlDir))
            {
                if (PathSafety.IsReparsePoint(ControlDir))
                    throw EngineError.Ownership("control dir is a reparse point: " + PathSafety.Clip(ControlDir));
                return;
            }
            Directory.CreateDirectory(ControlDir);
        }

        public bool HasState() { return ExistsMetadata(StatePath); }
        public bool HasJournal() { return ExistsMetadata(JournalPath); }

        private static bool ExistsMetadata(string path)
        {
            PathSafety.AssertNoReparseInChain(path, new HashSet<string>());
            if (Directory.Exists(path)) throw EngineError.Ownership("metadata path is a directory");
            return File.Exists(path);
        }

        private static string ReadDocument(string path)
        {
            if (!ExistsMetadata(path)) return null;
            if (!PathSafety.IsRegularFile(path)) throw EngineError.Ownership("metadata must be a regular file");
            try
            {
                using (var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
                {
                    if (input.Length > Json.MaxJsonLength) throw EngineError.Validation("metadata file exceeds size bound");
                    using (var reader = new StreamReader(input, new UTF8Encoding(false, true), true)) return reader.ReadToEnd();
                }
            }
            catch (IOException error)
            {
                int code = error.HResult & 0xffff;
                if (code == NativeMethods.ERROR_SHARING_VIOLATION || code == NativeMethods.ERROR_LOCK_VIOLATION)
                    throw EngineError.Busy("install metadata is locked; retry after the other process closes it");
                throw;
            }
        }

        public InstalledState ReadState()
        {
            string text = ReadDocument(StatePath);
            if (text == null) return null;
            InstalledState state = InstalledState.FromMap(Json.AsObject(Json.Parse(text), "state"));
            StoredValidation.State(state, Root);
            return state;
        }

        public Journal ReadJournal()
        {
            string text = ReadDocument(JournalPath);
            if (text == null) return null;
            Journal journal = Journal.FromMap(Json.AsObject(Json.Parse(text), "journal"));
            StoredValidation.Journal(journal, Root);
            return journal;
        }

        // Atomic journal write: fsync a temp then rename over pending.json, so a
        // crash mid-write can never leave a torn/unparseable journal (which would
        // otherwise wedge every later install/uninstall/recover on ReadJournal).
        public void WriteJournal(Journal j)
        {
            StoredValidation.Journal(j, Root);
            Journal prior = ReadJournal();
            if (prior != null && prior.TxnId != j.TxnId) throw EngineError.Ownership("another transaction owns the existing journal");
            EnsureControlDir();
            WriteAtomic(JournalPath, Json.Serialize(j.ToMap()), null);
        }

        public void DeleteJournal()
        {
            if (ExistsMetadata(JournalPath)) { ReadJournal(); File.Delete(JournalPath); }
        }

        // THE commit. Atomic file replace + fsync. lastTxnId inside the state is
        // what makes the whole transaction "committed".
        public void CommitState(InstalledState st)
        {
            StoredValidation.State(st, Root);
            InstalledState prior = ReadState();
            if (prior != null && prior.AppId != st.AppId) throw EngineError.Ownership("another identity owns the existing state");
            ValidateBackup(st.AppId);
            EnsureControlDir();
            WriteAtomic(StatePath, Json.Serialize(st.ToMap()), BakPath);
        }

        public void ValidateBackup(string appId)
        {
            string backup = ReadDocument(BakPath);
            if (backup != null)
            {
                InstalledState old = InstalledState.FromMap(Json.AsObject(Json.Parse(backup), "state backup"));
                StoredValidation.State(old, Root);
                if (old.AppId != appId) throw EngineError.Ownership("another identity owns the state backup");
            }
        }

        private static void WriteAtomic(string path, string json, string backup)
        {
            byte[] bytes = new UTF8Encoding(false).GetBytes(json);
            // Never truncate an unknown fixed-name .tmp left beside metadata.
            string tmp = path + ".write-" + Guid.NewGuid().ToString("N"); bool created = false;
            try
            {
                using (var fs = new FileStream(tmp, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1 << 16, FileOptions.WriteThrough))
                { created = true; fs.Write(bytes, 0, bytes.Length); fs.Flush(true); }
                if (ExistsMetadata(path)) File.Replace(tmp, path, backup, true);
                else File.Move(tmp, path);
            }
            finally { if (created && File.Exists(tmp)) File.Delete(tmp); }
        }

        public static void SafeDelete(string path)
        {
            try { if (File.Exists(path)) File.Delete(path); }
            catch { /* best effort for transient temp files only */ }
        }
    }
}
