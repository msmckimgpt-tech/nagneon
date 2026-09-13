// installer/engine/Errors.cs
// ---------------------------------------------------------------------------
// Controlled error types. An EngineError carries a clean, bounded, credential-
// free message and an exit code; anything else that escapes is treated as an
// unexpected failure (still reported, still non-zero, never a false success).
// ---------------------------------------------------------------------------

using System;

namespace Backseat.Installer
{
    // Distinct non-zero exit codes. Any non-zero value means failure; these are
    // just informative to the parent's logs.
    internal static class ExitCodes
    {
        public const int Success = 0;
        public const int Usage = 2;
        public const int Validation = 3;
        public const int Ownership = 4;
        public const int Busy = 5;            // mutex held / app running
        public const int RolledBack = 6;      // operation failed but state safe
        public const int Unrecoverable = 7;   // rollback/recover could not finish
        public const int LaunchError = 8;     // launcher could not start child
        public const int CrashFault = 79;     // intentional test crash fault
    }

    internal sealed class EngineError : Exception
    {
        public readonly int Code;

        public EngineError(int code, string message) : base(message)
        {
            Code = code;
        }

        public static EngineError Validation(string message)
        {
            return new EngineError(ExitCodes.Validation, message);
        }

        public static EngineError Ownership(string message)
        {
            return new EngineError(ExitCodes.Ownership, message);
        }

        public static EngineError Busy(string message)
        {
            return new EngineError(ExitCodes.Busy, message);
        }

        public static EngineError Unrecoverable(string message)
        {
            return new EngineError(ExitCodes.Unrecoverable, message);
        }
    }
}
