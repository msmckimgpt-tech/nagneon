param([string]$InstallRoot, [switch]$Inspect)
$ErrorActionPreference = 'Stop'
try {
    if (-not $InstallRoot) {
        $pointer = Join-Path $env:LOCALAPPDATA 'Nagneon/installation.json'
        $InstallRoot = (Get-Content -LiteralPath $pointer -Raw | ConvertFrom-Json).installRoot
    }
    $config = Get-Content -LiteralPath (Join-Path $InstallRoot 'current.json') -Raw | ConvertFrom-Json
    $exe = Join-Path $InstallRoot $config.executable
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'Installed executable is missing. Reapply the release.' }
    $storageFile = Join-Path $env:APPDATA 'Nagneon/storage.json'
    $savedProfile = if (Test-Path -LiteralPath $storageFile) { (Get-Content -LiteralPath $storageFile -Raw | ConvertFrom-Json).profile } else { $config.profile }
    if (-not (Test-Path -LiteralPath (Join-Path $savedProfile 'data') -PathType Container)) { throw 'Saved profile is missing. Refusing to create an empty profile.' }
    if ((Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash -ne $config.exeSha256) { throw 'Installed executable hash mismatch.' }
    if ($Inspect) { [pscustomobject]@{ executable=$exe; profile=$savedProfile; version=$config.version } | ConvertTo-Json; exit 0 }
    $child = Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -PassThru
    $child.WaitForExit()
    exit $child.ExitCode
} catch { Write-Error ('Nagneon: ' + $_.Exception.Message); exit 1 }
