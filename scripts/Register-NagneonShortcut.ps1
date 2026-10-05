# Only the installer chooses real Windows shortcut locations. Tests use isolated folders.
function Register-NagneonShortcut {
    param(
        [Parameter(Mandatory=$true)][string]$LinkPath,
        [Parameter(Mandatory=$true)][string]$BackupPath,
        [Parameter(Mandatory=$true)][string]$InstallRoot,
        [Parameter(Mandatory=$true)][string]$Executable
    )
    $ErrorActionPreference = 'Stop'
    $launcher = Join-Path $InstallRoot 'Start-Nagneon.cmd'
    if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw 'Fixed launcher is missing.' }
    if (Test-Path -LiteralPath $BackupPath) { throw 'Shortcut backup already exists.' }
    if (Test-Path -LiteralPath $LinkPath) {
        if ((Get-Item -LiteralPath $LinkPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked shortcuts are not supported.' }
        New-Item -ItemType Directory -Path (Split-Path $BackupPath) -Force | Out-Null
        Copy-Item -LiteralPath $LinkPath -Destination $BackupPath
        if ((Get-FileHash -LiteralPath $LinkPath).Hash -ne (Get-FileHash -LiteralPath $BackupPath).Hash) { throw 'Shortcut changed during backup.' }
    }
    New-Item -ItemType Directory -Path (Split-Path $LinkPath) -Force | Out-Null
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($LinkPath)
    $link.TargetPath = $launcher
    $link.Arguments = ''
    $link.WorkingDirectory = $InstallRoot
    $link.IconLocation = $Executable + ',0'
    $link.Save()
    $saved = $shell.CreateShortcut($LinkPath)
    if ($saved.TargetPath -ne $launcher -or $saved.Arguments -ne '' -or $saved.WorkingDirectory -ne $InstallRoot) { throw 'Shortcut registration did not persist.' }
}
