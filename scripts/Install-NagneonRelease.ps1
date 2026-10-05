param(
    [Parameter(Mandatory=$true)][string]$PackageFolder,
    [Parameter(Mandatory=$true)][string]$Version,
    [Parameter(Mandatory=$true)][string]$InstallRoot,
    [string]$Profile,
    [switch]$Register
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Profile-Compatibility.ps1')
. (Join-Path $PSScriptRoot 'Register-NagneonShortcut.ps1')
. (Join-Path $PSScriptRoot 'Launcher-Command.ps1')
if ($Register) {
    Assert-NagneonNativeStorageView -Profile (Join-Path $env:APPDATA 'Nagneon')
    Assert-NagneonNativeStorageView -Profile (Join-Path $env:LOCALAPPDATA 'Nagneon')
}
function Write-JsonAtomic($Path, $Value) {
    $temp = $Path + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
    [IO.File]::WriteAllText($temp, ($Value | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
    if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($temp,$Path,($Path + '.previous-' + [guid]::NewGuid().ToString('N'))) } else { [IO.File]::Move($temp,$Path) }
}
function Assert-NagneonInstallOutsideProfileData($SelectedProfile) {
    $dataRoot = [IO.Path]::GetFullPath((Join-Path $SelectedProfile 'data')).TrimEnd('\')
    if ([string]::Equals($InstallRoot.TrimEnd('\'),$dataRoot,[StringComparison]::OrdinalIgnoreCase) -or
        ($InstallRoot.TrimEnd('\') + '\').StartsWith(($dataRoot + '\'),[StringComparison]::OrdinalIgnoreCase)) {
        throw 'Install root must be outside profile data. Existing records were not changed.'
    }
}
function Get-NagneonProfileInventory($DataFolder) {
    $root = Get-Item -LiteralPath $DataFolder -Force
    if (-not $root.PSIsContainer -or ($root.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Profile data must be a regular directory.' }
    $prefix = $root.FullName.TrimEnd('\') + '\'
    $files = New-Object 'System.Collections.Generic.List[object]'
    $directories = New-Object 'System.Collections.Generic.List[string]'
    foreach ($entry in Get-ChildItem -LiteralPath $DataFolder -Force -Recurse) {
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Profile links are not supported. Existing records were not changed.' }
        if (-not $entry.FullName.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'Profile inventory escaped its data folder.' }
        $relative = $entry.FullName.Substring($prefix.Length)
        if ($entry.PSIsContainer) { $directories.Add($relative) }
        elseif ($entry -is [IO.FileInfo]) { $files.Add([pscustomobject]@{path=$relative;sha256=(Get-FileHash -LiteralPath $entry.FullName -Algorithm SHA256).Hash}) }
        else { throw 'Unsupported profile entry. Existing records were not changed.' }
    }
    return [pscustomobject]@{files=@($files | Sort-Object path);directories=@($directories | Sort-Object)}
}
function Assert-NagneonProfileInventory($DataFolder, $Expected, $Label) {
    $observed = Get-NagneonProfileInventory $DataFolder
    if (($observed | ConvertTo-Json -Depth 6 -Compress) -cne ($Expected | ConvertTo-Json -Depth 6 -Compress)) {
        throw "Profile $Label file list or contents changed during update. Retry with the app closed; keep the existing profile and backups."
    }
}
$PackageFolder = (Resolve-Path -LiteralPath $PackageFolder).Path
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
if (($InstallRoot.TrimEnd('\') + '\').StartsWith(($PackageFolder.TrimEnd('\') + '\'),[StringComparison]::OrdinalIgnoreCase)) { throw 'Install root must be outside the source package.' }
foreach ($taskDirectory in @($PackageFolder,$InstallRoot)) {
    for ($taskAncestor = $taskDirectory; $taskAncestor; $taskAncestor = Split-Path $taskAncestor -Parent) {
        if ((Test-Path -LiteralPath $taskAncestor) -and ((Get-Item -LiteralPath $taskAncestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Linked installation paths are not supported.' }
    }
}
if (Get-ChildItem -LiteralPath $PackageFolder -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw 'Package links are not supported.' }
if ($Version -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]*$') { throw 'Invalid version.' }
foreach ($item in @('Nagneon.exe','resources/app.asar')) {
    if (-not (Test-Path -LiteralPath (Join-Path $PackageFolder $item) -PathType Leaf)) { throw "Incomplete package: $item" }
}
if ($Profile -and [IO.Path]::IsPathRooted($Profile)) { Assert-NagneonInstallOutsideProfileData $Profile }
$packageCapability = Get-NagneonPackageCapabilities $PackageFolder $Version
New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
$lock = [IO.File]::Open((Join-Path $InstallRoot 'update.lock'),'OpenOrCreate','ReadWrite','None')
$entrypointBackup = @()
$entrypointWrites = $false
$pointerCommitted = $false
try {
    $configPath = Join-Path $InstallRoot 'current.json'
    $old = if (Test-Path -LiteralPath $configPath) { Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
    $storageFile = Join-Path $env:APPDATA 'Nagneon/storage.json'
    if ($Register -and (Test-Path -LiteralPath $storageFile)) {
        $registeredProfile = (Get-Content -LiteralPath $storageFile -Raw -Encoding UTF8 | ConvertFrom-Json).profile
        if ($Profile -and [IO.Path]::GetFullPath($Profile) -ne $registeredProfile) { throw 'Use app settings to change the registered storage location.' }
        $Profile = $registeredProfile
        if ($old) { $old.profile = $registeredProfile }
    }
    if ($old) {
        if ($Profile -and [IO.Path]::GetFullPath($Profile) -ne $old.profile) { throw 'Updates must preserve the registered profile.' }
        $Profile = $old.profile
    }
    if (-not $Profile) {
        $Profile = Join-Path $env:APPDATA 'backseat-studio'
        Assert-NagneonNativeStorageView -Profile $Profile
        New-Item -ItemType Directory -Path (Join-Path $Profile 'data') -Force | Out-Null
    }
    if (-not [IO.Path]::IsPathRooted($Profile)) { throw 'An absolute profile is required.' }
    $Profile = (Resolve-Path -LiteralPath $Profile).Path
    if (-not (Test-Path -LiteralPath (Join-Path $Profile 'data'))) { throw 'Existing profile data is required.' }
    Assert-NagneonInstallOutsideProfileData $Profile
    $packageCapability = Get-NagneonPackageCapabilities $PackageFolder $Version $packageCapability.receiptSha256
    Assert-NagneonProfileCompatibility -Profile $Profile -AppVersion $packageCapability.appVersion -PackageFolder $PackageFolder -ExpectedReceiptSha256 $packageCapability.receiptSha256
    $active = Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('Nagneon.exe','electron.exe') -and ($_.ExecutablePath -like ($InstallRoot + '\*') -or $_.CommandLine -like ('*' + $Profile + '*')) }
    if ($active) { throw 'Close Nagneon normally before updating. No processes were stopped.' }
    $dataFolder = Join-Path $Profile 'data'
    $profileInventory = Get-NagneonProfileInventory $dataFolder
    $packageInventory = Get-NagneonProfileInventory $PackageFolder
    $stamp = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8)
    $backup = Join-Path $InstallRoot ('backups/update-' + $stamp)
    New-Item -ItemType Directory -Path $backup | Out-Null
    Copy-Item -LiteralPath $dataFolder -Destination (Join-Path $backup 'data') -Recurse -Force
    Assert-NagneonProfileInventory $dataFolder $profileInventory 'source'
    Assert-NagneonProfileInventory (Join-Path $backup 'data') $profileInventory 'backup'
    Write-JsonAtomic (Join-Path $backup 'profile-inventory.json') $profileInventory
    if ($old) { Copy-Item -LiteralPath $configPath -Destination (Join-Path $backup 'current.json') }
    foreach ($name in @('Start-Nagneon.cmd','Start-InstalledNagneon.ps1','Profile-Compatibility.ps1','Package-Capabilities.ps1')) {
        $previous = Join-Path $InstallRoot $name
        $saved = Join-Path $backup $name
        $existed = Test-Path -LiteralPath $previous -PathType Leaf
        if (Test-Path -LiteralPath $previous) {
            if (-not $existed -or ((Get-Item -LiteralPath $previous -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Installation entrypoints must be regular files.' }
            Copy-Item -LiteralPath $previous -Destination $saved
            if ((Get-NagneonFileDigest $previous) -cne (Get-NagneonFileDigest $saved)) { throw 'Launcher changed during backup. Retry with the app closed.' }
        }
        $entrypointBackup += [pscustomobject]@{path=$previous;saved=$saved;existed=$existed}
    }
    $relativeExe = 'versions/' + $Version + '-' + $stamp + '/Nagneon.exe'
    $destination = Split-Path (Join-Path $InstallRoot $relativeExe)
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    Get-ChildItem -LiteralPath $PackageFolder -Force | Copy-Item -Destination $destination -Recurse
    Assert-NagneonProfileInventory $PackageFolder $packageInventory 'package source'
    Assert-NagneonProfileInventory $destination $packageInventory 'package copy'
    $copiedCapability = Get-NagneonPackageCapabilities $destination $Version $packageCapability.receiptSha256
    $inventory = foreach ($file in Get-ChildItem -LiteralPath $PackageFolder -File -Recurse -Force) {
        $relative = $file.FullName.Substring($PackageFolder.TrimEnd('\').Length).TrimStart('\')
        $hash = (Get-FileHash -LiteralPath $file.FullName).Hash
        if ($hash -ne (Get-FileHash -LiteralPath (Join-Path $destination $relative)).Hash) { throw "Package copy mismatch: $relative" }
        [pscustomobject]@{path=$relative;sha256=$hash}
    }
    Write-JsonAtomic (Join-Path $backup 'package-inventory.json') $inventory
    Assert-NagneonProfileInventory $dataFolder $profileInventory 'source'
    Assert-NagneonProfileInventory (Join-Path $backup 'data') $profileInventory 'backup'
    Assert-NagneonProfileCompatibility -Profile $Profile -AppVersion $copiedCapability.appVersion -PackageFolder $destination -ExpectedReceiptSha256 $packageCapability.receiptSha256
    $entrypointWrites = $true
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Start-InstalledNagneon.ps1') -Destination (Join-Path $InstallRoot 'Start-InstalledNagneon.ps1') -Force
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Profile-Compatibility.ps1') -Destination (Join-Path $InstallRoot 'Profile-Compatibility.ps1') -Force
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Package-Capabilities.ps1') -Destination (Join-Path $InstallRoot 'Package-Capabilities.ps1') -Force
    [IO.File]::WriteAllText((Join-Path $InstallRoot 'Start-Nagneon.cmd'), (Get-NagneonLauncherCommand -Installed), [Text.Encoding]::ASCII)
    Assert-NagneonProfileInventory $dataFolder $profileInventory 'source'
    Assert-NagneonProfileInventory (Join-Path $backup 'data') $profileInventory 'backup'
    Assert-NagneonProfileInventory $PackageFolder $packageInventory 'package source'
    Assert-NagneonProfileInventory $destination $packageInventory 'package copy'
    $copiedCapability = Get-NagneonPackageCapabilities $destination $Version $packageCapability.receiptSha256
    Assert-NagneonProfileCompatibility -Profile $Profile -AppVersion $copiedCapability.appVersion -PackageFolder $destination -ExpectedReceiptSha256 $packageCapability.receiptSha256
    Write-JsonAtomic $configPath ([ordered]@{version=$Version;executable=$relativeExe;profile=$Profile;exeSha256=$copiedCapability.exeSha256;asarSha256=$copiedCapability.asarSha256;packageCapabilitySha256=$copiedCapability.receiptSha256;backup=$backup})
    $pointerCommitted = $true
    if ($Register) {
        if (-not (Test-Path -LiteralPath $storageFile)) {
            New-Item -ItemType Directory -Path (Split-Path $storageFile) -Force | Out-Null
            Write-JsonAtomic $storageFile @{profile=$Profile}
        }
        $registration = Join-Path $env:LOCALAPPDATA 'Nagneon'
        New-Item -ItemType Directory -Path $registration -Force | Out-Null
        Write-JsonAtomic (Join-Path $registration 'installation.json') @{installRoot=$InstallRoot}
        Register-NagneonShortcut -LinkPath (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Nagneon.lnk') -BackupPath (Join-Path $backup 'Nagneon.lnk') -InstallRoot $InstallRoot -Executable (Join-Path $destination 'Nagneon.exe')
        Register-NagneonShortcut -LinkPath (Join-Path ([Environment]::GetFolderPath('Programs')) 'Nagneon.lnk') -BackupPath (Join-Path $backup 'StartMenu-Nagneon.lnk') -InstallRoot $InstallRoot -Executable (Join-Path $destination 'Nagneon.exe')
    }
    Get-Content -LiteralPath $configPath
} catch {
    $updateError = $_
    if ($entrypointWrites -and -not $pointerCommitted) {
        $restorationFailures = @()
        foreach ($entry in $entrypointBackup) {
            try {
                if ($entry.existed) {
                    [IO.File]::WriteAllBytes($entry.path,[IO.File]::ReadAllBytes($entry.saved))
                    if ((Get-NagneonFileDigest $entry.path) -cne (Get-NagneonFileDigest $entry.saved)) { throw 'Restored launcher hash mismatch.' }
                } elseif (Test-Path -LiteralPath $entry.path -PathType Leaf) { [IO.File]::Delete($entry.path) }
            } catch { $restorationFailures += ($entry.path + ': ' + $_.Exception.Message) }
        }
        if ($restorationFailures.Count) { throw ("Update failed: " + $updateError.Exception.Message + ". Unrestored entrypoints: " + ($restorationFailures -join '; ') + '. Preserve the profile and backup; reapply the previous verified launcher.') }
    }
    throw $updateError
} finally { $lock.Dispose() }
