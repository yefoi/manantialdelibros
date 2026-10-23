@echo off
chcp 1252 >nul
title Manantial de Libros - servidor
rem Arranca solo el servidor, sin abrir el navegador.
rem Lo usa el arranque automatico de Windows.
rem pushd funciona tambien con rutas de red (\\servidor\carpeta)
pushd "%~dp0.."

set "NODE=%~dp0..\runtime\node\node.exe"
if not exist "%NODE%" set "NODE=%LOCALAPPDATA%\Manantial de Libros\node\node.exe"
if not exist "%NODE%" set "NODE="
if not defined NODE for /f "delims=" %%i in ('where node 2^>nul') do set "NODE=%%i"
if not defined NODE (
  echo No encuentro Node.js ^(ni en el proyecto, ni en este PC, ni en el sistema^).
  popd
  exit /b 1
)
"%NODE%" "%~dp0..\app\server.js"
popd
