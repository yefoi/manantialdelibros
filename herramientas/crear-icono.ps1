# =====================================================================
#  Manantial de Libros - genera los iconos y la imagen del logo
#  a partir del logo original (circulo azul con la pila de libros)
#
#    web\img\logo-libros.png   256x256  (para la cabecera y la portada)
#    web\img\icono-180.png     180x180  (icono para moviles)
#    web\icono.ico             16,32,48,64,128,256  (navegador y acceso directo)
# =====================================================================
[CmdletBinding()]
param([string]$Origen = '')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$Raiz = Split-Path -Parent $PSScriptRoot
if (-not $Origen) {
  $candidatos = @(
    (Join-Path $Raiz 'web\img\logo-libros.png'),
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Manantial de libros\diseño\Logo Manantial de libros copia.png')
  )
  foreach ($c in $candidatos) { if (Test-Path $c) { $Origen = $c; break } }
}
if (-not $Origen -or -not (Test-Path $Origen)) { Write-Error "No encuentro el logo original. Pasa la ruta con -Origen"; exit 1 }
Write-Host "Logo original: $Origen"

$fuente = [System.Drawing.Image]::FromFile($Origen)

# --- recortar al contenido (quita margenes transparentes) ---
# se copia a memoria y se suelta el archivo original: el destino puede ser el
# mismo archivo que el origen (por ejemplo web\img\logo-libros.png)
$bmp32 = New-Object System.Drawing.Bitmap($fuente)
$fuente.Dispose()
$minX = $bmp32.Width; $minY = $bmp32.Height; $maxX = -1; $maxY = -1
for ($y = 0; $y -lt $bmp32.Height; $y++) {
  for ($x = 0; $x -lt $bmp32.Width; $x++) {
    if ($bmp32.GetPixel($x, $y).A -gt 12) {
      if ($x -lt $minX) { $minX = $x }
      if ($y -lt $minY) { $minY = $y }
      if ($x -gt $maxX) { $maxX = $x }
      if ($y -gt $maxY) { $maxY = $y }
    }
  }
}
if ($maxX -lt 0) { throw "El logo es transparente del todo" }
$ancho = $maxX - $minX + 1
$alto = $maxY - $minY + 1
$lado = [Math]::Max($ancho, $alto)
Write-Host "Recorte: ${ancho}x${alto} (cuadrado de $lado)"

function HacerPng([int]$tamano, [string]$destino, [double]$margen = 0.0) {
  $bmp = New-Object System.Drawing.Bitmap($tamano, $tamano)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  try {
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    $m = [int]($tamano * $margen)
    $ladoUtil = $tamano - 2 * $m
    $dest = New-Object System.Drawing.Rectangle($m, $m, $ladoUtil, $ladoUtil)
    $orig = New-Object System.Drawing.Rectangle($minX, $minY, $lado, $lado)
    if ($ancho -ne $lado -or $alto -ne $lado) {
      # el contenido no es cuadrado: centrarlo dentro del cuadrado
      $dx = [int](($lado - $ancho) / 2); $dy = [int](($lado - $alto) / 2)
      $orig = New-Object System.Drawing.Rectangle(($minX - $dx), ($minY - $dy), $lado, $lado)
    }
    $g.DrawImage($bmp32, $dest, $orig, [System.Drawing.GraphicsUnit]::Pixel)
  } finally { $g.Dispose() }
  $bmp.Save($destino, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "  creado: $destino ($([Math]::Round((Get-Item $destino).Length/1KB)) KB)"
}

New-Item -ItemType Directory -Force -Path (Join-Path $Raiz 'web\img') | Out-Null
HacerPng 256 (Join-Path $Raiz 'web\img\logo-libros.png') 0.01
HacerPng 180 (Join-Path $Raiz 'web\img\icono-180.png') 0.01

# --- ICO multi-tamano con PNG incrustados ---
$tamanos = @(16, 32, 48, 64, 128, 256)
$pngs = @()
$tmp = Join-Path $env:TEMP ('ico_' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
foreach ($t in $tamanos) {
  $ruta = Join-Path $tmp "$t.png"
  HacerPng $t $ruta 0.03
  $pngs += , @{ Tamano = $t; Bytes = [IO.File]::ReadAllBytes($ruta) }
}
$fs = [IO.File]::Create((Join-Path $Raiz 'web\icono.ico'))
$bw = New-Object IO.BinaryWriter($fs)
try {
  $bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$pngs.Count)
  $offset = 6 + 16 * $pngs.Count
  foreach ($p in $pngs) {
    $t = $p.Tamano
    $bw.Write([byte]$(if ($t -ge 256) { 0 } else { $t }))
    $bw.Write([byte]$(if ($t -ge 256) { 0 } else { $t }))
    $bw.Write([byte]0); $bw.Write([byte]0)
    $bw.Write([UInt16]1); $bw.Write([UInt16]32)
    $bw.Write([UInt32]$p.Bytes.Length); $bw.Write([UInt32]$offset)
    $offset += $p.Bytes.Length
  }
  foreach ($p in $pngs) { $bw.Write($p.Bytes) }
} finally { $bw.Close(); $fs.Close() }
Remove-Item $tmp -Recurse -Force
Write-Host "  creado: $((Join-Path $Raiz 'web\icono.ico')) ($([Math]::Round((Get-Item (Join-Path $Raiz 'web\icono.ico')).Length/1KB)) KB)"
$bmp32.Dispose()

# --- acceso directo del escritorio con el icono nuevo ---
$escritorio = [Environment]::GetFolderPath('Desktop')
$bat = Join-Path $Raiz 'Iniciar Manantial de Libros.bat'
if (Test-Path $bat) {
  Get-ChildItem $escritorio -Filter '*.lnk' | Where-Object { $_.Name -match 'Manantial|Refugio' } | Remove-Item -Force -ErrorAction SilentlyContinue
  $shell = New-Object -ComObject WScript.Shell
  $l = $shell.CreateShortcut((Join-Path $escritorio 'Manantial de Libros.lnk'))
  $l.TargetPath = $bat
  $l.WorkingDirectory = $Raiz
  $l.IconLocation = "$(Join-Path $Raiz 'web\icono.ico'),0"
  $l.Description = 'Biblioteca Manantial de Libros'
  $l.Save()
  Write-Host "  acceso directo actualizado en el escritorio"
}
Write-Host "Listo." -ForegroundColor Green
