@echo off
rem Double-click wrapper: run auto-setup.ps1 with the local PowerShell.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0auto-setup.ps1" %*
pause
