'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { error, cleanBook, revision, readJson, atomic, assertUnchanged, readExcel, safeName, keyTitle, docxFields } = require('./modelo.cjs');
class Catalogo {
  constructor(provider, dataDir, source) {
    this.provider = provider; this.dataDir = dataDir; this.file = path.join(dataDir, 'catalogo-nube.json');
    this.state = readJson(this.file, { source, libros: [], historial: [], generado: new Date().toISOString() });
    if (this.state.source !== source) throw error('Esta carpeta de datos pertenece a otra alternativa o catálogo. Usa un volumen distinto para cada configuración.', 500);
    this.queue = Promise.resolve(); this.files = []; this.lastError = ''; this.lastSync = ''; this.busy = false;
  }
  serial(work) { const result = this.queue.then(work); this.queue = result.catch(() => {}); return result; }
  save() { this.state.generado = new Date().toISOString(); atomic(this.file, this.state); }
  publicBooks() { return this.state.libros.map(b => ({ ...b, _revision: revision(b) })); }
  history(action, before, after) {
    this.state.historial.unshift({ id: crypto.randomUUID(), fecha: new Date().toISOString(), accion: action, titulo: (after || before)?.titulo, libroId: (after || before)?.id, antes: before, despues: after });
    this.state.historial = this.state.historial.slice(0, 400);
  }
  async refresh() {
    this.busy = true;
    try {
      // Validate all external data before replacing the last working snapshot.
      const books = this.provider.listBooks ? await this.provider.listBooks() : this.state.libros;
      const files = await this.provider.listMedia();
      const changed = JSON.stringify(this.state.libros) !== JSON.stringify(books) || JSON.stringify(this.files) !== JSON.stringify(files);
      this.files = files.filter(f => safeName(f.name)); this.state.libros = books;
      this.lastSync = new Date().toISOString(); this.lastError = '';
      if (changed || !fs.existsSync(this.file)) this.save();
      return books;
    } catch (e) { this.lastError = e.message; throw e; }
    finally { this.busy = false; }
  }
  sync() { return this.serial(() => this.refresh()); }
  get(id) { const b = this.state.libros.find(b => b.id === id); if (!b) throw error('Libro no encontrado.', 404); return b; }
  async patchInside(id, changes, expected, action = 'ficha') {
    const patch = cleanBook(changes, { partial: true });
    if (!Object.keys(patch).length) throw error('No hay campos para guardar.');
    if (!expected) throw error('Falta la versión de la ficha. Recarga antes de guardar.', 428);
    const before = this.get(id);
    if (revision(before) !== expected) throw error('Esta ficha ha cambiado. Recarga y revisa los datos.', 409);
    let after;
    if (this.provider.patch) after = await this.provider.patch(id, patch, before);
    else after = { ...before, ...patch };
    this.state.libros[this.state.libros.findIndex(b => b.id === id)] = after;
    // Do not attribute unrelated edits made directly in the sheet to this action.
    const historyBefore = { ...after };
    for (const key of Object.keys(patch)) historyBefore[key] = before[key];
    this.history(action, historyBefore, after); this.save(); return { ...after, _revision: revision(after) };
  }
  patch(id, changes, expected) { return this.serial(() => this.patchInside(id, changes, expected)); }
  add(changes) {
    return this.serial(async () => {
      const book = { ...cleanBook({ estado: 'Disponible', fechaEntrada: new Date().toISOString().slice(0, 10), ...changes }), id: crypto.randomUUID(), fila: 0 };
      if (this.provider.add) await this.provider.add(book);
      this.state.libros.push(book); this.history('alta', null, book); this.save(); return { ...book, _revision: revision(book) };
    });
  }
  import(buffer) {
    return this.serial(async () => {
      if (this.provider.listBooks) throw error('Importa el Excel preparado en OneDrive o Google Sheets. La importación directa corresponde a la alternativa independiente.');
      if (this.state.libros.length) throw error('La importación inicial requiere un catálogo vacío. Conserva una copia y usa un volumen nuevo para sustituir un catálogo completo.', 409);
      const books = await readExcel(buffer); this.state.libros = books; this.history('importacion', null, null); this.save(); return books.length;
    });
  }
  upload(id, type, buffer, ext, expected) {
    return this.serial(async () => {
      const before = this.get(id);
      if (revision(before) !== expected) throw error('La ficha ha cambiado. Recarga antes de subir el archivo.', 409);
      const images = ['.jpg', '.jpeg', '.png', '.webp']; const docs = ['.docx', '.txt', '.md', '.pdf'];
      if (!(type === 'info' ? docs : ['portada', 'contraportada'].includes(type) ? images : []).includes(ext)) throw error('Formato o tipo de archivo no permitido.');
      if (type !== 'info') {
        try { await require('sharp')(buffer, { limitInputPixels: 40000000 }).metadata(); } catch { throw error('La imagen no es válida o es demasiado grande.'); }
      }
      const name = id + '-' + type + '-' + crypto.randomBytes(6).toString('hex') + ext;
      const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }[ext] || 'text/plain';
      const patch = type === 'info' ? { infoArchivo: name } : { [type === 'portada' ? 'portadas' : 'contraportadas']: [name] };
      if (ext === '.docx') {
        const fields = await docxFields(buffer);
        for (const k of ['paginas', 'sinopsis', 'genero', 'fechaPublicacion']) if (fields[k]) patch[k] = fields[k];
      }
      // Files are kept when replaced, so an undo does not depend on a deleted image.
      const file = await this.provider.upload(name, buffer, mime); this.files.push(file);
      return this.patchInside(id, patch, expected, 'archivo');
    });
  }
  bulk(files) {
    return this.serial(async () => {
      const report = { subidos: 0, asociados: 0, avisos: [] };
      for (const file of files) {
        if (!safeName(file.name) || !/\.(jpg|jpeg|png|webp|docx|pdf|txt|md)$/i.test(file.name)) { report.avisos.push(file.name + ': nombre o formato no admitido.'); continue; }
        if (this.files.some(f => f.name === file.name)) { report.avisos.push(file.name + ': ya existe; usa Cambiar archivo en la ficha.'); continue; }
        const uploaded = await this.provider.upload(file.name, file.buffer, 'application/octet-stream'); this.files.push(uploaded); report.subidos++;
        const stem = file.name.replace(/\.[^.]+$/, ''); const match = stem.match(/^(.*?)\s+0?([123])([a-z])?$/i);
        const candidates = this.state.libros.filter(b => ['portadas', 'contraportadas'].some(k => (b[k] || []).includes(file.name)) || b.infoArchivo === file.name);
        // Exact associations imported from the original project take precedence.
        if (candidates.length) { report.asociados++; continue; }
        const byTitle = match ? this.state.libros.filter(b => keyTitle(b.titulo) === keyTitle(match[1])) : [];
        if (byTitle.length !== 1 || match?.[3]) { report.avisos.push(file.name + ': sin asociación inequívoca; asígnalo desde su ficha.'); continue; }
        const b = byTitle[0], field = match[2] === '1' ? 'portadas' : match[2] === '2' ? 'contraportadas' : 'infoArchivo';
        const patch = { [field]: field === 'infoArchivo' ? file.name : [file.name] };
        await this.patchInside(b.id, patch, revision(b), 'archivo'); report.asociados++;
      }
      this.save(); return report;
    });
  }
  undo(id) {
    return this.serial(async () => {
      const item = this.state.historial.find(h => h.id === id);
      if (!item?.antes || !item.despues || item.deshecho) throw error('Este cambio no se puede deshacer.');
      const current = this.get(item.libroId), changes = {};
      for (const k of Object.keys(cleanBook(item.antes))) if (JSON.stringify(item.antes[k]) !== JSON.stringify(item.despues[k])) changes[k] = item.antes[k];
      assertUnchanged(current, item.despues, changes);
      const book = await this.patchInside(current.id, changes, revision(current), 'deshacer'); item.deshecho = true; this.save(); return book;
    });
  }
  referenced(name) { return this.state.libros.some(b => (b.portadas || []).includes(name) || (b.contraportadas || []).includes(name) || b.infoArchivo === name); }
  async media(name, thumbnail = false) {
    if (!safeName(name) || !this.referenced(name)) throw error('Archivo no encontrado.', 404);
    const matches = this.files.filter(f => f.name === name);
    if (matches.length !== 1) throw error(matches.length ? 'Hay varios archivos con el mismo nombre. Renómbralos en la carpeta.' : 'Este archivo no está en la carpeta configurada.', 404);
    const file = matches[0]; if (file.size > 30 * 1024 * 1024) throw error('El archivo supera 30 MB.');
    const key = crypto.createHash('sha256').update(name + ':' + file.tag + ':' + thumbnail).digest('hex');
    const cacheDir = path.join(this.dataDir, 'cache'); fs.mkdirSync(cacheDir, { recursive: true });
    const cacheFile = path.join(cacheDir, key);
    if (fs.existsSync(cacheFile)) return fs.readFileSync(cacheFile);
    let buffer = await this.provider.download(file);
    if (buffer.length > 30 * 1024 * 1024) throw error('El archivo supera 30 MB.');
    if (thumbnail) buffer = await require('sharp')(buffer, { limitInputPixels: 40000000 }).rotate().resize({ width: 320, height: 480, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
    fs.writeFileSync(cacheFile, buffer);
    // Bound generated caches on the persistent volume (originals remain at the provider).
    const entries = fs.readdirSync(cacheDir); if (entries.length > 2000) { const old = entries.map(n => ({ n, t: fs.statSync(path.join(cacheDir, n)).mtimeMs })).sort((a, b) => a.t - b.t); for (const f of old.slice(0, 200)) fs.unlinkSync(path.join(cacheDir, f.n)); }
    return buffer;
  }
}
module.exports = { Catalogo };
