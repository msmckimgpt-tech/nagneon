param([string]$PackageFolder, [string]$ResultPath)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $PackageFolder) {
  $package = Get-Content (Join-Path $root 'artifacts/latest-package.json') -Raw | ConvertFrom-Json
  $PackageFolder = $package.folder
}
if (-not $ResultPath) { $ResultPath = Join-Path $root 'artifacts/nagneon/native-result.json' }
$exe = Join-Path $PackageFolder 'Nagneon.exe'
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'Package executable is missing' }
New-Item -ItemType Directory -Path (Split-Path -Parent $ResultPath) -Force | Out-Null
$profile = Join-Path $root ('artifacts/nagneon/native-' + [guid]::NewGuid().ToString('N'))
$process = Start-Process -FilePath $exe -ArgumentList ('"--nagneon-profile=' + $profile + '"') -WindowStyle Hidden -PassThru
$started = $process.StartTime
$deadline = (Get-Date).AddSeconds(30)
do {
  Start-Sleep -Milliseconds 500
  $process.Refresh()
} while (-not $process.HasExited -and $process.MainWindowTitle -notmatch 'Nagneon' -and (Get-Date) -lt $deadline)
$result = [ordered]@{ exe=$exe; pid=$process.Id; started=$started; profile=$profile; title=$process.MainWindowTitle; window=($process.MainWindowHandle.ToInt64() -ne 0); passed=$false }
if (-not $process.HasExited -and $process.StartTime -eq $started -and $process.Path -eq $exe) {
  $result.closedNormally=$process.CloseMainWindow()
  $result.exited=$process.WaitForExit(15000)
}
$result.profileCreated=Test-Path (Join-Path $profile 'data')
$result.passed=$result.window -and $result.title -match 'Nagneon' -and $result.exited -and $result.profileCreated
$result | ConvertTo-Json | Set-Content -LiteralPath $ResultPath
$result | ConvertTo-Json
if (-not $result.passed) { exit 1 }
