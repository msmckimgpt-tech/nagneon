[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$entry=Join-Path $root 'tools\desktop-commander\node_modules\@wonderwhy-er\desktop-commander\package.json'
$location=Get-ItemPropertyValue -LiteralPath 'HKCU:\Software\d1a6026a-6210-588e-9a2b-da3936f94e02' -Name InstallLocation -ErrorAction SilentlyContinue
$state=[ordered]@{webLauncherInstalled=!!$location;webLauncherVersion=$null;desktopCommanderVersion=$null;isolatedCodexConfigured=(Test-Path -LiteralPath (Join-Path $root 'web-codex-home\config.toml'));rdcAgentRunning=$false;liveWebRoundtrip='NOT_VERIFIED';webMcpEndpoint='https://mcp.desktopcommander.app/mcp'}
if($location){$app=Join-Path $location 'Codex Web GPT.exe';if(Test-Path -LiteralPath $app){$state.webLauncherVersion=(Get-Item -LiteralPath $app).VersionInfo.ProductVersion}}
if(Test-Path -LiteralPath $entry){$state.desktopCommanderVersion=(Get-Content -LiteralPath $entry -Raw | ConvertFrom-Json).version}
$record=Join-Path $root 'rdc-process.json'
if(Test-Path -LiteralPath $record){$r=Get-Content -LiteralPath $record -Raw | ConvertFrom-Json;$p=Get-Process -Id $r.pid -ErrorAction SilentlyContinue;if($p -and $p.StartTime.ToUniversalTime().Ticks -eq ([datetime]$r.started).ToUniversalTime().Ticks){$state.rdcAgentRunning=$true}}
$state | ConvertTo-Json
