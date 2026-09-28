# =====================================================================
#  Manantial de Libros - permitir el acceso desde la red local (una sola vez)
#  Hay que ejecutar este script COMO ADMINISTRADOR (el .bat lo pide solo).
# =====================================================================
$ErrorActionPreference = 'Stop'

$Raiz = Split-Path -Parent $PSScriptRoot
$ajustes = Join-Path $Raiz 'datos\ajustes.json'
$puerto = 8080
if (Test-Path $ajustes) {
  try { $puerto = (Get-Content $ajustes -Raw -Encoding UTF8 | ConvertFrom-Json).puerto } catch { }
}
$nombreRegla = "Manantial de Libros (biblioteca) $puerto"

Write-Host ""
Write-Host "  Manantial de Libros - abriendo el puerto $puerto en el firewall" -ForegroundColor Cyan
Write-Host ""

# quitar la regla anterior si existe
Get-NetFirewallRule -DisplayName $nombreRegla -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue

try {
  New-NetFirewallRule -DisplayName $nombreRegla -Direction Inbound -Protocol TCP -LocalPort $puerto `
    -Action Allow -Profile Private, Domain -Description "Permite ver la biblioteca Manantial de Libros desde moviles y ordenadores de la red local." | Out-Null
  Write-Host "  Listo: puerto $puerto permitido en la red local." -ForegroundColor Green
} catch {
  Write-Host "  No se pudo con New-NetFirewallRule, probando con netsh..." -ForegroundColor Yellow
  netsh advfirewall firewall delete rule name="$nombreRegla" | Out-Null
  netsh advfirewall firewall add rule name="$nombreRegla" dir=in action=allow protocol=TCP localport=$puerto profile=private,domain
}

Write-Host ""
Write-Host "  Direcciones para entrar desde el movil o desde otro ordenador:" -ForegroundColor Cyan
$ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -ne 'WellKnown' } |
  Select-Object -ExpandProperty IPAddress -Unique
foreach ($ip in $ips) { Write-Host "     http://${ip}:$puerto" }
Write-Host ""
Write-Host "  (El ordenador y los moviles tienen que estar en la misma wifi.)" -ForegroundColor DarkGray
Write-Host ""
Read-Host "  Pulsa Intro para cerrar"
