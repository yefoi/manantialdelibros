# =====================================================================
#  Manantial de Libros - pasar al Excel los cambios hechos en la web
#  (A articulo, B titulo, C autor, D editorial, E signatura, F estanteria,
#   G balda, H estado, J F.SALIDA, K observaciones)
#
#    .\actualizar-excel.ps1                      (usa datos\excel-pendiente.json)
#    .\actualizar-excel.ps1 -Excel <copia.xlsx>  (para probar sin tocar el original)
# =====================================================================
[CmdletBinding()]
param(
  [string]$Ajustes = '',
  [string]$Cola = '',
  [string]$Excel = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$Raiz = Split-Path -Parent $PSScriptRoot
if (-not $Ajustes) { $Ajustes = Join-Path $Raiz 'datos\ajustes.json' }
if (-not $Cola) { $Cola = Join-Path $Raiz 'datos\excel-pendiente.json' }
if (-not $Excel) { $Excel = (Get-Content $Ajustes -Raw -Encoding UTF8 | ConvertFrom-Json).origenExcel }

if (-not (Test-Path $Excel)) { Write-Host "No encuentro el Excel: $Excel"; exit 2 }
if (-not (Test-Path $Cola)) { exit 0 }
$datos = Get-Content $Cola -Raw -Encoding UTF8 | ConvertFrom-Json
$items = @($datos.items)
if ($items.Count -eq 0) { exit 0 }

function EscaparXml([string]$s) {
  return $s.Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;').Replace('"', '&quot;')
}
function IndiceColumna([string]$letra) {
  $n = 0
  foreach ($ch in $letra.ToCharArray()) { $n = $n * 26 + ([int][char]$ch - 64) }
  return $n
}

# Cambia una celda de la fila. $tipo: 'texto' (inlineStr) o 'numero'
function PonerCelda([string]$fila, [int]$filaNum, [string]$columna, [string]$contenido, [string]$tipo) {
  $ref = $columna + $filaNum
  $m = [regex]::Match($fila, '<c\s+r="' + $ref + '"([^>]*?)(/>|>)', 'Singleline')
  if ($m.Success) {
    $attrs = ($m.Groups[1].Value -replace '\s+t="[^"]*"', '').TrimEnd()
    if ($attrs) { $attrs = $attrs } else { $attrs = '' }
    if ($m.Groups[2].Value -eq '>') {
      # hay que quitar el contenido antiguo hasta </c>
      $fin = $fila.IndexOf('</c>', $m.Index + $m.Length)
      if ($fin -lt 0) { return $fila }
      $antes = $fila.Substring(0, $m.Index)
      $despues = $fila.Substring($fin + 4)
    } else {
      $antes = $fila.Substring(0, $m.Index)
      $despues = $fila.Substring($m.Index + $m.Length)
    }
  } else {
    # la celda no existe: se inserta respetando el orden de columnas
    $indice = IndiceColumna $columna
    $antes = ''
    $despues = $fila
    foreach ($m2 in [regex]::Matches($fila, '<c\s+r="([A-Z]+)\d+"')) {
      if ((IndiceColumna $m2.Groups[1].Value) -gt $indice) {
        $antes = $fila.Substring(0, $m2.Index)
        $despues = $fila.Substring($m2.Index)
        break
      }
    }
    if ($antes -eq '' -and $despues -eq $fila) {
      # no hay ninguna celda posterior: se anade al final de la fila
      return $fila + (NuevaCelda $ref '' $contenido $tipo)
    }
    $attrs = ''
  }
  return $antes + (NuevaCelda $ref $attrs $contenido $tipo) + $despues
}

function NuevaCelda([string]$ref, [string]$attrs, [string]$contenido, [string]$tipo) {
  if ($tipo -eq 'texto') {
    return '<c r="' + $ref + '"' + $attrs + ' t="inlineStr"><is><t>' + (EscaparXml $contenido) + '</t></is></c>'
  }
  if ($contenido -eq '') { return '<c r="' + $ref + '"' + $attrs + '/>' }
  return '<c r="' + $ref + '"' + $attrs + '><v>' + $contenido + '</v></c>'
}

# --- copia de seguridad ---
$copias = Join-Path $Raiz 'datos\copias-excel'
New-Item -ItemType Directory -Force -Path $copias | Out-Null
$respaldo = Join-Path $copias ('listado-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.xlsx')
try { Copy-Item $Excel $respaldo -Force } catch { }

# --- actualizar el Excel ---
$zip = [System.IO.Compression.ZipFile]::Open($Excel, 'Update')
$cambios = 0
try {
  $entrada = $zip.Entries | Where-Object { $_.FullName -eq 'xl/worksheets/sheet1.xml' }
  if (-not $entrada) { throw 'El Excel no tiene la hoja esperada (xl/worksheets/sheet1.xml)' }
  $lector = New-Object System.IO.StreamReader($entrada.Open(), [Text.Encoding]::UTF8)
  $xml = $lector.ReadToEnd(); $lector.Close()

  foreach ($item in $items) {
    $filaNum = [int]$item.fila
    if ($filaNum -le 0) { continue }
    $m = [regex]::Match($xml, '(<row\s+r="' + $filaNum + '"[^>]*>)(.*?)(</row>)', 'Singleline')
    if (-not $m.Success) { Write-Host "  (aviso: no encuentro la fila $filaNum)"; continue }
    $etiqueta = $m.Groups[1].Value
    $fila = $m.Groups[2].Value
    # formato nuevo ({campos}) y antiguo ({estado, fecha})
    $campos = $item.campos
    if (-not $campos) { $campos = [pscustomobject]@{ estado = $item.estado; fechaSalida = $item.fecha } }
    $nueva = $fila
    # A = articulo, B = titulo (como en el listado original)
    if ($null -ne $campos.titulo) {
      $articulo = ''; $titulo = [string]$campos.titulo
      $mm = [regex]::Match($titulo, '^(?i)(el|la|los|las|un|una|unos|unas)\s+(.+)$')
      if ($mm.Success) { $articulo = $mm.Groups[1].Value; $titulo = $mm.Groups[2].Value }
      $nueva = PonerCelda $nueva $filaNum 'A' $articulo 'texto'
      $nueva = PonerCelda $nueva $filaNum 'B' $titulo 'texto'
    }
    if ($null -ne $campos.autor)         { $nueva = PonerCelda $nueva $filaNum 'C' ([string]$campos.autor) 'texto' }
    if ($null -ne $campos.editorial)     { $nueva = PonerCelda $nueva $filaNum 'D' ([string]$campos.editorial) 'texto' }
    if ($null -ne $campos.signatura)     { $nueva = PonerCelda $nueva $filaNum 'E' ([string]$campos.signatura) 'texto' }
    if ($null -ne $campos.estanteria)    { $nueva = PonerCelda $nueva $filaNum 'F' ([string]$campos.estanteria) 'texto' }
    if ($null -ne $campos.balda)         { $nueva = PonerCelda $nueva $filaNum 'G' ([string]$campos.balda) 'texto' }
    if ($null -ne $campos.estado)        { $nueva = PonerCelda $nueva $filaNum 'H' ([string]$campos.estado) 'texto' }
    if ($null -ne $campos.fechaSalida) {
      $serial = ''
      if ($campos.fechaSalida) {
        $serial = [string][int]([datetime]::ParseExact([string]$campos.fechaSalida, 'yyyy-MM-dd', $null) - [datetime]'1899-12-30').TotalDays
      }
      $nueva = PonerCelda $nueva $filaNum 'J' $serial 'numero'
    }
    if ($null -ne $campos.observaciones) { $nueva = PonerCelda $nueva $filaNum 'K' ([string]$campos.observaciones) 'texto' }
    if ($nueva -ne $fila) {
      $xml = $xml.Substring(0, $m.Index) + $etiqueta + $nueva + '</row>' + $xml.Substring($m.Index + $m.Length)
      $cambios++
    }
  }

  if ($cambios -gt 0) {
    $flujo = $entrada.Open()
    $flujo.SetLength(0)
    $escritor = New-Object System.IO.StreamWriter($flujo, (New-Object Text.UTF8Encoding($false)))
    $escritor.Write($xml)
    $escritor.Flush(); $escritor.Close()
  }
} finally { $zip.Dispose() }

Write-Host "  Excel actualizado: $cambios celdas. Copia de seguridad: $(Split-Path -Leaf $respaldo)"
exit 0
