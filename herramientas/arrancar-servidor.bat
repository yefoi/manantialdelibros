@echo off
chcp 1252 >nul
title Manantial de Libros - servidor
rem Arranca solo el servidor, sin abrir el navegador.
rem Lo usa el arranque automatico de Windows.
cd /d "%~dp0.."
if not exist "%~dp0..\runtime\node\node.exe" (
  echo No encuentro Node.js en runtime\node\node.exe
  exit /b 1
)
"%~dp0..\runtime\node\node.exe" "%~dp0..\app\server.js"
