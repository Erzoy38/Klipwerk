@echo off
chcp 65001 >nul
title Klipwerk - EXE erstellen
cd /d "%~dp0"
if not exist node_modules call npm install
echo  Das Installationsprogramm wird gebaut (Ordner "dist") ...
call npm run dist
echo.
echo  Fertig. Die Dateien liegen im Ordner "dist".
pause
