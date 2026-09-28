# =====================================================================
#  Manantial de Libros - arrancar el servidor automaticamente al encender el PC
#  (opcional)  Ejecutar y elegir:  .\arranque-automatico.ps1 -Quitar
# =====================================================================
[CmdletBinding()]
param([switch]$Quitar)

$Raiz = Split-Path -Parent $PSScriptRoot
$Inicio = [Environment]::GetFolderPath('Startup')
$acceso = Join-Path $Inicio 'Manantial de Libros.lnk'

if ($Quitar) {
  if (Test-Path $acceso) { Remove-Item $acceso -Force; Write-Host "Arranque automatico desactivado." }
  else { Write-Host "No estaba activado." }
  exit 0
}

$bat = Join-Path $Raiz 'Iniciar Manantial de Libros.bat'
if (-not (Test-Path $bat)) { Write-Error "No encuentro el lanzador: $bat"; exit 1 }

$shell = New-Object -ComObject WScript.Shell
$enlace = $shell.CreateShortcut($acceso)
$enlace.TargetPath = $bat
$enlace.WorkingDirectory = $Raiz
$enlace.WindowStyle = 7
$enlace.Description = 'Manantial de Libros - biblioteca'
$enlace.Save()
Write-Host "Hecho: Manantial de Libros se arrancara al encender el ordenador." -ForegroundColor Green
Write-Host "Para desactivarlo:  .\arranque-automatico.ps1 -Quitar"
