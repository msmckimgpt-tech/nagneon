// installer/engine/PathSafety.cs
// ---------------------------------------------------------------------------
// All path validation for the engine. The rules mirror scripts/build-installer
// .mjs (sanitizeRelativePath / verifyPackage) so the engine refuses exactly what
// the generator refuses, plus the extra live-filesystem checks a real install
// needs: absolute-local-root normalisation, reparse-point (junction/symlink)
// refusal along whole chains, and "resolved path stays inside the owned root".
// ---------------------------------------------------------------------------

using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;

namespace Backseat.Installer
{
    internal static class PathSafety
    {
        // Windows reserved device names (case-insensitive, with or without ext).
        private static readonly Regex Reserved =
            new Regex(@"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)", RegexOptions.IgnoreCase);

        // Illegal characters inside a single path segment (control chars + the
        // Windows-reserved set). ':' is included, which also rejects ADS.
        private static readonly Regex IllegalSegChars = new Regex("[\\x00-\\x1f<>:\"|?*]");

        public const int MaxRelPathLength = 240;
        public const int MaxSegments = 64;

        // --- Relative payload paths (from the manifest) --------------------
        // Accept ONLY a safe, forward-slash relative path. Returns the same path
        // (segments re-joined) on success; throws EngineError otherwise.
        public static string SanitizeRelative(string p)
        {
            if (string.IsNullOrEmpty(p)) throw EngineError.Validation("empty path");
            if (p.Length > MaxRelPathLength)
                throw EngineError.Validation("path too long: " + Clip(p));
            if (p.IndexOf('\\') >= 0) throw EngineError.Validation("backslash not allowed: " + Clip(p));
            if (p.IndexOf('\0') >= 0) throw EngineError.Validation("NUL in path");
            if (p.StartsWith("/")) throw EngineError.Validation("absolute path not allowed: " + Clip(p));
            if (Regex.IsMatch(p, "^[A-Za-z]:")) throw EngineError.Validation("drive-qualified path not allowed: " + Clip(p));

            string[] segments = p.Split('/');
            if (segments.Length > MaxSegments)
                throw EngineError.Validation("too many path segments: " + Clip(p));
            foreach (string seg in segments)
            {
                if (seg == "" || seg == "." || seg == "..")
                    throw EngineError.Validation("unsafe segment in path: " + Clip(p));
                if (IllegalSegChars.IsMatch(seg))
                    throw EngineError.Validation("illegal character in path: " + Clip(p));
                if (seg != seg.Trim() || seg.EndsWith("."))
                    throw EngineError.Validation("trailing dot/space segment: " + Clip(p));
                if (Reserved.IsMatch(seg))
                    throw EngineError.Validation("reserved device name in path: " + Clip(p));
            }
            return string.Join("/", segments);
        }

        // --- Install / source root normalisation ---------------------------
        // Absolute, drive-qualified, local, not a bare drive root, no UNC, no
        // device path, no traversal. Returns the canonical full path without a
        // trailing separator.
        public static string NormalizeAbsoluteLocalDir(string input, string label)
        {
            if (string.IsNullOrEmpty(input))
                throw EngineError.Validation(label + ": empty path");
            if (input.IndexOf('\0') >= 0)
                throw EngineError.Validation(label + ": NUL in path");
            if (input.StartsWith("\\\\") || input.StartsWith("//"))
                throw EngineError.Validation(label + ": UNC path not allowed: " + Clip(input));
            // Device / extended-length / DOS-device prefixes.
            if (input.StartsWith("\\\\?\\") || input.StartsWith("\\\\.\\") ||
                input.StartsWith("\\??\\"))
                throw EngineError.Validation(label + ": device path not allowed: " + Clip(input));
            // Reject explicit traversal in the *input* even though GetFullPath
            // would collapse it (defence in depth against surprising inputs).
            foreach (string seg in input.Split('\\', '/'))
            {
                if (seg == ".." || seg == ".") throw EngineError.Validation(label + ": traversal/alias segment not allowed: " + Clip(input));
                if (seg.Length == 2 && IsDriveLetter(seg[0]) && seg[1] == ':') continue;
                if (seg.Length > 0 && (seg != seg.Trim() || seg.EndsWith(".") || Reserved.IsMatch(seg) || IllegalSegChars.IsMatch(seg)))
                    throw EngineError.Validation(label + ": invalid Windows path segment: " + Clip(seg));
            }

            // Reject relative paths outright — GetFullPath would otherwise resolve
            // them against the process CWD and silently accept them.
            if (!Path.IsPathRooted(input))
                throw EngineError.Validation(label + ": must be an absolute path: " + Clip(input));
            // Reject drive-relative paths like "C:foo" (rooted but not absolute).
            if (input.Length >= 2 && input[1] == ':' &&
                (input.Length == 2 || (input[2] != '\\' && input[2] != '/')))
                throw EngineError.Validation(label + ": drive-relative path not allowed: " + Clip(input));

            string full;
            try { full = Path.GetFullPath(input); }
            catch (Exception e) { throw EngineError.Validation(label + ": invalid path: " + e.Message); }

            // Must be drive-qualified (e.g. C:\...), not rooted-without-drive (\x).
            if (full.Length < 3 || !IsDriveLetter(full[0]) || full[1] != ':' || full[2] != '\\')
                throw EngineError.Validation(label + ": must be an absolute drive path: " + Clip(full));

            full = TrimTrailingSep(full);
            string root = Path.GetPathRoot(full); // "C:\"
            if (string.Equals(full, TrimTrailingSep(root), StringComparison.OrdinalIgnoreCase))
                throw EngineError.Validation(label + ": drive root is not allowed: " + Clip(full));

            uint dt = NativeMethods.GetDriveTypeW(root);
            if (dt == NativeMethods.DRIVE_REMOTE)
                throw EngineError.Validation(label + ": network drive not allowed: " + Clip(full));
            if (dt == NativeMethods.DRIVE_NO_ROOT_DIR)
                throw EngineError.Validation(label + ": drive does not exist: " + Clip(full));

            return full;
        }

        // Walk every EXISTING component from the drive root down to `absPath`
        // and refuse if any of them is a reparse point (junction / symlink /
        // mount point). Non-existent tail components are fine (we will create
        // them ourselves). Uses a visited cache to stay cheap across many files.
        public static void AssertNoReparseInChain(string absPath, HashSet<string> cache)
        {
            string root = Path.GetPathRoot(absPath);
            if (string.IsNullOrEmpty(root))
                throw EngineError.Validation("cannot resolve path root: " + Clip(absPath));
            string rest = absPath.Substring(root.Length);
            string cur = TrimTrailingSep(root);
            foreach (string seg in rest.Split(new char[] { '\\', '/' },
                         StringSplitOptions.RemoveEmptyEntries))
            {
                cur = cur + "\\" + seg;
                if (cache != null && cache.Contains(cur.ToLowerInvariant())) continue;
                uint attr = NativeMethods.GetFileAttributesW(cur);
                if (attr == NativeMethods.INVALID_FILE_ATTRIBUTES)
                    return; // component does not exist; nothing deeper can either
                if ((attr & NativeMethods.FILE_ATTRIBUTE_REPARSE_POINT) != 0)
                    throw EngineError.Validation("reparse point (junction/symlink) not allowed: " + Clip(cur));
                if (cache != null) cache.Add(cur.ToLowerInvariant());
            }
        }

        public static bool IsReparsePoint(string absPath)
        {
            uint attr = NativeMethods.GetFileAttributesW(absPath);
            if (attr == NativeMethods.INVALID_FILE_ATTRIBUTES) return false;
            return (attr & NativeMethods.FILE_ATTRIBUTE_REPARSE_POINT) != 0;
        }

        public static bool IsRegularFile(string absPath)
        {
            uint attr = NativeMethods.GetFileAttributesW(absPath);
            if (attr == NativeMethods.INVALID_FILE_ATTRIBUTES) return false;
            if ((attr & NativeMethods.FILE_ATTRIBUTE_REPARSE_POINT) != 0) return false;
            if ((attr & NativeMethods.FILE_ATTRIBUTE_DIRECTORY) != 0) return false;
            return true;
        }

        // Combine an owned root with a validated relative path and PROVE the
        // canonical result is still inside the root. Guards every resolved
        // deletion / move / copy target against traversal and aliasing.
        public static string CombineInsideRoot(string root, string relForwardSlash, string label)
        {
            string rel = relForwardSlash.Replace('/', '\\');
            string combined = Path.GetFullPath(Path.Combine(root, rel));
            if (!IsInsideRoot(root, combined))
                throw EngineError.Validation(label + ": resolved path escapes root: " + Clip(combined));
            return combined;
        }

        public static bool IsInsideRoot(string root, string candidate)
        {
            string r = TrimTrailingSep(Path.GetFullPath(root));
            string c = TrimTrailingSep(Path.GetFullPath(candidate));
            if (string.Equals(r, c, StringComparison.OrdinalIgnoreCase)) return true;
            return c.StartsWith(r + "\\", StringComparison.OrdinalIgnoreCase);
        }

        public static string TrimTrailingSep(string p)
        {
            if (string.IsNullOrEmpty(p)) return p;
            if (p.Length == 3 && p[1] == ':' && p[2] == '\\') return p; // keep "C:\"
            return p.TrimEnd('\\', '/');
        }

        private static bool IsDriveLetter(char c)
        {
            return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');
        }

        public static string Clip(string s)
        {
            if (s == null) return "";
            return s.Length <= 200 ? s : s.Substring(0, 200) + "...";
        }
    }
}
