# =====================================================================
#  Manantial de Libros - ver la direccion para entrar desde el movil
# =====================================================================
$ErrorActionPreference = 'SilentlyContinue'
$Raiz = Split-Path -Parent $PSScriptRoot

$puerto = 8080
$ajustes = Join-Path $Raiz 'datos\ajustes.json'
if (Test-Path $ajustes) {
  try { $puerto = (Get-Content $ajustes -Raw -Encoding UTF8 | ConvertFrom-Json).puerto } catch { }
}

Write-Host ""
Write-Host "  =====================================================" -ForegroundColor DarkGray
Write-Host "   MANANTIAL DE LIBROS - donde se entra" -ForegroundColor Cyan
Write-Host "  =====================================================" -ForegroundColor DarkGray
Write-Host ""
Write-Host "   En este ordenador:" -ForegroundColor White
Write-Host "      http://localhost:$puerto" -ForegroundColor Green
Write-Host ""
Write-Host "   Desde moviles y otros ordenadores de la red:" -ForegroundColor White
$ips = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -ne 'WellKnown' } |
  Select-Object -ExpandProperty IPAddress -Unique
if ($ips) {
  foreach ($ip in $ips) { Write-Host "      http://${ip}:$puerto" -ForegroundColor Green }
} else {
  Write-Host "      (este ordenador no esta conectado a ninguna red)" -ForegroundColor Yellow
}
Write-Host ""

# ¿esta abierto el puerto en el firewall?
$regla = Get-NetFirewallRule -DisplayName "*Manantial de Libros*" -ErrorAction SilentlyContinue
if ($regla) {
  Write-Host "   Puerto abierto en el firewall: SI" -ForegroundColor Green
} else {
  Write-Host "   Puerto abierto en el firewall: NO" -ForegroundColor Yellow
  Write-Host "   -> Ejecuta una vez:  'Permitir acceso desde la red (una vez).bat'" -ForegroundColor Yellow
  Write-Host "      (sin eso, los moviles no podran entrar)" -ForegroundColor DarkGray
}

# aviso si la red es publica (el firewall de Windows es mas estricto)
$perfil = Get-NetConnectionProfile | Select-Object -First 1
if ($perfil) {
  Write-Host ""
  Write-Host "   Red: $($perfil.Name)  ($($perfil.NetworkCategory))" -ForegroundColor DarkGray
  if ($perfil.NetworkCategory -eq 'Public') {
    Write-Host "   Aviso: Windows trata esta red como 'Publica'. Si no funciona desde el" -ForegroundColor Yellow
    Write-Host "   movil, cambia la red a 'Privada' en Configuracion > Red e Internet." -ForegroundColor Yellow
  }
}
Write-Host ""
