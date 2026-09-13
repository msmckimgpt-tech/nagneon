using System;
using System.IO;
using System.Threading;
internal static class FixtureApp {
    private static int Main(string[] args) {
        string control = Environment.GetEnvironmentVariable("BACKSEAT_FIXTURE_CONTROL");
        if (string.IsNullOrEmpty(control) || !Directory.Exists(control)) return 0;
        using (var held = args.Length == 2 && args[0] == "--hold" ? new FileStream(args[1], FileMode.Open, FileAccess.Read, FileShare.None) : null) {
            File.WriteAllLines(Path.Combine(control, "arguments"), args);
            File.WriteAllText(Path.Combine(control, "ready"), System.Diagnostics.Process.GetCurrentProcess().Id.ToString());
            for (int i=0; i<600 && !File.Exists(Path.Combine(control, "stop")); i++) Thread.Sleep(100);
        }
        return 0;
    }
}
