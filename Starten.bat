@echo off
cd /d "%~dp0"
if not exist node_modules (
  call "%~dp0Installieren.bat"
)
start "" /b cmd /c "npm start"
