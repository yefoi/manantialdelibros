@echo off
chcp 1252 >nul
title Manantial de Libros - subir cambios a GitHub
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0herramientas\subir-github.ps1"
exit /b 0
