@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Pantokrator Atlas

set "ATLAS_NODE=%~dp0runtime\node.exe"
if not exist "%ATLAS_NODE%" (
  set "ATLAS_NODE=node.exe"
  where node.exe >nul 2>&1
)
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

"%ATLAS_NODE%" "%~dp0scripts\start-atlas.mjs" %*
set "ATLAS_EXIT=%ERRORLEVEL%"

if not "%ATLAS_EXIT%"=="0" (
  echo.
  echo Pantokrator Atlas could not start. Review the message above.
  echo See docs\USER_GUIDE.md for troubleshooting.
  pause
)

exit /b %ATLAS_EXIT%
