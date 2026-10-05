function Get-NagneonLauncherCommand {
    param([switch]$Installed)
    # Select an installed runtime by location, never by policy or by retrying a
    # failed script. Every runtime keeps its normal execution policy.
    $start = if ($Installed) {
        '"%NAGNEON_POWERSHELL%" -NoLogo -NoProfile -File "%~dp0Start-InstalledNagneon.ps1" -InstallRoot "%~dp0."'
    } else {
        '"%NAGNEON_POWERSHELL%" -NoLogo -NoProfile -File "%~dp0scripts\Start-InstalledNagneon.ps1"'
    }
    $command = @'
@echo off
setlocal DisableDelayedExpansion
set "NAGNEON_POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if exist "%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe" set "NAGNEON_POWERSHELL=%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe"
if exist "%ProgramFiles%\PowerShell\7\pwsh.exe" set "NAGNEON_POWERSHELL=%ProgramFiles%\PowerShell\7\pwsh.exe"
__NAGNEON_START__
set "NAGNEON_EXIT=%errorlevel%"
if not "%NAGNEON_EXIT%"=="0" pause
exit /b %NAGNEON_EXIT%
'@
    return ($command.Replace('__NAGNEON_START__', $start) -replace '\r?\n', "`r`n") + "`r`n"
}
