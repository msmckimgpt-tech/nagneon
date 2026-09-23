param([string]$InstallRoot, [switch]$Inspect)
$ErrorActionPreference = 'Stop'
try {
    . (Join-Path $PSScriptRoot 'Profile-Compatibility.ps1')
    if (-not $InstallRoot) {
        $pointer = Join-Path $env:LOCALAPPDATA 'Nagneon/installation.json'
        if (-not (Test-Path -LiteralPath $pointer -PathType Leaf)) { throw 'Installation registration is missing. Open Start-Nagneon.cmd in the fixed installation folder, or re-register the installation. Existing records were not changed.' }
        try { $InstallRoot = (Get-Content -LiteralPath $pointer -Raw -Encoding UTF8 | ConvertFrom-Json).installRoot }
        catch { throw 'Installation registration cannot be read. Re-register the fixed installation; keep the existing profile and backups.' }
    }
    if (-not $InstallRoot -or -not [IO.Path]::IsPathRooted($InstallRoot)) { throw 'The registered installation folder is invalid. Re-register the fixed installation.' }
    try { $config = Get-Content -LiteralPath (Join-Path $InstallRoot 'current.json') -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch { throw 'The installed release configuration is missing or unreadable. Reapply a verified release; keep the profile and backups.' }
    if (-not $config.executable -or $config.exeSha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'The installed release configuration is incomplete. Reapply a verified release.' }
    $exe = Join-Path $InstallRoot $config.executable
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'Installed executable is missing. Reapply the release.' }
    $productVersion = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
    $inAppRecovery = $productVersion -match '^(\d+)\.(\d+)\.(\d+)' -and [version]($Matches[1]+'.'+$Matches[2]+'.'+$Matches[3]) -ge [version]'0.1.6'
    $savedProfile = $config.profile
    # New app versions own profile discovery, recovery and storage UI, including
    # direct EXE launches. Do not block their startup in the external launcher.
    if (-not $inAppRecovery) {
    $storageFile = Join-Path $env:APPDATA 'Nagneon/storage.json'
    try { $savedProfile = if (Test-Path -LiteralPath $storageFile) { (Get-Content -LiteralPath $storageFile -Raw -Encoding UTF8 | ConvertFrom-Json).profile } else { $config.profile } }
    catch { throw 'The saved storage setting cannot be read. Keep storage.json and the profile for recovery; no empty profile was created.' }
    if (-not $savedProfile -or -not [IO.Path]::IsPathRooted($savedProfile)) { throw 'The saved profile path is invalid. Restore the storage setting or reconnect the storage device. No empty profile was created.' }
    if (-not (Test-Path -LiteralPath (Join-Path $savedProfile 'data') -PathType Container)) {
        if ($Inspect) { throw "Saved profile data is missing at: $savedProfile\data. Open the launcher normally to recover the existing records." }
        throw 'Install Nagneon 0.1.6 or later to recover this profile inside the app.'
    }
    Assert-NagneonProfileCompatibility -Profile $savedProfile -AppVersion (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
    }
    if ($inAppRecovery) {
        $savedProfile = Join-Path $env:APPDATA 'backseat-studio'
        $currentStorageFile = Join-Path $env:APPDATA 'Nagneon/storage.json'
        if (Test-Path -LiteralPath $currentStorageFile -PathType Leaf) {
            $savedProfile = (Get-Content -LiteralPath $currentStorageFile -Raw -Encoding UTF8 | ConvertFrom-Json).profile
            if (-not $savedProfile -or -not [IO.Path]::IsPathRooted($savedProfile)) { throw 'The selected storage profile is invalid. Preserve storage.json and recover the profile before launch.' }
        }
    }
    if ($inAppRecovery -and $savedProfile -and (Test-Path -LiteralPath (Join-Path $savedProfile 'data/profile-format.json'))) { Assert-NagneonProfileCompatibility -Profile $savedProfile -AppVersion $productVersion }
    # CMD can inherit a PowerShell 7 PSModulePath that hides the Windows
    # PowerShell Get-FileHash module. Use the runtime directly at this boundary.
    $stream = [IO.File]::OpenRead($exe)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $digest = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','') } finally { $stream.Dispose(); $sha.Dispose() }
    if ($digest -ne $config.exeSha256) { throw 'Installed executable hash mismatch.' }
    if ($Inspect) { [pscustomobject]@{ executable=$exe; profile=$savedProfile; version=$config.version } | ConvertTo-Json; exit 0 }
    $child = Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -PassThru
    $child.WaitForExit()
    exit $child.ExitCode
} catch {
    $message = "Nagneon could not start safely.`r`n`r`n" + $_.Exception.Message + "`r`n`r`nYour saved records were not reset. Preserve the profile and installation backups."
    # Expected startup failures are user guidance, not an unhandled PowerShell
    # exception. Inspection remains non-interactive for automation/regression tests.
    if ($Inspect) { [Console]::Error.WriteLine($message) }
    else {
        try {
            Add-Type -AssemblyName System.Windows.Forms
            [void][System.Windows.Forms.MessageBox]::Show($message, 'Nagneon - Startup check', 'OK', 'Warning')
        } catch { [Console]::Error.WriteLine($message) }
    }
    exit 1
}
