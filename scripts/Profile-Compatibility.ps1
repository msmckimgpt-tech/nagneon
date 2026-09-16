function Assert-NagneonResolvedStoragePath {
    param([string]$Requested, [string]$Resolved)
    if ($Resolved.StartsWith('\\?\UNC\')) { $Resolved = '\\' + $Resolved.Substring(8) }
    elseif ($Resolved.StartsWith('\\?\')) { $Resolved = $Resolved.Substring(4) }
    if (-not [string]::Equals([IO.Path]::GetFullPath($Requested), [IO.Path]::GetFullPath($Resolved), [StringComparison]::OrdinalIgnoreCase)) {
        throw "Storage is redirected by this process: $Requested -> $Resolved. Run the launcher/import/update from ordinary Windows Explorer, outside the packaged agent. Existing records were not changed."
    }
}

function Assert-NagneonNativeStorageView {
    param([Parameter(Mandatory=$true)][string]$Profile)
    if (-not ('Nagneon.StorageHandle' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
namespace Nagneon {
    public static class StorageHandle {
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
        public static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder path, uint size, uint flags);
    }
}
'@
    }
    $parent = [IO.Path]::GetFullPath($Profile)
    while (-not [IO.Directory]::Exists($parent)) {
        $next = [IO.Path]::GetDirectoryName($parent)
        if (-not $next) { throw 'Cannot locate an existing parent for the storage folder.' }
        $parent = $next
    }
    # Package identity APIs can report NO_PACKAGE for agent child processes
    # while AppData writes are still redirected. Inspect the actual write handle.
    $probe = [IO.Path]::Combine($parent, '.nagneon-storage-probe-' + [guid]::NewGuid().ToString('N') + '.tmp')
    $stream = New-Object IO.FileStream($probe, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None, 4096, [IO.FileOptions]::DeleteOnClose)
    try {
        $buffer = New-Object Text.StringBuilder 32768
        $length = [Nagneon.StorageHandle]::GetFinalPathNameByHandle($stream.SafeFileHandle, $buffer, 32768, 0)
        if ($length -eq 0 -or $length -ge 32768) { throw 'Cannot verify the physical storage location. No profile records were changed.' }
        Assert-NagneonResolvedStoragePath -Requested $probe -Resolved $buffer.ToString()
    } finally { $stream.Dispose() }
}

function Restore-NagneonRedirectedProfile {
    param([Parameter(Mandatory=$true)][string]$Profile, [string]$AppData = $env:APPDATA, [string]$Packages = (Join-Path $env:LOCALAPPDATA 'Packages'), [switch]$NonInteractive)
    $target = Join-Path $Profile 'data'
    if ([IO.Directory]::Exists($target)) { return $false }
    Assert-NagneonNativeStorageView -Profile $Profile
    $prefix = [IO.Path]::GetFullPath($AppData).TrimEnd('\') + '\'
    $full = [IO.Path]::GetFullPath($Profile)
    $candidates = @()
    if ($full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -and [IO.Directory]::Exists($Packages)) {
        $suffix = $full.Substring($prefix.Length)
        $candidates = @(Get-ChildItem -LiteralPath $Packages -Directory | ForEach-Object {
            $candidate = Join-Path $_.FullName ('LocalCache\Roaming\' + $suffix + '\data')
            if ([IO.File]::Exists((Join-Path $candidate 'world.json'))) { $candidate }
        })
    }
    $source = if ($candidates.Count -eq 1) { $candidates[0] } else { $null }
    if (-not $source -and -not $NonInteractive) {
        Add-Type -AssemblyName System.Windows.Forms
        $picker = New-Object System.Windows.Forms.FolderBrowserDialog
        $picker.Description = 'Select the existing Nagneon profile folder (containing data), or its data folder. Records will be copied and the original kept.'
        $picker.ShowNewFolderButton = $false
        try {
            if ($picker.ShowDialog() -eq 'OK') {
                $source = $picker.SelectedPath
                if ([IO.Directory]::Exists((Join-Path $source 'data'))) { $source = Join-Path $source 'data' }
            }
        } finally { $picker.Dispose() }
    }
    if (-not $source) { throw 'Profile recovery needs an existing record folder. No records were reset.' }
    if (-not [IO.File]::Exists((Join-Path $source 'world.json'))) { throw 'The selected folder does not contain world.json. Select the existing record folder.' }
    # Copy only complete, readable records. Never overwrite an existing target
    # or choose arbitrarily between different package copies/backups.
    $null = Get-Content -LiteralPath (Join-Path $source 'world.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ((Get-Item -LiteralPath $source).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked recovery sources are unsupported.' }
    $files = @(Get-ChildItem -LiteralPath $source -Recurse -Force)
    if ($files | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw 'Linked recovery records are unsupported.' }
    New-Item -ItemType Directory -Path $Profile -Force | Out-Null
    $stage = Join-Path $Profile ('data.recovery-' + [guid]::NewGuid().ToString('N'))
    Copy-Item -LiteralPath $source -Destination $stage -Recurse -ErrorAction Stop
    foreach ($file in $files | Where-Object { -not $_.PSIsContainer }) {
        $relative = $file.FullName.Substring($source.TrimEnd('\').Length).TrimStart('\')
        $sha = [Security.Cryptography.SHA256]::Create()
        try {
            $a = [IO.File]::OpenRead($file.FullName)
            try { $first = [BitConverter]::ToString($sha.ComputeHash($a)) } finally { $a.Dispose() }
            $b = [IO.File]::OpenRead((Join-Path $stage $relative))
            try { $second = [BitConverter]::ToString($sha.ComputeHash($b)) } finally { $b.Dispose() }
        } finally { $sha.Dispose() }
        if ($first -ne $second) { throw 'Recovery copy verification failed. Original records were preserved.' }
    }
    $after = @(Get-ChildItem -LiteralPath $source -Recurse -Force)
    if (($files.FullName | Sort-Object | Out-String) -ne ($after.FullName | Sort-Object | Out-String)) { throw 'Recovery source changed during copying. Original records were preserved; retry after closing the app.' }
    [IO.Directory]::Move($stage, $target)
    return $true
}

function Assert-NagneonProfileCompatibility {
    param([Parameter(Mandatory=$true)][string]$Profile, [Parameter(Mandatory=$true)][string]$AppVersion)
    Assert-NagneonNativeStorageView -Profile $Profile
    if ($AppVersion -notmatch '^(\d+)\.(\d+)\.(\d+)') { throw 'Cannot identify the application version. Reapply a verified package.' }
    $targetVersion = [version]($Matches[1] + '.' + $Matches[2] + '.' + $Matches[3])
    if ($targetVersion -ge [version]'0.1.4') { return }
    $worldFile = Join-Path $Profile 'data/world.json'
    if (-not (Test-Path -LiteralPath $worldFile -PathType Leaf)) { return }
    try { $world = Get-Content -LiteralPath $worldFile -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch { throw 'Cannot confirm profile compatibility. Preserve the current data and use a separate backup copy for recovery.' }
    if (-not $world.settings -or -not ($world.settings.PSObject.Properties.Name -contains 'maxCalls') -or @($world.settings.personas).Count -gt 40) {
        throw 'This profile requires Nagneon 0.1.4 or later. Do not open it with an older app. For recovery, copy a pre-update backup into a separate profile; keep current records unchanged.'
    }
}
