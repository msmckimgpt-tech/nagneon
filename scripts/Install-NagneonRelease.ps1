param(
    [Parameter(Mandatory=$true)][string]$PackageFolder,
    [Parameter(Mandatory=$true)][string]$Version,
    [Parameter(Mandatory=$true)][string]$InstallRoot,
    [string]$Profile,
    [switch]$Register
)
$ErrorActionPreference = 'Stop'
function Write-JsonAtomic($Path, $Value) {
    $temp = $Path + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
    [IO.File]::WriteAllText($temp, ($Value | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
    if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($temp,$Path,($Path + '.previous-' + [guid]::NewGuid().ToString('N'))) } else { [IO.File]::Move($temp,$Path) }
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
New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
$lock = [IO.File]::Open((Join-Path $InstallRoot 'update.lock'),'OpenOrCreate','ReadWrite','None')
try {
    $configPath = Join-Path $InstallRoot 'current.json'
    $old = if (Test-Path -LiteralPath $configPath) { Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json } else { $null }
    $storageFile = Join-Path $env:APPDATA 'Nagneon/storage.json'
    if ($Register -and (Test-Path -LiteralPath $storageFile)) {
        $registeredProfile = (Get-Content -LiteralPath $storageFile -Raw | ConvertFrom-Json).profile
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
        New-Item -ItemType Directory -Path (Join-Path $Profile 'data') -Force | Out-Null
    }
    if (-not [IO.Path]::IsPathRooted($Profile)) { throw 'An absolute profile is required.' }
    $Profile = (Resolve-Path -LiteralPath $Profile).Path
    if (-not (Test-Path -LiteralPath (Join-Path $Profile 'data'))) { throw 'Existing profile data is required.' }
    $active = Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('Nagneon.exe','electron.exe') -and ($_.ExecutablePath -like ($InstallRoot + '\*') -or $_.CommandLine -like ('*' + $Profile + '*')) }
    if ($active) { throw 'Close Nagneon normally before updating. No processes were stopped.' }
    $stamp = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8)
    $backup = Join-Path $InstallRoot ('backups/update-' + $stamp)
    New-Item -ItemType Directory -Path $backup | Out-Null
    Copy-Item -LiteralPath (Join-Path $Profile 'data') -Destination (Join-Path $backup 'data') -Recurse
    foreach ($file in Get-ChildItem -LiteralPath (Join-Path $Profile 'data') -File -Recurse) {
        $relative = $file.FullName.Substring((Join-Path $Profile 'data').Length).TrimStart('\')
        if ((Get-FileHash -LiteralPath $file.FullName).Hash -ne (Get-FileHash -LiteralPath (Join-Path (Join-Path $backup 'data') $relative)).Hash) { throw 'Profile changed during backup. Retry with the app closed.' }
    }
    if ($old) { Copy-Item -LiteralPath $configPath -Destination (Join-Path $backup 'current.json') }
    $relativeExe = 'versions/' + $Version + '-' + $stamp + '/Nagneon.exe'
    $destination = Split-Path (Join-Path $InstallRoot $relativeExe)
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    Get-ChildItem -LiteralPath $PackageFolder -Force | Copy-Item -Destination $destination -Recurse
    $inventory = foreach ($file in Get-ChildItem -LiteralPath $PackageFolder -File -Recurse -Force) {
        $relative = $file.FullName.Substring($PackageFolder.TrimEnd('\').Length).TrimStart('\')
        $hash = (Get-FileHash -LiteralPath $file.FullName).Hash
        if ($hash -ne (Get-FileHash -LiteralPath (Join-Path $destination $relative)).Hash) { throw "Package copy mismatch: $relative" }
        [pscustomobject]@{path=$relative;sha256=$hash}
    }
    Write-JsonAtomic (Join-Path $backup 'package-inventory.json') $inventory
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Start-InstalledNagneon.ps1') -Destination (Join-Path $InstallRoot 'Start-InstalledNagneon.ps1') -Force
    [IO.File]::WriteAllText((Join-Path $InstallRoot 'Start-Nagneon.cmd'), "@echo off`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"%~dp0Start-InstalledNagneon.ps1`" -InstallRoot `"%~dp0.`"`r`nif errorlevel 1 pause`r`n", [Text.Encoding]::ASCII)
    Write-JsonAtomic $configPath ([ordered]@{version=$Version;executable=$relativeExe;profile=$Profile;exeSha256=(Get-FileHash -LiteralPath (Join-Path $destination 'Nagneon.exe')).Hash;backup=$backup})
    if ($Register) {
        if (-not (Test-Path -LiteralPath $storageFile)) {
            New-Item -ItemType Directory -Path (Split-Path $storageFile) -Force | Out-Null
            Write-JsonAtomic $storageFile @{profile=$Profile}
        }
        $registration = Join-Path $env:LOCALAPPDATA 'Nagneon'
        New-Item -ItemType Directory -Path $registration -Force | Out-Null
        Write-JsonAtomic (Join-Path $registration 'installation.json') @{installRoot=$InstallRoot}
        $shell = New-Object -ComObject WScript.Shell
        $linkPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Nagneon.lnk'
        if (Test-Path -LiteralPath $linkPath) { Copy-Item -LiteralPath $linkPath -Destination (Join-Path $backup 'Nagneon.lnk') }
        $link = $shell.CreateShortcut($linkPath)
        $link.TargetPath = Join-Path $InstallRoot 'Start-Nagneon.cmd'
        $link.Arguments = ''
        $link.WorkingDirectory = $InstallRoot
        $link.IconLocation = (Join-Path $destination 'Nagneon.exe') + ',0'
        $link.Save()
    }
    Get-Content -LiteralPath $configPath
} finally { $lock.Dispose() }
