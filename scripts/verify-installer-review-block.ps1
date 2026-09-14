param(
  [string]$InstallerPath = 'artifacts/installer-reviewed-fixture/BACKSEAT-Setup.exe',
  [string]$ReportPath = 'artifacts/installer-review-block-test.json'
)
$ErrorActionPreference = 'Stop'
$taskRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskExe = [IO.Path]::GetFullPath((Join-Path $taskRoot $InstallerPath))
$taskReport = [IO.Path]::GetFullPath((Join-Path $taskRoot $ReportPath))
if (-not $taskExe.StartsWith((Join-Path $taskRoot 'artifacts') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Test installer outside artifacts' }
if (-not $taskReport.StartsWith((Join-Path $taskRoot 'artifacts') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Test report outside artifacts' }
$taskTarget = Join-Path $taskRoot ('artifacts/installer-inert-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
if (-not $taskTarget.StartsWith((Join-Path $taskRoot 'artifacts') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Test path outside artifacts' }
if (Test-Path -LiteralPath $taskTarget) { throw 'Test target already exists' }
$taskKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Nagneon-Test'
$taskMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Nagneon (Test)'
$taskDefault = Join-Path $env:LOCALAPPDATA 'Programs/Nagneon (Test)'
$taskBefore = @{key=(Test-Path -LiteralPath $taskKey);menu=(Test-Path -LiteralPath $taskMenu);default=(Test-Path -LiteralPath $taskDefault)}
if ($taskBefore.key -or $taskBefore.menu -or $taskBefore.default) { throw 'Test identity already in use; do not touch it' }
$taskProc = Start-Process -FilePath $taskExe -ArgumentList @('/S', ('/D=' + $taskTarget)) -WindowStyle Hidden -PassThru
if (-not $taskProc.WaitForExit(15000)) { throw 'Review blocker did not finish; inspect the exact test PID' }
$taskProc.Refresh()
$taskAfter = @{key=(Test-Path -LiteralPath $taskKey);menu=(Test-Path -LiteralPath $taskMenu);default=(Test-Path -LiteralPath $taskDefault);target=(Test-Path -LiteralPath $taskTarget)}
$taskPassed = $taskProc.ExitCode -eq 10 -and -not $taskAfter.key -and -not $taskAfter.menu -and -not $taskAfter.default -and -not $taskAfter.target
@{passed=$taskPassed;exe=$taskExe;target=$taskTarget;pid=$taskProc.Id;exitCode=$taskProc.ExitCode;before=$taskBefore;after=$taskAfter;scope='Inert review-only synthetic installer exits before creating install state; not install/uninstall acceptance'} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $taskReport
if (-not $taskPassed) { throw 'Review-only execution did not remain inert' }
