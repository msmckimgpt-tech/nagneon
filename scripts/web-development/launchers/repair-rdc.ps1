[CmdletBinding()]
param(
  [string]$Root = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.local\share\ai-web-development'),
  [string]$ProjectPath,
  [switch]$RestartOwned,
  [ValidateRange(0,60)][int]$WaitSeconds = 15
)
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath($Root)
$entry = Join-Path $Root 'tools\desktop-commander\node_modules\@wonderwhy-er\desktop-commander\dist\index.js'
$record = Join-Path $Root 'rdc-process.json'
if (!(Test-Path -LiteralPath $entry -PathType Leaf)) { throw 'RDC installation missing. Install the pinned package first; credentials will not be copied.' }
foreach ($name in @('start-rdc.ps1','stop-rdc.ps1')) {
  if (!(Test-Path -LiteralPath (Join-Path $Root ('bin\'+$name)) -PathType Leaf)) { throw "Missing launcher: $name" }
}
if ($ProjectPath -and !(Test-Path -LiteralPath $ProjectPath -PathType Container)) { throw 'Project directory does not exist on this machine.' }

function Get-OwnedAgent {
  if (!(Test-Path -LiteralPath $record)) { return $null }
  $info = Get-Content -LiteralPath $record -Raw | ConvertFrom-Json
  if ($info.entry -ne $entry) { throw 'Recorded entry differs from this installation; refusing recovery.' }
  $process = Get-Process -Id $info.pid -ErrorAction SilentlyContinue
  if (!$process) { return $null }
  if ($process.StartTime.ToUniversalTime().Ticks -ne ([datetime]$info.started).ToUniversalTime().Ticks -or $process.Path -ne $info.executable) {
    throw 'Recorded PID now belongs to a different process; refusing recovery.'
  }
  $details = Get-CimInstance Win32_Process -Filter "ProcessId = $($info.pid)"
  if (!$details.CommandLine -or !$details.CommandLine.Contains(('"'+$entry+'"')) -or $details.CommandLine -notmatch '\sremote(?:\s|$)') {
    throw 'RDC command identity does not match; refusing recovery.'
  }
  return $info
}

$mutex = New-Object System.Threading.Mutex($false,'Local\AI-Web-Development-RDC-Recovery')
if (!$mutex.WaitOne(0)) { $mutex.Dispose(); throw 'Another RDC recovery is in progress.' }
try {
  $owned = Get-OwnedAgent
  $matching = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
    $_.CommandLine -and $_.CommandLine.Contains(('"'+$entry+'"')) -and $_.CommandLine -match '\sremote(?:\s|$)'
  })
  if (@($matching | Where-Object { !$owned -or $_.ProcessId -ne $owned.pid }).Count) {
    throw 'An unowned RDC agent is already running. No process was stopped or duplicated.'
  }
  $action = 'ALREADY_RUNNING'
  $shell = (Get-Process -Id $PID).Path
  if ($RestartOwned -and $owned) {
    & $shell -NoProfile -File (Join-Path $Root 'bin\stop-rdc.ps1') | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Owned-agent stop failed.' }
    $owned = $null
    $action = 'RESTARTED'
  }
  if (!$owned) {
    New-Item -ItemType Directory -Path (Join-Path $Root 'logs') -Force | Out-Null
    & $shell -NoProfile -File (Join-Path $Root 'bin\start-rdc.ps1') | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'RDC start failed.' }
    if ($action -ne 'RESTARTED') { $action = 'STARTED' }
  }
  $deadline = [datetime]::UtcNow.AddSeconds($WaitSeconds)
  $state = 'STARTING_OR_RECONNECTING'
  do {
    $owned = Get-OwnedAgent
    if (!$owned) { $state = 'EXITED'; break }
    # Inspect only this process's launcher logs; never read credential storage or emit raw logs/codes.
    $tail = @()
    foreach ($log in @($owned.stdout,$owned.stderr)) {
      $fullLog = [IO.Path]::GetFullPath($log)
      if (!$fullLog.StartsWith((Join-Path $Root 'logs')+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected log location.' }
      if (Test-Path -LiteralPath $fullLog) { $tail += Get-Content -LiteralPath $fullLog -Tail 60 }
    }
    $joined = $tail -join "`n"
    if ($joined -match 'Device ready:') { $state = 'LOCAL_READY_REMOTE_UNVERIFIED'; break }
    if ($joined -match 'Waiting for authorization|Please complete authentication') { $state = 'AUTH_REQUIRED'; break }
    if ([datetime]::UtcNow -ge $deadline) { break }
    Start-Sleep -Milliseconds 500
  } while ($true)
  [pscustomobject]@{
    machine = [Environment]::MachineName
    action = $action
    state = $state
    pid = $(if ($owned) { $owned.pid } else { $null })
    projectPath = $ProjectPath
    remoteAccess = 'NOT_VERIFIED'
    verificationUrl = $(if ($state -eq 'AUTH_REQUIRED') { 'https://mcp.desktopcommander.app/device/verify' } else { $null })
    logPath = $(if ($owned) { $owned.stdout } else { $null })
    nextStep = 'Use RDC list_devices, select this machine explicitly, then read a non-secret project file. If AUTH_REQUIRED, complete official device login with the existing account and rerun.'
  } | ConvertTo-Json
  if ($state -eq 'AUTH_REQUIRED') { exit 2 }
  if ($state -ne 'LOCAL_READY_REMOTE_UNVERIFIED') { exit 3 }
} finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
