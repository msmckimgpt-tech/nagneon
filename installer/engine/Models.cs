// installer/engine/Models.cs
// ---------------------------------------------------------------------------
// Plain data models + their bounded parsers. FileEntry mirrors the manifest
// entry contract from scripts/build-installer.mjs (validated path, bytes>=0,
// 64-lowerhex sha256). VersionRecord is what we persist per owned version so
// uninstall/recover know EXACTLY which files are owned. InstallRequest is the
// whole validated REQUEST_JSON.
// ---------------------------------------------------------------------------

using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace Backseat.Installer
{
    internal sealed class FileEntry
    {
        public string Path;     // validated forward-slash relative path
        public long Bytes;
        public string Sha256;   // 64 lowercase hex

        private static readonly Regex HexRe = new Regex("^[a-f0-9]{64}$");

        public static FileEntry Parse(Dictionary<string, object> m, string ctx)
        {
            var e = new FileEntry();
            e.Path = PathSafety.SanitizeRelative(Json.GetString(m, "path", ctx));
            e.Bytes = Json.GetLong(m, "bytes", ctx);
            if (e.Bytes < 0) throw EngineError.Validation(ctx + ".bytes must be >= 0");
            if (e.Bytes > Limits.MaxFileBytes)
                throw EngineError.Validation(ctx + ".bytes exceeds bound");
            string sha = Json.GetString(m, "sha256", ctx).ToLowerInvariant();
            if (!HexRe.IsMatch(sha)) throw EngineError.Validation(ctx + ".sha256 must be 64 lowercase hex");
            e.Sha256 = sha;
            return e;
        }

        public Dictionary<string, object> ToMap()
        {
            var m = new Dictionary<string, object>();
            m["path"] = Path;
            m["bytes"] = Bytes;
            m["sha256"] = Sha256;
            return m;
        }

        public static FileEntry FromMap(Dictionary<string, object> m)
        {
            return Parse(m, "file");
        }
    }

    internal static class Limits
    {
        public const int MaxFiles = 100000;
        public const long MaxFileBytes = 8L * 1024 * 1024 * 1024;   // 8 GiB / file
        public const long MaxTotalBytes = 64L * 1024 * 1024 * 1024; // 64 GiB total
        public const int MaxLeftoversReported = 200;
    }

    // A fully-described owned version: its payload dir name + the manifest that
    // defines its owned files. Persisted in state and journal.
    internal sealed class VersionRecord
    {
        public string PayloadDirname;
        public string Version;
        public string BuildId;
        public string ExeName;
        public List<FileEntry> Files = new List<FileEntry>();

        public Dictionary<string, object> ToMap()
        {
            var m = new Dictionary<string, object>();
            m["payloadDirname"] = PayloadDirname;
            m["version"] = Version;
            m["buildId"] = BuildId;
            m["exeName"] = ExeName;
            var arr = new List<object>();
            foreach (var f in Files) arr.Add(f.ToMap());
            m["files"] = arr;
            return m;
        }

        public static VersionRecord FromMap(Dictionary<string, object> m)
        {
            var v = new VersionRecord();
            v.PayloadDirname = Json.GetString(m, "payloadDirname", "version");
            v.Version = Json.GetString(m, "version", "version");
            v.BuildId = Json.GetString(m, "buildId", "version");
            v.ExeName = Json.GetString(m, "exeName", "version");
            // Re-validate the payload dir name shape on the way back in.
            if (!Regex.IsMatch(v.PayloadDirname, @"^[0-9A-Za-z._+-]+$"))
                throw EngineError.Validation("state: unsafe payloadDirname");
            foreach (object o in Json.AsArray(Json.Get(m, "files"), "version.files"))
                v.Files.Add(FileEntry.FromMap(Json.AsObject(o, "version.files[]")));
            return v;
        }

        // Compact descriptor for the report (no file list).
        public Dictionary<string, object> ToBrief()
        {
            var m = new Dictionary<string, object>();
            m["payloadDirname"] = PayloadDirname;
            m["version"] = Version;
            m["buildId"] = BuildId;
            return m;
        }
    }

    internal sealed class InstallRequest
    {
        public Identity Identity;
        public List<FileEntry> Files = new List<FileEntry>();
        public string EngineSha256;    // 64 hex, of the running temp engine
        public string TestFault;       // only honoured when Identity.IsTest

        private static readonly Regex HexRe = new Regex("^[a-fA-F0-9]{64}$");

        public static InstallRequest Parse(string jsonText)
        {
            var root = Json.AsObject(Json.Parse(jsonText), "request");
            long schema = Json.GetLong(root, "schema", "request");
            if (schema != 1) throw EngineError.Validation("unsupported request schema: " + schema);

            var req = new InstallRequest();
            req.Identity = Identity.ParseAndValidate(Json.AsObject(Json.Get(root, "identity"), "identity"));

            string engHash = Json.GetString(root, "engineSha256", "request");
            if (!HexRe.IsMatch(engHash)) throw EngineError.Validation("engineSha256 must be 64 hex");
            req.EngineSha256 = engHash.ToLowerInvariant();

            object[] files = Json.AsArray(Json.Get(root, "files"), "request.files");
            if (files.Length == 0) throw EngineError.Validation("request.files is empty");
            if (files.Length > Limits.MaxFiles) throw EngineError.Validation("request.files exceeds bound");

            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            long total = 0;
            for (int i = 0; i < files.Length; i++)
            {
                FileEntry e = FileEntry.Parse(Json.AsObject(files[i], "request.files[" + i + "]"),
                    "request.files[" + i + "]");
                // Case-insensitive duplicate detection (Windows FS is case-insensitive).
                if (!seen.Add(e.Path.ToLowerInvariant()))
                    throw EngineError.Validation("duplicate path (case-insensitive): " + PathSafety.Clip(e.Path));
                total += e.Bytes;
                if (total > Limits.MaxTotalBytes) throw EngineError.Validation("total bytes exceeds bound");
                req.Files.Add(e);
            }

            // Every required runtime file must be present in the manifest.
            foreach (string required in Identity.RequiredRuntimeFiles)
                if (!seen.Contains(required.ToLowerInvariant()))
                    throw EngineError.Validation("required runtime file missing from manifest: " + required);

            req.TestFault = Json.GetStringOrNull(root, "testFault");
            if (req.TestFault != null && !req.Identity.IsTest)
                throw EngineError.Validation("testFault is only permitted for test-marker identities");
            if (req.TestFault != null && !FaultPoints.IsKnown(req.TestFault))
                throw EngineError.Validation("unknown testFault: " + PathSafety.Clip(req.TestFault));

            StoredValidation.Version(req.ToVersionRecord(), req.Identity.ExeName);
            return req;
        }

        public VersionRecord ToVersionRecord()
        {
            var v = new VersionRecord();
            v.PayloadDirname = Identity.PayloadDirname;
            v.Version = Identity.Version;
            v.BuildId = Identity.BuildId;
            v.ExeName = Identity.ExeName;
            v.Files = Files;
            return v;
        }
    }

    // Supported fault-injection points (test identities only).
    internal static class FaultPoints
    {
        public const string ThrowAfterStage = "throw:after-stage";
        public const string ThrowAfterPromote = "throw:after-promote";
        public const string ThrowAfterShortcut = "throw:after-shortcut";
        public const string ThrowAfterRegistry = "throw:after-registry";
        public const string ThrowBeforeState = "throw:before-state";
        public const string CrashAfterShortcut = "crash:after-shortcut";
        public const string CrashBeforeState = "crash:before-state";
        public const string CrashAfterState = "crash:after-state";

        private static readonly HashSet<string> Known = new HashSet<string>(new string[]
        {
            ThrowAfterStage, ThrowAfterPromote, ThrowAfterShortcut, ThrowAfterRegistry,
            ThrowBeforeState, CrashAfterShortcut, CrashBeforeState, CrashAfterState,
        });

        public static bool IsKnown(string s) { return s != null && Known.Contains(s); }
    }
}
