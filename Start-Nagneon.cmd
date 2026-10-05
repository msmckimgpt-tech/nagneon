@echo off
setlocal DisableDelayedExpansion
set "NAGNEON_POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if exist "%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe" set "NAGNEON_POWERSHELL=%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe"
if exist "%ProgramFiles%\PowerShell\7\pwsh.exe" set "NAGNEON_POWERSHELL=%ProgramFiles%\PowerShell\7\pwsh.exe"
"%NAGNEON_POWERSHELL%" -NoLogo -NoProfile -File "%~dp0scripts\Start-InstalledNagneon.ps1"
set "NAGNEON_EXIT=%errorlevel%"
if not "%NAGNEON_EXIT%"=="0" pause
exit /b %NAGNEON_EXIT%
