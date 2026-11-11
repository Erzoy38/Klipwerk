@echo off
chcp 65001 >nul
title Klipwerk - Installation
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js wurde nicht gefunden.
  echo  Bitte zuerst Node.js LTS von https://nodejs.org installieren
  echo  und danach diese Datei erneut starten.
  echo.
  pause
  exit /b 1
)
echo  Klipwerk wird eingerichtet. Das dauert beim ersten Mal ein paar Minuten ...
call npm install
if errorlevel 1 (
  echo.
  echo  Die Installation ist fehlgeschlagen. Bitte Internetverbindung pruefen.
  pause
  exit /b 1
)
echo.
echo  Fertig! Klipwerk kann jetzt mit "Starten.bat" geoeffnet werden.
pause
