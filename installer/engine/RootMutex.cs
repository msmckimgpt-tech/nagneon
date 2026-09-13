using System;
using System.Diagnostics;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;

namespace Backseat.Installer
{
    // One operation owns both locks for its complete lifetime. Global serializes
    // upgraded engines across login sessions; Local also cooperates with older
    // engines in this session. Older engines in OTHER sessions cannot acquire
    // the new global lock retroactively. The caller must still validate files.
    internal sealed class RootMutex : IDisposable
    {
        private readonly Mutex global, legacy;
        private readonly object gate = new object();
        private bool held, disposed;
        private int ownerThread;

        public RootMutex(string root)
        {
            string normalized = PathSafety.NormalizeAbsoluteLocalDir(root, "mutex install root");
            string key = PathSafety.TrimTrailingSep(normalized).ToLowerInvariant();
            string name = "Backseat.Installer." + Hashing.Sha256Bytes(Encoding.Unicode.GetBytes(key)).Substring(0, 40);
            var security = new MutexSecurity();
            using (WindowsIdentity identity = WindowsIdentity.GetCurrent())
            {
                if (identity.User == null) throw EngineError.Ownership("could not identify the install lock owner");
                security.AddAccessRule(new MutexAccessRule(identity.User, MutexRights.FullControl, AccessControlType.Allow));
            }
            security.AddAccessRule(new MutexAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), MutexRights.FullControl, AccessControlType.Allow));
            security.SetAccessRuleProtection(true, false);
            try
            {
                bool created;
                global = new Mutex(false, "Global\\" + name, out created, security);
                legacy = new Mutex(false, "Local\\" + name, out created, security);
            }
            catch (Exception error)
            {
                if (legacy != null) legacy.Dispose();
                if (global != null) global.Dispose();
                // No alternate name, ACL takeover, or session-only fallback.
                if (error is UnauthorizedAccessException || error is WaitHandleCannotBeOpenedException)
                    throw EngineError.Busy("the install lock is inaccessible or occupied by another object; nothing changed");
                throw;
            }
        }

        private static bool Wait(Mutex mutex, int milliseconds)
        {
            try { return mutex.WaitOne(milliseconds); }
            catch (AbandonedMutexException) { return true; } // Windows grants ownership; stored state is still revalidated by Engine.
        }

        public bool TryAcquire(int milliseconds)
        {
            if (milliseconds < Timeout.Infinite) throw new ArgumentOutOfRangeException("milliseconds");
            lock (gate)
            {
                if (disposed) throw new ObjectDisposedException("RootMutex");
                // Repeating this operation's acquisition is idempotent: never
                // leak an extra recursive OS acquisition behind a Boolean flag.
                if (held) return ownerThread == Thread.CurrentThread.ManagedThreadId;
                var clock = Stopwatch.StartNew();
                if (!Wait(global, milliseconds)) return false;
                bool localHeld = false;
                try
                {
                    int remaining = milliseconds == Timeout.Infinite ? Timeout.Infinite : (int)Math.Max(0L, milliseconds - clock.ElapsedMilliseconds);
                    localHeld = Wait(legacy, remaining);
                    if (!localHeld) return false;
                    held = true; ownerThread = Thread.CurrentThread.ManagedThreadId;
                    return true;
                }
                finally { if (!localHeld) global.ReleaseMutex(); }
            }
        }

        public bool TryAcquire(TimeSpan timeout)
        {
            double ms = timeout.TotalMilliseconds;
            if (ms < Timeout.Infinite || ms > int.MaxValue) throw new ArgumentOutOfRangeException("timeout");
            return TryAcquire((int)ms);
        }

        public void Release()
        {
            lock (gate)
            {
                if (!held) return;
                if (ownerThread != Thread.CurrentThread.ManagedThreadId)
                    throw new SynchronizationLockException("only the acquiring thread may release the install lock");
                legacy.ReleaseMutex(); global.ReleaseMutex();
                held = false; ownerThread = 0;
            }
        }

        public void Dispose()
        {
            lock (gate)
            {
                if (disposed) return;
                Release(); legacy.Dispose(); global.Dispose(); disposed = true;
            }
        }
    }
}
