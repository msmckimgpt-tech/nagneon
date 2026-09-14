[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$record=Join-Path $root 'rdc-process.json'
if(!(Test-Path -LiteralPath $record)){Write-Output 'No owned RDC agent.'; exit 0}
$info=Get-Content -LiteralPath $record -Raw | ConvertFrom-Json
$p=Get-Process -Id $info.pid -ErrorAction SilentlyContinue
if(!$p){Write-Output 'Owned RDC agent has already exited.'; exit 0}
if($p.StartTime.ToUniversalTime().Ticks -ne ([datetime]$info.started).ToUniversalTime().Ticks -or $p.Path -ne $info.executable){throw 'Process identity changed; refusing to stop it.'}
$cim=Get-CimInstance Win32_Process -Filter "ProcessId = $($info.pid)"
if(!$cim.CommandLine.Contains(('"'+$info.entry+'"'))){throw 'Command path does not match the owned RDC agent.'}
# Stop only this exact device agent; no process tree or other sessions.
Stop-Process -Id $p.Id
Write-Output 'Stopped the owned RDC device agent.'
