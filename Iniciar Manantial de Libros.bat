@echo off
chcp 1252 >nul
title Manantial de Libros - Biblioteca
cd /d "%~dp0"

set "NODE=%~dp0runtime\node\node.exe"
if not exist "%NODE%" (
  echo.
  echo  No encuentro Node.js en la carpeta "runtime".
  echo  Vuelve a instalar el proyecto o avisa a quien te lo preparo.
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
