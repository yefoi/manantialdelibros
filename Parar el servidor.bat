@echo off
chcp 1252 >nul
title Manantial de Libros - parar servidor
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0herramientas\parar-servidor.ps1"
exit /b 0
