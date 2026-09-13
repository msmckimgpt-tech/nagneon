// installer/engine/WindowsResources.cs
// ---------------------------------------------------------------------------
// The three "published" Windows resources the engine owns, plus the delete-lock
// batch used by uninstall:
//
//   RegistryOps  - HKCU Add/Remove Programs entry (never HKLM, never elevates).
//                  Ownership is validated (AppId + InstallLocation) before delete.
//   ShortcutOps  - per-user Start Menu .lnk via IShellLink, target = stable
//                  launcher. The link's target is validated before deletion so
//                  a user-replaced shortcut is never removed.
//   DeleteLockBatch - opens ALL owned files with exclusive, delete-on-close
//                  handles BEFORE any deletion. If every file opens, no other
//                  process holds them AND none can be started (a direct-EXE
//                  launch is blocked while we hold the handles); closing the
//                  handles deletes them. If ANY file is locked, the armed
//                  deletes are CANCELLED so nothing is removed. No process kills.
// ---------------------------------------------------------------------------

using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

namespace Backseat.Installer
{
    internal static class RegistryOps
    {
        public static void AssertPublishable(string regKey, string expectedAppId, string root)
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(regKey, false))
            {
                if (key == null) return;
                if (!string.Equals(key.GetValue("AppId") as string, expectedAppId, StringComparison.Ordinal) ||
                    !string.Equals(key.GetValue("InstallLocation") as string, root, StringComparison.OrdinalIgnoreCase))
                    throw EngineError.Ownership("existing uninstall registration belongs to a different identity or location");
            }
        }

        public static void WriteUninstallEntry(InstalledState st, string root,
            string launcherPath, string uninstallerPath, long estimatedSizeKb)
        {
            AssertPublishable(st.RegUninstallKey, st.AppId, root);
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(st.RegUninstallKey))
            {
                if (key == null) throw new EngineError(ExitCodes.RolledBack,
                    "could not open HKCU uninstall key");
                key.SetValue("DisplayName", st.AppName, RegistryValueKind.String);
                key.SetValue("DisplayVersion", st.Current.Version, RegistryValueKind.String);
                key.SetValue("Publisher", st.Publisher ?? "", RegistryValueKind.String);
                key.SetValue("DisplayIcon", launcherPath, RegistryValueKind.String);
                key.SetValue("InstallLocation", root, RegistryValueKind.String);
                key.SetValue("UninstallString", "\"" + uninstallerPath + "\"", RegistryValueKind.String);
                key.SetValue("AppId", st.AppId, RegistryValueKind.String);
                key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                key.SetValue("EstimatedSize", (int)Math.Min(int.MaxValue, estimatedSizeKb),
                    RegistryValueKind.DWord);
            }
        }

        // Delete the HKCU key only if it is demonstrably ours (AppId + root match).
        // Returns true if deleted, false if left in place (ownership mismatch).
        public static bool DeleteUninstallEntryIfOwned(string regKey, string expectedAppId, string root)
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(regKey, false))
            {
                if (key == null) return true; // already gone
                object appId = key.GetValue("AppId");
                object loc = key.GetValue("InstallLocation");
                bool owned = appId is string &&
                    string.Equals((string)appId, expectedAppId, StringComparison.Ordinal) &&
                    loc is string &&
                    string.Equals(PathSafety.TrimTrailingSep((string)loc),
                        PathSafety.TrimTrailingSep(root), StringComparison.OrdinalIgnoreCase);
                if (!owned) return false;
            }
            Registry.CurrentUser.DeleteSubKeyTree(regKey, false);
            return true;
        }

        public static string ReadAppId(string regKey)
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(regKey, false))
            {
                if (key == null) return null;
                return key.GetValue("AppId") as string;
            }
        }
    }

    internal static class ShortcutOps
    {
        public static void AssertPublishable(string lnkPath, string targetLauncher)
        {
            PathSafety.AssertNoReparseInChain(lnkPath, new HashSet<string>());
            if (Directory.Exists(lnkPath)) throw EngineError.Ownership("shortcut path is occupied by a directory");
            if (!File.Exists(lnkPath)) return;
            if (!string.Equals(ReadTarget(lnkPath), targetLauncher, StringComparison.OrdinalIgnoreCase))
                throw EngineError.Ownership("existing shortcut does not belong to this install location");
        }

        // %APPDATA%\Microsoft\Windows\Start Menu\Programs\<group>\<appName>.lnk
        public static string ShortcutPath(string shortcutGroup, string appName)
        {
            string programs = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
            return Path.Combine(Path.Combine(programs, shortcutGroup), appName + ".lnk");
        }

        public static string GroupDir(string shortcutGroup)
        {
            string programs = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
            return Path.Combine(programs, shortcutGroup);
        }

        public static void Create(string lnkPath, string targetLauncher, string workingDir, string description)
        {
            AssertPublishable(lnkPath, targetLauncher);
            string dir = Path.GetDirectoryName(lnkPath);
            if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
            string temp = Path.Combine(dir, ".backseat-link-" + Guid.NewGuid().ToString("N") + ".tmp");
            var link = (NativeMethods.IShellLinkW)new NativeMethods.CShellLink();
            try
            {
                var pf = (NativeMethods.IPersistFile)link;
                // Preserve application arguments and shell preferences a user
                // added to an already-owned link.
                if (File.Exists(lnkPath)) pf.Load(lnkPath, NativeMethods.STGM_READ);
                link.SetPath(targetLauncher);
                link.SetWorkingDirectory(workingDir);
                link.SetIconLocation(targetLauncher, 0);
                if (!string.IsNullOrEmpty(description))
                    link.SetDescription(description.Length > 250 ? description.Substring(0, 250) : description);
                pf.Save(temp, true);
                AssertPublishable(lnkPath, targetLauncher);
                if (File.Exists(lnkPath)) File.Replace(temp, lnkPath, null);
                else File.Move(temp, lnkPath);
            }
            finally
            {
                Marshal.ReleaseComObject(link);
                if (File.Exists(temp)) File.Delete(temp);
            }
        }

        public static string ReadTarget(string lnkPath)
        {
            if (!File.Exists(lnkPath)) return null;
            var link = (NativeMethods.IShellLinkW)new NativeMethods.CShellLink();
            try
            {
                var pf = (NativeMethods.IPersistFile)link;
                pf.Load(lnkPath, NativeMethods.STGM_READ);
                var sb = new StringBuilder(1024);
                link.GetPath(sb, sb.Capacity, IntPtr.Zero, 0);
                return sb.ToString();
            }
            catch
            {
                return null;
            }
            finally
            {
                Marshal.ReleaseComObject(link);
            }
        }

        // Delete only if the .lnk points at our launcher. Returns true if removed
        // or already absent; false if left in place (target mismatch/unreadable).
        public static bool DeleteIfOwned(string lnkPath, string ownedLauncherPath)
        {
            if (!File.Exists(lnkPath)) return true;
            string target = ReadTarget(lnkPath);
            if (target == null) return false;
            if (!string.Equals(PathSafety.TrimTrailingSep(target),
                    PathSafety.TrimTrailingSep(ownedLauncherPath), StringComparison.OrdinalIgnoreCase))
                return false;
            File.Delete(lnkPath);
            return true;
        }
    }

    // Result of the process scan (informational; the lock batch is authoritative).
    internal sealed class RunningScan
    {
        public bool AnyRunning;
        public readonly List<string> Details = new List<string>();
    }

    internal static class ProcessScan
    {
        // Best-effort: report if any running process's main module is one of the
        // exact owned executables. Access failures are ignored (the delete-lock
        // batch is the authoritative gate); this only sharpens the message.
        public static RunningScan ScanForOwnedExes(IEnumerable<string> ownedExePaths)
        {
            var scan = new RunningScan();
            var norm = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string p in ownedExePaths) norm.Add(PathSafety.TrimTrailingSep(p));
            System.Diagnostics.Process[] procs;
            try { procs = System.Diagnostics.Process.GetProcesses(); }
            catch { return scan; }
            foreach (var p in procs)
            {
                try
                {
                    string mf = p.MainModule != null ? p.MainModule.FileName : null;
                    if (mf != null && norm.Contains(PathSafety.TrimTrailingSep(mf)))
                    {
                        scan.AnyRunning = true;
                        scan.Details.Add(Path.GetFileName(mf));
                    }
                }
                catch { /* inaccessible process; ignore */ }
                finally { try { p.Dispose(); } catch { } }
            }
            return scan;
        }
    }

    // Opens every owned file with an exclusive handle (DELETE access, share-DELETE
    // only) BEFORE any deletion. While these handles are held, no other process
    // can open the file for read/execute, so a direct-EXE launch is blocked and
    // any already-running instance is detected (its open conflicts with ours).
    //
    // Deletion is ARMED ONLY AT COMMIT: TryOpenAll merely locks. If a lock is
    // found or the caller aborts, we simply close the handles and NOTHING is
    // deleted (trivially all-or-nothing). At commit we set the delete disposition
    // on every held handle, then close them, which removes each owned file.
    internal sealed class DeleteLockBatch : IDisposable
    {
        private readonly List<KeyValuePair<string, SafeFileHandle>> _opened =
            new List<KeyValuePair<string, SafeFileHandle>>();
        public readonly List<string> Missing = new List<string>();
        public string LockedPath;      // first path that was locked, if any

        // Lock all paths. Returns false on the first genuine lock (caller should
        // Dispose, which just closes handles — nothing is deleted). Missing files
        // are skipped (already gone).
        public bool TryOpenAll(IEnumerable<string> paths)
        {
            foreach (string path in paths)
            {
                // FILE_FLAG_OPEN_REPARSE_POINT: never follow a junction/symlink.
                // For a normal file this flag is ignored, so ordinary owned files
                // open and delete as usual; but if an owned path was swapped for a
                // reparse point, we open (and, on commit, delete) the LINK itself
                // and never its target — so we can never delete foreign/unowned
                // data through an alias. A directory reparse point opened without
                // BACKUP_SEMANTICS fails here, which the caller treats as a lock
                // (fail-closed: nothing is deleted).
                SafeFileHandle h = NativeMethods.CreateFileW(
                    path,
                    NativeMethods.DELETE,
                    NativeMethods.FILE_SHARE_DELETE,
                    IntPtr.Zero,
                    NativeMethods.OPEN_EXISTING,
                    NativeMethods.FILE_FLAG_OPEN_REPARSE_POINT,
                    IntPtr.Zero);
                if (h.IsInvalid)
                {
                    int err = Marshal.GetLastWin32Error();
                    h.Dispose();
                    if (err == NativeMethods.ERROR_FILE_NOT_FOUND || err == NativeMethods.ERROR_PATH_NOT_FOUND)
                    {
                        Missing.Add(path);
                        continue;
                    }
                    LockedPath = path;
                    return false;
                }
                _opened.Add(new KeyValuePair<string, SafeFileHandle>(path, h));
            }
            return true;
        }

        public int OpenedCount { get { return _opened.Count; } }

        // Arm delete disposition on every held handle, then close them all. Each
        // owned file is removed when its (only) handle closes. Returns the paths
        // that unexpectedly still exist afterwards (reported as leftovers).
        public List<string> CommitDeletions()
        {
            foreach (var kv in _opened)
            {
                var info = new NativeMethods.FILE_DISPOSITION_INFO();
                info.DeleteFile = 1;
                if (!NativeMethods.SetFileInformationByHandle(kv.Value,
                    NativeMethods.FileDispositionInfo, ref info,
                    (uint)Marshal.SizeOf(typeof(NativeMethods.FILE_DISPOSITION_INFO))))
                {
                    bool cancelled = true;
                    foreach (var opened in _opened)
                    {
                        var cancel = new NativeMethods.FILE_DISPOSITION_INFO();
                        cancel.DeleteFile = 0;
                        if (!NativeMethods.SetFileInformationByHandle(opened.Value,
                            NativeMethods.FileDispositionInfo, ref cancel,
                            (uint)Marshal.SizeOf(typeof(NativeMethods.FILE_DISPOSITION_INFO)))) cancelled = false;
                    }
                    if (!cancelled) throw EngineError.Unrecoverable("could not cancel all pending file deletions; install state retained for recovery");
                    throw EngineError.Busy("could not mark an owned file for deletion; cancelled all deletions");
                }
            }
            var paths = new List<string>();
            foreach (var kv in _opened) { paths.Add(kv.Key); kv.Value.Dispose(); }
            _opened.Clear();
            var stillPresent = new List<string>();
            foreach (string p in paths)
            {
                try { if (File.Exists(p)) stillPresent.Add(p); }
                catch { }
            }
            return stillPresent;
        }

        // Close all handles without arming deletion: nothing is deleted.
        public void Dispose()
        {
            foreach (var kv in _opened) kv.Value.Dispose();
            _opened.Clear();
        }
    }

}
