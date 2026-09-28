# =====================================================================
#  Manantial de Libros - generador de miniaturas
#  Uso normal:   .\miniaturas.ps1            (genera todas las que falten)
#  Un solo archivo: .\miniaturas.ps1 -Archivo "principito, el 01.jpg"
# =====================================================================
[CmdletBinding()]
param(
  [string]$Archivo = '',
  [switch]$Forzar
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$Raiz = Split-Path -Parent $PSScriptRoot
$Origen = ''
$cfgPath = Join-Path $Raiz 'datos\ajustes.json'
if (Test-Path $cfgPath) { $Origen = (Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json).origenLibros }
$Subidas = Join-Path $Raiz 'datos\subidas'
$Salida = Join-Path $Raiz 'datos\miniaturas'
New-Item -ItemType Directory -Force -Path $Salida | Out-Null

$AnchoMax = 460
$AltoMax = 700
$Calidad = 80

function Localizar([string]$nombre) {
  $p = Join-Path $Subidas $nombre
  if (Test-Path $p) { return $p }
  if ($Origen) { $p = Join-Path $Origen $nombre; if (Test-Path $p) { return $p } }
  return $null
}

function HacerMiniatura([string]$ruta, [string]$destino) {
  $stream = [IO.File]::OpenRead($ruta)
  try { $img = [System.Drawing.Image]::FromStream($stream, $true, $true) } catch { $stream.Dispose(); throw }
  try {
    # orientacion EXIF
    $rotar = 0
    if ($img.PropertyIdList -contains 0x0112) {
      $orient = [int]$img.GetPropertyItem(0x0112).Value[0]
      if ($orient -eq 6) { $rotar = 90 } elseif ($orient -eq 8) { $rotar = 270 } elseif ($orient -eq 3) { $rotar = 180 }
    }
    $escala = [Math]::Min([double]$AnchoMax / $img.Width, [double]$AltoMax / $img.Height)
    if ($escala -gt 1) { $escala = 1 }
    $w = [int][Math]::Max(1, [Math]::Round($img.Width * $escala))
    $h = [int][Math]::Max(1, [Math]::Round($img.Height * $escala))
    $destinoFinal = $destino
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      if ($rotar -ne 0) { $g.TranslateTransform($w / 2, $h / 2); $g.RotateTransform($rotar); $g.TranslateTransform(-$w / 2, -$h / 2) }
      $g.DrawImage($img, 0, 0, $w, $h)
    } finally { $g.Dispose() }
    $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
    $param = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $param.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [int64]$Calidad)
    try { $bmp.Save($destinoFinal, $codec, $param) } finally { $bmp.Dispose(); $param.Dispose() }
  } finally { $img.Dispose(); $stream.Dispose() }
}

if ($Archivo) {
  $ruta = Localizar $Archivo
  if (-not $ruta) { Write-Host "No encuentro la imagen: $Archivo"; exit 0 }
  $destino = Join-Path $Salida ($Archivo + '.jpg')
  HacerMiniatura $ruta $destino
  Write-Host "Miniatura creada: $Archivo"
  exit 0
}

if (-not $Origen -or -not (Test-Path $Origen)) { Write-Error "No encuentro la carpeta de libros ($Origen)"; exit 1 }
$imagenes = Get-ChildItem $Origen -File | Where-Object { $_.Extension.ToLower() -in '.jpg', '.jpeg', '.png' }
$total = 0; $hechas = 0; $fallos = 0
foreach ($i in $imagenes) {
  $total++
  $destino = Join-Path $Salida ($i.Name + '.jpg')
  if ((Test-Path $destino) -and -not $Forzar) { continue }
  try { HacerMiniatura $i.FullName $destino; $hechas++ }
  catch { $fallos++; Write-Warning "Fallo con $($i.Name): $($_.Exception.Message)" }
  if ($hechas % 100 -eq 0 -and $hechas -gt 0) { Write-Host "  $hechas miniaturas..." }
}
Write-Host "Miniaturas: $hechas nuevas / $total imagenes (fallos: $fallos)"
