// installer/engine/NativeMethods.cs
// ---------------------------------------------------------------------------
// P/Invoke + COM interop for the BACKSEAT per-user installer engine.
//
// Everything the engine needs from Windows that the BCL does not expose safely:
//   * reparse-point detection (GetFileAttributesW) for junction/symlink refusal
//   * exclusive delete-on-close handles (CreateFileW + SetFileInformationByHandle)
//     so a direct-EXE launch cannot start an owned executable between the lock
//     check and its deletion, without ever killing a process
//   * drive-type check (reject network / non-fixed roots)
//   * console-window hiding for launcher mode (single /target:exe binary)
//   * IShellLinkW / IPersistFile for creating & validating the Start Menu link
//
// No unmanaged filesystem *mutation* is performed via shell/cmd/powershell —
// deletes happen through delete-on-close handles or managed File/Directory APIs.
// ---------------------------------------------------------------------------

using System;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Backseat.Installer
{
    internal static class NativeMethods
    {
        // --- File attributes / reparse points ------------------------------
        public const uint INVALID_FILE_ATTRIBUTES = 0xFFFFFFFF;
        public const uint FILE_ATTRIBUTE_DIRECTORY = 0x00000010;
        public const uint FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern uint GetFileAttributesW(string lpFileName);

        // --- CreateFile flags for exclusive delete handles ------------------
        public const uint GENERIC_READ = 0x80000000;
        public const uint DELETE = 0x00010000;
        public const uint FILE_SHARE_READ = 0x00000001;
        public const uint FILE_SHARE_WRITE = 0x00000002;
        public const uint FILE_SHARE_DELETE = 0x00000004;
        public const uint OPEN_EXISTING = 3;
        public const uint FILE_FLAG_DELETE_ON_CLOSE = 0x04000000;
        public const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
        public const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;

        public const int ERROR_FILE_NOT_FOUND = 2;
        public const int ERROR_PATH_NOT_FOUND = 3;
        public const int ERROR_ACCESS_DENIED = 5;
        public const int ERROR_SHARING_VIOLATION = 32;
        public const int ERROR_LOCK_VIOLATION = 33;

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern SafeFileHandle CreateFileW(
            string lpFileName, uint dwDesiredAccess, uint dwShareMode,
            IntPtr lpSecurityAttributes, uint dwCreationDisposition,
            uint dwFlagsAndAttributes, IntPtr hTemplateFile);

        // FILE_DISPOSITION_INFO uses a single BOOLEAN (1 byte). Used to CANCEL a
        // previously-armed delete-on-close so an aborted preflight deletes nothing.
        [StructLayout(LayoutKind.Sequential)]
        public struct FILE_DISPOSITION_INFO
        {
            public byte DeleteFile;
        }

        // FileDispositionInfo == 4 in FILE_INFO_BY_HANDLE_CLASS.
        public const int FileDispositionInfo = 4;

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool SetFileInformationByHandle(
            SafeFileHandle hFile, int FileInformationClass,
            ref FILE_DISPOSITION_INFO lpFileInformation, uint dwBufferSize);

        // --- Drive type -----------------------------------------------------
        public const uint DRIVE_UNKNOWN = 0;
        public const uint DRIVE_NO_ROOT_DIR = 1;
        public const uint DRIVE_REMOVABLE = 2;
        public const uint DRIVE_FIXED = 3;
        public const uint DRIVE_REMOTE = 4;
        public const uint DRIVE_CDROM = 5;
        public const uint DRIVE_RAMDISK = 6;

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern uint GetDriveTypeW(string lpRootPathName);

        // --- Console hiding (launcher mode) --------------------------------
        [DllImport("kernel32.dll")]
        public static extern IntPtr GetConsoleWindow();

        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        public const int SW_HIDE = 0;

        // --- IShellLinkW / IPersistFile (Start Menu shortcut) --------------
        // STGM read flag for IPersistFile.Load
        public const uint STGM_READ = 0x00000000;

        [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
        public class CShellLink { }

        [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown),
         Guid("000214F9-0000-0000-C000-000000000046")]
        public interface IShellLinkW
        {
            void GetPath([MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszFile,
                int cchMaxPath, IntPtr pfd, uint fFlags);
            void GetIDList(out IntPtr ppidl);
            void SetIDList(IntPtr pidl);
            void GetDescription([MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszName, int cchMaxName);
            void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string pszName);
            void GetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszDir, int cchMaxPath);
            void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string pszDir);
            void GetArguments([MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszArgs, int cchMaxPath);
            void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string pszArgs);
            void GetHotkey(out short pwHotkey);
            void SetHotkey(short wHotkey);
            void GetShowCmd(out int piShowCmd);
            void SetShowCmd(int iShowCmd);
            void GetIconLocation([MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszIconPath,
                int cchIconPath, out int piIcon);
            void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string pszIconPath, int iIcon);
            void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string pszPathRel, uint dwReserved);
            void Resolve(IntPtr hwnd, uint fFlags);
            void SetPath([MarshalAs(UnmanagedType.LPWStr)] string pszFile);
        }

        [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown),
         Guid("0000010b-0000-0000-C000-000000000046")]
        public interface IPersistFile
        {
            void GetClassID(out Guid pClassID);
            [PreserveSig] int IsDirty();
            void Load([MarshalAs(UnmanagedType.LPWStr)] string pszFileName, uint dwMode);
            void Save([MarshalAs(UnmanagedType.LPWStr)] string pszFileName,
                [MarshalAs(UnmanagedType.Bool)] bool fRemember);
            void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string pszFileName);
            void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string ppszFileName);
        }
    }
}
