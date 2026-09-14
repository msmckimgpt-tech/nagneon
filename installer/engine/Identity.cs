// installer/engine/Identity.cs
// ---------------------------------------------------------------------------
// Identity constants + request validation.
//
// The production/test identity tables are copied VERBATIM from
// scripts/build-installer.mjs (IDENTITIES) so the engine and the NSIS build
// agree on every value that decides *where* an install lives. The request's
// declared identity must match one of these tables exactly; a request whose
// marker is 'test' can never carry production folders/keys and vice versa.
// ---------------------------------------------------------------------------

using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace Backseat.Installer
{
    internal sealed class Identity
    {
        public string Marker;          // "production" | "test"
        public string AppName;
        public string AppId;           // {GUID}
        public string InstallSubdir;
        public string ShortcutGroup;
        public string RegUninstallKey; // HKCU relative
        public string ExeName;         // "Nagneon.exe"
        public string UninstallerName;
        public string Publisher;
        public string Version;
        public string BuildId;
        public string PayloadDirname;  // "<version>+<buildId>"

        // Stable launcher filename (this engine binary copied into the root).
        public const string LauncherName = "Nagneon Launcher.exe";

        // Immutable owner marker written into state; distinguishes our state
        // format/owner from anything else that might sit in the install root.
        public const string OwnerMarker = "backseat-installer";
        public const string OwnerGuid = "{B0A5E7D2-3C41-4E88-9F6A-7D2C1B0E4A55}";

        // The runtime files desktop/runtime.cjs requires at launch. Mirrors
        // REQUIRED_RUNTIME_FILES in scripts/build-installer.mjs VERBATIM (forward-
        // slash relative); the manifest must list every one of these or install is
        // refused. Keep this list in lockstep with the builder and runtime.cjs.
        public static readonly string[] RequiredRuntimeFiles = new string[]
        {
            "Nagneon.exe",
            "resources/codex/bin/codex.exe",
            "resources/speech/python/python.exe",
            "resources/speech/speech_worker.py",
            "resources/speech/model/model.bin",
            "resources/sound/sound_worker.py",
            "resources/sound/model/yamnet.onnx",
        };

        private static readonly Regex VersionRe =
            new Regex(@"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$");
        private static readonly Regex BuildIdRe =
            new Regex(@"^[0-9A-Za-z._-]{1,64}$");
        private static readonly Regex PayloadRe =
            new Regex(@"^[0-9A-Za-z._+-]+$");

        public static Identity ExpectedFor(string marker)
        {
            if (marker == "production")
                return new Identity
                {
                    Marker = "production",
                    AppName = "Nagneon",
                    AppId = "{9D4F2B31-8250-4BFC-AE43-3C27B5E8F092}",
                    InstallSubdir = "Nagneon",
                    ShortcutGroup = "Nagneon",
                    RegUninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Nagneon",
                    ExeName = "Nagneon.exe",
                    UninstallerName = "Uninstall Nagneon.exe",
                    Publisher = "Unspecified publisher (development build)",
                };
            if (marker == "test")
                return new Identity
                {
                    Marker = "test",
                    AppName = "Nagneon (Test)",
                    AppId = "{8C2EFA10-5B76-4D83-AB91-7F3064D82E51}",
                    InstallSubdir = "Nagneon (Test)",
                    ShortcutGroup = "Nagneon (Test)",
                    RegUninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Nagneon-Test",
                    ExeName = "Nagneon.exe",
                    UninstallerName = "Uninstall Nagneon (Test).exe",
                    Publisher = "Unspecified publisher (development build)",
                };
            throw EngineError.Validation("unknown identity marker: " + PathSafety.Clip(marker));
        }

        public bool IsTest { get { return Marker == "test"; } }

        public static void ValidateVersion(string version, string buildId, string payload)
        {
            if (version == null || version.Length > 128 || !VersionRe.IsMatch(version) ||
                buildId == null || !BuildIdRe.IsMatch(buildId) || payload != version + "+" + buildId ||
                !PayloadRe.IsMatch(payload) || buildId.EndsWith("."))
                throw EngineError.Validation("version/build/payload identity is inconsistent");
        }

        // Validate a request-declared identity object against the mode constants.
        public static Identity ParseAndValidate(Dictionary<string, object> idObj)
        {
            string marker = Json.GetString(idObj, "marker", "identity");
            Identity exp = ExpectedFor(marker);

            string version = Json.GetString(idObj, "version", "identity");
            string buildId = Json.GetString(idObj, "buildId", "identity");
            string payload = Json.GetString(idObj, "payloadDirname", "identity");
            ValidateVersion(version, buildId, payload);

            if (!VersionRe.IsMatch(version))
                throw EngineError.Validation("invalid version: " + PathSafety.Clip(version));
            if (!BuildIdRe.IsMatch(buildId))
                throw EngineError.Validation("invalid buildId: " + PathSafety.Clip(buildId));
            string expectedPayload = version + "+" + buildId;
            if (payload != expectedPayload)
                throw EngineError.Validation("payloadDirname must equal version+buildId ('" +
                    PathSafety.Clip(expectedPayload) + "')");
            if (!PayloadRe.IsMatch(payload))
                throw EngineError.Validation("unsafe payloadDirname: " + PathSafety.Clip(payload));

            // Every mode-fixed field must match the constants exactly.
            RequireEqual("identity.appId", Json.GetString(idObj, "appId", "identity"), exp.AppId);
            RequireEqual("identity.appName", Json.GetString(idObj, "appName", "identity"), exp.AppName);
            RequireEqual("identity.installSubdir", Json.GetString(idObj, "installSubdir", "identity"), exp.InstallSubdir);
            RequireEqual("identity.shortcutGroup", Json.GetString(idObj, "shortcutGroup", "identity"), exp.ShortcutGroup);
            RequireEqual("identity.regUninstallKey", Json.GetString(idObj, "regUninstallKey", "identity"), exp.RegUninstallKey);
            RequireEqual("identity.exeName", Json.GetString(idObj, "exeName", "identity"), exp.ExeName);
            RequireEqual("identity.uninstallerName", Json.GetString(idObj, "uninstallerName", "identity"), exp.UninstallerName);
            RequireEqual("identity.publisher", Json.GetString(idObj, "publisher", "identity"), exp.Publisher);

            exp.Version = version;
            exp.BuildId = buildId;
            exp.PayloadDirname = payload;
            return exp;
        }

        private static void RequireEqual(string field, string got, string want)
        {
            if (!string.Equals(got, want, StringComparison.Ordinal))
                throw EngineError.Validation(field + " mismatch: got '" + PathSafety.Clip(got) +
                    "', expected '" + PathSafety.Clip(want) + "'");
        }
    }
}
