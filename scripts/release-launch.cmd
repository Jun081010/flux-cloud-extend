@echo off
rem Root launcher inside the release zip. Packaged as "一键安装.cmd".
setlocal
chcp 65001 >nul
title FluxDown Cloud - one click setup
pushd "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\one-click.ps1" %*
set "CODE=%ERRORLEVEL%"
popd
if not "%~1"=="" exit /b %CODE%
echo.
pause
exit /b %CODE%
