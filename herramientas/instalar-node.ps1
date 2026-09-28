# =====================================================================
#  Manantial de Libros - descarga Node.js portable dentro de runtime\
#  No instala nada en el sistema: solo crea la carpeta runtime\node
# =====================================================================
[CmdletBinding()]
param([string]$Version = 'v24.21.0')

$ErrorActionPreference = 'Stop'
$Raiz = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $Raiz 'runtime'
$destino = Join-Path $runtime 'node'
$nodeExe = Join-Path $destino 'node.exe'

if (Test-Path $nodeExe) {
  Write-Host "Node.js ya esta preparado: $nodeExe" -ForegroundColor Green
  & $nodeExe --version
  exit 0
}

Write-Host "Descargando Node.js $Version (unos 40 MB)..." -ForegroundColor Cyan
$url = "https://nodejs.org/dist/$Version/node-$Version-win-x64.zip"
$zip = Join-Path $runtime 'node.zip'
$tmp = Join-Path $runtime 'tmp'
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
Expand-Archive -Path $zip -DestinationPath $tmp -Force
$inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
if (-not $inner) { throw "El archivo descargado no tiene el formato esperado" }
Move-Item $inner.FullName $destino
Remove-Item $tmp -Recurse -Force
Remove-Item $zip -Force

if (-not (Test-Path $nodeExe)) { throw "No se ha podido preparar Node.js" }
Write-Host "Listo. Node.js instalado en: $destino" -ForegroundColor Green
& $nodeExe --version
