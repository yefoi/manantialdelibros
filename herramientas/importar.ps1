# =====================================================================
#  Manantial de Libros - Importador de la biblioteca
#  Lee el Excel de la biblioteca y la carpeta de portadas/info (.docx)
#  y genera datos/biblioteca.json y datos/estadisticas.json
# =====================================================================
[CmdletBinding()]
param(
  [string]$Ajustes = "",
  [switch]$Silencioso
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$Raiz = Split-Path -Parent $PSScriptRoot
if (-not $Ajustes) { $Ajustes = Join-Path $Raiz 'datos\ajustes.json' }

# ---------------------------------------------------------------- utilidades
function Escribir([string]$msg) { if (-not $Silencioso) { Write-Host $msg } }

# avisos del diagnostico de nombres y archivos (solo informativos)
function Nuevo-Aviso([string]$id, [string]$nombre, [string]$detalle, $items) {
  if (-not $items -or @($items).Count -eq 0) { return }
  [void]$script:avisos.Add([pscustomobject]@{ id = $id; nombre = $nombre; detalle = $detalle; total = @($items).Count; items = @($items) })
}
function Item-Aviso([string]$texto, [string]$detalle, [string]$id) {
  return [pscustomobject]@{ texto = $texto; detalle = $detalle; id = $id }
}

function Normalizar([string]$s) {
  if ($null -eq $s) { return '' }
  $t = $s.Normalize([Text.NormalizationForm]::FormD)
  $sb = New-Object Text.StringBuilder
  foreach ($ch in $t.ToCharArray()) {
    if ([Globalization.CharUnicodeInfo]::GetUnicodeCategory($ch) -ne [Globalization.UnicodeCategory]::NonSpacingMark) { [void]$sb.Append($ch) }
  }
  $t = $sb.ToString().Normalize([Text.NormalizationForm]::FormC).ToUpperInvariant()
  $t = [regex]::Replace($t, '[^A-Z0-9 ]+', ' ')
  $t = [regex]::Replace($t, '\s+', ' ').Trim()
  return $t
}

function Claves([string]$s) {
  $n = Normalizar $s
  $m = [regex]::Match($n, '^(.*?)\s+(EL|LA|LOS|LAS|UN|UNA|UNOS|UNAS)$')
  if ($m.Success) { $n = "$($m.Groups[2].Value) $($m.Groups[1].Value)" }
  $n2 = [regex]::Replace($n, '^(EL|LA|LOS|LAS|UN|UNA|UNOS|UNAS)\s+', '')
  $out = @()
  foreach ($k in @($n, $n2)) { if ($k -and $k -notin $out) { $out += $k } }
  return $out
}

function FechaExcel([string]$v) {
  if (-not $v) { return '' }
  $v = $v.Trim()
  if ($v -eq '' -or $v -eq '-') { return '' }
  $n = 0.0
  if ([double]::TryParse($v, [ref]$n) -and $n -gt 20000 -and $n -lt 80000) {
    try { return ([DateTime]::FromOADate($n)).ToString('yyyy-MM-dd') } catch { return '' }
  }
  return $v
}

function ArreglarTitulo([string]$titulo, [string]$archivo) {  # El listado del Excel escribe los titulos por la palabra significativa
  # ("alcalde de Zalamea"); los nombres de archivo llevan el articulo al final
  # ("alcalde de zalamea, el 01.jpg"). Aqui se reconstruye el titulo completo.
  $t = ([string]$titulo).Trim()
  if (-not $t) { return $t }
  if ($archivo) {
    $base = [IO.Path]::GetFileNameWithoutExtension($archivo)
    $base = $base -replace '\s*\(\s*[IVX]+\s*\)\s*$', ''
    $base = [regex]::Replace($base, '\s+0?[123]\s*[a-z]?\s*$', '')
    $m = [regex]::Match($base, ',\s*(el|la|los|las|un|una)\s*$', 'IgnoreCase')
    if ($m.Success -and $t -notmatch '^(?i)(el|la|los|las|un|una)\s') {
      $art = $m.Groups[1].Value.ToLowerInvariant()
      $t = $art.Substring(0, 1).ToUpperInvariant() + $art.Substring(1) + ' ' + $t
    }
  }
  if ($t -cmatch '^[a-záéíóúñü]') { $t = $t.Substring(0, 1).ToUpperInvariant() + $t.Substring(1) }
  return $t
}

function LeerDocx([string]$ruta, [string]$nombreArchivo) {
  $zip = [System.IO.Compression.ZipFile]::OpenRead($ruta)
  try {
    $e = $zip.Entries | Where-Object { $_.FullName -eq 'word/document.xml' }
    if (-not $e) { return $null }
    $r = New-Object System.IO.StreamReader($e.Open(), [Text.Encoding]::UTF8)
    $xmlText = $r.ReadToEnd(); $r.Close()
    $xml = New-Object System.Xml.XmlDocument
    $xml.LoadXml($xmlText)
    $ns = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
    $ns.AddNamespace('w', 'http://schemas.openxmlformats.org/wordprocessingml/2006/main')
    $lineas = @()
    foreach ($p in $xml.SelectNodes('//w:p', $ns)) {
      $t = ($p.SelectNodes('.//w:t', $ns) | ForEach-Object { $_.InnerText }) -join ''
      $lineas += $t
    }
  } finally { $zip.Dispose() }

  $campos = [ordered]@{ titulo = ''; autor = ''; paginas = ''; editorial = ''; sinopsis = ''; genero = ''; fechaPublicacion = '' }
  $alias = @{
    'TITULO' = 'titulo'; 'TITUTLO' = 'titulo'; 'TITULO SEGUNDO' = 'titulo'
    'AUTOR' = 'autor'
    'PAGINA' = 'paginas'; 'PAGINAS' = 'paginas'; 'PAGINA S' = 'paginas'
    'EDITORIAL' = 'editorial'; 'EDITORIA' = 'editorial'; 'EDIORIAL' = 'editorial'; 'EDITOR' = 'editorial'
    'SINOPSIS' = 'sinopsis'; 'SISNOPSIS' = 'sinopsis'; 'SIPNOSIS' = 'sinopsis'; 'SISNOPSI' = 'sinopsis'; 'RESENAS' = 'sinopsis'
    'GENERO' = 'genero'
    'FECHA DE PUBLICACION' = 'fechaPublicacion'
  }
  $actual = ''
  foreach ($linea in $lineas) {
    # la etiqueta puede ir en mayusculas o minusculas (TITULO:, Titulo:, titulo:)
    $m = [regex]::Match($linea, '^\s*([\p{L}][\p{L}\s]{2,20})\s*:\s*(.*)$')
    if ($m.Success) {
      $etiqueta = Normalizar $m.Groups[1].Value
      $valor = $m.Groups[2].Value.Trim()
      if ($alias.ContainsKey($etiqueta)) {
        $actual = $alias[$etiqueta]
        if ($valor) { $campos[$actual] = $valor }
        continue
      }
    }
    if ($actual -and $linea.Trim()) { $campos[$actual] = ($campos[$actual] + ' ' + $linea.Trim()).Trim() }
  }
  return [pscustomobject]@{
    Archivo = $nombreArchivo
    Titulo = $campos.titulo; Autor = $campos.autor; Paginas = $campos.paginas
    Editorial = $campos.editorial; Sinopsis = $campos.sinopsis; Genero = $campos.genero
    FechaPublicacion = $campos.fechaPublicacion
  }
}

# ---------------------------------------------------------------- ajustes
if (-not (Test-Path $Ajustes)) {
  $defecto = [ordered]@{
    origenLibros  = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'libros FINAL')
    origenExcel   = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'listado_biblioteca_excel.xlsx')
    puerto        = 8080
    nombreSitio   = 'Manantial de Libros'
  }
  New-Item -ItemType Directory -Force -Path (Split-Path $Ajustes) | Out-Null
  $defecto | ConvertTo-Json | Set-Content -Path $Ajustes -Encoding UTF8
  Escribir "Creado $Ajustes con valores por defecto."
}
$cfg = Get-Content -Path $Ajustes -Raw -Encoding UTF8 | ConvertFrom-Json
$OrigenLibros = $cfg.origenLibros
$OrigenExcel = $cfg.origenExcel
if (-not (Test-Path $OrigenExcel)) { throw "No encuentro el Excel: $OrigenExcel" }
if (-not (Test-Path $OrigenLibros)) { throw "No encuentro la carpeta de libros: $OrigenLibros" }

# ---------------------------------------------------------------- Excel
Escribir "Leyendo Excel..."
$zip = [System.IO.Compression.ZipFile]::OpenRead($OrigenExcel)
try {
  $shared = @{}
  $se = $zip.Entries | Where-Object { $_.FullName -eq 'xl/sharedStrings.xml' }
  if ($se) {
    $r = New-Object System.IO.StreamReader($se.Open()); [xml]$sx = $r.ReadToEnd(); $r.Close()
    $i = 0
    foreach ($si in $sx.sst.si) {
      $texto = ''
      if ($si.t -is [string]) { $texto = $si.t }
      elseif ($si.t -and $si.t.'#text') { $texto = $si.t.'#text' }
      elseif ($si.r) { $texto = (@($si.r) | ForEach-Object { if ($_.t -is [string]) { $_.t } else { $_.t.'#text' } }) -join '' }
      $shared[$i] = $texto; $i++
    }
  }
  $sheetEntry = $zip.Entries | Where-Object { $_.FullName -eq 'xl/worksheets/sheet1.xml' }
  $r = New-Object System.IO.StreamReader($sheetEntry.Open()); [xml]$sh = $r.ReadToEnd(); $r.Close()
  $filas = @()
  $nFila = 0
  foreach ($row in $sh.worksheet.sheetData.row) {
    $nFila++
    $celdas = @{}
    foreach ($c in $row.c) {
      $col = ($c.r -replace '\d+', '')
      $val = ''
      if ($c.t -eq 's') { $val = $shared[[int]$c.v] }
      elseif ($c.t -eq 'inlineStr') { $val = $c.is.t }
      elseif ($c.v -ne $null) { $val = [string]$c.v }
      if ($val -ne '') { $celdas[$col] = $val }
    }
    $filas += ,[pscustomobject]@{ N = $nFila; C = $celdas }
  }
} finally { $zip.Dispose() }
Escribir ("  filas: {0}" -f $filas.Count)

$signaturasCanonicas = @{
  'NOVELA' = 'Novela'; 'ENSAYO' = 'Ensayo'; 'NO FICCION' = 'No Ficción'; 'POESIA' = 'Poesía'
  'BIOGRAFIA' = 'Biografía'; 'TEATRO' = 'Teatro'; 'RELATO' = 'Relato'; 'AUTOAYUDA' = 'Autoayuda'
  'OTROS' = 'Otros'
}

$libros = New-Object Collections.ArrayList
$articulosExcel = 0
foreach ($f in $filas) {
  $c = $f.C
  $titulo = if ($c['B']) { ([string]$c['B']).Trim() } else { '' }
  if (-not $titulo -or $titulo -eq 'TITULO') { continue }
  # la columna A del Excel trae el articulo del titulo ("El", "La", "Los"...)
  $articulo = if ($c['A']) { ([string]$c['A']).Trim() } else { '' }
  if ($articulo -and $articulo -ne 'ARTICULO' -and $titulo -notmatch '^(?i)(el|la|los|las|un|una|the)\s') {
    $titulo = $articulo + ' ' + $titulo
    $articulosExcel++
  }
  $estadoRaw = if ($c['H']) { ([string]$c['H']).Trim() } else { '' }
  if ($estadoRaw -eq 'ESTADO') { continue }
  $estado = switch -Regex ($estadoRaw) {
    '^(?i)disponible' { 'Disponible' }
    '^(?i)prestado'   { 'Prestado' }
    '^(?i)donado'     { 'Donado' }
    default           { '' }
  }
  $sigRaw = if ($c['E']) { ([string]$c['E']).Trim() } else { '' }
  $sigKey = Normalizar $sigRaw
  $signatura = if ($sigRaw -eq '') { '' } elseif ($signaturasCanonicas.ContainsKey($sigKey)) { $signaturasCanonicas[$sigKey] } else { $sigRaw }
  $id = "r$($f.N)"
  $registro = [ordered]@{
    id            = $id
    fila          = $f.N
    titulo        = $titulo
    autor         = if ($c['C']) { ([string]$c['C']).Trim() } else { '' }
    editorial     = if ($c['D']) { ([string]$c['D']).Trim() } else { '' }
    signatura     = $signatura
    estanteria    = if ($c['F']) { ([string]$c['F']).Trim() } else { '' }
    balda         = if ($c['G']) { ([string]$c['G']).Trim() } else { '' }
    estado        = $estado
    fechaEntrada  = FechaExcel ([string]$c['I'])
    fechaSalida   = FechaExcel ([string]$c['J'])
    observaciones = if ($c['K']) { ([string]$c['K']).Trim() } else { '' }
    portadas      = @()
    contraportadas = @()
    paginas       = ''
    sinopsis      = ''
    genero        = ''
    infoArchivo   = ''
    variante      = ''
  }
  [void]$libros.Add([pscustomobject]$registro)
}
Escribir ("  libros validos: {0}   (con articulo de la columna A: {1})" -f $libros.Count, $articulosExcel)

# ---------------------------------------------------------------- archivos
Escribir "Indexando archivos..."
$archivos = Get-ChildItem -Path $OrigenLibros -File |
  Where-Object { $_.Extension.ToLower() -in '.jpg', '.jpeg', '.png', '.docx', '.doc', '.txt', '.pdf' -and $_.Name -notlike '~$*' -and $_.Name -notmatch 'plantilla' }

# archivos que el importador no lee (fotos del movil, otros formatos...)
$extensionesLeidas = @('.jpg', '.jpeg', '.png', '.docx', '.doc', '.txt', '.pdf')
$archivosIgnoradosPorExtension = @(Get-ChildItem -Path $OrigenLibros -File |
  Where-Object { $_.Extension.ToLower() -notin $extensionesLeidas -and $_.Name -notlike '~$*' -and
                 $_.Name -notmatch 'plantilla' -and $_.Name -notin 'Thumbs.db', 'desktop.ini', '.DS_Store' })

# listas para el diagnostico de nombres
$avisos = New-Object Collections.ArrayList
$imagenSinNumero = New-Object Collections.ArrayList
$imagenNumeroTres = New-Object Collections.ArrayList
$numeracionRara = New-Object Collections.ArrayList
$ambiguosLista = New-Object Collections.ArrayList

$grupos = @{}   # clave -> @{ letra -> @{ img1=@(); img2=@(); docs=@() } }
foreach ($a in $archivos) {
  $base = $a.BaseName
  $ext = $a.Extension.ToLower()
  $esImagen = $ext -in '.jpg', '.jpeg', '.png'
  $letra = ''
  $numero = ''
  $nombre = $base
  # quitar marcas finales: (I) (II) (3) [final]
  $nombre = [regex]::Replace($nombre, '\s*[\(\[\{]\s*[IVXivx0-9]{1,3}\s*[\)\]\}]\s*$', '')
  $m = [regex]::Match($nombre, '^(?<n>.*?)[\s_-]+0?(?<num>[123])\s*(?<letra>[a-z])?$')
  if ($m.Success) {
    $nombre = $m.Groups['n'].Value.Trim()
    $numero = $m.Groups['num'].Value
    $letra = $m.Groups['letra'].Value
  }
  if (-not $nombre) { continue }
  # diagnostico de numeracion (una sola vez por archivo)
  if (-not $numero) {
    $mn = [regex]::Match($base, '[\s_-]+0?(?<num>\d{1,2})$')
    if ($mn.Success) {
      [void]$numeracionRara.Add((Item-Aviso $a.Name ("acaba en " + $mn.Groups['num'].Value + "; solo se reconocen 01, 02 y 03") ''))
    } elseif ($esImagen) {
      [void]$imagenSinNumero.Add((Item-Aviso $a.Name 'no lleva numero; para usarla debe acabar en " 01" (portada) o " 02" (contraportada)' ''))
    }
  } elseif ($esImagen -and $numero -eq '3') {
    [void]$imagenNumeroTres.Add((Item-Aviso $a.Name 'el 03 es para documentos de informacion, no para imagenes' ''))
  }
  foreach ($k in (Claves $nombre)) {
    if (-not $grupos.ContainsKey($k)) { $grupos[$k] = @{} }
    if (-not $grupos[$k].ContainsKey($letra)) { $grupos[$k][$letra] = @{ nombre = $nombre; img1 = @(); img2 = @(); docs = @() } }
    $g = $grupos[$k][$letra]
    if ($esImagen) {
      if ($numero -eq '1') { if ($a.Name -notin $g.img1) { $g.img1 += $a.Name } }
      elseif ($numero -eq '2') { if ($a.Name -notin $g.img2) { $g.img2 += $a.Name } }
    } else {
      if ($a.Name -notin $g.docs) { $g.docs += $a.Name }
    }
  }
}
Escribir ("  claves de archivos: {0}" -f $grupos.Count)

# ---------------------------------------------------------------- emparejar
Escribir "Emparejando libros con archivos..."
$porClave = @{}
foreach ($l in $libros) {
  foreach ($k in (Claves $l.titulo)) {
    if (-not $porClave.ContainsKey($k)) { $porClave[$k] = @() }
    if ($l -notin $porClave[$k]) { $porClave[$k] += $l }
  }
}

# ------- titulos repetidos: cada grupo de archivos a la fila que diga su docx
# Cuando hay varios ejemplares del mismo titulo (varias filas del Excel), en vez
# de repartirlos solo por orden, se comparan editorial y autor del docx de cada
# grupo con los de cada fila (solo columnas que ya existen en el Excel).
$cache = @{}   # cache de docx leidos (se reutiliza al leer la informacion)
function CamposDocxGrupo($g) {
  if (-not $g -or -not $g.docs -or @($g.docs).Count -eq 0) { return $null }
  $nombre = [string]$g.docs[0]
  if ($cache.ContainsKey($nombre)) { return $cache[$nombre] }
  $info = $null
  try { $info = LeerDocx (Join-Path $OrigenLibros $nombre) $nombre } catch { $info = $null }
  $cache[$nombre] = $info
  return $info
}
function PuntuarDocx($libro, $info) {
  if (-not $info) { return 0 }
  $p = 0
  if ($info.Editorial -and $libro.editorial -and (Normalizar ([string]$info.Editorial)) -eq (Normalizar ([string]$libro.editorial))) { $p += 3 }
  if ($info.Autor -and $libro.autor -and (Normalizar ([string]$info.Autor)) -eq (Normalizar ([string]$libro.autor))) { $p += 2 }
  return $p
}

$letraPorLibro = @{}    # id de libro -> letra decidida por los datos del docx
$letrasTomadas = @{}    # "familia|letra" -> $true
$familiasHechas = @{}   # el titulo con y sin articulo comparten la misma familia de archivos
foreach ($k in $porClave.Keys) {
  if (-not $grupos.ContainsKey($k)) { continue }
  $companeros = $porClave[$k]
  $letras = @($grupos[$k].Keys | Sort-Object)
  if (@($companeros).Count -le 1 -or $letras.Count -le 1) { continue }
  $firma = (@($companeros | ForEach-Object { $_.id }) | Sort-Object) -join ','
  if ($familiasHechas.ContainsKey($firma)) { continue }
  $familiasHechas[$firma] = $true
  $pares = @()
  for ($i = 0; $i -lt @($companeros).Count; $i++) {
    $l = $companeros[$i]
    foreach ($letra in $letras) {
      $p = PuntuarDocx $l (CamposDocxGrupo $grupos[$k][$letra])
      if ($p -ge 3) { $pares += [pscustomobject]@{ LibroId = $l.id; Letra = $letra; Puntos = $p; Orden = $i } }
    }
  }
  # desempate determinista: mas puntos, luego orden de fila, luego letra
  $ordenados = @($pares | Sort-Object -Property @{ Expression = 'Puntos'; Descending = $true },
                                                 @{ Expression = 'Orden'; Descending = $false },
                                                 @{ Expression = 'Letra'; Descending = $false })
  foreach ($par in $ordenados) {
    if ($letraPorLibro.ContainsKey($par.LibroId)) { continue }
    if ($letrasTomadas.ContainsKey("$firma|$($par.Letra)")) { continue }
    $letraPorLibro[$par.LibroId] = $par.Letra
    $letrasTomadas["$firma|$($par.Letra)"] = $true
  }
}

$usados = @{}
$conPortada = 0

# --------------------- asociaciones estables: cada archivo sigue a su libro
# Si un archivo ya estaba asignado a un libro en la importacion anterior, se le
# vuelve a asignar aunque hayan cambiado el titulo: no se pierden fotos ni se
# crean fichas duplicadas desde los archivos.
$asocPath = Join-Path $Raiz 'datos\asociaciones.json'
$asociaciones = @{}
if (Test-Path $asocPath) {
  try {
    $aj = Get-Content $asocPath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($prop in $aj.PSObject.Properties) { $asociaciones[$prop.Name] = [string]$prop.Value }
  } catch { $asociaciones = @{} }
}
if ($asociaciones.Count) {
  $porIdAsoc = @{}
  foreach ($l in $libros) { $porIdAsoc[$l.id] = $l }
  foreach ($k in $grupos.Keys) {
    foreach ($letra in $grupos[$k].Keys) {
      $g = $grupos[$k][$letra]
      # dueño del grupo: el libro al que apuntan sus archivos asociados
      $duenos = @{}
      foreach ($n in (@($g.img1) + @($g.img2) + @($g.docs))) {
        $idAsoc = [string]$asociaciones[$n]
        if ($idAsoc -and $porIdAsoc.ContainsKey($idAsoc)) { $duenos[$idAsoc] = $true }
      }
      if (@($duenos.Keys).Count -eq 1) {
        # todo el grupo (portada, contraportada y documento) va a su libro,
        # aunque algun archivo (p. ej. un .docx recien creado) no tenga aun asociacion
        $l = $porIdAsoc[(@($duenos.Keys))[0]]
        foreach ($n in @($g.img1)) {
          if ($usados.ContainsKey($n)) { continue }
          if (@($l.portadas).Count -eq 0) { $conPortada++ }
          $l.portadas = @(@($l.portadas) + $n)
          $usados[$n] = $true
        }
        foreach ($n in @($g.img2)) {
          if ($usados.ContainsKey($n)) { continue }
          $l.contraportadas = @(@($l.contraportadas) + $n)
          $usados[$n] = $true
        }
        foreach ($n in @($g.docs)) {
          if ($usados.ContainsKey($n)) { continue }
          if (-not $l.infoArchivo) { $l.infoArchivo = $n }
          $usados[$n] = $true
        }
      } else {
        # archivos del mismo grupo asociados a libros distintos: cada uno al suyo
        foreach ($n in @($g.img1)) {
          if ($usados.ContainsKey($n)) { continue }
          $idAsoc = [string]$asociaciones[$n]
          if (-not $idAsoc -or -not $porIdAsoc.ContainsKey($idAsoc)) { continue }
          $l = $porIdAsoc[$idAsoc]
          if (@($l.portadas).Count -eq 0) { $conPortada++ }
          $l.portadas = @(@($l.portadas) + $n)
          $usados[$n] = $true
        }
        foreach ($n in @($g.img2)) {
          if ($usados.ContainsKey($n)) { continue }
          $idAsoc = [string]$asociaciones[$n]
          if (-not $idAsoc -or -not $porIdAsoc.ContainsKey($idAsoc)) { continue }
          $l = $porIdAsoc[$idAsoc]
          $l.contraportadas = @(@($l.contraportadas) + $n)
          $usados[$n] = $true
        }
        foreach ($n in @($g.docs)) {
          if ($usados.ContainsKey($n)) { continue }
          $idAsoc = [string]$asociaciones[$n]
          if (-not $idAsoc -or -not $porIdAsoc.ContainsKey($idAsoc)) { continue }
          $l = $porIdAsoc[$idAsoc]
          if (-not $l.infoArchivo) { $l.infoArchivo = $n; $usados[$n] = $true }
        }
      }
    }
  }
  Escribir ("  archivos reasignados por su libro (asociacion estable): {0}" -f (@($usados.Keys).Count))
}

foreach ($l in $libros) {
  # si ya tiene archivos por asociacion estable, no se toca
  if (@($l.portadas).Count -gt 0 -or @($l.contraportadas).Count -gt 0 -or $l.infoArchivo) { continue }
  $k = ''
  foreach ($clave in (Claves $l.titulo)) { if ($grupos.ContainsKey($clave)) { $k = $clave; break } }
  if (-not $k) { continue }
  $letras = @($grupos[$k].Keys | Sort-Object)
  $companeros = $porClave[$k]
  $firma = (@($companeros | ForEach-Object { $_.id }) | Sort-Object) -join ','
  $indice = [array]::IndexOf($companeros, $l)
  if ($indice -lt 0) { $indice = 0 }
  $letraAsignada = ''
  if ($letraPorLibro.ContainsKey($l.id)) {
    # decidida comparando la editorial y el autor del docx con los del Excel
    $letraAsignada = $letraPorLibro[$l.id]
  } else {
    if ($letras.Count -ge ($indice + 1)) { $letraAsignada = $letras[$indice] }
    elseif ($indice -ge $letras.Count) { $letraAsignada = $letras[-1] }
    # no quitarle la letra que el docx ya le dio a otro ejemplar
    if ($letrasTomadas.ContainsKey("$firma|$letraAsignada")) {
      $libre = @($letras | Where-Object { -not $letrasTomadas.ContainsKey("$firma|$_") })
      if ($libre.Count) { $letraAsignada = $libre[0] }
      else {
        # ya no queda ningun grupo de archivos libre para este ejemplar:
        # se queda sin fotos (antes se repetia el ultimo grupo y salian
        # dos fichas con la misma portada)
        continue
      }
    }
    $letrasTomadas["$firma|$letraAsignada"] = $true
  }
  $g = $grupos[$k][$letraAsignada]
  if (-not $g) { continue }
  # no repetir un grupo cuyos archivos ya estan puestos en otro libro
  if (@(@($g.img1) + @($g.img2) + @($g.docs)) | Where-Object { $usados.ContainsKey($_) }) { continue }
  $l.portadas = @($g.img1)
  $l.contraportadas = @($g.img2)
  $l.infoArchivo = if ($g.docs.Count) { $g.docs[0] } else { '' }
  $l.variante = $letraAsignada
  if ($g.img1.Count) { $conPortada++ }
  foreach ($n in @($g.img1) + @($g.img2) + @($g.docs)) { $usados[$n] = $true }
}
Escribir ("  libros con portada: {0}" -f $conPortada)

# --------------------------------------------------- emparejamiento difuso
function Distancia([string]$a, [string]$b) {
  if ($a -eq $b) { return 0 }
  $la = $a.Length; $lb = $b.Length
  if ($la -eq 0) { return $lb }
  if ($lb -eq 0) { return $la }
  $prev = New-Object 'int[]' ($lb + 1)
  $curr = New-Object 'int[]' ($lb + 1)
  for ($j = 0; $j -le $lb; $j++) { $prev[$j] = $j }
  for ($i = 1; $i -le $la; $i++) {
    $curr[0] = $i
    $ca = $a[$i - 1]
    for ($j = 1; $j -le $lb; $j++) {
      $coste = if ($b[$j - 1] -eq $ca) { 0 } else { 1 }
      $min = $prev[$j] + 1
      if (($curr[$j - 1] + 1) -lt $min) { $min = $curr[$j - 1] + 1 }
      if (($prev[$j - 1] + $coste) -lt $min) { $min = $prev[$j - 1] + $coste }
      $curr[$j] = $min
    }
    $tmp = $prev; $prev = $curr; $curr = $tmp
  }
  return $prev[$lb]
}
function Similitud([string]$a, [string]$b) {
  $max = [Math]::Max($a.Length, $b.Length)
  if ($max -eq 0) { return 1.0 }
  return 1.0 - ([double](Distancia $a $b) / [double]$max)
}

# grupos (clave+letra) que todavia no se han usado
$gruposLibres = @{}
foreach ($k in $grupos.Keys) {
  foreach ($letra in $grupos[$k].Keys) {
    $g = $grupos[$k][$letra]
    $todos = @($g.img1) + @($g.img2) + @($g.docs)
    if (-not $todos.Count) { continue }
    $usado = $false
    foreach ($n in $todos) { if ($usados.ContainsKey($n)) { $usado = $true; break } }
    if (-not $usado) { $gruposLibres["$k|$letra"] = [pscustomobject]@{ Clave = $k; Letra = $letra; G = $g } }
  }
}
Escribir ("  grupos de archivos sin asignar: {0}" -f $gruposLibres.Count)

# libros sin portada, indexados por letra inicial de su clave
$librosLibres = @{}
foreach ($l in $libros) {
  if ($l.portadas.Count -gt 0 -or $l.contraportadas.Count -gt 0 -or $l.infoArchivo) { continue }
  $k = (@(Claves $l.titulo))[0]
  if (-not $k) { continue }
  $letra0 = $k.Substring(0, 1)
  if (-not $librosLibres.ContainsKey($letra0)) { $librosLibres[$letra0] = @() }
  $librosLibres[$letra0] += [pscustomobject]@{ Libro = $l; Clave = $k }
}

$sugerencias = New-Object Collections.ArrayList
$ambiguos = 0
foreach ($entrada in ($gruposLibres.Values | Sort-Object { $_.Clave })) {
  $k = $entrada.Clave
  $letra0 = $k.Substring(0, 1)
  $candidatos = @()
  if ($librosLibres.ContainsKey($letra0)) { $candidatos = $librosLibres[$letra0] }
  $mejor = $null; $mejorPunt = 0.0
  foreach ($cand in $candidatos) {
    $p = Similitud $k $cand.Clave
    if ($p -gt $mejorPunt) { $mejorPunt = $p; $mejor = $cand }
  }
  if ($mejor -and $mejorPunt -ge 0.86) {
    $otro = $null; $segundoPunt = 0.0
    foreach ($cand in $candidatos) {
      if ($cand -eq $mejor) { continue }
      $p = Similitud $k $cand.Clave
      if ($p -gt $segundoPunt) { $segundoPunt = $p; $otro = $cand }
    }
    if ($segundoPunt -ge ($mejorPunt - 0.02)) {   # demasiado parecido: lo dejamos para revision
      $ambiguos++
      $otroTitulo = if ($otro) { $otro.Libro.titulo } else { '?' }
      [void]$ambiguosLista.Add((Item-Aviso $entrada.G.nombre ("parecido a """ + $mejor.Libro.titulo + """ y a """ + $otroTitulo + """; no se ha asignado") ''))
      continue
    }
    $g = $entrada.G
    $l = $mejor.Libro
    # no usar fotos que ya esten puestas en otro libro (un mismo archivo puede
    # estar en dos claves por el articulo: "algo, el" y "el algo")
    if (@(@($g.img1) + @($g.img2) + @($g.docs)) | Where-Object { $usados.ContainsKey($_) }) { continue }
    $l.portadas = @($g.img1)
    $l.contraportadas = @($g.img2)
    $l.infoArchivo = if ($g.docs.Count) { $g.docs[0] } else { '' }
    $l.variante = "~$($entrada.Letra)"
    if ($g.img1.Count) { $conPortada++ }
    foreach ($n in @($g.img1) + @($g.img2) + @($g.docs)) { $usados[$n] = $true }
    [void]$sugerencias.Add(("{0,-45} -> {1}  ({2:P0})" -f $k, $mejor.Clave, $mejorPunt))
    # quitar de la lista de libres
    $claveLetra = $letra0
    $librosLibres[$claveLetra] = @($librosLibres[$claveLetra] | Where-Object { $_.Libro -ne $l })
  }
}
Escribir ("  emparejados por similitud: {0}  (ambiguos descartados: {1})" -f $sugerencias.Count, $ambiguos)

# ------------------------------------------- archivos sin libro: fichas nuevas
$gruposLibres2 = @{}
foreach ($k in $grupos.Keys) {
  foreach ($letra in $grupos[$k].Keys) {
    $g = $grupos[$k][$letra]
    $todos = @($g.img1) + @($g.img2) + @($g.docs)
    if (-not $todos.Count) { continue }
    $usado = $false
    foreach ($n in $todos) { if ($usados.ContainsKey($n)) { $usado = $true; break } }
    if (-not $usado) { $gruposLibres2["$k|$letra"] = [pscustomobject]@{ Clave = $k; Letra = $letra; G = $g } }
  }
}

$extra = 0
foreach ($entrada in ($gruposLibres2.Values | Sort-Object { $_.G.nombre })) {
  if ($entrada.Clave -match '^\d+$' -or $entrada.Clave.Length -lt 3) { continue }
  # la misma lista se construyo antes del bucle: hay que comprobar de nuevo que
  # estas fotos no se hayan puesto ya en otro libro (evita fichas duplicadas)
  if (@(@($entrada.G.img1) + @($entrada.G.img2) + @($entrada.G.docs)) | Where-Object { $usados.ContainsKey($_) }) { continue }
  $nombre = $entrada.G.nombre
  # des-invertir el articulo: "habana, la" -> "la habana"
  $m = [regex]::Match($nombre, '^(.*?),\s*(el|la|los|las|un|una)\s*$', 'IgnoreCase')
  if ($m.Success) {
    $titulo = ($m.Groups[2].Value + ' ' + $m.Groups[1].Value).Trim()
    if ($titulo.Length -gt 1) { $titulo = $titulo.Substring(0, 1).ToUpper() + $titulo.Substring(1) }
  } else { $titulo = $nombre }
  $md5 = [Security.Cryptography.MD5]::Create()
  $hash = [BitConverter]::ToString($md5.ComputeHash([Text.Encoding]::UTF8.GetBytes($entrada.Clave))).Replace('-', '').Substring(0, 8).ToLower()
  $id = "f$hash"
  $registro = [ordered]@{
    id = $id; fila = 0; titulo = $titulo; autor = ''; editorial = ''; signatura = ''
    estanteria = ''; balda = ''; estado = ''; fechaEntrada = ''; fechaSalida = ''
    observaciones = 'Ficha creada desde los archivos (no estaba en el listado)'
    portadas = @($entrada.G.img1); contraportadas = @($entrada.G.img2)
    paginas = ''; sinopsis = ''; genero = ''
    infoArchivo = if ($entrada.G.docs.Count) { $entrada.G.docs[0] } else { '' }
    variante = $entrada.Letra; origen = 'carpeta'
  }
  [void]$libros.Add([pscustomobject]$registro)
  $extra++
  foreach ($n in @($entrada.G.img1) + @($entrada.G.img2) + @($entrada.G.docs)) { $usados[$n] = $true }
}
Escribir ("  fichas nuevas desde archivos: {0}" -f $extra)

# ------------------------------------------------- titulos del listado
Escribir "Reconstruyendo titulos (articulo del nombre del archivo + mayuscula inicial)..."
$correcciones = New-Object Collections.ArrayList
foreach ($l in $libros) {
  $archivo = @(@($l.portadas) + @($l.contraportadas) + @($l.infoArchivo)) | Where-Object { $_ } | Select-Object -First 1
  $antes = $l.titulo
  $despues = ArreglarTitulo $l.titulo $archivo
  if ($despues -cne $antes) {
    $l.titulo = $despues
    [void]$correcciones.Add(("{0,-8} {1}   ->   {2}" -f $l.id, $antes, $despues))
  }
}
Escribir ("  titulos corregidos: {0}" -f $correcciones.Count)

# (el informe de revision se escribe al final, cuando ya se sabe que ha cambiado)

# --------------------- guardar asociaciones archivo -> libro para la proxima vez
# Si un archivo esta compartido por varios libros (varios ejemplares del mismo
# titulo sin letra a/b/c), NO se asocia: es ambiguo y el Diagnostico avisara.
try {
  $usoArchivo = @{}
  foreach ($l in $libros) {
    foreach ($n in @(@($l.portadas)) + @($l.contraportadas) + @([string]$l.infoArchivo)) {
      if ($n) { if ($usoArchivo.ContainsKey($n)) { $usoArchivo[$n]++ } else { $usoArchivo[$n] = 1 } }
    }
  }
  $asocSalida = @{}
  foreach ($l in $libros) {
    foreach ($n in @(@($l.portadas)) + @($l.contraportadas) + @([string]$l.infoArchivo)) {
      if ($n -and $usoArchivo[$n] -eq 1) { $asocSalida[[string]$n] = $l.id }
    }
  }
  $asocTmp = "$asocPath.tmp"
  [IO.File]::WriteAllText($asocTmp, ($asocSalida | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
  Move-Item -Force $asocTmp $asocPath
} catch { Escribir ("  (aviso: no se han podido guardar las asociaciones: {0})" -f $_.Exception.Message) }

# ---------------------------------------------------------------- docx
Escribir "Leyendo informacion (.docx)..."
$leidos = 0
foreach ($l in $libros) {
  if (-not $l.infoArchivo) { continue }
  $ext = [IO.Path]::GetExtension($l.infoArchivo).ToLower()
  if ($ext -ne '.docx') { continue }
  if (-not $cache.ContainsKey($l.infoArchivo)) {
    $ruta = Join-Path $OrigenLibros $l.infoArchivo
    try { $cache[$l.infoArchivo] = LeerDocx $ruta $l.infoArchivo } catch { $cache[$l.infoArchivo] = $null }
    $leidos++
  }
  $info = $cache[$l.infoArchivo]
  if (-not $info) { continue }
  if ($info.Paginas) { $l.paginas = [string]$info.Paginas }
  if ($info.Sinopsis) { $l.sinopsis = [string]$info.Sinopsis }
  if ($info.Genero) { $l.genero = [string]$info.Genero }
  if (-not $l.autor -and $info.Autor) { $l.autor = [string]$info.Autor }
  if (-not $l.editorial -and $info.Editorial) { $l.editorial = [string]$info.Editorial }
}
Escribir ("  docx leidos: {0}" -f $leidos)

# ---------------------------------------------------------------- salida
$destino = Join-Path $Raiz 'datos\biblioteca.json'

# --- comparar con el catalogo anterior para saber que ha cambiado ---
# la clave ignora el articulo inicial para que los cambios de titulo no
# cuenten como libros nuevos o desaparecidos
function ClaveLibro($l) {
  $t = [regex]::Replace((Normalizar $l.titulo), '^(EL|LA|LOS|LAS|UN|UNA|UNOS|UNAS)\s+', '')
  return $t + '|' + (Normalizar $l.autor)
}
$antesInfo = @{}    # clave -> datos del libro
$antesCuenta = @{}  # clave -> cuantas veces aparece
$habiaAnterior = $false
if (Test-Path $destino) {
  try {
    $previo = Get-Content $destino -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($previo.libros) {
      $habiaAnterior = $true
      foreach ($l in $previo.libros) {
        $k = ClaveLibro $l
        if (-not $antesInfo.ContainsKey($k)) { $antesInfo[$k] = $l }
        if ($antesCuenta.ContainsKey($k)) { $antesCuenta[$k]++ } else { $antesCuenta[$k] = 1 }
      }
    }
  } catch { $habiaAnterior = $false }
}

$altas = New-Object Collections.ArrayList
$sobrantes = @{}
foreach ($k in $antesCuenta.Keys) { $sobrantes[$k] = $antesCuenta[$k] }
foreach ($l in $libros) {
  $k = ClaveLibro $l
  if ($sobrantes.ContainsKey($k) -and $sobrantes[$k] -gt 0) { $sobrantes[$k]-- }
  else { [void]$altas.Add([pscustomobject]@{ id = $l.id; titulo = $l.titulo; autor = $l.autor; estado = $l.estado; estanteria = $l.estanteria }) }
}
$bajas = New-Object Collections.ArrayList
foreach ($k in $sobrantes.Keys) {
  if ($sobrantes[$k] -gt 0) {
    $info = $antesInfo[$k]
    [void]$bajas.Add([pscustomobject]@{
      titulo = if ($info) { $info.titulo } else { ($k -split '\|')[0] }
      autor = if ($info) { $info.autor } else { '' }
      estado = if ($info) { $info.estado } else { '' }
      veces = $sobrantes[$k]
    })
  }
}
if ($habiaAnterior) { Escribir ("  novedades: {0} altas, {1} bajas" -f $altas.Count, $bajas.Count) }

# ------------------------------------------------------------- informe
$informe = New-Object Collections.ArrayList
[void]$informe.Add("# Revision de la importacion - $(Get-Date -Format 'yyyy-MM-dd HH:mm')")
[void]$informe.Add("")
[void]$informe.Add("## Novedades respecto a la importacion anterior")
if (-not $habiaAnterior) {
  [void]$informe.Add("  (primera importacion: no hay con que comparar)")
} elseif (-not $altas.Count -and -not $bajas.Count) {
  [void]$informe.Add("  (sin cambios: estan los mismos libros que antes)")
} else {
  if ($altas.Count) {
    [void]$informe.Add("  Libros nuevos ($($altas.Count)):")
    foreach ($a in $altas) { [void]$informe.Add("     + $($a.titulo)   [$($a.autor)]") }
  }
  if ($bajas.Count) {
    [void]$informe.Add("  Libros que ya no aparecen en el listado ($($bajas.Count)):")
    foreach ($b in $bajas) { [void]$informe.Add("     - $($b.titulo)   [$($b.autor)]") }
  }
}
[void]$informe.Add("")
[void]$informe.Add("## Emparejados por similitud (revisar que el libro sea el correcto)")
if ($sugerencias.Count) { foreach ($s in $sugerencias) { [void]$informe.Add("  $s") } } else { [void]$informe.Add("  (ninguno)") }
[void]$informe.Add("")
[void]$informe.Add("## Titulos reconstruidos (articulo recuperado del nombre del archivo)")
if ($correcciones.Count) { foreach ($c in $correcciones) { [void]$informe.Add("  $c") } } else { [void]$informe.Add("  (ninguno)") }
[void]$informe.Add("")
[void]$informe.Add("## Archivos sin asignar a ningun libro")
$resto = @()
foreach ($k in ($grupos.Keys | Sort-Object)) {
  foreach ($letra in ($grupos[$k].Keys | Sort-Object)) {
    $g = $grupos[$k][$letra]
    foreach ($n in @($g.img1) + @($g.img2) + @($g.docs)) { if (-not $usados.ContainsKey($n)) { $resto += $n } }
  }
}
if ($resto.Count) { foreach ($n in ($resto | Sort-Object -Unique)) { [void]$informe.Add("  $n") } } else { [void]$informe.Add("  (ninguno)") }

# --------------------------------------- diagnostico de nombres y asignacion
# Solo informativo: no modifica ni el Excel ni la carpeta de fotos.
$itemsCompartidas = New-Object Collections.ArrayList
$usoFotos = @{}
foreach ($l in $libros) {
  foreach ($n in @($l.portadas) + @($l.contraportadas)) {
    if (-not $usoFotos.ContainsKey($n)) { $usoFotos[$n] = New-Object Collections.ArrayList }
    [void]$usoFotos[$n].Add($l)
  }
}
foreach ($n in ($usoFotos.Keys | Sort-Object)) {
  # se deduplica por id (Select-Object -Unique con objetos no sirve: mismo ToString)
  $ids = @($usoFotos[$n] | ForEach-Object { $_.id } | Sort-Object -Unique)
  if ($ids.Count -gt 1) {
    $titulos = @($usoFotos[$n] | ForEach-Object { $_.titulo } | Sort-Object -Unique)
    [void]$itemsCompartidas.Add((Item-Aviso $n ($titulos -join ' / ') $ids[0]))
  }
}
Nuevo-Aviso 'fotosCompartidas' 'Fotos usadas por mas de un libro' 'El mismo archivo aparece en varias fichas (normalmente falta el sufijo a/b de los tomos).' $itemsCompartidas

$itemsTrasera = New-Object Collections.ArrayList
foreach ($l in $libros) {
  if (@($l.contraportadas).Count -gt 0 -and @($l.portadas).Count -eq 0) {
    [void]$itemsTrasera.Add((Item-Aviso $l.titulo (($l.contraportadas -join ', ') + ' (hay 02 pero no 01)') $l.id))
  }
}
Nuevo-Aviso 'contraportadaSinPortada' 'Contraportada sin portada' 'Tienen foto 02 pero no 01; el catalogo las muestra como "Sin portada".' $itemsTrasera

$itemsDocs = New-Object Collections.ArrayList
$vistosDocs = @{}
foreach ($k in ($grupos.Keys | Sort-Object)) {
  foreach ($letra in ($grupos[$k].Keys | Sort-Object)) {
    $g = $grupos[$k][$letra]
    if (@($g.docs).Count -le 1) { continue }
    $firma = (@($g.docs) | Sort-Object) -join '|'
    if ($vistosDocs.ContainsKey($firma)) { continue }
    $vistosDocs[$firma] = $true
    [void]$itemsDocs.Add((Item-Aviso $g.nombre ('se usa ' + $g.docs[0] + '; sin usar: ' + ((@($g.docs) | Select-Object -Skip 1) -join ', ')) ''))
  }
}
Nuevo-Aviso 'variosDocumentos' 'Varios documentos para el mismo libro' 'Solo se lee el primero; los demas no se muestran en la ficha.' $itemsDocs

Nuevo-Aviso 'imagenSinNumero' 'Imagenes sin numero 01/02' 'No siguen el patron "titulo 01.jpg"; no se han usado en ninguna ficha.' $imagenSinNumero
Nuevo-Aviso 'imagenNumeroTres' 'Imagenes numeradas como 03' 'Para imagenes solo valen 01 (portada) y 02 (contraportada); el 03 es para documentos.' $imagenNumeroTres
Nuevo-Aviso 'numeracionRara' 'Numeracion no reconocida' 'El nombre acaba en un numero distinto de 01, 02 o 03.' $numeracionRara

$itemsExtension = New-Object Collections.ArrayList
foreach ($a in $archivosIgnoradosPorExtension) {
  [void]$itemsExtension.Add((Item-Aviso $a.Name ('extension ' + $a.Extension) ''))
}
Nuevo-Aviso 'extensiones' 'Archivos con extension no soportada' 'El importador solo lee jpg, jpeg, png, docx, doc, txt y pdf.' $itemsExtension

$itemsFichas = New-Object Collections.ArrayList
foreach ($l in $libros) {
  if ($l.origen -eq 'carpeta') {
    $susArchivos = @(@($l.portadas) + @($l.contraportadas) + @($l.infoArchivo)) | Where-Object { $_ }
    [void]$itemsFichas.Add((Item-Aviso $l.titulo ($susArchivos -join ', ') $l.id))
  }
}
Nuevo-Aviso 'fichasNuevas' 'Fichas creadas desde archivos' 'No estaban en el Excel; el catalogo las marca como "Por completar".' $itemsFichas

Nuevo-Aviso 'ambiguos' 'Emparejamientos ambiguos descartados' 'El archivo se parecia a dos libros a la vez; revisa el nombre o pasalo al Excel.' $ambiguosLista

$itemsIgnorados = New-Object Collections.ArrayList
foreach ($n in ($resto | Sort-Object -Unique)) {
  [void]$itemsIgnorados.Add((Item-Aviso $n 'no se corresponde con ningun libro' ''))
}
Nuevo-Aviso 'archivosIgnorados' 'Archivos sin asignar' 'No se han podido relacionar con ninguna ficha ni crear una nueva.' $itemsIgnorados

[void]$informe.Add("")
[void]$informe.Add("## Diagnostico de archivos")
if (-not $avisos.Count) {
  [void]$informe.Add("  (sin avisos)")
} else {
  foreach ($av in $avisos) {
    [void]$informe.Add(("  {0} ({1}):" -f $av.nombre, $av.total))
    foreach ($it in $av.items) {
      $extra = if ($it.detalle) { "   [" + $it.detalle + "]" } else { "" }
      [void]$informe.Add("     - " + $it.texto + $extra)
    }
  }
}
$informe -join "`r`n" | Set-Content -Path (Join-Path $Raiz 'datos\revision.txt') -Encoding UTF8

$diag = [ordered]@{
  generado = (Get-Date).ToString('s')
  totalArchivos = $archivos.Count + $archivosIgnoradosPorExtension.Count
  totalAvisos = $avisos.Count
  avisos = @($avisos)
}
$diagTmp = Join-Path $Raiz 'datos\diagnostico.json.tmp'
[IO.File]::WriteAllText($diagTmp, ($diag | ConvertTo-Json -Depth 6 -Compress), (New-Object Text.UTF8Encoding $false))
Move-Item -Force $diagTmp (Join-Path $Raiz 'datos\diagnostico.json')
Escribir ("  diagnostico de archivos: {0} aviso(s)" -f $avisos.Count)

$novedades = [ordered]@{
  generado = (Get-Date).ToString('s')
  primeraVez = -not $habiaAnterior
  altas = @($altas)
  bajas = @($bajas)
}
$novTmp = Join-Path $Raiz 'datos\novedades.json.tmp'
[IO.File]::WriteAllText($novTmp, ($novedades | ConvertTo-Json -Depth 4 -Compress), (New-Object Text.UTF8Encoding $false))
Move-Item -Force $novTmp (Join-Path $Raiz 'datos\novedades.json')

# --------------------------- reconciliar cambios: "gana el ultimo cambio"
# La web anota lo que escribe en los documentos (_excelEstado, _excelCampos,
# _docxCampos). Si el Excel o el .docx ya no coincide con eso, es que alguien
# los ha cambiado a mano: mandan los documentos y se retira el cambio de la web.
$cambiosPath = Join-Path $Raiz 'datos\cambios.json'
if (Test-Path $cambiosPath) {
  try {
    $cambios = Get-Content $cambiosPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $porId = @{}
    foreach ($l in $libros) { $porId[$l.id] = $l }
    $camposExcel = @('titulo', 'autor', 'editorial', 'signatura', 'estanteria', 'balda', 'observaciones')
    $mapaDocx = @{
      titulo = 'Titulo'; autor = 'Autor'; editorial = 'Editorial'; paginas = 'Paginas'
      sinopsis = 'Sinopsis'; genero = 'Genero'; fechaPublicacion = 'FechaPublicacion'
    }
    $tocado = $false
    $adoptados = 0
    foreach ($id in @($cambios.PSObject.Properties.Name)) {
      $c = $cambios.$id
      $props = @($c.PSObject.Properties.Name)
      $l = $porId[$id]
      $cambio = $false

      # estado (columna H del Excel)
      if ($l -and $props -contains 'estado' -and $props -contains '_excelEstado') {
        if ([string]$l.estado -ne [string]$c._excelEstado) {
          $c.PSObject.Properties.Remove('estado')
          $c.PSObject.Properties.Remove('fechaSalida')
          $c.PSObject.Properties.Remove('_excelEstado')
          $cambio = $true
          $adoptados++
        }
      }

      # campos de ficha que la web escribe en el Excel (columnas A..K)
      if ($l -and $props -contains '_excelCampos') {
        foreach ($campo in @($c._excelCampos.PSObject.Properties.Name)) {
          if ([string]$l.$campo -ne [string]$c._excelCampos.$campo) {
            if ($props -contains $campo) { $c.PSObject.Properties.Remove($campo) }
            $c._excelCampos.PSObject.Properties.Remove($campo)
            $cambio = $true
            $adoptados++
          }
        }
        if (@($c._excelCampos.PSObject.Properties.Name).Count -eq 0) { $c.PSObject.Properties.Remove('_excelCampos') }
      }

      # campos de ficha que la web escribe en el .docx
      if ($props -contains '_docxCampos') {
        $archivo = ''
        if ($props -contains '_docxArchivo') { $archivo = [string]$c._docxArchivo }
        if (-not $archivo -and $l) { $archivo = [string]$l.infoArchivo }
        $info = $null
        if ($archivo -and $cache.ContainsKey($archivo)) { $info = $cache[$archivo] }
        if ($info) {
          foreach ($campo in @($c._docxCampos.PSObject.Properties.Name)) {
            $valor = ''
            if ($mapaDocx.ContainsKey($campo)) { $valor = [string]$info.PSObject.Properties[$mapaDocx[$campo]].Value }
            if ($valor -ne [string]$c._docxCampos.$campo) {
              if ($props -contains $campo) { $c.PSObject.Properties.Remove($campo) }
              $c._docxCampos.PSObject.Properties.Remove($campo)
              $cambio = $true
              $adoptados++
            }
          }
          if (@($c._docxCampos.PSObject.Properties.Name).Count -eq 0) {
            $c.PSObject.Properties.Remove('_docxCampos')
            if ($props -contains '_docxArchivo') { $c.PSObject.Properties.Remove('_docxArchivo') }
          }
        }
      }

      if ($cambio) {
        $tocado = $true
        if (($c.PSObject.Properties | Measure-Object).Count -eq 0) { $cambios.PSObject.Properties.Remove($id) }
      }
    }
    if ($tocado) {
      $tmp = "$cambiosPath.tmp"
      [IO.File]::WriteAllText($tmp, ($cambios | ConvertTo-Json -Depth 4 -Compress), (New-Object Text.UTF8Encoding $false))
      Move-Item -Force $tmp $cambiosPath
      Escribir ("  cambios adoptados de los documentos (cambiados a mano): {0}" -f $adoptados)
    }
  } catch {
    Escribir ("  (aviso: no se han podido conciliar los cambios: {0})" -f $_.Exception.Message)
  }
}

$salida = [ordered]@{
  generado = (Get-Date).ToString('s')
  origenExcel = $OrigenExcel
  origenLibros = $OrigenLibros
  total = $libros.Count
  libros = @($libros)
}
$json = $salida | ConvertTo-Json -Depth 6 -Compress
# escritura atomica: primero un temporal y luego se sustituye
$tmp = "$destino.tmp"
[IO.File]::WriteAllText($tmp, $json, (New-Object Text.UTF8Encoding $false))
Move-Item -Force $tmp $destino
Escribir ("Escrito {0} ({1:N1} MB)" -f $destino, ((Get-Item $destino).Length / 1MB))

# estadisticas
$stats = [ordered]@{
  total = $libros.Count
  conPortada = $conPortada
  conSinopsis = @($libros | Where-Object { $_.sinopsis }).Count
  porEstado = @{}
  porSignatura = @{}
}
foreach ($g in ($libros | Group-Object estado)) { $stats.porEstado[$g.Name] = $g.Count }
foreach ($g in ($libros | Group-Object signatura)) { $stats.porSignatura[$g.Name] = $g.Count }
$statsJson = $stats | ConvertTo-Json -Depth 4 -Compress
[IO.File]::WriteAllText((Join-Path $Raiz 'datos\estadisticas.json'), $statsJson, (New-Object Text.UTF8Encoding $false))

# resumen final
Escribir ("Archivos sin asignar: {0}  (ver datos\revision.txt)" -f $resto.Count)
Escribir "Listo."
