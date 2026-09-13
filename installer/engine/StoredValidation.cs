using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;

namespace Backseat.Installer
{
    // Persisted data is not authority for arbitrary filesystem or registry paths.
    // Validate all records before any engine operation may use their paths.
    internal static class StoredValidation
    {
        private static void Equal(string name, string got, string expected)
        {
            if (!string.Equals(got, expected, StringComparison.Ordinal))
                throw EngineError.Ownership("stored " + name + " does not match the application identity");
        }

        public static void PathEquals(string name, string got, string expected)
        {
            string normalized = PathSafety.NormalizeAbsoluteLocalDir(got, name);
            if (!string.Equals(got, normalized, StringComparison.OrdinalIgnoreCase) ||
                !string.Equals(normalized, expected, StringComparison.OrdinalIgnoreCase))
                throw EngineError.Ownership("stored " + name + " is not the expected canonical path");
            PathSafety.AssertNoReparseInChain(normalized, new HashSet<string>());
        }

        public static void TxnId(string txn)
        {
            if (!Regex.IsMatch(txn ?? "", "^txn-[a-f0-9]{32}$"))
                throw EngineError.Validation("invalid stored transaction id");
        }

        private static Identity Fixed(string marker, string appId, string appName, string reg,
            string group, string uninstaller, string exe, string publisher)
        {
            Identity expected = Identity.ExpectedFor(marker);
            Equal("appId", appId, expected.AppId); Equal("appName", appName, expected.AppName);
            Equal("registry key", reg, expected.RegUninstallKey); Equal("shortcut group", group, expected.ShortcutGroup);
            Equal("uninstaller", uninstaller, expected.UninstallerName); Equal("executable", exe, expected.ExeName);
            Equal("publisher", publisher, expected.Publisher);
            return expected;
        }

        public static void Version(VersionRecord version, string expectedExe)
        {
            if (version == null) throw EngineError.Validation("missing stored version");
            Identity.ValidateVersion(version.Version, version.BuildId, version.PayloadDirname);
            Equal("version executable", version.ExeName, expectedExe);
            if (version.Files.Count == 0 || version.Files.Count > Limits.MaxFiles)
                throw EngineError.Validation("stored manifest file count is invalid");
            var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            long total = 0;
            foreach (FileEntry file in version.Files)
            {
                FileEntry.Parse(file.ToMap(), "stored file");
                if (!paths.Add(file.Path)) throw EngineError.Validation("duplicate stored file path");
                total += file.Bytes;
                if (total > Limits.MaxTotalBytes) throw EngineError.Validation("stored payload exceeds size bound");
            }
            // Historical versions need their own app executable, not a later
            // version's optional sound/speech feature list.
            if (!paths.Contains(expectedExe)) throw EngineError.Validation("stored manifest lacks its executable");
            foreach (string path in paths)
            {
                int slash = path.IndexOf('/');
                while (slash >= 0)
                {
                    if (paths.Contains(path.Substring(0, slash)))
                        throw EngineError.Validation("stored file/directory alias collision");
                    slash = path.IndexOf('/', slash + 1);
                }
            }
        }

        public static void State(InstalledState state, string root)
        {
            Equal("owner", state.Owner, Identity.OwnerMarker); Equal("owner guid", state.OwnerGuid, Identity.OwnerGuid);
            Fixed(state.Marker, state.AppId, state.AppName, state.RegUninstallKey, state.ShortcutGroup,
                state.UninstallerName, state.ExeName, state.Publisher);
            Equal("launcher", state.LauncherName, Identity.LauncherName);
            PathEquals("install root", state.InstallRoot, root); TxnId(state.LastTxnId);
            if (state.Current == null || state.Retained.Count > 256)
                throw EngineError.Validation("stored version history is invalid");
            var versions = new List<VersionRecord>(); versions.Add(state.Current);
            if (state.Previous != null) versions.Add(state.Previous); versions.AddRange(state.Retained);
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var cache = new HashSet<string>(); int count = 0;
            foreach (VersionRecord version in versions)
            {
                Version(version, state.ExeName);
                if (!seen.Add(version.PayloadDirname)) throw EngineError.Validation("duplicate stored version");
                count += version.Files.Count;
                if (count > Limits.MaxFiles) throw EngineError.Validation("stored version history exceeds file bound");
                string dir = Path.Combine(Path.Combine(root, "app"), version.PayloadDirname);
                foreach (FileEntry file in version.Files)
                    PathSafety.AssertNoReparseInChain(PathSafety.CombineInsideRoot(dir, file.Path, "owned file"), cache);
            }
        }

        public static void Journal(Journal journal, string root)
        {
            Fixed(journal.Marker, journal.AppId, journal.AppName, journal.RegUninstallKey, journal.ShortcutGroup,
                journal.UninstallerName, journal.ExeName, journal.Publisher);
            TxnId(journal.TxnId); Equal("journal operation", journal.Op, "install");
            if (journal.Phase != "staging" && journal.Phase != "staged" && journal.Phase != "promoted" &&
                journal.Phase != "controls-backed-up" && journal.Phase != "files" &&
                journal.Phase != "shortcut" && journal.Phase != "registry")
                throw EngineError.Validation("invalid stored transaction phase");
            Version(journal.Target, journal.ExeName);
            PathEquals("journal root", journal.Root, root);
            PathEquals("control directory", journal.ControlDir, Path.Combine(root, StateStore.ControlDirName));
            PathEquals("stage directory", journal.StageDir, Path.Combine(Path.Combine(root, "app"), ".pending-" + journal.Target.BuildId));
            PathEquals("new payload directory", journal.NewPayloadDir, Path.Combine(Path.Combine(root, "app"), journal.Target.PayloadDirname));
            if (journal.FirstInstall != (journal.PriorPayloadDirname == null))
                throw EngineError.Validation("first-install/prior-version record is inconsistent");
        }

        public static void Relationship(Journal journal, InstalledState state, string root)
        {
            Journal(journal, root);
            if (state == null)
            {
                if (!journal.FirstInstall) throw EngineError.Ownership("update journal has no committed install state");
                return;
            }
            State(state, root); Equal("journal appId", journal.AppId, state.AppId);
            if (state.LastTxnId == journal.TxnId)
            {
                if (Json.Serialize(state.Current.ToMap()) != Json.Serialize(journal.Target.ToMap()))
                    throw EngineError.Ownership("committed state does not match pending target");
                if (journal.FirstInstall && state.Previous != null)
                    throw EngineError.Ownership("first-install commit unexpectedly has a prior version");
                if (!journal.FirstInstall && journal.PriorPayloadDirname != state.Current.PayloadDirname &&
                    (state.Previous == null || journal.PriorPayloadDirname != state.Previous.PayloadDirname))
                    throw EngineError.Ownership("committed update has inconsistent prior version");
            }
            else if (journal.FirstInstall || journal.PriorPayloadDirname != state.Current.PayloadDirname)
                throw EngineError.Ownership("uncommitted journal does not reference current install state");
        }
    }
}
