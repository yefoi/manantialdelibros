@echo off
chcp 1252 >nul
title Manantial de Libros - actualizar desde GitHub
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0herramientas\actualizar-github.ps1"
exit /b 0
