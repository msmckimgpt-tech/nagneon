// installer/engine/Hashing.cs
// ---------------------------------------------------------------------------
// Streaming SHA-256 helpers. Files are hashed with a bounded buffer so the real
// ~1.5 GB payload never has to be fully buffered in memory.
// ---------------------------------------------------------------------------

using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace Backseat.Installer
{
    internal static class Hashing
    {
        // Lowercase-hex SHA-256 of a file. Opened read-only with share-read so it
        // never blocks another reader; large payloads stream through SHA256.
        public static string Sha256File(string path)
        {
            using (var sha = SHA256.Create())
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read,
                       FileShare.Read | FileShare.Delete, 1 << 20, FileOptions.SequentialScan))
            {
                return ToHex(sha.ComputeHash(fs));
            }
        }

        public static string Sha256Bytes(byte[] data)
        {
            using (var sha = SHA256.Create())
            {
                return ToHex(sha.ComputeHash(data));
            }
        }

        public static string ToHex(byte[] b)
        {
            var sb = new StringBuilder(b.Length * 2);
            for (int i = 0; i < b.Length; i++) sb.Append(b[i].ToString("x2"));
            return sb.ToString();
        }
    }
}
