# =====================================================================
#  Manantial de Libros - parar el servidor
#  Uso: doble clic en "Parar el servidor.bat"
#  Util para dejar el sitio detenido antes de apagar o suspender el PC.
# =====================================================================
[CmdletBinding()]
param([switch]$NoPausa)

$ErrorActionPreference = 'Stop'

function Pausar { if (-not $NoPausa) { Read-Host "  Pulsa Intro para cerrar" } }

Write-Host ""
Write-Host "  Manantial de Libros - parar el servidor" -ForegroundColor Cyan
Write-Host ""

$procesos = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -match 'app[\\/]+server\.js' })

if (-not $procesos.Count) {
  Write-Host "  El servidor no estaba en marcha." -ForegroundColor Green
  Write-Host ""
  Pausar
  exit 0
}

foreach ($p in $procesos) {
  Write-Host ("  Parando el servidor (proceso {0})..." -f $p.ProcessId) -ForegroundColor Cyan
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 1

$quedan = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -match 'app[\\/]+server\.js' })
if ($quedan.Count) {
  Write-Host "  No se ha podido parar del todo. Intentalo otra vez." -ForegroundColor Red
  Pausar
  exit 1
}

Write-Host ""
Write-Host "  Servidor parado. Ya puedes apagar o suspender el ordenador." -ForegroundColor Green
Write-Host "  Al encender el PC arrancara solo (si tienes el arranque automatico)." -ForegroundColor DarkGray
Write-Host "  Si solo lo suspendes, al volver usa 'Iniciar Manantial de Libros.bat'." -ForegroundColor DarkGray
Write-Host ""
Pausar
