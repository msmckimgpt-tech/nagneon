// installer/engine/Report.cs
// ---------------------------------------------------------------------------
// The operation report. Shape (agreed with the parent):
//   {ok, operation, root, error?, current?, previous?, recovered?, leftovers?, steps:[]}
// It is ALWAYS written to REPORT_JSON (best-effort) and echoed to stdout, is
// bounded, and never contains credentials or paths outside the install root.
// ---------------------------------------------------------------------------

using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace Backseat.Installer
{
    internal sealed class OpReport
    {
        public bool Ok;
        public string Operation;
        public string Root;
        public string Error;
        public object Current;    // brief map or null
        public object Previous;   // brief map or null
        public bool? Recovered;
        public readonly List<string> Leftovers = new List<string>();
        public readonly List<string> Steps = new List<string>();

        public OpReport(string operation, string root)
        {
            Operation = operation;
            Root = root;
        }

        public void Step(string s) { Steps.Add(s); }

        public void AddLeftover(string relOrName)
        {
            if (Leftovers.Count < Limits.MaxLeftoversReported) Leftovers.Add(relOrName);
        }

        public Dictionary<string, object> ToMap()
        {
            var m = new Dictionary<string, object>();
            m["ok"] = Ok;
            m["operation"] = Operation;
            m["root"] = Root;
            if (Error != null) m["error"] = Error;
            if (Current != null) m["current"] = Current;
            if (Previous != null) m["previous"] = Previous;
            if (Recovered.HasValue) m["recovered"] = Recovered.Value;
            if (Leftovers.Count > 0) m["leftovers"] = Leftovers;
            m["steps"] = Steps;
            return m;
        }

        public string ToJson()
        {
            return Json.Serialize(ToMap());
        }

        // Write to REPORT_JSON (best-effort, atomic) and always echo to stdout.
        public void Emit(string reportPath)
        {
            string json = ToJson();
            Console.Out.WriteLine(json);
            if (string.IsNullOrEmpty(reportPath)) return;
            try
            {
                string dir = Path.GetDirectoryName(reportPath);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                    Directory.CreateDirectory(dir);
                string tmp = reportPath + ".tmp";
                File.WriteAllText(tmp, json, new UTF8Encoding(false));
                if (File.Exists(reportPath)) File.Delete(reportPath);
                File.Move(tmp, reportPath);
            }
            catch (Exception e)
            {
                Console.Error.WriteLine("warning: could not write REPORT_JSON: " + e.Message);
            }
        }
    }
}
