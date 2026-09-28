# =====================================================================
#  Manantial de Libros - evitar que el ordenador se suspenda
#  (el sitio web vive en este ordenador: si se suspende, deja de responder)
#
#    .\no-dormir.ps1            -> no se suspende nunca (enchufado)
#    .\no-dormir.ps1 -Quitar    -> vuelve a los valores de antes (20 min)
# =====================================================================
[CmdletBinding()]
param([switch]$Quitar)

$ErrorActionPreference = 'Continue'

function ValorCA([string]$sub, [string]$grupo) {
  $lineas = powercfg /query SCHEME_CURRENT $sub $grupo
  $linea = $lineas | Where-Object { $_ -match 'AC Power Setting' -or $_ -match 'corriente alterna actual' } | Select-Object -First 1
  if (-not $linea) { return -1 }
  $v = ($linea -split ':')[-1].Trim() -replace '0x', ''
  try { return [Convert]::ToInt32($v, 16) } catch { return -1 }
}
function Minutos([int]$seg) { if ($seg -le 0) { 'NUNCA' } else { "$([Math]::Round($seg / 60)) minutos" } }

if ($Quitar) {
  powercfg /change standby-timeout-ac 20 | Out-Null
  Write-Host ""
  Write-Host "  Deshecho: el equipo volvera a suspenderse a los 20 minutos." -ForegroundColor Yellow
  Write-Host "  (la web dejara de responder cuando se suspenda)"
  Write-Host ""
  exit 0
}

Write-Host ""
Write-Host "  Manantial de Libros - evitar que el equipo se suspenda" -ForegroundColor Cyan
Write-Host ""

$antesSuspender = ValorCA SUB_SLEEP STANDBYIDLE
Write-Host "  Antes: suspender tras $((Minutos $antesSuspender))" -ForegroundColor DarkGray

powercfg /change standby-timeout-ac 0 | Out-Null
powercfg /change hibernate-timeout-ac 0 | Out-Null
powercfg /change disk-timeout-ac 0 | Out-Null

$despuesSuspender = ValorCA SUB_SLEEP STANDBYIDLE
$despuesDisco = ValorCA SUB_DISK DISKIDLE
$pantalla = ValorCA SUB_VIDEO VIDEOIDLE

Write-Host ""
Write-Host "  Ahora (con el equipo enchufado):" -ForegroundColor White
Write-Host "     suspender el equipo .... $((Minutos $despuesSuspender))"
Write-Host "     apagar el disco duro .... $((Minutos $despuesDisco))"
Write-Host "     apagar la pantalla ...... $((Minutos $pantalla))  (esto no afecta al sitio)"

if ($despuesSuspender -le 0) {
  Write-Host ""
  Write-Host "  Listo: el ordenador no se suspendera y la web estara siempre disponible." -ForegroundColor Green
} else {
  Write-Host ""
  Write-Host "  AVISO: no se ha podido cambiar (puede estar bloqueado por las" -ForegroundColor Yellow
  Write-Host "  politicas de la empresa). Habla con informatica de la fundacion." -ForegroundColor Yellow
}
Write-Host ""
Write-Host "  Para deshacerlo:  .\no-dormir.ps1 -Quitar" -ForegroundColor DarkGray
Write-Host ""
