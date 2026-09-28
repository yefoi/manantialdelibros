@echo off
chcp 1252 >nul
title Manantial de Libros - preparar este ordenador
cd /d "%~dp0"
echo.
echo  =====================================================
echo   MANANTIAL DE LIBROS - preparar el ordenador
echo  =====================================================
echo.
echo   Esto descarga Node.js (portable) dentro de la carpeta runtime.
echo   No instala nada en el sistema.
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
echo                (clic derecho > Ejecutar con PowerShell)
echo   4) Ejecuta:  herramientas\miniaturas.ps1
echo.
echo   Despues, para arrancar la biblioteca:
echo      Iniciar Manantial de Libros.bat
echo  ---------------------------------------------------------------
goto fin
:fallo
echo.
echo  Algo ha fallado. Revisa el mensaje de arriba.
:fin
echo.
pause
