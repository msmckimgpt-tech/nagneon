param([Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference='Stop'
$identityKey='Software\Microsoft\Windows\CurrentVersion\Uninstall\Nagneon-Test'
$result=@{registries=@{};shortcut=$null;group=$null}
foreach($view in @([Microsoft.Win32.RegistryView]::Registry32,[Microsoft.Win32.RegistryView]::Registry64)) {
  $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,$view)
  try {
    $key=$base.OpenSubKey($identityKey)
    if($null -eq $key){$result.registries[$view.ToString()]=$null;continue}
    try {$values=@{};foreach($name in $key.GetValueNames()){$values[$name]=$key.GetValue($name)};$result.registries[$view.ToString()]=$values}
    finally {$key.Dispose()}
  } finally {$base.Dispose()}
}
$group=Join-Path ([Environment]::GetFolderPath('Programs')) 'Nagneon (Test)'
$link=Join-Path $group 'Nagneon (Test).lnk'
$result.group=@{path=$group;exists=(Test-Path -LiteralPath $group)}
if(Test-Path -LiteralPath $link){
  $shell=New-Object -ComObject WScript.Shell
  $hasher=[Security.Cryptography.SHA256]::Create()
  try {$linkHash=[BitConverter]::ToString($hasher.ComputeHash([IO.File]::ReadAllBytes($link))).Replace('-','');$shortcut=$shell.CreateShortcut($link);$result.shortcut=@{path=$link;target=$shortcut.TargetPath;workingDirectory=$shortcut.WorkingDirectory;arguments=$shortcut.Arguments;description=$shortcut.Description;sha256=$linkHash}}
  finally {$hasher.Dispose();if($shortcut){[Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut)|Out-Null};[Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)|Out-Null}
}
$result|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $OutputPath -Encoding utf8
