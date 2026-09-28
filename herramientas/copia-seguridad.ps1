# =====================================================================
#  Manantial de Libros - copia de seguridad de los datos del sitio
#  Crea un ZIP con fecha dentro de la carpeta "copias"
# =====================================================================
$ErrorActionPreference = 'Stop'
$Raiz = Split-Path -Parent $PSScriptRoot
$datos = Join-Path $Raiz 'datos'
$copias = Join-Path $Raiz 'copias'
New-Item -ItemType Directory -Force -Path $copias | Out-Null

$fecha = Get-Date -Format 'yyyy-MM-dd_HH-mm'
$destino = Join-Path $copias "manantial-de-libros_$fecha.zip"

$incluir = @()
foreach ($n in 'cambios.json', 'nuevos.json', 'acceso.json', 'ajustes.json', 'biblioteca.json', 'estadisticas.json') {
  $p = Join-Path $datos $n
  if (Test-Path $p) { $incluir += $p }
}
$subidas = Join-Path $datos 'subidas'
if (Test-Path $subidas) { $incluir += (Get-ChildItem $subidas -File | Select-Object -ExpandProperty FullName) }

if (-not $incluir.Count) { Write-Error "No hay nada que copiar en $datos"; exit 1 }
Compress-Archive -Path $incluir -DestinationPath $destino -Force
$mb = [Math]::Round((Get-Item $destino).Length / 1MB, 1)
Write-Host "Copia creada: $destino  ($mb MB)" -ForegroundColor Green
