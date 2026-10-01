# =====================================================================
#  Manantial de Libros - anadir al Excel un libro creado desde la web
#  Uso:  .\anadir-excel.ps1 -Datos <ruta.json>
#  El JSON trae: titulo, autor, editorial, signatura, estanteria, balda,
#  estado, fechaEntrada, fechaSalida, observaciones
#  Escribe la fila al final de la hoja y devuelve "FILA=<numero>"
# =====================================================================
[CmdletBinding()]
param(
  [string]$Ajustes = '',
  [string]$Datos = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$Raiz = Split-Path -Parent $PSScriptRoot
if (-not $Ajustes) { $Ajustes = Join-Path $Raiz 'datos\ajustes.json' }
if (-not $Datos -or -not (Test-Path $Datos)) { Write-Error 'Falta -Datos <ruta.json>'; exit 2 }
$Excel = (Get-Content $Ajustes -Raw -Encoding UTF8 | ConvertFrom-Json).origenExcel
if (-not (Test-Path $Excel)) { Write-Host "No encuentro el Excel: $Excel"; exit 2 }
$libro = Get-Content $Datos -Raw -Encoding UTF8 | ConvertFrom-Json

function EscaparXml([string]$s) {
  return $s.Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;').Replace('"', '&quot;')
}
function Celda([string]$col, [int]$fila, [string]$valor) {
  if ($null -eq $valor -or [string]$valor -eq '') { return '' }
  return '<c r="' + $col + $fila + '" t="inlineStr"><is><t>' + (EscaparXml ([string]$valor)) + '</t></is></c>'
}
function CeldaFecha([string]$col, [int]$fila, [string]$fecha) {
  if (-not $fecha) { return '' }
  $serial = ''
  try { $serial = [string][int]([datetime]::ParseExact($fecha, 'yyyy-MM-dd', $null) - [datetime]'1899-12-30').TotalDays } catch { return '' }
  return '<c r="' + $col + $fila + '"><v>' + $serial + '</v></c>'
}

# --- copia de seguridad ---
$copias = Join-Path $Raiz 'datos\copias-excel'
New-Item -ItemType Directory -Force -Path $copias | Out-Null
try { Copy-Item $Excel (Join-Path $copias ('listado-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.xlsx')) -Force } catch { }

$zip = [System.IO.Compression.ZipFile]::Open($Excel, 'Update')
try {
  $entrada = $zip.Entries | Where-Object { $_.FullName -eq 'xl/worksheets/sheet1.xml' }
  if (-not $entrada) { throw 'El Excel no tiene la hoja esperada (xl/worksheets/sheet1.xml)' }
  $lector = New-Object System.IO.StreamReader($entrada.Open(), [Text.Encoding]::UTF8)
  $xml = $lector.ReadToEnd(); $lector.Close()

  $max = 0
  foreach ($m in [regex]::Matches($xml, '<row\s+r="(\d+)"')) {
    $n = [int]$m.Groups[1].Value
    if ($n -gt $max) { $max = $n }
  }
  $filaNum = $max + 1

  # igual que el listado: A articulo, B titulo sin articulo
  $articulo = ''; $titulo = [string]$libro.titulo
  $mm = [regex]::Match($titulo, '^(?i)(el|la|los|las|un|una|unos|unas)\s+(.+)$')
  if ($mm.Success) { $articulo = $mm.Groups[1].Value; $titulo = $mm.Groups[2].Value }

  $fila = '<row r="' + $filaNum + '">' +
    (Celda 'A' $filaNum $articulo) +
    (Celda 'B' $filaNum $titulo) +
    (Celda 'C' $filaNum ([string]$libro.autor)) +
    (Celda 'D' $filaNum ([string]$libro.editorial)) +
    (Celda 'E' $filaNum ([string]$libro.signatura)) +
    (Celda 'F' $filaNum ([string]$libro.estanteria)) +
    (Celda 'G' $filaNum ([string]$libro.balda)) +
    (Celda 'H' $filaNum ([string]$libro.estado)) +
    (CeldaFecha 'I' $filaNum ([string]$libro.fechaEntrada)) +
    (CeldaFecha 'J' $filaNum ([string]$libro.fechaSalida)) +
    (Celda 'K' $filaNum ([string]$libro.observaciones)) +
    '</row>'

  if ($xml -notmatch '</sheetData>') { throw 'La hoja no tiene sheetData' }
  $xml = $xml.Replace('</sheetData>', $fila + '</sheetData>')

  $flujo = $entrada.Open()
  $flujo.SetLength(0)
  $escritor = New-Object System.IO.StreamWriter($flujo, (New-Object Text.UTF8Encoding($false)))
  $escritor.Write($xml)
  $escritor.Flush(); $escritor.Close()
} finally { $zip.Dispose() }

Write-Host "FILA=$filaNum"
exit 0
