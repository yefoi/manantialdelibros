@echo off
chcp 1252 >nul
title Manantial de Libros - Biblioteca
rem pushd funciona tambien si la carpeta es una ruta de red (\\servidor\carpeta)
pushd "%~dp0"

rem 1) Node.js portable dentro del proyecto
rem 2) Node.js portable instalado en este PC (si el proyecto es de solo lectura)
rem 3) Node.js instalado en el sistema
set "NODE=%~dp0runtime\node\node.exe"
if not exist "%NODE%" set "NODE=%LOCALAPPDATA%\Manantial de Libros\node\node.exe"
if not exist "%NODE%" set "NODE="
if not defined NODE for /f "delims=" %%i in ('where node 2^>nul') do set "NODE=%%i"
if not defined NODE (
  echo.
  echo  No encuentro Node.js en este ordenador.
  echo.
  echo   Opciones:
  echo    1. Ejecuta "Preparar ^(nuevo ordenador^).bat"
  echo       ^(prepara Node.js sin necesidad de permisos de administrador^)
  echo    2. O instala Node.js desde https://nodejs.org y vuelve a abrir esto
  echo.
  popd
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
popd
pause
