[CmdletBinding()]
param([switch]$HelpOnly)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$entry=Join-Path $root 'tools\desktop-commander\node_modules\@wonderwhy-er\desktop-commander\dist\index.js'
if(!(Test-Path -LiteralPath $entry)){throw 'Pinned Desktop Commander installation is missing.'}
$node=(Get-Command node.exe -ErrorAction Stop).Source
if($HelpOnly){& $node $entry remote --help; exit $LASTEXITCODE}
$mutex=New-Object System.Threading.Mutex($false,'Local\AI-Web-Development-RDC-Launcher')
if(!$mutex.WaitOne(0)){$mutex.Dispose();throw 'Another RDC launch is in progress.'}
try {
$record=Join-Path $root 'rdc-process.json'
if(Test-Path -LiteralPath $record){
  $old=Get-Content -LiteralPath $record -Raw | ConvertFrom-Json
  $active=Get-Process -Id $old.pid -ErrorAction SilentlyContinue
  if($active -and $active.StartTime.ToUniversalTime().Ticks -eq ([datetime]$old.started).ToUniversalTime().Ticks){Write-Output 'This launcher already owns a running RDC agent.'; exit 0}
}
# Pairing details go to local logs. The agent owns credential storage.
$log=Join-Path $root ('logs\rdc-'+[guid]::NewGuid().ToString('N'))
$p=Start-Process -FilePath $node -ArgumentList @(('"'+$entry+'"'),'remote','--disable-no-sleep') -WindowStyle Hidden -PassThru -RedirectStandardOutput ($log+'.out.log') -RedirectStandardError ($log+'.err.log')
[pscustomobject]@{pid=$p.Id;started=$p.StartTime.ToUniversalTime().ToString('o');entry=$entry;executable=$node;stdout=($log+'.out.log');stderr=($log+'.err.log')} | ConvertTo-Json | Set-Content -LiteralPath $record -Encoding UTF8
Write-Output "RDC started. Pairing output: $log.out.log / $log.err.log"
} finally {$mutex.ReleaseMutex();$mutex.Dispose()}
