param([Parameter(Mandatory=$true)][string]$SourceData,[Parameter(Mandatory=$true)][string]$Profile,[Parameter(Mandatory=$true)][string]$BackupRoot)
$ErrorActionPreference='Stop'
$SourceData=(Resolve-Path -LiteralPath $SourceData).Path.TrimEnd('\')
$Profile=[IO.Path]::GetFullPath($Profile).TrimEnd('\')
$target=Join-Path $Profile 'data'
if ($SourceData -eq $target -or ($target+'\').StartsWith($SourceData+'\',[StringComparison]::OrdinalIgnoreCase) -or ($SourceData+'\').StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Source and destination must be separate.' }
if (Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('Nagneon.exe','electron.exe') -and ($_.Name -eq 'Nagneon.exe' -or $_.CommandLine -match 'backseat|nagneon') }) { throw 'Close Nagneon normally before importing.' }
if (Get-ChildItem -LiteralPath $SourceData -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw 'Linked data is unsupported.' }
$backup=Join-Path ([IO.Path]::GetFullPath($BackupRoot)) ('main-import-'+(Get-Date -Format yyyyMMdd-HHmmss)+'-'+[guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $backup -Force | Out-Null
Copy-Item -LiteralPath $SourceData -Destination (Join-Path $backup 'source-data') -Recurse
if (Test-Path -LiteralPath $target) { Copy-Item -LiteralPath $target -Destination (Join-Path $backup 'previous-data') -Recurse }
New-Item -ItemType Directory -Path $Profile -Force | Out-Null
$stage=Join-Path $Profile ('data.import-'+[guid]::NewGuid().ToString('N'))
Copy-Item -LiteralPath $SourceData -Destination $stage -Recurse
$inventory=foreach ($file in Get-ChildItem -LiteralPath $SourceData -File -Recurse -Force) {
    $relative=$file.FullName.Substring($SourceData.Length).TrimStart('\')
    $hash=(Get-FileHash -LiteralPath $file.FullName).Hash
    foreach ($copyRoot in @($stage,(Join-Path $backup 'source-data'))) {
        if ((Get-FileHash -LiteralPath (Join-Path $copyRoot $relative)).Hash -ne $hash) { throw "Import verification failed: $relative" }
    }
    [pscustomobject]@{path=$relative;sha256=$hash}
}
# Keep the previous destination beside the new one as an additional rollback.
$previous=$null
if (Test-Path -LiteralPath $target) { $previous=Join-Path $Profile ('data.before-import-'+[guid]::NewGuid().ToString('N')); Move-Item -LiteralPath $target -Destination $previous }
try { Move-Item -LiteralPath $stage -Destination $target } catch { if ($previous) { Move-Item -LiteralPath $previous -Destination $target }; throw }
$report=[ordered]@{source=$SourceData;profile=$Profile;backup=$backup;previous=$previous;files=@($inventory).Count;inventory=$inventory;verified=$true}
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $backup 'import.json') -Encoding UTF8
[pscustomobject]@{profile=$Profile;backup=$backup;files=@($inventory).Count;verified=$true} | ConvertTo-Json
