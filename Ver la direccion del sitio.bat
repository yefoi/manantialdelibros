@echo off
chcp 1252 >nul
title Manantial de Libros - direccion del sitio
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0herramientas\ver-direccion.ps1"
pause
