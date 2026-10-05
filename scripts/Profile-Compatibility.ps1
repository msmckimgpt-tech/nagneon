. (Join-Path $PSScriptRoot 'Package-Capabilities.ps1')
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

function Assert-NagneonProfileCompatibility {
    param([Parameter(Mandatory=$true)][string]$Profile, [Parameter(Mandatory=$true)][string]$AppVersion, [string]$PackageFolder, [string]$ExpectedReceiptSha256)
    Assert-NagneonNativeStorageView -Profile $Profile
    Assert-NagneonVersionString $AppVersion
    $targetVersion = [version]$AppVersion
    $capability = if ($PackageFolder) { Get-NagneonPackageCapabilities $PackageFolder $AppVersion $ExpectedReceiptSha256 } else { $null }
    $formatFile = Join-Path $Profile 'data/profile-format.json'
    if (Test-Path -LiteralPath $formatFile) {
        if (-not (Test-Path -LiteralPath $formatFile -PathType Leaf) -or ((Get-Item -LiteralPath $formatFile -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -or (Get-Item -LiteralPath $formatFile).Length -gt 65536) { throw 'Invalid profile format marker. Preserve the profile and backups.' }
        $formatJson = Get-Content -LiteralPath $formatFile -Raw -Encoding UTF8
        if (-not $formatJson.TrimStart().StartsWith('{')) { throw 'Profile format marker must be a JSON object.' }
        $format = $formatJson | ConvertFrom-Json
        foreach ($field in @('minReader','minAppVersion')) {
            if (-not @($format.PSObject.Properties | Where-Object { $_.Name -ceq $field }).Count) { throw 'Invalid profile format marker. Preserve the profile and backups.' }
        }
        Assert-NagneonSafeInteger $format.minReader 2
        Assert-NagneonVersionString $format.minAppVersion
        if ($targetVersion -lt [version]$format.minAppVersion) { throw "This profile requires Nagneon $($format.minAppVersion) or later. Preserve it and use a separate pre-update backup for rollback." }
        if (-not $capability) { throw 'Cannot verify the packaged profile reader. Rebuild a verified package; existing records were not changed.' }
        if ($format.minReader -gt $capability.profileReader) { throw "This profile requires reader $($format.minReader); the package supports reader $($capability.profileReader). Preserve it and use a compatible package or a separate pre-update backup." }
    }
    if ($targetVersion -ge [version]'0.1.4') { return }
    $worldFile = Join-Path $Profile 'data/world.json'
    if (-not (Test-Path -LiteralPath $worldFile -PathType Leaf)) { return }
    try { $world = Get-Content -LiteralPath $worldFile -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch { throw 'Cannot confirm profile compatibility. Preserve the current data and use a separate backup copy for recovery.' }
    if (-not $world.settings -or -not ($world.settings.PSObject.Properties.Name -contains 'maxCalls') -or @($world.settings.personas).Count -gt 40) {
        throw 'This profile requires Nagneon 0.1.4 or later. Do not open it with an older app. For recovery, copy a pre-update backup into a separate profile; keep current records unchanged.'
    }
}
