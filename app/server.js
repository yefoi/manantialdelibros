/* =====================================================================
   Manantial de Libros - servidor de la biblioteca
   Sin dependencias externas. Arranca con:  node app/server.js
   ===================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const os = require('os');
const { execFile } = require('child_process');

const RAIZ = path.resolve(__dirname, '..');
const DATOS = path.join(RAIZ, 'datos');
const WEB = path.join(RAIZ, 'web');
const SUBIDAS = path.join(DATOS, 'subidas');
const MINIATURAS = path.join(DATOS, 'miniaturas');
const AJUSTES_PATH = path.join(DATOS, 'ajustes.json');
const ACCESO_PATH = path.join(DATOS, 'acceso.json');
const BIBLIOTECA_PATH = path.join(DATOS, 'biblioteca.json');
const CAMBIOS_PATH = path.join(DATOS, 'cambios.json');
const NUEVOS_PATH = path.join(DATOS, 'nuevos.json');
const HISTORIAL_PATH = path.join(DATOS, 'historial.json');
const LOG_PATH = path.join(DATOS, 'registro.log');

const MAX_SUBIDA = 30 * 1024 * 1024;   // 30 MB
const DURACION_SESION = 30 * 24 * 60 * 60 * 1000; // 30 dias

const ARRANQUE = Date.now();
let ultimoCambioDetectado = '';
let ultimaImportacion = { inicio: '', fin: '', ok: null, motivo: '', error: '', total: 0 };

// ------------------------------------------------------------ utilidades basicas
function leerJson(ruta, porDefecto) {
  try {
    if (!fs.existsSync(ruta)) return porDefecto;
    const texto = fs.readFileSync(ruta, 'utf8').replace(/^\uFEFF/, '');
    if (!texto.trim()) return porDefecto;
    return JSON.parse(texto);
  } catch (e) {
    registrar('ERROR al leer ' + ruta + ': ' + e.message);
    return porDefecto;
  }
}
function escribirJson(ruta, objeto) {
  const tmp = ruta + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(objeto), 'utf8');
  fs.renameSync(tmp, ruta);
}
function registrar(msg) {
  const linea = '[' + new Date().toISOString() + '] ' + msg + '\r\n';
  try { fs.appendFileSync(LOG_PATH, linea, 'utf8'); } catch (e) { /* nada */ }
  process.stdout.write(linea);
}
function normalizar(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function carpetaSegura(nombre) {
  return typeof nombre === 'string' && nombre.length > 0 && nombre.length < 200 &&
    !nombre.includes('/') && !nombre.includes('\\') && !nombre.includes('..') && !nombre.startsWith('.');
}
function tamanoCarpeta(dir, profundidad) {
  // suma el tamano de una carpeta sin pasarse (para el estado del sistema)
  let bytes = 0, archivos = 0;
  (function andar(d, nivel) {
    let entradas = [];
    try { entradas = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entradas) {
      if (archivos > 20000) return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (nivel > 0) andar(p, nivel - 1); }
      else {
        try { bytes += fs.statSync(p).size; archivos++; } catch (err) { }
      }
    }
  })(dir, profundidad);
  return { bytes, archivos };
}
function fechaValida(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '';
}
function ultimasLineasLog(cuantas) {
  try {
    const lineas = fs.readFileSync(LOG_PATH, 'utf8').split(/\r?\n/)
      .filter((l) => /error|aviso|no se ha podido|no se pudo|fallo/i.test(l));
    return lineas.slice(-cuantas);
  } catch (e) { return []; }
}

// ------------------------------------------------------------ ajustes
if (!fs.existsSync(SUBIDAS)) fs.mkdirSync(SUBIDAS, { recursive: true });
if (!fs.existsSync(MINIATURAS)) fs.mkdirSync(MINIATURAS, { recursive: true });

let ajustes = leerJson(AJUSTES_PATH, {});
if (!ajustes.origenLibros) {
  ajustes.origenLibros = path.join(os.homedir(), 'Desktop', 'libros FINAL');
  escribirJson(AJUSTES_PATH, ajustes);
}
if (!ajustes.puerto) ajustes.puerto = 8080;
let ORIGEN = ajustes.origenLibros;

// ------------------------------------------------------------ acceso
function crearAccesoInicial() {
  const sal = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync('refugio', sal, 64).toString('hex');
  const acceso = {
    usuario: 'koine', sal, hash, clavePorDefecto: true,
    secreto: crypto.randomBytes(32).toString('hex'),
    creado: new Date().toISOString()
  };
  escribirJson(ACCESO_PATH, acceso);
  registrar('*** Creado acceso inicial: usuario "koine" / contrasena "refugio" (cambiala en el sitio) ***');
  return acceso;
}
let acceso = leerJson(ACCESO_PATH, null);
if (!acceso || !acceso.hash) acceso = crearAccesoInicial();
if (!acceso.secreto) { acceso.secreto = crypto.randomBytes(32).toString('hex'); escribirJson(ACCESO_PATH, acceso); }

function comprobarClave(usuario, clave) {
  if (String(usuario || '').toLowerCase() !== String(acceso.usuario).toLowerCase()) return false;
  const hash = crypto.scryptSync(String(clave || ''), acceso.sal, 64).toString('hex');
  const a = Buffer.from(hash, 'hex'), b = Buffer.from(acceso.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function firmar(payload) {
  return crypto.createHmac('sha256', acceso.secreto).update(payload).digest('base64url');
}
function crearToken() {
  const cuerpo = Buffer.from(JSON.stringify({ u: acceso.usuario, iat: Date.now(), exp: Date.now() + DURACION_SESION })).toString('base64url');
  return cuerpo + '.' + firmar(cuerpo);
}
function tokenValido(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const i = token.lastIndexOf('.');
  const c = token.slice(0, i), f = token.slice(i + 1);
  try {
    const esperada = Buffer.from(firmar(c));
    const recibida = Buffer.from(f);
    if (esperada.length !== recibida.length || !crypto.timingSafeEqual(esperada, recibida)) return false;
    const datos = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
    if (datos.exp <= Date.now()) return false;
    if (acceso.sesionesDesde && datos.iat < acceso.sesionesDesde) return false;
    return true;
  } catch (e) { return false; }
}
function leerCookies(req) {
  const out = {};
  const c = req.headers.cookie;
  if (!c) return out;
  for (const parte of c.split(';')) {
    const i = parte.indexOf('=');
    if (i > 0) out[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim());
  }
  return out;
}
function estaLogueado(req) {
  return tokenValido(leerCookies(req).koine);
}
function usuarioActual() { return acceso.usuario; }

// ------------------------------------------------------------ catalogo
let cacheCatalogo = null;

function cargarCatalogo() {
  if (cacheCatalogo) return cacheCatalogo;
  const base = leerJson(BIBLIOTECA_PATH, { libros: [] });
  const cambios = leerJson(CAMBIOS_PATH, {});
  const nuevos = leerJson(NUEVOS_PATH, []);
  const libros = [];
  const vistos = new Set();
  for (const l of (base.libros || [])) {
    const c = cambios[l.id];
    const fusionado = c ? Object.assign({}, l, c) : Object.assign({}, l);
    fusionado.origen = fusionado.origen || 'listado';
    libros.push(fusionado);
    vistos.add(l.id);
  }
  for (const l of (nuevos || [])) {
    const c = cambios[l.id];
    const fusionado = c ? Object.assign({}, l, c) : Object.assign({}, l);
    fusionado.origen = 'nuevo';
    libros.push(fusionado);
    vistos.add(l.id);
  }
  // cambios sobre libros que ya no estan en la base (no perder nada)
  for (const id of Object.keys(cambios)) {
    if (!vistos.has(id)) libros.push(Object.assign({ id, origen: 'huerfano' }, cambios[id]));
  }
  const json = Buffer.from(JSON.stringify({ total: libros.length, generado: base.generado || '', libros }), 'utf8');
  cacheCatalogo = { json, gzip: zlib.gzipSync(json), total: libros.length, libros, version: base.generado || '' };
  return cacheCatalogo;
}
function invalidarCatalogo() { cacheCatalogo = null; }

function guardarCambio(id, campos) {
  const cambios = leerJson(CAMBIOS_PATH, {});
  cambios[id] = Object.assign({}, cambios[id] || {}, campos);
  escribirJson(CAMBIOS_PATH, cambios);
  invalidarCatalogo();
}
function buscarLibro(id) {
  return cargarCatalogo().libros.find(l => l.id === id) || null;
}

// ------------------------------------------------------------ historial de cambios
// Guarda quien (usuario y dispositivo) cambio que y cuando, para poder deshacer.
const MAX_HISTORIAL = 400;
function leerHistorial() { return leerJson(HISTORIAL_PATH, { siguiente: 1, cambios: [] }); }
function ipDe(req) {
  const ip = (req && req.socket && req.socket.remoteAddress) || '';
  return String(ip).replace(/^::ffff:/, '');
}
function anotarCambio(req, accion, id, titulo, detalle, antes, despues) {
  const h = leerHistorial();
  const n = Number(h.siguiente) || 1;
  h.siguiente = n + 1;
  h.cambios.push({
    n, fecha: new Date().toISOString(), usuario: usuarioActual(), desde: ipDe(req),
    accion, id: id || '', titulo: titulo || '', detalle: detalle || '',
    antes: antes === undefined ? null : antes,
    despues: despues === undefined ? null : despues,
    deshecho: false
  });
  if (h.cambios.length > MAX_HISTORIAL) h.cambios = h.cambios.slice(-MAX_HISTORIAL);
  escribirJson(HISTORIAL_PATH, h);
  return n;
}
function camposAntesDe(libro, campos) {
  const antes = {};
  for (const k of Object.keys(campos)) antes[k] = libro[k] === undefined ? '' : libro[k];
  return antes;
}
function eliminarLibroNuevo(id) {
  // se conservan los archivos subidos (datos/subidas y miniaturas) para poder deshacer
  let nuevos = leerJson(NUEVOS_PATH, []);
  nuevos = nuevos.filter(l => l.id !== id);
  escribirJson(NUEVOS_PATH, nuevos);
  const cambios = leerJson(CAMBIOS_PATH, {});
  delete cambios[id];
  escribirJson(CAMBIOS_PATH, cambios);
  invalidarCatalogo();
}

// ------------------------------------------------------------ Excel: ida y vuelta
// La web guarda los cambios en cambios.json y, ademas, los pasa al Excel
// (columna ESTADO y F.SALIDA) para que el listado no se quede desfasado.
const EXCEL_PENDIENTE_PATH = path.join(DATOS, 'excel-pendiente.json');
let volcandoExcel = false;
let ultimoIntentoExcel = 0;
let retrasoExcel = 5000;   // si falla (Excel abierto), se espera mas antes de reintentar

function leerColaExcel() { return leerJson(EXCEL_PENDIENTE_PATH, { items: [] }); }
function escribirColaExcel(cola) { escribirJson(EXCEL_PENDIENTE_PATH, cola); }
function hayPendientesExcel() { const c = leerColaExcel(); return !!(c.items && c.items.length); }

// campos de la ficha que viven en columnas del Excel
const CAMPOS_EXCEL = ['titulo', 'autor', 'editorial', 'signatura', 'estanteria', 'balda', 'observaciones'];

function marcarPendienteExcel(id, fila, campos) {
  if (!fila || fila <= 0 || !campos || !Object.keys(campos).length) return;
  const cola = leerColaExcel();
  cola.items = (cola.items || []).filter(i => i.id !== id);
  cola.items.push({ id, fila, campos });
  escribirColaExcel(cola);
  volcarColaExcel();
}

function volcarColaExcel(cb) {
  const cola = leerColaExcel();
  const items = cola.items || [];
  if (!items.length) { if (cb) cb(null); return; }
  if (volcandoExcel) { if (cb) cb(null); return; }
  if (Date.now() - ultimoIntentoExcel < retrasoExcel) { if (cb) cb(null); return; }
  volcandoExcel = true;
  ultimoIntentoExcel = Date.now();
  ejecutarPowerShell('actualizar-excel.ps1', [], (err) => {
    volcandoExcel = false;
    if (err) {
      retrasoExcel = 60000;
      registrar('Aviso: no se han podido pasar los cambios al Excel (' +
        String(err.message || err).split('\n')[0] + '). Se reintentara en un minuto.');
      if (cb) cb(err);
      return;
    }
    retrasoExcel = 5000;
    const cambios = leerJson(CAMBIOS_PATH, {});
    for (const it of items) {
      const c = cambios[it.id];
      if (!c) continue;
      // formato nuevo ({campos}) y antiguo ({estado, fecha})
      const campos = it.campos || { estado: it.estado, fechaSalida: it.fecha };
      if (campos.estado !== undefined) c._excelEstado = campos.estado;
      const ficha = {};
      for (const k of CAMPOS_EXCEL) if (campos[k] !== undefined) ficha[k] = campos[k];
      if (Object.keys(ficha).length) c._excelCampos = Object.assign({}, c._excelCampos || {}, ficha);
    }
    escribirJson(CAMBIOS_PATH, cambios);
    escribirColaExcel({ items: [] });
    invalidarCatalogo();
    // el cambio del Excel lo hemos hecho nosotros: que el vigilante no reimporte
    try { firmaConocidaTexto = firmaActual().texto; } catch (e) { }
    registrar('Cambios pasados al Excel: ' + items.length + '.');
    if (cb) cb(null);
  });
}

// Cambios de estado hechos antes de esta funcion (sin marca _excelEstado):
// se pasan al Excel para que quede al dia.
function encolarCambiosAntiguos() {
  const cambios = leerJson(CAMBIOS_PATH, {});
  const base = leerJson(BIBLIOTECA_PATH, { libros: [] });
  const porId = {};
  for (const l of (base.libros || [])) porId[l.id] = l;
  let n = 0;
  for (const id of Object.keys(cambios)) {
    const c = cambios[id];
    if (!c || c.estado === undefined) continue;
    if (c._excelEstado !== undefined) continue;
    const l = porId[id];
    if (!l || !l.fila || l.fila <= 0) continue;
    const cola = leerColaExcel();
    if ((cola.items || []).some(i => i.id === id)) continue;
    cola.items = cola.items || [];
    cola.items.push({ id, fila: l.fila, campos: { estado: c.estado, fechaSalida: c.fechaSalida || '' } });
    escribirColaExcel(cola);
    n++;
  }
  if (n) { registrar('Cambios de estado pendientes de pasar al Excel: ' + n); volcarColaExcel(); }
}

// "Gana el ultimo cambio": la conciliacion con el Excel la hace el importador
// (herramientas\importar.ps1), que es quien lee el Excel de verdad.

// ------------------------------------------------------------ miniaturas
const miniaturasPendientes = new Set();
let trabajosMiniatura = 0;
const colaMiniaturas = [];
function generarMiniatura(nombre) {
  const script = path.join(RAIZ, 'herramientas', 'miniaturas.ps1');
  if (!fs.existsSync(script) || miniaturasPendientes.has(nombre)) return;
  miniaturasPendientes.add(nombre);
  colaMiniaturas.push(nombre);
  procesarColaMiniaturas();
}
function procesarColaMiniaturas() {
  if (trabajosMiniatura >= 2 || !colaMiniaturas.length) return;
  const nombre = colaMiniaturas.shift();
  trabajosMiniatura++;
  const script = path.join(RAIZ, 'herramientas', 'miniaturas.ps1');
  execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Archivo', nombre],
    { windowsHide: true }, (err) => {
      trabajosMiniatura--;
      miniaturasPendientes.delete(nombre);
      if (err) registrar('Aviso: no se pudo crear la miniatura de ' + nombre + ': ' + err.message);
      procesarColaMiniaturas();
    });
}

// ------------------------------------------------------------ docx
function extraerDocx(buffer) {
  // lector minimo de zip (solo lo necesario para word/document.xml)
  const EOCD = 0x06054b50, CD = 0x02014b50, LFH = 0x04034b50;
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0 && i >= buffer.length - 66000; i--) {
    if (buffer.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP no valido');
  const totalEntradas = buffer.readUInt16LE(eocd + 10);
  let puntero = buffer.readUInt32LE(eocd + 16);
  let objetivo = null;
  for (let n = 0; n < totalEntradas; n++) {
    if (buffer.readUInt32LE(puntero) !== CD) break;
    const metodo = buffer.readUInt16LE(puntero + 10);
    const comprimido = buffer.readUInt32LE(puntero + 20);
    const lfn = buffer.readUInt16LE(puntero + 28);
    const lex = buffer.readUInt16LE(puntero + 30);
    const lco = buffer.readUInt16LE(puntero + 32);
    const offset = buffer.readUInt32LE(puntero + 42);
    const nombre = buffer.toString('utf8', puntero + 46, puntero + 46 + lfn);
    if (nombre === 'word/document.xml') { objetivo = { metodo, comprimido, offset }; break; }
    puntero += 46 + lfn + lex + lco;
  }
  if (!objetivo) throw new Error('docx sin document.xml');
  const inicio = objetivo.offset + 30 + buffer.readUInt16LE(objetivo.offset + 26) + buffer.readUInt16LE(objetivo.offset + 28);
  const datos = buffer.slice(inicio, inicio + objetivo.comprimido);
  const xml = objetivo.metodo === 0 ? datos.toString('utf8') : zlib.inflateRawSync(datos).toString('utf8');
  return textoDeDocumentoXml(xml);
}
function textoDeDocumentoXml(xml) {
  const parrafos = [];
  const re = /<w:p[\s>][\s\S]*?<\/w:p>/g;
  let m;
  while ((m = re.exec(xml))) {
    let t = '';
    const rt = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
    let n;
    while ((n = rt.exec(m[0]))) t += n[1];
    parrafos.push(desescaparXml(t));
  }
  const lineas = parrafos.map(p => p.trim());
  const campos = { titulo: '', autor: '', paginas: '', editorial: '', sinopsis: '', genero: '', fechaPublicacion: '' };
  const alias = {
    'TITULO': 'titulo', 'TITUTLO': 'titulo', 'TITULO SEGUNDO': 'titulo',
    'AUTOR': 'autor',
    'PAGINA': 'paginas', 'PAGINAS': 'paginas', 'PAGINA S': 'paginas',
    'EDITORIAL': 'editorial', 'EDITORIA': 'editorial', 'EDIORIAL': 'editorial', 'EDITOR': 'editorial',
    'SINOPSIS': 'sinopsis', 'SISNOPSIS': 'sinopsis', 'SIPNOSIS': 'sinopsis', 'SISNOPSI': 'sinopsis', 'RESENAS': 'sinopsis',
    'GENERO': 'genero',
    'FECHA DE PUBLICACION': 'fechaPublicacion'
  };
  let actual = '';
  for (const linea of lineas) {
    const mm = linea.match(/^([A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ\s]{2,20})\s*:\s*(.*)$/);
    if (mm) {
      const etiqueta = normalizar(mm[1]);
      if (alias[etiqueta]) {
        actual = alias[etiqueta];
        if (mm[2]) campos[actual] = mm[2];
        continue;
      }
    }
    if (actual && linea) campos[actual] = (campos[actual] + ' ' + linea).trim();
  }
  return campos;
}
function desescaparXml(s) {
  return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (x, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&');
}

// ------------------------------------------------------------ docx: escritura
function escaparXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function crc32(buf) {
  let tabla = crc32.tabla;
  if (!tabla) {
    tabla = crc32.tabla = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      tabla[n] = c;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = tabla[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function zipSimple(entradas) {
  // ZIP sin compresion (metodo "almacenado"), suficiente para un .docx minimo
  const partes = [], central = [];
  let offset = 0;
  for (const e of entradas) {
    const nombre = Buffer.from(e.nombre, 'utf8');
    const crc = crc32(e.datos);
    const cab = Buffer.alloc(30);
    cab.writeUInt32LE(0x04034b50, 0);
    cab.writeUInt16LE(20, 4);
    cab.writeUInt16LE(0x0800, 6);           // nombres en UTF-8
    cab.writeUInt16LE(0, 8);                // sin compresion
    cab.writeUInt16LE(0, 10);
    cab.writeUInt16LE(33, 12);              // fecha 1980-01-01
    cab.writeUInt32LE(crc, 14);
    cab.writeUInt32LE(e.datos.length, 18);
    cab.writeUInt32LE(e.datos.length, 22);
    cab.writeUInt16LE(nombre.length, 26);
    cab.writeUInt16LE(0, 28);
    partes.push(cab, nombre, e.datos);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(0, 10);
    cen.writeUInt16LE(0, 12); cen.writeUInt16LE(33, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(e.datos.length, 20);
    cen.writeUInt32LE(e.datos.length, 24);
    cen.writeUInt16LE(nombre.length, 28);
    cen.writeUInt16LE(0, 30); cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34); cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE(0, 38);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nombre);
    offset += cab.length + nombre.length + e.datos.length;
  }
  const cd = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(0, 4); fin.writeUInt16LE(0, 6);
  fin.writeUInt16LE(entradas.length, 8);
  fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(cd.length, 12);
  fin.writeUInt32LE(offset, 16);
  fin.writeUInt16LE(0, 20);
  return Buffer.concat([Buffer.concat(partes), cd, fin]);
}
function crearDocx(campos) {
  const lineas = [];
  const pon = (etiqueta, valor) => {
    const v = String(valor == null ? '' : valor).replace(/\s+/g, ' ').trim();
    if (v) lineas.push(etiqueta + ': ' + v);
  };
  pon('TITULO', campos.titulo);
  pon('AUTOR', campos.autor);
  pon('PAGINAS', campos.paginas);
  pon('EDITORIAL', campos.editorial);
  pon('GENERO', campos.genero);
  pon('FECHA DE PUBLICACION', campos.fechaPublicacion);
  pon('SINOPSIS', campos.sinopsis);
  const parrafos = lineas.map(l => '<w:p><w:r><w:t xml:space="preserve">' + escaparXml(l) + '</w:t></w:r></w:p>').join('');
  const documento = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    parrafos + '</w:body></w:document>';
  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
  return zipSimple([
    { nombre: '[Content_Types].xml', datos: Buffer.from(contentTypes, 'utf8') },
    { nombre: '_rels/.rels', datos: Buffer.from(rels, 'utf8') },
    { nombre: 'word/document.xml', datos: Buffer.from(documento, 'utf8') }
  ]);
}
function limpiarNombreArchivo(s) {
  return String(s == null ? '' : s).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}
function baseDeArchivo(libro) {
  // si ya tiene una portada de la carpeta, el documento sigue su nombre;
  // las portadas subidas desde la web (id-...) se ignoran para el nombre
  const portada = (libro.portadas || [])[0] || '';
  if (portada && !(libro.id && portada.startsWith(libro.id + '-'))) {
    const base = portada.replace(/\.[a-z0-9]+$/i, '').replace(/\s+\d{1,2}[a-z]?$/i, '').trim();
    if (base) return base;
  }
  // convencion del listado: el articulo va al final ("jardinero fiel, el")
  let t = normalizarCampo(libro.titulo);
  let articulo = '';
  const m = t.match(/^(el|la|los|las|un|una|unos|unas)\s+(.+)$/i);
  if (m) { articulo = m[1].toLowerCase(); t = m[2]; }
  t = limpiarNombreArchivo(t.toLowerCase());
  if (!t) return '';
  return articulo ? (t + ', ' + articulo) : t;
}
function normalizarCampo(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
}
// Guarda los datos de la ficha en el .docx del libro (en la carpeta de fotos,
// o en datos/subidas si el libro se añadió desde el sitio). Devuelve
// { archivo, campos } con lo escrito (para poder conciliar despues), o null.
function sincronizarDocx(libro) {
  if (!libro || ajustes.sincronizarDocx === false) return null;
  const info = String(libro.infoArchivo || '');
  const campos = {
    titulo: normalizarCampo(libro.titulo), autor: normalizarCampo(libro.autor),
    editorial: normalizarCampo(libro.editorial), paginas: normalizarCampo(libro.paginas),
    genero: normalizarCampo(libro.genero), sinopsis: normalizarCampo(libro.sinopsis),
    fechaPublicacion: ''
  };
  const enSubidas = info ? path.join(SUBIDAS, info) : '';
  const enOrigen = info ? path.join(ORIGEN, info) : '';
  let destino = '', nombre = '';
  if (info.toLowerCase().endsWith('.docx') && enSubidas && fs.existsSync(enSubidas)) {
    destino = enSubidas; nombre = info;
  } else if (info.toLowerCase().endsWith('.docx') && enOrigen && fs.existsSync(enOrigen)) {
    destino = enOrigen; nombre = info;
    try { campos.fechaPublicacion = extraerDocx(fs.readFileSync(enOrigen)).fechaPublicacion || ''; } catch (e) { }
  } else if (info && !info.toLowerCase().endsWith('.docx')) {
    return null;   // pdf/txt de origen: no se tocan
  } else if (ORIGEN && fs.existsSync(ORIGEN) && libro.origen !== 'nuevo' && libro.origen !== 'huerfano') {
    nombre = limpiarNombreArchivo((baseDeArchivo(libro) || 'libro') + ' 03.docx');
    destino = path.join(ORIGEN, nombre);
  } else {
    nombre = libro.id + '-info-' + Date.now().toString(36) + '.docx';
    destino = path.join(SUBIDAS, nombre);
  }
  try {
    fs.writeFileSync(destino, crearDocx(campos));
    registrar('Documento de ficha actualizado: ' + destino);
    return { archivo: nombre, campos };
  } catch (e) {
    registrar('Aviso: no se ha podido actualizar el documento de ' + libro.id + ': ' + e.message);
    return null;
  }
}

// ------------------------------------------------------------ multipart
function leerCuerpo(req, limite) {
  return new Promise((resolve, reject) => {
    const trozos = [];
    let tamaño = 0;
    req.on('data', (t) => {
      tamaño += t.length;
      if (tamaño > limite) { reject(new Error('Demasiado grande')); req.destroy(); return; }
      trozos.push(t);
    });
    req.on('end', () => resolve(Buffer.concat(trozos)));
    req.on('error', reject);
  });
}
function analizarMultipart(buffer, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) throw new Error('Sin boundary');
  const boundary = '--' + (m[1] || m[2]).trim();
  const partes = [];
  const delim = Buffer.from('\r\n' + boundary);
  let inicio = buffer.indexOf(Buffer.from(boundary));
  if (inicio < 0) throw new Error('Multipart vacio');
  inicio += boundary.length;
  while (true) {
    const siguiente = buffer.indexOf(delim, inicio);
    if (siguiente < 0) break;
    const bloque = buffer.slice(inicio + 2, siguiente);
    const finCabeceras = bloque.indexOf('\r\n\r\n');
    if (finCabeceras > 0) {
      const cabeceras = bloque.slice(0, finCabeceras).toString('utf8');
      const datos = bloque.slice(finCabeceras + 4);
      const nm = /name="([^"]*)"/i.exec(cabeceras);
      const fn = /filename="([^"]*)"/i.exec(cabeceras);
      const ct = /content-type:\s*([^\r\n]+)/i.exec(cabeceras);
      partes.push({
        nombre: nm ? nm[1] : '',
        archivo: fn ? path.basename(fn[1]) : null,
        tipo: ct ? ct[1].trim() : '',
        datos
      });
    }
    inicio = siguiente + delim.length;
  }
  return partes;
}

// ------------------------------------------------------------ respuestas
function enviar(res, codigo, cuerpo, cabeceras) {
  res.writeHead(codigo, Object.assign({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin'
  }, cabeceras || {}));
  res.end(cuerpo);
}
function enviarJson(res, codigo, objeto, cabeceras) {
  enviar(res, codigo, JSON.stringify(objeto), Object.assign({
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'
  }, cabeceras || {}));
}
function enviarError(res, codigo, mensaje) { enviarJson(res, codigo, { error: mensaje }); }

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.doc': 'application/msword'
};
function tipoPorExtension(ruta) { return MIME[path.extname(ruta).toLowerCase()] || 'application/octet-stream'; }

function servirArchivo(res, req, ruta, opciones) {
  opciones = opciones || {};
  fs.stat(ruta, (err, st) => {
    if (err || !st.isFile()) {
      if (opciones.siFalla) return opciones.siFalla();
      return enviarError(res, 404, 'No encontrado');
    }
    const cabeceras = {
      'Content-Type': opciones.tipo || tipoPorExtension(ruta),
      'Content-Length': st.size,
      'Cache-Control': opciones.cache || 'public, max-age=86400',
      'Last-Modified': st.mtime.toUTCString()
    };
    if (opciones.descarga) cabeceras['Content-Disposition'] = 'attachment; filename="' + encodeURIComponent(path.basename(ruta)) + '"';
    res.writeHead(200, cabeceras);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(ruta).pipe(res).on('error', () => res.end());
  });
}

// ------------------------------------------------------------ rutas de medios
function localizarMedia(nombre, tipo) {
  if (!carpetaSegura(nombre)) return null;
  const candidatos = [];
  if (tipo === 'thumb') candidatos.push(path.join(MINIATURAS, nombre + '.jpg'));
  candidatos.push(path.join(SUBIDAS, nombre));
  candidatos.push(path.join(ORIGEN, nombre));
  for (const c of candidatos) if (fs.existsSync(c)) return c;
  return null;
}

// ------------------------------------------------------------ API
const intentos = new Map(); // ip -> {n, hasta}
function limitarIntentos(req) {
  const ip = req.socket.remoteAddress || '?';
  const ahora = Date.now();
  const reg = intentos.get(ip) || { n: 0, hasta: 0 };
  if (ahora > reg.hasta) { reg.n = 0; reg.hasta = ahora + 5 * 60 * 1000; }
  reg.n++;
  intentos.set(ip, reg);
  return reg.n <= 12;
}

async function api(req, res, url) {
  const ruta = url.pathname;
  const metodo = req.method.toUpperCase();

  if (ruta === '/api/estado' && metodo === 'GET') {
    const cat = cargarCatalogo();
    return enviarJson(res, 200, {
      logueado: estaLogueado(req), usuario: usuarioActual(),
      total: cat.total, clavePorDefecto: !!acceso.clavePorDefecto, sitio: ajustes.nombreSitio || 'Manantial de Libros',
      version: cat.version, actualizando: importando,
      excelPendiente: (leerColaExcel().items || []).length
    });
  }
  if (ruta === '/api/excel/volcar' && metodo === 'POST') {
    if (!estaLogueado(req)) return enviarError(res, 401, 'Hay que entrar como socio');
    ultimoIntentoExcel = 0;
    retrasoExcel = 5000;
    volcarColaExcel((err) => {
      if (err) return enviarJson(res, 200, { ok: false, mensaje: 'No se ha podido (¿esta el Excel abierto?)', pendiente: (leerColaExcel().items || []).length });
      return enviarJson(res, 200, { ok: true, pendiente: 0 });
    });
    return;
  }
  if (ruta === '/api/actualizar' && metodo === 'POST') {
    if (!estaLogueado(req)) return enviarError(res, 401, 'Hay que entrar como socio');
    if (importando) return enviarJson(res, 200, { ok: true, mensaje: 'Ya se esta actualizando' });
    actualizarCatalogo('peticion manual');
    return enviarJson(res, 200, { ok: true, mensaje: 'Actualizando el catalogo' });
  }

  // ---- novedades de la ultima importacion (libros nuevos y desaparecidos)
  if (ruta === '/api/novedades' && metodo === 'GET') {
    if (!estaLogueado(req)) return enviarError(res, 401, 'Hay que entrar como socio');
    const nov = leerJson(path.join(DATOS, 'novedades.json'), { generado: '', primeraVez: true, altas: [], bajas: [] });
    return enviarJson(res, 200, nov);
  }

  // ---- diagnostico de nombres y asignacion de archivos de la ultima importacion
  if (ruta === '/api/diagnostico' && metodo === 'GET') {
    if (!estaLogueado(req)) return enviarError(res, 401, 'Hay que entrar como socio');
    const diag = leerJson(path.join(DATOS, 'diagnostico.json'), { generado: '', totalArchivos: 0, totalAvisos: 0, avisos: [] });
    return enviarJson(res, 200, diag);
  }

  // ---- estado del sistema (salud) para el personal
  if (ruta === '/api/salud' && metodo === 'GET') {
    if (!estaLogueado(req)) return enviarError(res, 401, 'Hay que entrar como socio');
    const cat = cargarCatalogo();
    const cola = leerColaExcel();
    const diag = leerJson(path.join(DATOS, 'diagnostico.json'), null);
    let espacio = null;
    try {
      const s = fs.statfsSync(DATOS);
      espacio = { libre: Number(s.bavail) * Number(s.bsize), total: Number(s.blocks) * Number(s.bsize) };
    } catch (e) { }
    return enviarJson(res, 200, {
      servidor: {
        desde: new Date(ARRANQUE).toISOString(), puerto: ajustes.puerto,
        node: process.version, plataforma: process.platform
      },
      direcciones: direcciones(),
      catalogo: { total: cat.total, version: cat.version, importando, importacion: ultimaImportacion },
      vigilancia: { activa: ajustes.vigilar !== false, ultimoCambio: ultimoCambioDetectado },
      rutas: {
        origenExcel: ajustes.origenExcel || '', origenLibros: ORIGEN || '',
        existeExcel: !!(ajustes.origenExcel && fs.existsSync(ajustes.origenExcel)),
        existeLibros: !!(ORIGEN && fs.existsSync(ORIGEN))
      },
      excelPendiente: (cola.items || []).length,
      diagnostico: diag ? {
        generado: diag.generado || '', totalAvisos: diag.totalAvisos || 0, totalArchivos: diag.totalArchivos || 0
      } : null,
      espacio,
      tamanos: {
        datos: tamanoCarpeta(DATOS, 3),
        subidas: tamanoCarpeta(SUBIDAS, 2),
        miniaturas: tamanoCarpeta(MINIATURAS, 2),
        copias: tamanoCarpeta(path.join(RAIZ, 'copias'), 2)
      },
      clave: {
        biblioteca: fs.existsSync(BIBLIOTECA_PATH), cambios: fs.existsSync(CAMBIOS_PATH),
        nuevos: fs.existsSync(NUEVOS_PATH), historial: fs.existsSync(HISTORIAL_PATH),
        ajustes: fs.existsSync(AJUSTES_PATH), acceso: fs.existsSync(ACCESO_PATH)
      },
      errores: ultimasLineasLog(6)
    });
  }

  // ---- copia de seguridad de los datos
  if (ruta === '/api/copia-seguridad' && metodo === 'POST') {
    if (!estaLogueado(req)) return enviarError(res, 401, 'Hay que entrar como socio');
    ejecutarPowerShell('copia-seguridad.ps1', [], (err, stdout) => {
      if (err) {
        registrar('No se ha podido crear la copia de seguridad: ' + String(err.message || err).split('\n')[0]);
        return enviarJson(res, 200, { ok: false, mensaje: 'No se ha podido crear la copia de seguridad' });
      }
      const texto = String(stdout || '').trim().split('\n').filter(Boolean).pop() || 'Copia creada';
      registrar('Copia de seguridad creada (' + texto + ')');
      return enviarJson(res, 200, { ok: true, mensaje: texto });
    });
    return;
  }

  // ---- historial de cambios (quien cambio que y cuando) y deshacer
  if (ruta === '/api/historial' && metodo === 'GET') {
    if (!estaLogueado(req)) return enviarError(res, 401, 'Hay que entrar como socio');
    return enviarJson(res, 200, leerHistorial());
  }
  if (ruta === '/api/historial/deshacer' && metodo === 'POST') {
    if (!estaLogueado(req)) return enviarError(res, 401, 'Hay que entrar como socio');
    const cuerpo = await leerCuerpo(req, 64 * 1024);
    let datos = {};
    try { datos = JSON.parse(cuerpo.toString('utf8') || '{}'); } catch (e) { return enviarError(res, 400, 'Datos no validos'); }
    const h = leerHistorial();
    const e = (h.cambios || []).find(c => c.n === Number(datos.n));
    if (!e) return enviarError(res, 404, 'Ese cambio no esta en el historial');
    if (e.deshecho) return enviarError(res, 400, 'Ese cambio ya se deshizo');
    if (e.accion === 'deshacer' || e.accion === 'clave' ||
        (!e.antes && e.accion !== 'alta' && e.accion !== 'borrado')) {
      return enviarError(res, 400, 'Este cambio no se puede deshacer');
    }
    let libro = null;
    if (e.accion === 'alta') {
      const l = buscarLibro(e.id);
      if (!l) return enviarError(res, 400, 'Ese libro ya no existe');
      if (l.origen !== 'nuevo') return enviarError(res, 400, 'Solo se pueden deshacer las altas hechas desde el sitio');
      eliminarLibroNuevo(e.id);
    } else if (e.accion === 'borrado') {
      if (buscarLibro(e.id)) return enviarError(res, 400, 'Ese libro ya volvio al catalogo');
      const nuevos = leerJson(NUEVOS_PATH, []);
      nuevos.push(e.antes);
      escribirJson(NUEVOS_PATH, nuevos);
      invalidarCatalogo();
      libro = buscarLibro(e.id);
    } else {
      guardarCambio(e.id, e.antes);
      libro = buscarLibro(e.id);
      if (libro && e.accion === 'media' && e.antes) {
        // deshacer un cambio de imagen: los archivos nuevos se apartan a
        // datos/reemplazos y los antiguos se devuelven a su sitio
        const reemplazos = path.join(DATOS, 'reemplazos');
        try { fs.mkdirSync(reemplazos, { recursive: true }); } catch (err) { }
        const esSubida = (n) => new RegExp('^' + libro.id + '-(portada|contraportada|info)-').test(n);
        const apartar = (n) => {
          for (const dir of [SUBIDAS, ORIGEN]) {
            try {
              const p = path.join(dir, n);
              if (fs.existsSync(p)) {
                try { fs.unlinkSync(path.join(reemplazos, n)); } catch (err) { }
                fs.renameSync(p, path.join(reemplazos, n));
                try { fs.unlinkSync(path.join(MINIATURAS, n + '.jpg')); } catch (err) { }
                break;
              }
            } catch (err) { }
          }
        };
        const antiguos = [];
        const nuevos = [];
        for (const campo of ['portadas', 'contraportadas']) {
          for (const n of (Array.isArray(e.antes[campo]) ? e.antes[campo] : [])) if (n) antiguos.push(n);
          for (const n of (Array.isArray(e.despues && e.despues[campo]) ? e.despues[campo] : [])) if (n) nuevos.push(n);
        }
        if (e.antes.infoArchivo) antiguos.push(e.antes.infoArchivo);
        if (e.despues && e.despues.infoArchivo) nuevos.push(e.despues.infoArchivo);
        for (const n of nuevos) { if (!antiguos.includes(n)) apartar(n); }
        for (const n of antiguos) {
          try {
            const p = path.join(reemplazos, n);
            if (!fs.existsSync(p)) continue;
            const destino = path.join(esSubida(n) ? SUBIDAS : ORIGEN, n);
            try { if (fs.existsSync(destino)) fs.unlinkSync(destino); } catch (err) { }
            fs.renameSync(p, destino);
            setTimeout(() => generarMiniatura(n), 200);
          } catch (err) { }
        }
      }
      if (libro && e.accion === 'ficha') {
        // la ficha restaurada se devuelve tambien al .docx
        const hecho = sincronizarDocx(libro);
        if (hecho) {
          const cc = leerJson(CAMBIOS_PATH, {});
          if (cc[libro.id]) {
            cc[libro.id]._docxArchivo = hecho.archivo;
            cc[libro.id]._docxCampos = hecho.campos;
            if (hecho.archivo !== libro.infoArchivo) cc[libro.id].infoArchivo = hecho.archivo;
            escribirJson(CAMBIOS_PATH, cc);
            invalidarCatalogo();
            libro = buscarLibro(libro.id);
          }
        }
      }
      // los campos del Excel se devuelven al Excel
      if (libro && libro.fila) {
        const paraExcel = {};
        for (const k of CAMPOS_EXCEL) if (e.antes && e.antes[k] !== undefined) paraExcel[k] = e.antes[k];
        if (e.accion === 'estado' && e.antes && e.antes.estado !== undefined) {
          paraExcel.estado = libro.estado;
          paraExcel.fechaSalida = libro.fechaSalida || '';
        }
        marcarPendienteExcel(libro.id, libro.fila, paraExcel);
      }
    }
    e.deshecho = true;
    escribirJson(HISTORIAL_PATH, h);
    anotarCambio(req, 'deshacer', e.id, e.titulo, 'Deshecho el cambio #' + e.n + ' (' + e.detalle + ')', e.despues, e.antes);
    registrar('Deshecho el cambio #' + e.n + ' (' + e.accion + ' de ' + e.id + ')');
    return enviarJson(res, 200, { ok: true, libro });
  }

  // ---- rutas del Excel y de la carpeta de fotos
  if (ruta === '/api/rutas' && metodo === 'GET') {
    if (!estaLogueado(req)) return enviarError(res, 401, 'Hay que entrar como socio');
    return enviarJson(res, 200, {
      origenExcel: ajustes.origenExcel || '',
      origenLibros: ajustes.origenLibros || '',
      vigilar: ajustes.vigilar !== false,
      existeExcel: !!(ajustes.origenExcel && fs.existsSync(ajustes.origenExcel)),
      existeLibros: !!(ajustes.origenLibros && fs.existsSync(ajustes.origenLibros))
    });
  }
  if (ruta === '/api/rutas' && metodo === 'POST') {
    if (!estaLogueado(req)) return enviarError(res, 401, 'Hay que entrar como socio');
    const cuerpo = await leerCuerpo(req, 64 * 1024);
    let datos = {};
    try { datos = JSON.parse(cuerpo.toString('utf8') || '{}'); } catch (e) { return enviarError(res, 400, 'Datos no validos'); }
    const nuevoExcel = String(datos.origenExcel || '').trim();
    const nuevaCarpeta = String(datos.origenLibros || '').trim();
    if (!nuevoExcel || !fs.existsSync(nuevoExcel)) return enviarError(res, 400, 'No encuentro ese archivo de listado');
    if (!nuevaCarpeta || !fs.existsSync(nuevaCarpeta)) return enviarError(res, 400, 'No encuentro esa carpeta');
    if (!fs.statSync(nuevoExcel).isFile()) return enviarError(res, 400, 'El listado tiene que ser un archivo .xlsx');
    if (!fs.statSync(nuevaCarpeta).isDirectory()) return enviarError(res, 400, 'La carpeta de libros no es valida');
    const antes = { excel: ajustes.origenExcel, libros: ajustes.origenLibros };
    ajustes.origenExcel = nuevoExcel;
    ajustes.origenLibros = nuevaCarpeta;
    if (typeof datos.vigilar === 'boolean') ajustes.vigilar = datos.vigilar;
    escribirJson(AJUSTES_PATH, ajustes);
    ORIGEN = ajustes.origenLibros;
    registrar('Rutas cambiadas. Excel: ' + nuevoExcel + '  |  Fotos: ' + nuevaCarpeta);
    let imagenes = 0, docs = 0;
    try {
      for (const n of fs.readdirSync(ORIGEN)) {
        const e = path.extname(n).toLowerCase();
        if (['.jpg', '.jpeg', '.png', '.webp'].includes(e)) imagenes++;
        else if (['.docx', '.doc', '.pdf', '.txt', '.md'].includes(e)) docs++;
      }
    } catch (e) { }
    actualizarCatalogo('rutas cambiadas');
    return enviarJson(res, 200, { ok: true, origenExcel: nuevoExcel, origenLibros: nuevaCarpeta, imagenes, docs, antes });
  }

  // ---- explorador de carpetas del ordenador
  if (ruta === '/api/explorar' && metodo === 'GET') {
    if (!estaLogueado(req)) return enviarError(res, 401, 'Hay que entrar como socio');
    const tipo = (url.searchParams.get('tipo') || 'carpeta').toLowerCase();
    let base = (url.searchParams.get('ruta') || '').trim();
    if (!base) {
      const unidades = [];
      for (let c = 65; c <= 90; c++) {
        const l = String.fromCharCode(c) + ':';
        try { if (fs.existsSync(l + '\\')) unidades.push({ n: l + '\\', r: l + '\\', d: true, t: 0 }); } catch (e) { }
      }
      return enviarJson(res, 200, { ruta: '', padre: null, entradas: unidades, tipo });
    }
    if (!fs.existsSync(base)) return enviarError(res, 400, 'No encuentro esa ruta en este ordenador');
    try { if (!fs.statSync(base).isDirectory()) base = path.dirname(base); } catch (e) { return enviarError(res, 400, 'Ruta no valida'); }
    let nombres = [];
    try { nombres = fs.readdirSync(base); } catch (e) { return enviarError(res, 400, 'No se puede leer esa carpeta (¿permisos?)'); }
    const extensiones = ['.xlsx', '.xls'];
    const entradas = [];
    let archivos = 0, subcarpetas = 0;
    for (const n of nombres) {
      if (n.charAt(0) === '$' || n === 'System Volume Information' || n.charAt(0) === '.') continue;
      let s;
      try { s = fs.statSync(path.join(base, n)); } catch (e) { continue; }
      if (s.isDirectory()) {
        subcarpetas++;
        entradas.push({ n, r: path.join(base, n), d: true, t: 0 });
      } else {
        archivos++;
        if (tipo === 'archivo' && extensiones.includes(path.extname(n).toLowerCase())) entradas.push({ n, r: path.join(base, n), d: false, t: s.size });
      }
      if (entradas.length >= 800) break;
    }
    entradas.sort((a, b) => (a.d === b.d ? a.n.localeCompare(b.n, 'es') : (a.d ? -1 : 1)));
    const padre = path.dirname(base);
    return enviarJson(res, 200, { ruta: base, padre: padre === base ? null : padre, entradas, tipo, archivos, subcarpetas });
  }

  // ---- abrir una carpeta en el Explorador de Windows (en el ordenador del servidor)
  if (ruta === '/api/abrir' && metodo === 'POST') {
    if (!estaLogueado(req)) return enviarError(res, 401, 'Hay que entrar como socio');
    const cuerpo = await leerCuerpo(req, 8 * 1024);
    let datos = {};
    try { datos = JSON.parse(cuerpo.toString('utf8') || '{}'); } catch (e) { }
    const destino = String(datos.ruta || '').trim();
    if (!destino || !fs.existsSync(destino)) return enviarError(res, 400, 'Esa ruta no existe');
    execFile('explorer.exe', [destino], { windowsHide: false }, () => { });
    return enviarJson(res, 200, { ok: true });
  }
  if (ruta === '/api/libros' && metodo === 'GET') {
    const cat = cargarCatalogo();
    const aceptaGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    const cuerpo = aceptaGzip ? cat.gzip : cat.json;
    return enviar(res, 200, cuerpo, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Encoding': aceptaGzip ? 'gzip' : 'identity',
      'Cache-Control': 'no-store'
    });
  }
  if (ruta === '/api/login' && metodo === 'POST') {
    if (!limitarIntentos(req)) return enviarError(res, 429, 'Demasiados intentos. Espera unos minutos.');
    const cuerpo = await leerCuerpo(req, 64 * 1024);
    let datos = {};
    try { datos = JSON.parse(cuerpo.toString('utf8') || '{}'); } catch (e) { }
    if (!comprobarClave(datos.usuario, datos.clave)) {
      registrar('Intento de acceso fallido de ' + (req.socket.remoteAddress || '?'));
      return enviarError(res, 401, 'Usuario o contrasena incorrectos');
    }
    const token = crearToken();
    return enviarJson(res, 200, { ok: true, usuario: acceso.usuario }, {
      'Set-Cookie': 'koine=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + Math.floor(DURACION_SESION / 1000)
    });
  }
  if (ruta === '/api/logout' && metodo === 'POST') {
    acceso.sesionesDesde = Date.now();
    escribirJson(ACCESO_PATH, acceso);
    return enviarJson(res, 200, { ok: true }, { 'Set-Cookie': 'koine=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' });
  }
  if (ruta === '/api/clave' && metodo === 'POST') {
    if (!estaLogueado(req)) return enviarError(res, 401, 'Hay que entrar como socio');
    const cuerpo = await leerCuerpo(req, 64 * 1024);
    let datos = {};
    try { datos = JSON.parse(cuerpo.toString('utf8') || '{}'); } catch (e) { }
    if (!comprobarClave(datos.usuario || acceso.usuario, datos.actual)) return enviarError(res, 400, 'La contrasena actual no es correcta');
    if (!datos.nueva || String(datos.nueva).length < 4) return enviarError(res, 400, 'La nueva contrasena debe tener al menos 4 caracteres');
    acceso.sal = crypto.randomBytes(16).toString('hex');
    acceso.hash = crypto.scryptSync(String(datos.nueva), acceso.sal, 64).toString('hex');
    acceso.clavePorDefecto = false;
    if (datos.usuario && String(datos.usuario).trim()) acceso.usuario = String(datos.usuario).trim().slice(0, 40);
    acceso.secreto = crypto.randomBytes(32).toString('hex');
    escribirJson(ACCESO_PATH, acceso);
    anotarCambio(req, 'clave', '', '', 'Contraseña cambiada', null, null);
    registrar('Contrasena cambiada');
    return enviarJson(res, 200, { ok: true, usuario: acceso.usuario }, {
      'Set-Cookie': 'koine=' + crearToken() + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + Math.floor(DURACION_SESION / 1000)
    });
  }

  // ---- libros
  if (ruta === '/api/libros' && metodo === 'POST') {
    if (!estaLogueado(req)) return enviarError(res, 401, 'Hay que entrar como socio');
    const cuerpo = await leerCuerpo(req, 512 * 1024);
    let datos = {};
    try { datos = JSON.parse(cuerpo.toString('utf8') || '{}'); } catch (e) { return enviarError(res, 400, 'Datos no validos'); }
    const titulo = String(datos.titulo || '').trim();
    if (!titulo) return enviarError(res, 400, 'El titulo es obligatorio');
    const id = 'n' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
    const estadoNuevo = ['Disponible', 'Prestado', 'Donado'].includes(datos.estado) ? datos.estado : 'Disponible';
    const hoy = new Date().toISOString().slice(0, 10);
    const libro = {
      id, fila: 0, titulo,
      autor: String(datos.autor || '').trim(),
      editorial: String(datos.editorial || '').trim(),
      signatura: String(datos.signatura || '').trim(),
      estanteria: String(datos.estanteria || '').trim(),
      balda: String(datos.balda || '').trim(),
      estado: estadoNuevo,
      fechaEntrada: fechaValida(datos.fechaEntrada) || hoy,
      fechaSalida: estadoNuevo === 'Donado' ? (fechaValida(datos.fechaSalida) || hoy) : '',
      observaciones: String(datos.observaciones || '').trim(),
      portadas: [], contraportadas: [], paginas: String(datos.paginas || '').trim(),
      sinopsis: String(datos.sinopsis || '').trim(), genero: '', infoArchivo: '',
      creado: new Date().toISOString(), origen: 'nuevo'
    };
    if (libro.sinopsis || libro.paginas) {
      const hecho = sincronizarDocx(libro);
      if (hecho) libro.infoArchivo = hecho.archivo;
    }
    const nuevos = leerJson(NUEVOS_PATH, []);
    nuevos.push(libro);
    escribirJson(NUEVOS_PATH, nuevos);
    invalidarCatalogo();
    anotarCambio(req, 'alta', id, titulo, 'Libro añadido al catálogo', null, libro);
    registrar('Libro anadido: ' + titulo);
    return enviarJson(res, 201, { ok: true, libro });
  }

  const mLibro = ruta.match(/^\/api\/libros\/([A-Za-z0-9_-]{1,40})$/);
  if (mLibro) {
    const id = mLibro[1];
    if (metodo === 'GET') {
      const l = buscarLibro(id);
      return l ? enviarJson(res, 200, l) : enviarError(res, 404, 'Libro no encontrado');
    }
    if (metodo === 'PATCH') {
      if (!estaLogueado(req)) return enviarError(res, 401, 'Hay que entrar como socio');
      const cuerpo = await leerCuerpo(req, 512 * 1024);
      let datos = {};
      try { datos = JSON.parse(cuerpo.toString('utf8') || '{}'); } catch (e) { return enviarError(res, 400, 'Datos no validos'); }
      const actual = buscarLibro(id);
      if (!actual) return enviarError(res, 404, 'Libro no encontrado');
      const campos = {};
      const textos = ['titulo', 'autor', 'editorial', 'signatura', 'paginas', 'sinopsis', 'observaciones', 'estanteria', 'balda'];
      for (const k of textos) if (typeof datos[k] === 'string') campos[k] = datos[k].trim().slice(0, 8000);
      if (typeof datos.estado === 'string') {
        if (!['Disponible', 'Prestado', 'Donado', ''].includes(datos.estado)) return enviarError(res, 400, 'Estado no valido');
        campos.estado = datos.estado;
        if (datos.estado === 'Donado') campos.fechaSalida = new Date().toISOString().slice(0, 10);
        if (datos.estado === 'Disponible') { campos.fechaSalida = ''; }
      }
      if (!Object.keys(campos).length) return enviarError(res, 400, 'Nada que actualizar');
      const esEstado = Object.keys(campos).every(k => k === 'estado' || k === 'fechaSalida');
      // los cambios de ficha se escriben tambien en el .docx del libro
      let docxActualizado = '';
      let snapshotDocx = null;
      if (!esEstado) {
        const hecho = sincronizarDocx(Object.assign({}, actual, campos));
        if (hecho) {
          docxActualizado = hecho.archivo;
          snapshotDocx = hecho;
          if (hecho.archivo !== actual.infoArchivo) campos.infoArchivo = hecho.archivo;
        }
      }
      const antes = camposAntesDe(actual, campos);
      guardarCambio(id, campos);
      if (snapshotDocx) {
        const cc = leerJson(CAMBIOS_PATH, {});
        if (cc[id]) {
          cc[id]._docxArchivo = snapshotDocx.archivo;
          cc[id]._docxCampos = snapshotDocx.campos;
          escribirJson(CAMBIOS_PATH, cc);
          invalidarCatalogo();
        }
      }
      const detalle = esEstado
        ? (String(antes.estado || 'sin estado') + ' -> ' + String(campos.estado || 'sin estado'))
        : Object.keys(campos).join(', ');
      anotarCambio(req, esEstado ? 'estado' : 'ficha', id, actual.titulo, detalle, antes, campos);
      // los cambios de ficha (y el estado) se pasan tambien al Excel
      const paraExcel = {};
      for (const k of CAMPOS_EXCEL) if (campos[k] !== undefined) paraExcel[k] = campos[k];
      if (campos.estado !== undefined) {
        paraExcel.estado = campos.estado;
        paraExcel.fechaSalida = (buscarLibro(id) || actual).fechaSalida || '';
      }
      if (actual.fila) marcarPendienteExcel(id, actual.fila, paraExcel);
      registrar('Editado ' + id + ': ' + Object.keys(campos).join(', '));
      return enviarJson(res, 200, { ok: true, libro: buscarLibro(id), docx: docxActualizado });
    }
    if (metodo === 'DELETE') {
      if (!estaLogueado(req)) return enviarError(res, 401, 'Hay que entrar como socio');
      const libro = buscarLibro(id);
      if (!libro) return enviarError(res, 404, 'Libro no encontrado');
      if (libro.origen !== 'nuevo') return enviarError(res, 400, 'Solo se pueden eliminar los libros añadidos desde el sitio');
      anotarCambio(req, 'borrado', id, libro.titulo, 'Libro eliminado del catálogo', libro, null);
      eliminarLibroNuevo(id);
      registrar('Libro eliminado: ' + id + ' (' + libro.titulo + ')');
      return enviarJson(res, 200, { ok: true });
    }
  }

  // ---- exportar un libro anadido desde la web al Excel y a la carpeta de fotos
  const mExportar = ruta.match(/^\/api\/libros\/([A-Za-z0-9_-]{1,40})\/exportar$/);
  if (mExportar && metodo === 'POST') {
    if (!estaLogueado(req)) return enviarError(res, 401, 'Hay que entrar como socio');
    const id = mExportar[1];
    const libro = buscarLibro(id);
    if (!libro) return enviarError(res, 404, 'Libro no encontrado');
    if (libro.origen !== 'nuevo') return enviarError(res, 400, 'Este libro ya esta en el listado');
    if (!ajustes.origenExcel || !fs.existsSync(ajustes.origenExcel)) return enviarError(res, 400, 'No encuentro el Excel');
    if (!ORIGEN || !fs.existsSync(ORIGEN)) return enviarError(res, 400, 'No encuentro la carpeta de libros');

    const base = baseDeArchivo(libro);
    if (!base) return enviarError(res, 400, 'El titulo no sirve para nombrar los archivos');
    let choque = [];
    try {
      choque = fs.readdirSync(ORIGEN).filter((n) => {
        const ln = n.toLowerCase();
        return ln.startsWith(base + ' ') || ln.startsWith(base + '.');
      });
    } catch (e) { }
    if (choque.length) {
      return enviarError(res, 409, 'Ya hay archivos con ese nombre en la carpeta (' +
        choque.slice(0, 3).join(', ') + '). Cambia el titulo o renombralos.');
    }

    const portada = (libro.portadas || [])[0] || '';
    const contra = (libro.contraportadas || [])[0] || '';
    const info = String(libro.infoArchivo || '');
    const ext = (n) => path.extname(n).toLowerCase();
    for (const n of [portada, contra]) {
      if (n && ext(n) === '.webp') return enviarError(res, 400, 'La imagen .webp no se puede exportar; conviertela a jpg o png');
    }

    const datosPath = path.join(DATOS, 'exportar-libro.json');
    escribirJson(datosPath, {
      titulo: libro.titulo, autor: libro.autor, editorial: libro.editorial, signatura: libro.signatura,
      estanteria: libro.estanteria, balda: libro.balda, estado: libro.estado || 'Disponible',
      fechaEntrada: libro.fechaEntrada || new Date().toISOString().slice(0, 10),
      fechaSalida: libro.fechaSalida || '', observaciones: libro.observaciones
    });
    ejecutarPowerShell('anadir-excel.ps1', ['-Datos', datosPath], (err, stdout) => {
      try { fs.unlinkSync(datosPath); } catch (e) { }
      if (err) {
        registrar('No se ha podido exportar ' + id + ': ' + String(err.message || err).split('\n')[0]);
        return enviarError(res, 500, 'No se ha podido escribir en el Excel (¿esta abierto?). Cierralo e intentalo de nuevo.');
      }
      const mFila = /FILA=(\d+)/.exec(String(stdout || ''));
      if (!mFila) return enviarError(res, 500, 'El Excel no ha devuelto la fila nueva');
      const fila = Number(mFila[1]);

      const copiados = [];
      try {
        if (portada) {
          const nom = base + ' 01' + ext(portada);
          fs.copyFileSync(path.join(SUBIDAS, portada), path.join(ORIGEN, nom));
          copiados.push({ origen: portada, destino: nom });
        }
        if (contra) {
          const nom = base + ' 02' + ext(contra);
          fs.copyFileSync(path.join(SUBIDAS, contra), path.join(ORIGEN, nom));
          copiados.push({ origen: contra, destino: nom });
        }
        const rutaInfo = info ? path.join(SUBIDAS, info) : '';
        if (rutaInfo && fs.existsSync(rutaInfo)) {
          const nom = base + ' 03' + ext(info);
          fs.copyFileSync(rutaInfo, path.join(ORIGEN, nom));
          copiados.push({ origen: info, destino: nom });
        } else if (libro.sinopsis || libro.paginas || libro.genero) {
          const nom = base + ' 03.docx';
          fs.writeFileSync(path.join(ORIGEN, nom), crearDocx({
            titulo: libro.titulo, autor: libro.autor, editorial: libro.editorial,
            paginas: libro.paginas, genero: libro.genero, sinopsis: libro.sinopsis, fechaPublicacion: ''
          }));
          copiados.push({ origen: '', destino: nom });
        }
      } catch (e) {
        registrar('Aviso: fallo copiando los archivos de ' + id + ': ' + e.message);
        return enviarError(res, 500, 'La fila del Excel se ha anadido, pero no se han podido copiar los archivos: ' + e.message);
      }

      // la ficha pasa a ser del listado: fuera de nuevos.json y cambios.json,
      // y el historial apunta al id nuevo (r<fila>)
      let nuevos = leerJson(NUEVOS_PATH, []);
      nuevos = nuevos.filter((l) => l.id !== id);
      escribirJson(NUEVOS_PATH, nuevos);
      const cambios = leerJson(CAMBIOS_PATH, {});
      delete cambios[id];
      escribirJson(CAMBIOS_PATH, cambios);
      const h = leerHistorial();
      let tocados = 0;
      for (const e of (h.cambios || [])) { if (e.id === id) { e.id = 'r' + fila; tocados++; } }
      if (tocados) escribirJson(HISTORIAL_PATH, h);
      for (const c of copiados) {
        if (!c.origen) continue;
        try { fs.unlinkSync(path.join(SUBIDAS, c.origen)); } catch (e) { }
        try { fs.unlinkSync(path.join(MINIATURAS, c.origen + '.jpg')); } catch (e) { }
      }
      invalidarCatalogo();

      const responder = (intentos) => {
        const cat = cargarCatalogo();
        const nuevo = cat.libros.find((l) => l.fila === fila) ||
          cat.libros.find((l) => normalizar(l.titulo) === normalizar(libro.titulo));
        if (!nuevo && intentos > 0) {
          setTimeout(() => { invalidarCatalogo(); responder(intentos - 1); }, 1500);
          return;
        }
        registrar('Libro exportado al listado: ' + libro.titulo + ' (fila ' + fila + ')');
        return enviarJson(res, 200, {
          ok: true, fila, libro: nuevo || null,
          mensaje: 'Exportado al Excel (fila ' + fila + ') y a la carpeta de fotos'
        });
      };
      actualizarCatalogo('libro exportado al listado', () => { invalidarCatalogo(); responder(12); });
    });
    return;
  }

  // ---- medios de un libro (subir / borrar)
  const mMedia = ruta.match(/^\/api\/libros\/([A-Za-z0-9_-]{1,40})\/media$/);
  if (mMedia) {
    if (!estaLogueado(req)) return enviarError(res, 401, 'Hay que entrar como socio');
    const id = mMedia[1];
    const libro = buscarLibro(id);
    if (!libro) return enviarError(res, 404, 'Libro no encontrado');

    if (metodo === 'POST') {
      const cuerpo = await leerCuerpo(req, MAX_SUBIDA);
      let partes;
      try { partes = analizarMultipart(cuerpo, req.headers['content-type']); } catch (e) { return enviarError(res, 400, 'Subida no valida'); }
      const tipo = (partes.find(p => p.nombre === 'tipo') || {}).datos;
      const tipoTxt = tipo ? tipo.toString('utf8').trim() : '';
      const archivo = partes.find(p => p.nombre === 'archivo' && p.datos && p.datos.length);
      if (!archivo) return enviarError(res, 400, 'No has enviado ningun archivo');
      if (!['portada', 'contraportada', 'info'].includes(tipoTxt)) return enviarError(res, 400, 'Tipo no valido');
      const ext = path.extname(archivo.archivo || '').toLowerCase();
      const permitidos = tipoTxt === 'info' ? ['.docx', '.doc', '.txt', '.md', '.pdf'] : ['.jpg', '.jpeg', '.png', '.webp'];
      if (!permitidos.includes(ext)) return enviarError(res, 400, 'Formato no permitido (' + permitidos.join(', ') + ')');

      const campos = {};
      let nombre = '';
      if (tipoTxt === 'info') {
        nombre = id + '-info-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex') + ext;
        fs.writeFileSync(path.join(SUBIDAS, nombre), archivo.datos);
        campos.infoArchivo = nombre;
        if (ext === '.docx') {
          try {
            const camposDoc = extraerDocx(archivo.datos);
            if (camposDoc.sinopsis) campos.sinopsis = camposDoc.sinopsis;
            if (camposDoc.paginas) campos.paginas = camposDoc.paginas;
            if (camposDoc.genero) campos.genero = camposDoc.genero;
            if (camposDoc.autor && !libro.autor) campos.autor = camposDoc.autor;
            if (camposDoc.editorial && !libro.editorial) campos.editorial = camposDoc.editorial;
          } catch (e) { registrar('No se pudo leer el docx subido: ' + e.message); }
        } else if (ext === '.txt' || ext === '.md') {
          campos.sinopsis = archivo.datos.toString('utf8').replace(/\s+/g, ' ').trim().slice(0, 8000);
        }
      } else {
        // la portada/contraportada se CAMBIA (no se acumula) y, en libros del
        // listado o creados desde archivos, se guarda en libros FINAL con el
        // nombre estandar (mismo que la imagen que reemplaza, o "titulo 01/02")
        const campo = tipoTxt === 'portada' ? 'portadas' : 'contraportadas';
        const deFuente = !!(libro.fila || libro.origen === 'listado' || libro.origen === 'carpeta');
        const antigua = (Array.isArray(libro[campo]) ? libro[campo] : [])[0] || '';
        let destino = '';
        if (deFuente && ORIGEN && fs.existsSync(ORIGEN)) {
          const rutaAntigua = antigua ? path.join(ORIGEN, antigua) : '';
          if (rutaAntigua && fs.existsSync(rutaAntigua)) {
            nombre = limpiarNombreArchivo(antigua.replace(/\.[a-z0-9]+$/i, '') + ext);
          } else {
            nombre = limpiarNombreArchivo((baseDeArchivo(libro) || 'libro') + (tipoTxt === 'portada' ? ' 01' : ' 02') + ext);
          }
          destino = path.join(ORIGEN, nombre);
        } else {
          nombre = id + '-' + tipoTxt + '-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex') + ext;
          destino = path.join(SUBIDAS, nombre);
        }
        // las imagenes anteriores de esa cara se guardan en datos/reemplazos
        // (no se pierden, por si se deshace el cambio)
        const reemplazos = path.join(DATOS, 'reemplazos');
        try { fs.mkdirSync(reemplazos, { recursive: true }); } catch (e) { }
        for (const viejo of (Array.isArray(libro[campo]) ? libro[campo] : [])) {
          if (!viejo) continue;
          for (const dir of [SUBIDAS, ORIGEN]) {
            try {
              const p = path.join(dir, viejo);
              if (fs.existsSync(p)) {
                try { fs.unlinkSync(path.join(reemplazos, viejo)); } catch (e2) { }
                fs.renameSync(p, path.join(reemplazos, viejo));
                try { fs.unlinkSync(path.join(MINIATURAS, viejo + '.jpg')); } catch (e2) { }
                break;
              }
            } catch (e2) { }
          }
        }
        fs.writeFileSync(destino, archivo.datos);
        campos[campo] = [nombre];
        setTimeout(() => generarMiniatura(nombre), 200);
      }
      const antes = camposAntesDe(libro, campos);
      guardarCambio(id, campos);
      anotarCambio(req, 'media', id, libro.titulo, 'Subido ' + tipoTxt + ': ' + nombre +
        ' (' + Math.round(archivo.datos.length / 1024) + ' KB)', antes, campos);
      registrar('Subido ' + tipoTxt + ' de ' + id + ' (' + Math.round(archivo.datos.length / 1024) + ' KB)');
      return enviarJson(res, 200, { ok: true, archivo: nombre, libro: buscarLibro(id) });
    }

    if (metodo === 'DELETE') {
      const nombre = url.searchParams.get('archivo') || '';
      if (!carpetaSegura(nombre)) return enviarError(res, 400, 'Archivo no valido');
      const campos = {};
      for (const campo of ['portadas', 'contraportadas']) {
        if (Array.isArray(libro[campo]) && libro[campo].includes(nombre)) campos[campo] = libro[campo].filter(x => x !== nombre);
      }
      if (libro.infoArchivo === nombre) campos.infoArchivo = '';
      if (!Object.keys(campos).length) return enviarError(res, 400, 'Ese archivo no pertenece al libro');
      const antes = camposAntesDe(libro, campos);
      guardarCambio(id, campos);
      // el archivo se conserva en datos/subidas para poder deshacer
      anotarCambio(req, 'media', id, libro.titulo, 'Quitado: ' + nombre, antes, campos);
      return enviarJson(res, 200, { ok: true, libro: buscarLibro(id) });
    }
  }

  return enviarError(res, 404, 'Ruta no encontrada');
}

// ------------------------------------------------------------ actualizacion automatica
let importando = false;
let importacionPendiente = false;
let firmaConocidaTexto = '';
let temporizadorCambios = null;

function firmaArchivo(ruta) {
  try { const s = fs.statSync(ruta); return s.size + '/' + Math.round(s.mtimeMs); } catch (e) { return '0/0'; }
}
function firmaCarpeta(dir) {
  try {
    const nombres = fs.readdirSync(dir);
    let max = 0, total = 0, n = 0;
    for (const nombre of nombres) {
      if (nombre.charAt(0) === '~' || nombre.charAt(0) === '.') continue;
      try {
        const s = fs.statSync(path.join(dir, nombre));
        if (s.isFile()) { if (s.mtimeMs > max) max = s.mtimeMs; total += s.size; n++; }
      } catch (e) { /* archivo en uso: se ignora en esta pasada */ }
    }
    return n + '/' + Math.round(max) + '/' + total;
  } catch (e) { return '0/0/0'; }
}
function firmaActual() {
  const excel = firmaArchivo(ajustes.origenExcel);
  const carpeta = firmaCarpeta(ORIGEN);
  const marca = Math.max(Number(excel.split('/')[1]) || 0, Number(carpeta.split('/')[1]) || 0);
  return { texto: excel + ' | ' + carpeta, marca };
}

function actualizarCatalogo(motivo, cb) {
  if (importando) { importacionPendiente = true; if (cb) cb(null); return; }
  importando = true;
  importacionPendiente = false;
  const t0 = Date.now();
  ultimaImportacion = { inicio: new Date().toISOString(), fin: '', ok: null, motivo, error: '', total: ultimaImportacion.total || 0 };
  registrar('*** Cambios detectados (' + motivo + '): reimportando el catalogo... ***');
  ejecutarPowerShell('importar.ps1', [], (errI) => {
    if (errI) {
      ultimaImportacion.fin = new Date().toISOString();
      ultimaImportacion.ok = false;
      ultimaImportacion.error = String(errI.message || errI).split('\n')[0];
      registrar('ERROR al reimportar: ' + ultimaImportacion.error);
      importando = false;
      if (cb) cb(errI);
      return;
    }
    registrar('Catalogo reimportado en ' + Math.round((Date.now() - t0) / 1000) + ' s. Generando miniaturas...');
    ejecutarPowerShell('miniaturas.ps1', [], (errM) => {
      if (errM) registrar('Aviso: fallo al generar miniaturas: ' + String(errM.message || errM).split('\n')[0]);
      invalidarCatalogo();
      const cat = cargarCatalogo();
      firmaConocidaTexto = firmaActual().texto;
      importando = false;
      ultimaImportacion.fin = new Date().toISOString();
      ultimaImportacion.ok = true;
      ultimaImportacion.error = errM ? 'Aviso: fallo al generar miniaturas' : '';
      ultimaImportacion.total = cat.total;
      registrar('*** Catalogo actualizado: ' + cat.total + ' libros (' + cat.version + ') ***');
      if (importacionPendiente) { importacionPendiente = false; actualizarCatalogo('cambios encadenados'); }
      if (cb) cb(null);
    });
  });
}

function ejecutarPowerShell(script, argumentos, cb) {
  const ruta = path.join(RAIZ, 'herramientas', script);
  if (!fs.existsSync(ruta)) { registrar('No encuentro ' + ruta); return cb(new Error('script no encontrado')); }
  execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ruta].concat(argumentos || []),
    { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 20 * 60 * 1000 }, cb);
}

function vigilarCambios() {
  if (ajustes.vigilar === false) { registrar('Vigilancia automatica de cambios: desactivada.'); return; }
  let firma = firmaActual();
  firmaConocidaTexto = firma.texto;

  // si los datos de origen son mas nuevos que el catalogo, se actualiza al arrancar
  const fechaCatalogo = Date.parse(cargarCatalogo().version || '') || 0;
  if (firma.marca > 0 && fechaCatalogo > 0 && firma.marca > fechaCatalogo + 2000) {
    registrar('El Excel o las fotos son mas nuevos que el catalogo: se actualizara en unos segundos...');
    setTimeout(() => actualizarCatalogo('arranque'), 6000);
  }

  setInterval(() => {
    firma = firmaActual();
    if (firma.texto === firmaConocidaTexto) return;
    firmaConocidaTexto = firma.texto;
    ultimoCambioDetectado = new Date().toISOString();
    clearTimeout(temporizadorCambios);
    // se espera a que termine de copiarse antes de reimportar
    temporizadorCambios = setTimeout(() => actualizarCatalogo('Excel o fotos modificados'), 7000);
  }, 10000);
  registrar('Vigilando cambios en el Excel y en la carpeta de fotos.');
}

// ------------------------------------------------------------ servidor
const servidor = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch (e) { return enviarError(res, 400, 'Peticion no valida'); }
  const ruta = decodeURIComponent(url.pathname);

  try {
    if (ruta.startsWith('/api/')) return await api(req, res, url);

    if (ruta.startsWith('/media/')) {
      const m = ruta.match(/^\/media\/(img|thumb|doc|upload)\/(.+)$/);
      if (!m) return enviarError(res, 404, 'No encontrado');
      const tipo = m[1];
      const nombre = path.basename(m[2]);
      if (!carpetaSegura(nombre)) return enviarError(res, 400, 'Nombre no valido');

      if (tipo === 'thumb') {
        const mini = path.join(MINIATURAS, nombre + '.jpg');
        if (!fs.existsSync(mini)) generarMiniatura(nombre);
        if (fs.existsSync(mini)) return servirArchivo(res, req, mini, { cache: 'public, max-age=604800' });
      }

      const localizado = localizarMedia(nombre, tipo === 'thumb' ? 'upload' : tipo);
      if (!localizado) return enviarError(res, 404, 'Archivo no encontrado');
      const opciones = { descarga: tipo === 'doc' && url.searchParams.get('descargar') === '1' };
      if (tipo === 'thumb') opciones.cache = 'public, max-age=3600';
      else if (tipo === 'img') opciones.cache = 'public, max-age=86400';
      return servirArchivo(res, req, localizado, opciones);
    }

    // estaticos
    let rel = ruta === '/' ? 'index.html' : ruta.replace(/^\/+/, '');
    const destino = path.join(WEB, rel);
    if (!destino.startsWith(WEB)) return enviarError(res, 403, 'Prohibido');
    if (fs.existsSync(destino) && fs.statSync(destino).isFile()) return servirArchivo(res, req, destino, { cache: 'no-cache' });
    return servirArchivo(res, req, path.join(WEB, 'index.html'), { cache: 'no-cache' });
  } catch (e) {
    registrar('ERROR ' + req.method + ' ' + req.url + ' -> ' + e.message + '\n' + (e.stack || ''));
    if (!res.headersSent) return enviarError(res, 500, 'Error interno');
    try { res.end(); } catch (e2) { }
  }
});

function direcciones() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const nombre of Object.keys(ifaces)) {
    for (const d of ifaces[nombre] || []) {
      if (d.family === 'IPv4' && !d.internal) out.push('http://' + d.address + ':' + ajustes.puerto);
    }
  }
  return out;
}

servidor.listen(ajustes.puerto, '0.0.0.0', () => {
  const cat = cargarCatalogo();
  registrar('=====================================================');
  registrar(' Manantial de Libros - biblioteca en marcha');
  registrar(' Libros en el catalogo: ' + cat.total);
  registrar(' En este ordenador:  http://localhost:' + ajustes.puerto);
  for (const d of direcciones()) registrar(' En la red wifi:     ' + d);
  registrar(' Usuario: ' + acceso.usuario + (acceso.clavePorDefecto ? '   (contrasena inicial: refugio)' : ''));
  if (!fs.existsSync(ORIGEN)) {
    registrar('');
    registrar(' AVISO: no encuentro la carpeta de fotos:');
    registrar('   ' + ORIGEN);
    registrar(' Las portadas no se veran hasta que arregles esa ruta en datos/ajustes.json');
    registrar(' (o vuelvas a ejecutar herramientas/importar.ps1).');
  }
  registrar('=====================================================');
  vigilarCambios();
  // pasar al Excel los cambios de estado pendientes y reintentar de vez en cuando
  setTimeout(encolarCambiosAntiguos, 8000);
  setInterval(() => { if (hayPendientesExcel()) volcarColaExcel(); }, 60000);
});
servidor.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    registrar('');
    registrar(' AVISO: Manantial de Libros ya estaba en marcha en este ordenador.');
    registrar(' Puedes entrar directamente en:  http://localhost:' + ajustes.puerto);
    registrar(' (Si quieres reiniciarlo, cierra primero la otra ventana negra.)');
    process.exit(0);
  }
  registrar('ERROR del servidor: ' + e.message);
  process.exit(1);
});
process.on('SIGINT', () => { registrar('Servidor detenido.'); process.exit(0); });
