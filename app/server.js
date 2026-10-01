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
const LOG_PATH = path.join(DATOS, 'registro.log');

const MAX_SUBIDA = 30 * 1024 * 1024;   // 30 MB
const DURACION_SESION = 30 * 24 * 60 * 60 * 1000; // 30 dias

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

function marcarPendienteExcel(id, fila, estado, fecha) {
  const cola = leerColaExcel();
  cola.items = (cola.items || []).filter(i => i.id !== id);
  cola.items.push({ id, fila, estado, fecha: fecha || '' });
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
      if (cambios[it.id]) cambios[it.id]._excelEstado = it.estado;
    }
    escribirJson(CAMBIOS_PATH, cambios);
    escribirColaExcel({ items: [] });
    invalidarCatalogo();
    // el cambio del Excel lo hemos hecho nosotros: que el vigilante no reimporte
    try { firmaConocidaTexto = firmaActual().texto; } catch (e) { }
    registrar('Cambios de estado pasados al Excel: ' + items.length + '.');
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
    cola.items.push({ id, fila: l.fila, estado: c.estado, fecha: c.fechaSalida || '' });
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
  const campos = { titulo: '', autor: '', paginas: '', editorial: '', sinopsis: '', genero: '' };
  const alias = {
    'TITULO': 'titulo', 'TITUTLO': 'titulo', 'TITULO SEGUNDO': 'titulo',
    'AUTOR': 'autor',
    'PAGINA': 'paginas', 'PAGINAS': 'paginas', 'PAGINA S': 'paginas',
    'EDITORIAL': 'editorial', 'EDITORIA': 'editorial', 'EDIORIAL': 'editorial', 'EDITOR': 'editorial',
    'SINOPSIS': 'sinopsis', 'SISNOPSIS': 'sinopsis', 'SIPNOSIS': 'sinopsis', 'SISNOPSI': 'sinopsis', 'RESENAS': 'sinopsis',
    'GENERO': 'genero'
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
    const libro = {
      id, fila: 0, titulo,
      autor: String(datos.autor || '').trim(),
      editorial: String(datos.editorial || '').trim(),
      signatura: String(datos.signatura || '').trim(),
      estanteria: String(datos.estanteria || '').trim(),
      balda: String(datos.balda || '').trim(),
      estado: ['Disponible', 'Prestado', 'Donado'].includes(datos.estado) ? datos.estado : 'Disponible',
      fechaEntrada: new Date().toISOString().slice(0, 10), fechaSalida: '',
      observaciones: String(datos.observaciones || '').trim(),
      portadas: [], contraportadas: [], paginas: String(datos.paginas || '').trim(),
      sinopsis: String(datos.sinopsis || '').trim(), genero: '', infoArchivo: '',
      creado: new Date().toISOString(), origen: 'nuevo'
    };
    const nuevos = leerJson(NUEVOS_PATH, []);
    nuevos.push(libro);
    escribirJson(NUEVOS_PATH, nuevos);
    invalidarCatalogo();
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
      guardarCambio(id, campos);
      // el estado tambien se pasa al Excel (si el libro viene del listado)
      if (campos.estado !== undefined && actual.fila) {
        const despues = buscarLibro(id) || actual;
        marcarPendienteExcel(id, actual.fila, campos.estado, despues.fechaSalida || '');
      }
      registrar('Editado ' + id + ': ' + Object.keys(campos).join(', '));
      return enviarJson(res, 200, { ok: true, libro: buscarLibro(id) });
    }
    if (metodo === 'DELETE') {
      if (!estaLogueado(req)) return enviarError(res, 401, 'Hay que entrar como socio');
      const libro = buscarLibro(id);
      if (!libro) return enviarError(res, 404, 'Libro no encontrado');
      if (libro.origen !== 'nuevo') return enviarError(res, 400, 'Solo se pueden eliminar los libros añadidos desde el sitio');
      let nuevos = leerJson(NUEVOS_PATH, []);
      nuevos = nuevos.filter(l => l.id !== id);
      escribirJson(NUEVOS_PATH, nuevos);
      const cambios = leerJson(CAMBIOS_PATH, {});
      delete cambios[id];
      escribirJson(CAMBIOS_PATH, cambios);
      for (const nombre of [].concat(libro.portadas || [], libro.contraportadas || [], libro.infoArchivo ? [libro.infoArchivo] : [])) {
        try { const p = path.join(SUBIDAS, nombre); if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) { }
        try { const p = path.join(MINIATURAS, nombre + '.jpg'); if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) { }
      }
      invalidarCatalogo();
      registrar('Libro eliminado: ' + id + ' (' + libro.titulo + ')');
      return enviarJson(res, 200, { ok: true });
    }
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

      const nombre = id + '-' + tipoTxt + '-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex') + ext;
      fs.writeFileSync(path.join(SUBIDAS, nombre), archivo.datos);
      const campos = {};
      const campo = tipoTxt === 'portada' ? 'portadas' : tipoTxt === 'contraportada' ? 'contraportadas' : 'infoArchivo';

      if (tipoTxt === 'info') {
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
        const lista = Array.isArray(libro[campo]) ? libro[campo].slice() : [];
        lista.unshift(nombre);
        campos[campo] = lista;
        setTimeout(() => generarMiniatura(nombre), 200);
      }
      guardarCambio(id, campos);
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
      guardarCambio(id, campos);
      try {
        const enSubidas = path.join(SUBIDAS, nombre);
        if (fs.existsSync(enSubidas)) fs.unlinkSync(enSubidas);
      } catch (e) { }
      try {
        const mini = path.join(MINIATURAS, nombre + '.jpg');
        if (fs.existsSync(mini)) fs.unlinkSync(mini);
      } catch (e) { }
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
  registrar('*** Cambios detectados (' + motivo + '): reimportando el catalogo... ***');
  ejecutarPowerShell('importar.ps1', [], (errI) => {
    if (errI) {
      registrar('ERROR al reimportar: ' + String(errI.message || errI).split('\n')[0]);
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
