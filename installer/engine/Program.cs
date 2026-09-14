// installer/engine/Program.cs
// ---------------------------------------------------------------------------
// Entry point + CLI dispatch for the single-binary BACKSEAT installer engine.
//
// Positional CLI contract (agreed with the parent's NSIS integration):
//   InstallEngine.exe install   REQUEST_JSON SOURCE_DIRECTORY INSTALL_ROOT NEW_UNINSTALLER_EXE REPORT_JSON
//   InstallEngine.exe uninstall INSTALL_ROOT EXPECTED_APP_ID REPORT_JSON
//   InstallEngine.exe recover   INSTALL_ROOT EXPECTED_APP_ID REPORT_JSON
//   <installed root>\Nagneon Launcher.exe            (no args -> launcher mode)
//
// Exit 0 on success; any non-zero code is a failure (including app-running/busy).
// A bounded, credential-free JSON report is ALWAYS written to REPORT_JSON and
// echoed to stdout for the CLI operations. Crash faults (test only) exit 79
// intentionally without a report, to be finished by a later `recover`.
// ---------------------------------------------------------------------------

using System;
using System.IO;
using System.Reflection;

namespace Backseat.Installer
{
    internal static class Program
    {
        private static int Main(string[] args)
        {
            // Installed launcher arguments belong to the app, including words
            // that happen to match an installer operation.
            if (args.Length == 0 || string.Equals(Path.GetFileName(Assembly.GetExecutingAssembly().Location),
                    Identity.LauncherName, StringComparison.OrdinalIgnoreCase))
                return new Engine().RunLauncher(args);

            string op = args[0];
            string reportPath;
            string rootArgForReport;

            if (op == "install")
            {
                if (args.Length != 6)
                {
                    Console.Error.WriteLine("usage: install REQUEST_JSON SOURCE_DIRECTORY INSTALL_ROOT NEW_UNINSTALLER_EXE REPORT_JSON");
                    return ExitCodes.Usage;
                }
                reportPath = args[5];
                rootArgForReport = args[3];
            }
            else if (op == "uninstall" || op == "recover")
            {
                if (args.Length != 4)
                {
                    Console.Error.WriteLine("usage: " + op + " INSTALL_ROOT EXPECTED_APP_ID REPORT_JSON");
                    return ExitCodes.Usage;
                }
                reportPath = args[3];
                rootArgForReport = args[1];
            }
            else
            {
                Console.Error.WriteLine("unknown operation: " + op +
                    " (expected install|uninstall|recover, or no args for launcher)");
                return ExitCodes.Usage;
            }

            var report = new OpReport(op, rootArgForReport);
            var engine = new Engine();
            int code;
            try
            {
                if (op == "install")
                    code = engine.Install(args[1], args[2], args[3], args[4], report);
                else if (op == "uninstall")
                    code = engine.Uninstall(args[1], args[2], report);
                else
                    code = engine.Recover(args[1], args[2], report);
            }
            catch (EngineError ee)
            {
                report.Ok = false;
                report.Error = ee.Message;
                code = ee.Code;
            }
            catch (Exception ex)
            {
                report.Ok = false;
                report.Error = "unexpected: " + ex.GetType().Name + ": " + ex.Message;
                code = ExitCodes.Unrecoverable;
            }

            report.Emit(reportPath);
            return code;
        }
    }
}
