@echo off
cd /d "%~dp0"
call npm run desktop
if errorlevel 1 pause
