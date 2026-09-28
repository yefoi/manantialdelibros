# =====================================================================
#  Manantial de Libros - subir los cambios a GitHub
#  Uso: doble clic en "Subir cambios a GitHub.bat"
# =====================================================================
$ErrorActionPreference = 'Stop'
$Raiz = Split-Path -Parent $PSScriptRoot

function BuscarGit {
  $candidatos = @(
    (Join-Path $env:LOCALAPPDATA 'portablegit\bin\git.exe'),
    "$env:ProgramFiles\Git\cmd\git.exe",
    "${env:ProgramFiles(x86)}\Git\cmd\git.exe"
  )
  foreach ($c in $candidatos) { if (Test-Path $c) { return $c } }
  $enPath = Get-Command git -ErrorAction SilentlyContinue
  if ($enPath) { return $enPath.Source }
  return $null
}

$git = BuscarGit
if (-not $git) {
  Write-Host ""
  Write-Host "  No encuentro Git en este ordenador." -ForegroundColor Yellow
  Write-Host "  La primera vez hay que instalarlo (o copiar la carpeta 'portablegit')."
  Write-Host ""
  Read-Host "  Pulsa Intro para salir"
  exit 1
}

Write-Host ""
Write-Host "  Manantial de Libros - subir cambios a GitHub" -ForegroundColor Cyan
Write-Host "  Repositorio: $(( & $git -C $Raiz remote get-url origin ))" -ForegroundColor DarkGray
Write-Host ""

& $git -C $Raiz add -A
$estado = & $git -C $Raiz status --porcelain
if (-not $estado) {
  Write-Host "  No hay cambios nuevos que subir." -ForegroundColor Green
  Read-Host "  Pulsa Intro para salir"
  exit 0
}

Write-Host "  Archivos cambiados:" -ForegroundColor Cyan
$estado | ForEach-Object { "     $_" }
Write-Host ""

$mensaje = Read-Host "  Descripcion del cambio (Intro = fecha y hora)"
if (-not $mensaje) { $mensaje = "Actualizacion del " + (Get-Date -Format 'yyyy-MM-dd HH:mm') }

& $git -C $Raiz commit -q -m $mensaje
if ($LASTEXITCODE -ne 0) { Write-Host "  No se ha podido crear el commit." -ForegroundColor Red; Read-Host "  Intro para salir"; exit 1 }

Write-Host "  Subiendo a GitHub..." -ForegroundColor Cyan
& $git -C $Raiz push
if ($LASTEXITCODE -eq 0) {
  Write-Host ""
  Write-Host "  Listo: los cambios estan en https://github.com/yefoi/manantialdelibros" -ForegroundColor Green
} else {
  Write-Host ""
  Write-Host "  No se ha podido subir. Revisa el mensaje de arriba." -ForegroundColor Red
}
Write-Host ""
Read-Host "  Pulsa Intro para cerrar"
