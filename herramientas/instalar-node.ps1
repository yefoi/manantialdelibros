# =====================================================================
#  Manantial de Libros - preparar Node.js en este ordenador
#
#  El proyecto NO tiene dependencias: no hay que ejecutar "npm install".
#  Solo hace falta Node.js, y se puede resolver de cuatro maneras:
#    1. si ya hay un Node.js 18+ instalado en el sistema, se usa ese
#    2. si el proyecto esta en una carpeta escribible, se prepara en runtime\node
#    3. si el proyecto es una ruta de red o de solo lectura, se prepara en
#       %LOCALAPPDATA%\Manantial de Libros\node (en este PC, sin admin)
#    4. si existe node.zip junto al destino, se usa sin descargar (sin internet)
#  No instala nada en el sistema ni pide permisos de administrador.
# =====================================================================
[CmdletBinding()]
param([string]$Version = 'v24.21.0')

$ErrorActionPreference = 'Stop'
$Raiz = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $Raiz 'runtime'
$nodeProyecto = Join-Path $runtime 'node\node.exe'
$baseLocal = Join-Path $env:LOCALAPPDATA 'Manantial de Libros'
$nodeLocal = Join-Path $baseLocal 'node\node.exe'

Write-Host ""

# 1) ¿Ya esta preparado en algun sitio?
foreach ($cand in @($nodeProyecto, $nodeLocal)) {
  if (Test-Path $cand) {
    Write-Host "  Node.js ya esta preparado: $cand" -ForegroundColor Green
    & $cand --version
    exit 0
  }
}

# ¿Hay un Node.js moderno ya instalado en el ordenador?
$sistema = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $sistema) { $sistema = Get-Command node -ErrorAction SilentlyContinue }
if ($sistema) {
  try {
    $v = (& $sistema.Source --version).Trim() -replace '^v', ''
    $mayor = [int]($v.Split('.')[0])
    if ($mayor -ge 18) {
      Write-Host "  Ya hay Node.js $v instalado en este ordenador:" -ForegroundColor Green
      Write-Host "     $($sistema.Source)"
      Write-Host "  No hace falta descargar nada: el sitio usara ese Node." -ForegroundColor Green
      Write-Host ""
      exit 0
    } else {
      Write-Host "  El Node.js del sistema es antiguo ($v); se prepara uno portable." -ForegroundColor Yellow
    }
  } catch { }
}

# 2) ¿Donde se puede preparar? (el proyecto puede ser una ruta de red o de solo lectura)
$enRed = $Raiz.StartsWith('\\')
$puedeEscribir = $false
try {
  New-Item -ItemType Directory -Force -Path $runtime | Out-Null
  $prueba = Join-Path $runtime '.prueba_escritura'
  New-Item -ItemType File -Path $prueba -Force | Out-Null
  Remove-Item $prueba -Force
  $puedeEscribir = $true
} catch { $puedeEscribir = $false }

if ($enRed -or -not $puedeEscribir) {
  $destino = Join-Path $baseLocal 'node'
  $zip = Join-Path $baseLocal 'node.zip'
  $tmp = Join-Path $baseLocal 'tmp'
  New-Item -ItemType Directory -Force -Path $baseLocal | Out-Null
  Write-Host "  El proyecto esta en una ruta de red o en una carpeta sin permiso de escritura." -ForegroundColor Yellow
  Write-Host "  Node.js se prepara en este PC (sin permisos de administrador):" -ForegroundColor Yellow
  Write-Host "     $destino" -ForegroundColor DarkGray
} else {
  $destino = Join-Path $runtime 'node'
  $zip = Join-Path $runtime 'node.zip'
  $tmp = Join-Path $runtime 'tmp'
}

# 3) Descargar (o usar un node.zip copiado a mano)
if (Test-Path $zip) {
  Write-Host "  Uso el archivo node.zip que ya esta aqui (sin descargar):" -ForegroundColor Cyan
  Write-Host "     $zip" -ForegroundColor DarkGray
} else {
  Write-Host "  Descargando Node.js $Version (unos 40 MB)..." -ForegroundColor Cyan
  $url = "https://nodejs.org/dist/$Version/node-$Version-win-x64.zip"
  try {
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
  } catch {
    Write-Host ""
    Write-Host "  NO se ha podido descargar Node.js." -ForegroundColor Red
    Write-Host "  - Comprueba que este ordenador tiene internet (o el proxy de la empresa)." -ForegroundColor Yellow
    Write-Host "  - O copia el archivo node-v...-win-x64.zip de otro ordenador y dejalo en:" -ForegroundColor Yellow
    Write-Host "        $zip" -ForegroundColor Yellow
    Write-Host "    y vuelve a ejecutar este mismo comando." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Detalle: $($_.Exception.Message)" -ForegroundColor DarkGray
    exit 1
  }
}

# 4) Descomprimir
try {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
} catch {
  Write-Host ""
  Write-Host "  NO se ha podido descomprimir Node.js." -ForegroundColor Red
  Write-Host "  Suele ser falta de permisos de escritura o el antivirus." -ForegroundColor Yellow
  Write-Host "  Detalle: $($_.Exception.Message)" -ForegroundColor DarkGray
  exit 1
}

try {
  $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
  if (-not $inner) { throw "El archivo descargado no tiene el formato esperado" }
  New-Item -ItemType Directory -Force -Path $destino | Out-Null
  Move-Item (Join-Path $inner.FullName '*') $destino -Force
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
} catch {
  Write-Host ""
  Write-Host "  Error al colocar Node.js: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

$nodeFinal = Join-Path $destino 'node.exe'
if (-not (Test-Path $nodeFinal)) {
  Write-Host "  No se ha podido preparar Node.js (falta $nodeFinal)" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "  Listo. Node.js preparado en:" -ForegroundColor Green
Write-Host "     $nodeFinal" -ForegroundColor Green
Write-Host "  (el archivo node.zip se conserva: sirve para otro ordenador sin internet)"
& $nodeFinal --version
exit 0
