# =====================================================================
#  Manantial de Libros - bajar la ultima version desde GitHub
#  Uso: doble clic en "Actualizar desde GitHub.bat"
#
#  No toca datos\ (catalogo, historial, subidas), runtime\ ni copias\:
#  estan ignorados por Git y se quedan como estan en este ordenador.
# =====================================================================
[CmdletBinding()]
param([switch]$NoPausa)

$ErrorActionPreference = 'Stop'
$Raiz = Split-Path -Parent $PSScriptRoot

function Pausar { if (-not $NoPausa) { Read-Host "  Pulsa Intro para cerrar" } }

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
  Pausar
  exit 1
}

Write-Host ""
Write-Host "  Manantial de Libros - actualizar desde GitHub" -ForegroundColor Cyan
Write-Host "  Repositorio: $(( & $git -C $Raiz remote get-url origin ))" -ForegroundColor DarkGray
Write-Host ""

$rama = (& $git -C $Raiz rev-parse --abbrev-ref HEAD).Trim()

$estado = & $git -C $Raiz status --porcelain
if ($estado) {
  Write-Host "  Hay cambios locales sin subir en este ordenador:" -ForegroundColor Yellow
  $estado | ForEach-Object { "     $_" }
  Write-Host ""
  Write-Host "  Para no perderlos, subelos antes con 'Subir cambios a GitHub.bat'" -ForegroundColor Yellow
  Write-Host "  o pide ayuda antes de continuar." -ForegroundColor Yellow
  Write-Host ""
  Pausar
  exit 1
}

Write-Host "  Buscando la ultima version..." -ForegroundColor Cyan
& $git -C $Raiz fetch origin --prune
if ($LASTEXITCODE -ne 0) {
  Write-Host "  No se ha podido conectar con GitHub. Revisa internet o los permisos." -ForegroundColor Red
  Pausar
  exit 1
}

$antes = (& $git -C $Raiz rev-parse HEAD).Trim()
$pendientes = [int](& $git -C $Raiz rev-list --count "HEAD..origin/$rama")
if ($pendientes -eq 0) {
  Write-Host "  Ya esta al dia: no hay nada nuevo que bajar." -ForegroundColor Green
} else {
  Write-Host ("  Bajando {0} cambio(s)..." -f $pendientes) -ForegroundColor Cyan
  & $git -C $Raiz merge --ff-only "origin/$rama"
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  No se ha podido actualizar. Avisa a quien mantiene el sitio." -ForegroundColor Red
    Pausar
    exit 1
  }
  $despues = (& $git -C $Raiz rev-parse HEAD).Trim()
  Write-Host ""
  Write-Host "  Archivos actualizados:" -ForegroundColor Cyan
  & $git -C $Raiz diff --stat $antes $despues | ForEach-Object { "     $_" }
}

# reiniciar el servidor si estaba en marcha, para que aplique los cambios
$procesos = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -match 'app[\\/]+server\.js' })
if ($procesos.Count) {
  Write-Host ""
  Write-Host "  Reiniciando el servidor para aplicar los cambios..." -ForegroundColor Cyan
  foreach ($p in $procesos) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1
  $node = Join-Path $Raiz 'runtime\node\node.exe'
  if (Test-Path $node) {
    $log = Join-Path $env:TEMP 'manantial-server.log'
    Start-Process -FilePath $node -ArgumentList 'app\server.js' -WorkingDirectory $Raiz -WindowStyle Hidden `
      -RedirectStandardOutput $log -RedirectStandardError ($log + '.err')
    Write-Host "  Servidor reiniciado en segundo plano." -ForegroundColor Green
  } else {
    Write-Host "  No encuentro runtime\node\node.exe; arranca el sitio con su acceso directo." -ForegroundColor Yellow
  }
} else {
  Write-Host ""
  Write-Host "  (El servidor no estaba en marcha; los cambios se aplicaran al arrancarlo.)" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "  Listo. En los navegadores, refresca con Ctrl+F5." -ForegroundColor Green
Write-Host ""
Pausar
