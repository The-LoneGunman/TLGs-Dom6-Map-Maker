@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Pantokrator Atlas

where node.exe >nul 2>&1
if errorlevel 1 (
  echo.
  echo Pantokrator Atlas needs Node.js 22.13.0 or newer.
  echo Opening the official Node.js download page...
  start "" "https://nodejs.org/en/download"
  echo.
  echo Install Node.js, then double-click this launcher again.
  pause
  exit /b 1
)

node.exe "%~dp0scripts\start-atlas.mjs" %*
set "ATLAS_EXIT=%ERRORLEVEL%"

if not "%ATLAS_EXIT%"=="0" (
  echo.
  echo Pantokrator Atlas could not start. Review the message above.
  echo See docs\USER_GUIDE.md for troubleshooting.
  pause
)

exit /b %ATLAS_EXIT%
