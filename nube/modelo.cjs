'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');

const HEADERS = ['ARTICULO', 'TITULO', 'AUTOR', 'EDITORIAL', 'SIGNATURA', 'ESTANTERIA', 'BALDA', 'ESTADO', 'F_ENTRADA', 'F_SALIDA', 'OBSERVACIONES', 'ID_WEB', 'PAGINAS', 'SINOPSIS', 'GENERO', 'FECHA_PUBLICACION', 'PORTADAS', 'CONTRAPORTADAS', 'INFO_ARCHIVO'];
const FIELDS = ['articulo', 'titulo', 'autor', 'editorial', 'signatura', 'estanteria', 'balda', 'estado', 'fechaEntrada', 'fechaSalida', 'observaciones', 'id', 'paginas', 'sinopsis', 'genero', 'fechaPublicacion', 'portadas', 'contraportadas', 'infoArchivo'];
const ESTADOS = ['', 'Disponible', 'Prestado', 'Donado'];
const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const keyTitle = s => norm(s).replace(/^(el|la|los|las|un|una|unos|unas) /, '').replace(/ (el|la|los|las|un|una)$/, '');
function error(message, status = 400) { return Object.assign(new Error(message), { status }); }
function safeName(s) { return typeof s === 'string' && s.length > 0 && s.length < 240 && !/[\\/\x00-\x1f]/.test(s) && s !== '.' && s !== '..'; }
function text(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (v && typeof v === 'object') return text(v.result ?? v.text ?? (v.richText || []).map(x => x.text).join(''));
  return String(v ?? '').trim();
}
function date(v) {
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
  return text(v);
}
function names(v) {
  let list = v;
  if (!Array.isArray(list)) { try { list = JSON.parse(v || '[]'); } catch { list = v ? [v] : []; } }
  return [...new Set((Array.isArray(list) ? list : []).filter(safeName))];
}
function cleanBook(input, { partial = false } = {}) {
  const out = {};
  for (const f of FIELDS.filter(f => !['id', 'articulo'].includes(f))) {
    if (partial && !Object.hasOwn(input, f)) continue;
    out[f] = ['portadas', 'contraportadas'].includes(f) ? names(input[f]) : text(input[f]).slice(0, f === 'sinopsis' ? 24000 : 8000);
  }
  if (Object.hasOwn(out, 'titulo') && !out.titulo) throw error('El título es obligatorio.');
  if (Object.hasOwn(out, 'estado') && !ESTADOS.includes(out.estado)) throw error('Estado no válido.');
  if (out.infoArchivo && !safeName(out.infoArchivo)) throw error('Nombre de documento no válido.');
  return out;
}
function rowToBook(row, rowNumber) {
  const data = Object.fromEntries(FIELDS.map((f, i) => [f, row[i] ?? '']));
  data.titulo = text(data.titulo);
  if (!data.titulo || norm(data.titulo) === 'titulo') return null;
  if (text(data.articulo) && !/^(el|la|los|las|un|una|unos|unas|the)\s/i.test(data.titulo)) data.titulo = text(data.articulo) + ' ' + data.titulo;
  data.estado = ESTADOS.find(s => s && norm(data.estado).startsWith(norm(s))) || '';
  data.fechaEntrada = date(data.fechaEntrada); data.fechaSalida = date(data.fechaSalida);
  const libro = cleanBook(data);
  return { ...libro, id: text(data.id), fila: rowNumber };
}
function rowsToBooks(rows, requireIds = true) {
  if (!Array.isArray(rows) || !rows.length) throw error('La hoja no tiene cabecera. Usa la plantilla de la nube.');
  if (requireIds && HEADERS.some((h, i) => norm(rows[0][i]) !== norm(h))) throw error('La hoja debe usar las 19 columnas de la plantilla de la nube (A:S), con ID_WEB en L. Ejecuta npm run nube:preparar.');
  const seen = new Set();
  return rows.slice(1).map((r, i) => rowToBook(r, i + 2)).filter(Boolean).map(b => {
    if (!b.id && !requireIds) b.id = crypto.randomUUID();
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(b.id)) throw error('Hay una fila sin ID_WEB válido. Prepara el Excel antes de conectarlo.');
    if (seen.has(b.id)) throw error('ID_WEB duplicado: cada ejemplar debe tener un ID distinto.');
    seen.add(b.id); return b;
  });
}
function bookToRow(book) {
  return FIELDS.map(f => f === 'articulo' ? '' : ['portadas', 'contraportadas'].includes(f) ? JSON.stringify(book[f] || []) : text(book[f]));
}
function revision(book) {
  return crypto.createHash('sha256').update(JSON.stringify(bookToRow(book))).digest('hex').slice(0, 24);
}
async function readExcel(buffer) {
  // Reject ZIP bombs before ExcelJS decompresses large worksheet/shared-string parts.
  if (buffer.length > 20 * 1024 * 1024) throw error('El Excel supera 20 MB.');
  if (buffer.length < 22) throw error('El archivo no es un Excel .xlsx válido.');
  let p = buffer.length - 22;
  while (p >= Math.max(0, buffer.length - 65557) && buffer.readUInt32LE(p) !== 0x06054b50) p--;
  if (p < Math.max(0, buffer.length - 65557)) throw error('ZIP del Excel no válido.');
  const total = buffer.readUInt16LE(p + 10); let offset = buffer.readUInt32LE(p + 16), unpacked = 0;
  if (total > 10000) throw error('El Excel tiene demasiadas entradas.');
  for (let n = 0; n < total; n++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw error('Índice del Excel no válido.');
    unpacked += buffer.readUInt32LE(offset + 24);
    if (unpacked > 100 * 1024 * 1024) throw error('El Excel descomprimido supera 100 MB.');
    offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet('Catalogo') || wb.worksheets[0];
  if (!ws || ws.rowCount > 50000) throw error('El Excel debe contener una hoja con menos de 50.000 filas.');
  const rows = []; ws.eachRow({ includeEmpty: true }, (r, i) => { rows[i - 1] = HEADERS.map((_, n) => { const c = r.getCell(n + 1); return c.type === ExcelJS.ValueType.Date ? c.value : text(c.value); }); });
  // In legacy A:K sheets Excel numeric dates may be formatted as plain numbers.
  for (const r of rows.slice(1)) for (const i of [8, 9]) if (/^\d{5}(\.\d+)?$/.test(r[i] || '')) r[i] = date(Number(r[i]));
  return rowsToBooks(rows, norm(rows[0]?.[11]) === 'id web');
}
async function writeExcel(books) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'Manantial de Libros';
  const ws = wb.addWorksheet('Catalogo', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.addTable({ name: 'Catalogo', ref: 'A1', headerRow: true, style: { theme: 'TableStyleMedium2', showRowStripes: true }, columns: HEADERS.map(name => ({ name, filterButton: true })), rows: books.map(bookToRow) });
  ws.columns.forEach((c, i) => { c.width = [1, 13].includes(i) ? 50 : 22; });
  ws.getColumn(12).hidden = true;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw error('No se puede leer ' + path.basename(file) + '. Restaura una copia antes de continuar.', 500); }
}
function atomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(obj), { mode: 0o600 }); fs.renameSync(file + '.tmp', file);
}
function assertUnchanged(actual, before, patch) {
  for (const field of Object.keys(patch)) if (JSON.stringify(actual[field] ?? '') !== JSON.stringify(before[field] ?? '')) throw error('Ese libro cambió en la hoja desde que abriste la ficha. Recarga y revisa los datos antes de guardar.', 409);
}
async function docxFields(buffer) {
  if (buffer.length > 5 * 1024 * 1024) throw error('El documento supera 5 MB.');
  const zip = await JSZip.loadAsync(buffer); const f = zip.file('word/document.xml'); if (!f) return {};
  if (f._data?.uncompressedSize > 5 * 1024 * 1024) throw error('El texto descomprimido es demasiado grande.');
  const xml = await f.async('string');
  const plain = xml.replace(/<\/w:p>/g, '\n').replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const alias = { titulo: 'titulo', autor: 'autor', paginas: 'paginas', editorial: 'editorial', sinopsis: 'sinopsis', genero: 'genero', 'fecha de publicacion': 'fechaPublicacion' };
  const out = {}; let current;
  for (const line of plain.split('\n')) { const m = line.match(/^\s*([^:]{3,25}):\s*(.*)$/); if (m && alias[norm(m[1])]) { current = alias[norm(m[1])]; out[current] = m[2]; } else if (current && line.trim()) out[current] += ' ' + line.trim(); }
  return out;
}
module.exports = { HEADERS, FIELDS, ESTADOS, norm, keyTitle, error, safeName, cleanBook, rowsToBooks, bookToRow, revision, readExcel, writeExcel, readJson, atomic, assertUnchanged, docxFields };
