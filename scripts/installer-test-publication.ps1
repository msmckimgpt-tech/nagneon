param(
  [Parameter(Mandatory=$true)][ValidateSet('foreign-registry','restore-registry','foreign-shortcut','restore-shortcut','customize-shortcut')][string]$Action,
  [Parameter(Mandatory=$true)][string]$InstallRoot
)
$ErrorActionPreference='Stop'
$workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$testRoot=[IO.Path]::GetFullPath($InstallRoot)
if (-not $testRoot.StartsWith((Join-Path $workspace 'artifacts/installer-guards-'),[StringComparison]::OrdinalIgnoreCase)) { throw 'Not a guard-test root' }
$state=Get-Content -LiteralPath (Join-Path $testRoot '.backseat/state.json') -Raw | ConvertFrom-Json
$testId='{8C2EFA10-5B76-4D83-AB91-7F3064D82E51}'
if ($state.appId -ne $testId -or $state.installRoot -cne $testRoot) { throw 'Test identity/root mismatch' }
$keyPath='Software\Microsoft\Windows\CurrentVersion\Uninstall\Nagneon-Test'
if ($Action -eq 'foreign-registry' -or $Action -eq 'restore-registry') {
  $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($keyPath,$true)
  if ($null -eq $key) { throw 'No existing TEST registration to mutate' }
  try {
    if ($key.GetValue('InstallLocation') -cne $testRoot) { throw 'Registration belongs to another root' }
    $expected=if($Action -eq 'foreign-registry'){$testId}else{'foreign-fixture'}
    $replacement=if($Action -eq 'foreign-registry'){'foreign-fixture'}else{$testId}
    if ($key.GetValue('AppId') -cne $expected) { throw 'Unexpected registration owner; refusing' }
    $key.SetValue('AppId',$replacement,[Microsoft.Win32.RegistryValueKind]::String)
  } finally {$key.Dispose()}
} else {
  $linkPath=Join-Path ([Environment]::GetFolderPath('Programs')) 'Nagneon (Test)/Nagneon (Test).lnk'
  if (-not (Test-Path -LiteralPath $linkPath)) { throw 'TEST shortcut missing' }
  $launcher=Join-Path $testRoot 'BACKSEAT Launcher.exe'
  $foreign=Join-Path ([IO.Path]::GetDirectoryName($testRoot)) 'foreign.exe'
  $shell=New-Object -ComObject WScript.Shell
  try {
    $link=$shell.CreateShortcut($linkPath)
    $expected=if($Action -eq 'restore-shortcut'){$foreign}else{$launcher}
    if ($link.TargetPath -cne $expected) { throw 'Unexpected shortcut owner; refusing' }
    if ($Action -eq 'customize-shortcut') {$link.Arguments='--fixture-label "my audience"'}
    else {$link.TargetPath=if($Action -eq 'foreign-shortcut'){$foreign}else{$launcher}}
    $link.Save()
  } finally {if($link){[Runtime.InteropServices.Marshal]::FinalReleaseComObject($link)|Out-Null};[Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)|Out-Null}
}
Write-Output $Action
