# =====================================================================
#  Manantial de Libros - preparar Node.js en este ordenador
#
#  El proyecto NO tiene dependencias: no hay que ejecutar "npm install".
#  Solo hace falta Node.js, y se puede resolver de tres maneras:
#    1. si ya hay un Node.js moderno instalado en el sistema, se usa ese
#    2. si existe runtime\node.zip (copiado a mano), se descomprime (sin internet)
#    3. si no, se descarga la version portable dentro de runtime\node
#  No instala nada en el sistema.
# =====================================================================
[CmdletBinding()]
param([string]$Version = 'v24.21.0')

$ErrorActionPreference = 'Stop'
$Raiz = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $Raiz 'runtime'
$destino = Join-Path $runtime 'node'
$nodeExe = Join-Path $destino 'node.exe'
$zip = Join-Path $runtime 'node.zip'
$tmp = Join-Path $runtime 'tmp'

if (Test-Path $nodeExe) {
  Write-Host "Node.js ya esta preparado en runtime\node:" -ForegroundColor Green
  & $nodeExe --version
  exit 0
}

# 1) ¿Hay un Node.js moderno ya instalado en el ordenador?
$sistema = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $sistema) { $sistema = Get-Command node -ErrorAction SilentlyContinue }
if ($sistema) {
  try {
    $v = (& $sistema.Source --version).Trim() -replace '^v', ''
    $mayor = [int]($v.Split('.')[0])
    if ($mayor -ge 18) {
      Write-Host ""
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

# 2) ¿Esta ya el zip descargado (se puede copiar de otro ordenador)?
if (Test-Path $zip) {
  Write-Host "  Uso el archivo runtime\node.zip que ya esta aqui (sin descargar)." -ForegroundColor Cyan
} else {
  Write-Host "  Descargando Node.js $Version (unos 40 MB)..." -ForegroundColor Cyan
  New-Item -ItemType Directory -Force -Path $runtime | Out-Null
  $url = "https://nodejs.org/dist/$Version/node-$Version-win-x64.zip"
  try {
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
  } catch {
    Write-Host ""
    Write-Host "  NO se ha podido descargar Node.js." -ForegroundColor Red
    Write-Host "  - Comprueba que este ordenador tiene internet (o el proxy de la empresa)." -ForegroundColor Yellow
    Write-Host "  - O copia el archivo node-v...-win-x64.zip de otro ordenador y dejalo" -ForegroundColor Yellow
    Write-Host "    en esta carpeta con el nombre:  runtime\node.zip" -ForegroundColor Yellow
    Write-Host "    (en el ordenador que funciona esta en: $runtime\node.zip)" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  Detalle: $($_.Exception.Message)" -ForegroundColor DarkGray
    exit 1
  }
}

# 3) Descomprimir (con aviso claro si no hay permisos de escritura)
try {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
} catch {
  Write-Host ""
  Write-Host "  NO se ha podido descomprimir Node.js en esta carpeta." -ForegroundColor Red
  Write-Host "  Casi siempre es porque no hay permisos para escribir aqui:" -ForegroundColor Yellow
  Write-Host "     $Raiz" -ForegroundColor DarkGray
  Write-Host "  Mueve la carpeta del proyecto a Documentos o al escritorio y vuelve" -ForegroundColor Yellow
  Write-Host "  a ejecutar 'Preparar (nuevo ordenador).bat'." -ForegroundColor Yellow
  Write-Host ""
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
  Write-Host "  Error al colocar Node.js en runtime\node: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

if (-not (Test-Path $nodeExe)) {
  Write-Host "  No se ha podido preparar Node.js (falta $nodeExe)" -ForegroundColor Red
  exit 1
}

# el zip se conserva: sirve para reinstalar sin internet o copiarlo a otro PC
Write-Host ""
Write-Host "  Listo. Node.js preparado en: $destino" -ForegroundColor Green
Write-Host "  (el archivo runtime\node.zip se conserva: sirve para otro ordenador sin internet)"
& $nodeExe --version
exit 0
