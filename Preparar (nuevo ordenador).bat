@echo off
chcp 1252 >nul
title Manantial de Libros - preparar este ordenador
cd /d "%~dp0"
echo.
echo  =====================================================
echo   MANANTIAL DE LIBROS - preparar el ordenador
echo  =====================================================
echo.
echo   El proyecto NO tiene dependencias: no hay que ejecutar "npm install".
echo   Solo necesita Node.js, y esto lo resuelve de la forma mas sencilla:
echo.
echo     - si este ordenador ya tiene Node.js (18 o superior), usa ese
echo     - si existe runtime\node.zip, lo descomprime (sirve sin internet)
echo     - si no, lo descarga dentro de la carpeta runtime (no instala nada
echo       en el sistema: no hacen falta permisos de administrador)
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0herramientas\instalar-node.ps1"
if errorlevel 1 goto fallo
echo.
echo  ---------------------------------------------------------------
echo   Siguiente paso: importar el catalogo desde el Excel
echo.
echo   1) Copia el Excel  "listado_biblioteca_excel.xlsx"  en el
echo      escritorio.
echo   2) Copia la carpeta de fotos  "libros FINAL"  en el escritorio.
echo   3) Ejecuta:  herramientas\importar.ps1
echo                (clic derecho ^> Ejecutar con PowerShell)
echo   4) Ejecuta:  herramientas\miniaturas.ps1
echo.
echo   Despues, para arrancar la biblioteca:
echo      Iniciar Manantial de Libros.bat
echo.
echo   Si te ha dado un error de permisos, mueve toda la carpeta del
echo   proyecto a "Documentos" (no la dejes en Program Files ni en la
echo   raiz de C:) y vuelve a ejecutar este archivo.
echo  ---------------------------------------------------------------
goto fin
:fallo
echo.
echo  Algo ha fallado. Revisa el mensaje de arriba.
:fin
echo.
pause
