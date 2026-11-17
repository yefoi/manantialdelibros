'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { readJson, readExcel, writeExcel, safeName, keyTitle, docxFields, cleanBook } = require('./modelo.cjs');
async function prepare(args) {
  let books, mediaDirs = [];
  if (args.proyecto) {
    const root = path.resolve(args.proyecto), data = path.join(root, 'datos');
    const base = readJson(path.join(data, 'biblioteca.json'), null);
    if (!base?.libros) throw new Error('Actualiza primero el catálogo de la versión local. Falta datos/biblioteca.json.');
    const changes = readJson(path.join(data, 'cambios.json'), {}), added = readJson(path.join(data, 'nuevos.json'), []);
    const known = new Set(); books = [];
    for (const b of [...base.libros, ...added]) {
      if (known.has(b.id)) continue; known.add(b.id);
      const merged = { ...b, ...changes[b.id] };
      books.push({ ...cleanBook(merged), id: b.id, fila: b.fila || 0 });
    }
    const settings = readJson(path.join(data, 'ajustes.json'), {});
    mediaDirs = [path.join(data, 'subidas'), settings.origenLibros].filter(Boolean);
    console.log('Se prepara una copia del catálogo generado el ' + (base.generado || 'fecha desconocida') + '.');
    const orphan = Object.keys(changes).filter(id => !known.has(id));
    if (orphan.length) throw new Error('Hay cambios sobre ' + orphan.length + ' libros que no están en el catálogo. Revísalos en la versión local antes de migrar.');
  } else if (args.excel) {
    books = await readExcel(fs.readFileSync(path.resolve(args.excel)));
    if (args.fotos) {
      mediaDirs = [path.resolve(args.fotos)];
      for (const name of fs.readdirSync(mediaDirs[0])) {
        if (!safeName(name)) continue;
        const m = name.match(/^(.*?)\s+0?([123])\.(jpg|jpeg|png|webp|docx|pdf|txt|md)$/i);
        if (!m) continue;
        const matches = books.filter(b => keyTitle(b.titulo) === keyTitle(m[1]));
        if (matches.length !== 1) continue;
        const b = matches[0];
        if (m[2] === '1' || m[2] === '2') b[m[2] === '1' ? 'portadas' : 'contraportadas'].push(name);
        else { b.infoArchivo = name; if (/\.docx$/i.test(name)) { const info = await docxFields(fs.readFileSync(path.join(mediaDirs[0], name))); for (const k of ['sinopsis', 'paginas', 'genero', 'fechaPublicacion']) if (info[k]) b[k] = info[k]; } }
      }
    }
  } else throw new Error('Usa --proyecto C:\\manantialdelibros o --excel listado.xlsx [--fotos carpeta].');
  const output = path.resolve(args.salida || '.nube-datos/preparacion');
  if (fs.existsSync(path.join(output, 'manantial-nube.xlsx'))) throw new Error('La salida ya contiene una preparación. Elige otra carpeta --salida.');
  fs.mkdirSync(path.join(output, 'libros FINAL'), { recursive: true });
  const seenIds = new Set();
  for (const book of books) { if (!/^[a-zA-Z0-9_-]{1,80}$/.test(book.id) || seenIds.has(book.id)) throw new Error('Hay identificadores inválidos o duplicados.'); seenIds.add(book.id); }
  fs.writeFileSync(path.join(output, 'manantial-nube.xlsx'), await writeExcel(books));
  const names = new Set(books.flatMap(b => [...b.portadas, ...b.contraportadas, b.infoArchivo].filter(Boolean)));
  let copied = 0; const missing = [];
  for (const name of names) {
    const source = mediaDirs.map(dir => path.join(dir, name)).find(file => fs.existsSync(file));
    if (source) { fs.copyFileSync(source, path.join(output, 'libros FINAL', name)); copied++; } else missing.push(name);
  }
  const report = { libros: books.length, archivosCopiados: copied, archivosSinEncontrar: missing, preparado: new Date().toISOString() };
  fs.writeFileSync(path.join(output, 'informe.json'), JSON.stringify(report, null, 2));
  console.log('Preparado: ' + books.length + ' libros, ' + copied + ' archivos. Faltan ' + missing.length + '.\nSalida: ' + output);
  return report;
}
if (require.main === module) {
  const { values } = parseArgs({ options: { proyecto: { type: 'string' }, excel: { type: 'string' }, fotos: { type: 'string' }, salida: { type: 'string' } } });
  prepare(values).catch(e => { console.error(e.message); process.exitCode = 1; });
}
module.exports = { prepare };
