using System;
using System.Collections.Generic;
using System.IO;

namespace Backseat.Installer
{
    // Keep Windows publication separate from filesystem removal so late failures
    // can be reproduced without touching HKCU, Start Menu, or other processes.
    internal interface IUninstallHost
    {
        void AssertOwned(InstalledState state, string root);
        RunningScan Scan(IEnumerable<string> paths);
        void RemovePublished(InstalledState state, string root, OpReport report);
    }

    internal sealed class WindowsUninstallHost : IUninstallHost
    {
        public void AssertOwned(InstalledState st, string root)
        {
            RegistryOps.AssertPublishable(st.RegUninstallKey, st.AppId, root);
            ShortcutOps.AssertPublishable(ShortcutOps.ShortcutPath(st.ShortcutGroup, st.AppName), Path.Combine(root, Identity.LauncherName));
        }
        public RunningScan Scan(IEnumerable<string> paths) { return ProcessScan.ScanForOwnedExes(paths); }
        public void RemovePublished(InstalledState st, string root, OpReport report)
        {
            string launcher = Path.Combine(root, Identity.LauncherName);
            string lnk = ShortcutOps.ShortcutPath(st.ShortcutGroup, st.AppName);
            if (ShortcutOps.DeleteIfOwned(lnk, launcher))
            {
                report.Step("removed-shortcut");
                Engine.TryRemoveEmptyDir(ShortcutOps.GroupDir(st.ShortcutGroup));
            }
            else if (File.Exists(lnk)) report.AddLeftover("startmenu:" + st.AppName + ".lnk (target not owned)");
            if (RegistryOps.DeleteUninstallEntryIfOwned(st.RegUninstallKey, st.AppId, root)) report.Step("removed-registry");
            else report.AddLeftover("hkcu:" + st.RegUninstallKey + " (not owned)");
        }
    }
}
