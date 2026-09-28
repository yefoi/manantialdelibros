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

function ArreglarTitulo([string]$titulo, [string]$archivo) {
  # El listado del Excel escribe los titulos por la palabra significativa
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
    $m = [regex]::Match($linea, '^\s*([\p{Lu}][\p{Lu}\s]{2,20})\s*:\s*(.*)$')
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

$usados = @{}
$conPortada = 0
foreach ($l in $libros) {
  $k = ''
  foreach ($clave in (Claves $l.titulo)) { if ($grupos.ContainsKey($clave)) { $k = $clave; break } }
  if (-not $k) { continue }
  $letras = @($grupos[$k].Keys | Sort-Object)
  $companeros = $porClave[$k]
  $indice = [array]::IndexOf($companeros, $l)
  if ($indice -lt 0) { $indice = 0 }
  $letraAsignada = ''
  if ($letras.Count -ge ($indice + 1)) { $letraAsignada = $letras[$indice] }
  elseif ($indice -ge $letras.Count) { $letraAsignada = $letras[-1] }
  $g = $grupos[$k][$letraAsignada]
  if (-not $g) { continue }
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
    if ($segundoPunt -ge ($mejorPunt - 0.02)) { $ambiguos++ ; continue }   # demasiado parecido: lo dejamos para revision
    $g = $entrada.G
    $l = $mejor.Libro
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

# ------------------------------------------------------------- revision
$informe = New-Object Collections.ArrayList
[void]$informe.Add("# Revision de la importacion - $(Get-Date -Format 'yyyy-MM-dd HH:mm')")
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
$informe -join "`r`n" | Set-Content -Path (Join-Path $Raiz 'datos\revision.txt') -Encoding UTF8

# ---------------------------------------------------------------- docx
Escribir "Leyendo informacion (.docx)..."
$cache = @{}
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
$salida = [ordered]@{
  generado = (Get-Date).ToString('s')
  origenExcel = $OrigenExcel
  origenLibros = $OrigenLibros
  total = $libros.Count
  libros = @($libros)
}
$json = $salida | ConvertTo-Json -Depth 6 -Compress
[IO.File]::WriteAllText($destino, $json, (New-Object Text.UTF8Encoding $false))
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
