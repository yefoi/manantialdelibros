@echo off
chcp 1252 >nul
title Manantial de Libros - permitir acceso desde la red
cd /d "%~dp0"
echo.
echo  Se va a pedir permiso de administrador para abrir el puerto en el firewall.
echo  Solo hay que hacerlo UNA VEZ en este ordenador.
echo.
powershell -NoProfile -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','\"%~dp0herramientas\firewall.ps1\"'"
exit /b 0
