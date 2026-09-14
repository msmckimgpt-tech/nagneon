[CmdletBinding()]
param([string]$WorkingDirectory=(Get-Location).Path,[switch]$Login)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$config=Join-Path $root 'web-codex-home\config.toml'
if(!$Login -and !(Test-Path -LiteralPath $config)){throw 'Complete the isolated Web GPT launcher setup and Install models first.'}
$codex=(Get-Command codex.exe -ErrorAction Stop).Source
$start=New-Object System.Diagnostics.ProcessStartInfo
$start.FileName=$codex
$start.WorkingDirectory=(Resolve-Path -LiteralPath $WorkingDirectory).Path
$start.UseShellExecute=$false
$start.EnvironmentVariables['CODEX_HOME']=Join-Path $root 'web-codex-home'
if($Login){$start.Arguments='login'}
else{$start.Arguments='--model chatgpt-web/extra-high -c model_reasoning_effort="xhigh"'}
$p=[System.Diagnostics.Process]::Start($start)
$p.WaitForExit()
exit $p.ExitCode
