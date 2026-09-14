[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$location=Get-ItemPropertyValue -LiteralPath 'HKCU:\Software\d1a6026a-6210-588e-9a2b-da3936f94e02' -Name InstallLocation
$app=Join-Path $location 'Codex Web GPT.exe'
if(!(Test-Path -LiteralPath $app)){throw 'Codex Web GPT is not installed.'}
foreach($name in @('web-codex-home','web-bridge','web-launcher')){New-Item -ItemType Directory -Force (Join-Path $root $name) | Out-Null}
$start=New-Object System.Diagnostics.ProcessStartInfo
$start.FileName=$app
$start.UseShellExecute=$false
# Child-only environment. Existing Codex and Claude configuration is untouched.
$start.EnvironmentVariables['CODEX_HOME']=Join-Path $root 'web-codex-home'
$start.EnvironmentVariables['CODEX_CHATGPT_WEB_HOME']=Join-Path $root 'web-bridge'
$start.EnvironmentVariables['CODEX_WEB_GPT_LAUNCHER_DATA_DIR']=Join-Path $root 'web-launcher'
$process=[System.Diagnostics.Process]::Start($start)
[pscustomobject]@{pid=$process.Id;launcher=$app;codexHome=(Join-Path $root 'web-codex-home');mode='isolated supplementary web route'} | ConvertTo-Json
