@echo off
setlocal
if not exist "%~dp0scripts\launch.vbs" (
  echo DepthPilot could not find its launcher. Please extract the whole download first.
  pause
  exit /b 1
)
start "" "%SystemRoot%\System32\wscript.exe" "%~dp0scripts\launch.vbs"
exit /b 0
