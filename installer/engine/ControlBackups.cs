using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace Backseat.Installer {
    // Each pending transaction owns a small, durable backup of the stable
    // launcher and uninstaller. Payload metadata alone cannot restore these.
    internal static class ControlBackups {
        private static string Folder(string root, Journal journal) {
            if (!Regex.IsMatch(journal.TxnId ?? "", "^txn-[a-f0-9]{32}$"))
                throw EngineError.Ownership("invalid control backup transaction id");
            Identity expected = Identity.ExpectedFor(journal.Marker);
            if (expected.AppId != journal.AppId || expected.UninstallerName != journal.UninstallerName)
                throw EngineError.Ownership("control backup identity mismatch");
            string dir = Path.Combine(Path.Combine(root, StateStore.ControlDirName), "controls-" + journal.TxnId);
            PathSafety.AssertNoReparseInChain(dir, new HashSet<string>());
            return dir;
        }
        private static string[] Names(Journal journal) {
            return new[] { Identity.LauncherName, journal.UninstallerName };
        }
        private static void DurableCopy(string source, string destination) {
            using (var input = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
                input.CopyTo(output); output.Flush(true);
            }
        }
        public static void Prepare(string root, Journal journal) {
            if (journal.FirstInstall) return;
            string dir = Folder(root, journal);
            if (Directory.Exists(dir) || File.Exists(dir)) throw EngineError.Ownership("control backup path already exists");
            Directory.CreateDirectory(dir);
            var files = new List<object>();
            foreach (string name in Names(journal)) {
                string source = Path.Combine(root, name), backup = Path.Combine(dir, name);
                PathSafety.AssertNoReparseInChain(source, new HashSet<string>());
                DurableCopy(source, backup);
                var entry = new FileEntry(); entry.Path = name; entry.Bytes = new FileInfo(backup).Length;
                entry.Sha256 = Hashing.Sha256File(backup); files.Add(entry.ToMap());
            }
            var manifest = new Dictionary<string, object>();
            manifest["txnId"] = journal.TxnId; manifest["appId"] = journal.AppId; manifest["files"] = files;
            byte[] bytes = new UTF8Encoding(false).GetBytes(Json.Serialize(manifest));
            using (var output = new FileStream(Path.Combine(dir, "manifest.json"), FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
                output.Write(bytes, 0, bytes.Length); output.Flush(true);
            }
        }
        public static void Restore(string root, Journal journal) {
            if (journal.FirstInstall) return;
            // The journal is flushed to this phase BEFORE the first overwrite.
            if (journal.Phase == "staging" || journal.Phase == "promoted" || journal.Phase == "staged") return;
            string dir = Folder(root, journal), manifestPath = Path.Combine(dir, "manifest.json");
            PathSafety.AssertNoReparseInChain(manifestPath, new HashSet<string>());
            var manifest = Json.AsObject(Json.Parse(File.ReadAllText(manifestPath)), "control backups");
            if (Json.GetString(manifest, "txnId", "backups") != journal.TxnId || Json.GetString(manifest, "appId", "backups") != journal.AppId)
                throw EngineError.Ownership("control backup manifest ownership mismatch");
            object[] raw = Json.AsArray(Json.Get(manifest, "files"), "backups.files");
            string[] names = Names(journal);
            if (raw.Length != names.Length) throw EngineError.Validation("incomplete control backups");
            var entries = new List<FileEntry>();
            for (int i=0; i<raw.Length; i++) {
                FileEntry entry = FileEntry.Parse(Json.AsObject(raw[i], "backup"), "backup");
                if (entry.Path != names[i]) throw EngineError.Ownership("unexpected control backup name");
                string path = Path.Combine(dir, entry.Path);
                PathSafety.AssertNoReparseInChain(path, new HashSet<string>());
                if (!File.Exists(path) || new FileInfo(path).Length != entry.Bytes || Hashing.Sha256File(path) != entry.Sha256)
                    throw EngineError.Validation("control backup integrity failed");
                entries.Add(entry);
            }
            // Validate the entire backup before restoring either published file.
            for (int i=0; i<entries.Count; i++) {
                FileEntry entry = entries[i];
                string temp = Path.Combine(dir, "restore-" + i), destination = Path.Combine(root, entry.Path);
                PathSafety.AssertNoReparseInChain(destination, new HashSet<string>());
                PathSafety.AssertNoReparseInChain(temp, new HashSet<string>());
                if (!File.Exists(temp)) DurableCopy(Path.Combine(dir, entry.Path), temp);
                if (new FileInfo(temp).Length != entry.Bytes || Hashing.Sha256File(temp) != entry.Sha256)
                    throw EngineError.Validation("control restore temporary file integrity failed");
                if (File.Exists(destination)) File.Replace(temp, destination, null);
                else File.Move(temp, destination);
            }
        }
        public static void Cleanup(string root, Journal journal) {
            if (journal.FirstInstall) return;
            string dir = Folder(root, journal);
            if (!Directory.Exists(dir)) return;
            var names = new List<string>(Names(journal)); names.Add("manifest.json"); names.Add("restore-0"); names.Add("restore-1");
            foreach (string name in names) {
                string path = Path.Combine(dir, name);
                PathSafety.AssertNoReparseInChain(path, new HashSet<string>());
                if (File.Exists(path)) File.Delete(path);
            }
            // Unrecognised user files are left untouched.
            if (Directory.GetFileSystemEntries(dir).Length == 0) Directory.Delete(dir, false);
        }
    }
}
