'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { cleanBook, writeExcel, readExcel, rowsToBooks, HEADERS, bookToRow, revision } = require('../modelo.cjs');
const sample = () => ({ ...cleanBook({ titulo: 'El río', autor: 'Autora', estado: 'Disponible', estanteria: '0', fechaEntrada: '2026-11-17', portadas: ['río 01.jpg'] }), id: 'r2' });
test('El Excel preparado conserva IDs, estantería cero, fechas y asociaciones', async () => {
  const book = sample(), buffer = await writeExcel([book]), loaded = await readExcel(buffer);
  assert.equal(loaded[0].id, 'r2'); assert.equal(loaded[0].estanteria, '0'); assert.equal(loaded[0].fechaEntrada, '2026-11-17'); assert.deepEqual(loaded[0].portadas, ['río 01.jpg']); assert.equal(revision(loaded[0]), revision(book));
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buffer); assert.ok(wb.getWorksheet('Catalogo').getTable('Catalogo')); assert.equal(wb.getWorksheet('Catalogo').getCell('L1').value, 'ID_WEB');
});
test('Importa el esquema original A:K y asigna identificadores únicos', async () => {
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Original'); ws.addRow(HEADERS.slice(0, 11));
  ws.addRow(['El','río','Autora','','Novela',0,'2','PRESTADO',46343,'','']); ws.addRow(['El','río','Autora','','Novela',0,'2','Disponible']);
  const loaded = await readExcel(Buffer.from(await wb.xlsx.writeBuffer())); assert.equal(loaded.length, 2); assert.equal(loaded[0].titulo, 'El río'); assert.equal(loaded[0].estanteria, '0'); assert.notEqual(loaded[0].id, loaded[1].id); assert.match(loaded[0].fechaEntrada, /^2026-/);
});
test('Rechaza esquema externo incorrecto e IDs duplicados antes de reemplazar el catálogo', () => {
  const row = bookToRow(sample()); assert.throws(() => rowsToBooks([HEADERS, row, row]), /duplicado/); assert.throws(() => rowsToBooks([HEADERS.slice(0,11), row]), /19 columnas/);
});
test('Los textos que parecen fórmulas se exportan como texto', async () => {
  const b = sample(); b.titulo = '=HYPERLINK("https://example.com")'; const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await writeExcel([b])); assert.equal(wb.getWorksheet('Catalogo').getCell('B2').type, ExcelJS.ValueType.String);
});
test('Rechaza archivos sin ZIP válido', async () => { await assert.rejects(readExcel(Buffer.from('No es un excel')), /válido/); });
