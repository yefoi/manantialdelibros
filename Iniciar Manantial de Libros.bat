@echo off
chcp 1252 >nul
title Manantial de Libros - Biblioteca
cd /d "%~dp0"

rem 1) Node.js portable dentro del proyecto   2) si no, el Node.js del sistema
set "NODE=%~dp0runtime\node\node.exe"
if exist "%NODE%" goto :tengo
for /f "delims=" %%i in ('where node 2^>nul') do set "NODE=%%i"
:tengo
if not exist "%NODE%" (
  echo.
  echo  No encuentro Node.js en este ordenador.
  echo.
  echo   Opciones:
  echo    1. Ejecuta "Preparar (nuevo ordenador).bat"
  echo       (descarga Node.js portable dentro del proyecto; no instala nada)
  echo    2. O instala Node.js desde https://nodejs.org y vuelve a abrir esto
  echo.
  pause
  exit /b 1
)

echo.
echo  =====================================================
echo   MANANTIAL DE LIBROS - Biblioteca comunitaria
echo  =====================================================
echo.
echo   Arrancando el servidor... el navegador se abrira solo.
echo.
echo   Para pararlo: cierra esta ventana o pulsa Ctrl+C.
echo.

start "" http://localhost:8080
"%NODE%" "%~dp0app\server.js"

echo.
echo  El servidor se ha detenido.
pause
