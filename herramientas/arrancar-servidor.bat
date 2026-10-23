@echo off
chcp 1252 >nul
title Manantial de Libros - servidor
rem Arranca solo el servidor, sin abrir el navegador.
rem Lo usa el arranque automatico de Windows.
cd /d "%~dp0.."

set "NODE=%~dp0..\runtime\node\node.exe"
if exist "%NODE%" goto :tengo
for /f "delims=" %%i in ('where node 2^>nul') do set "NODE=%%i"
:tengo
if not exist "%NODE%" (
  echo No encuentro Node.js (ni en runtime\node ni instalado en el sistema).
  exit /b 1
)
"%NODE%" "%~dp0..\app\server.js"
