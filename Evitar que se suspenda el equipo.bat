@echo off
chcp 1252 >nul
title Manantial de Libros - evitar que el equipo se suspenda
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0herramientas\no-dormir.ps1"
pause
