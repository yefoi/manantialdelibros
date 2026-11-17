'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Microsoft, Google } = require('../proveedores.cjs');
const { HEADERS, cleanBook, bookToRow } = require('../modelo.cjs');
const book = id => ({ ...cleanBook({ titulo: 'Libro ' + id, estado: 'Disponible', autor: 'Autor' }), id });
const response = data => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type':'application/json' } });
const msClient = { getTokenCache: () => ({ getAllAccounts: async () => [{}] }), acquireTokenSilent: async () => ({ accessToken:'test-token' }) };
test('Microsoft localiza por ID tras ordenar y escribe solo las celdas cambiadas', async () => {
  const before=book('uno'), other=book('dos'), calls=[];
  const provider=new Microsoft({ MS_DRIVE_ID:'unidad',MS_EXCEL_ID:'excel',MS_FOLDER_ID:'fotos' },'.',{client:msClient,fetcher:async(url,options)=>{calls.push({url,options}); return response(options.method==='GET'?{address:'Catalogo!A1:S3',values:[HEADERS,bookToRow(other),bookToRow(before)]}:{});}});
  await provider.patch('uno',{estado:'Prestado'},before); const patch=calls.find(c=>c.options.method==='PATCH'); assert.match(patch.url,/A3:S3/); const values=JSON.parse(patch.options.body).values[0]; assert.equal(values[7],'Prestado'); assert.equal(values[1],null); assert.equal(values[11],null);
});
test('Microsoft detecta cambios remotos y no envía un PATCH', async () => {
  const before=book('uno'), remote={...before,estado:'Donado'};let writes=0;
  const provider=new Microsoft({MS_DRIVE_ID:'u',MS_EXCEL_ID:'e',MS_FOLDER_ID:'f'},'.',{client:msClient,fetcher:async(url,o)=>{if(o.method!=='GET')writes++;return response({address:'Catalogo!A1:S2',values:[HEADERS,bookToRow(remote)]});}});
  await assert.rejects(provider.patch('uno',{estado:'Prestado'},before),e=>e.status===409);assert.equal(writes,0);
});
test('Microsoft evita reenviar una alta cuyo ID ya existe', async () => {
  const existing=book('uno');let writes=0;const provider=new Microsoft({MS_DRIVE_ID:'u',MS_EXCEL_ID:'e',MS_FOLDER_ID:'f'},'.',{client:msClient,fetcher:async(url,o)=>{if(o.method!=='GET')writes++;return response({address:'Catalogo!A1:S2',values:[HEADERS,bookToRow(existing)]});}}); await provider.add(existing);assert.equal(writes,0);
});
test('Un enlace de paginación ajeno a Graph nunca recibe el token Microsoft',async()=>{
  let calls=0;const provider=new Microsoft({MS_DRIVE_ID:'u',MS_EXCEL_ID:'e',MS_FOLDER_ID:'f'},'.',{client:msClient,fetcher:async()=>{calls++;return response({value:[],'@odata.nextLink':'https://example.com/steal'});}});await assert.rejects(provider.listMedia(),/inesperado/);assert.equal(calls,1);
});
test('Google guarda texto RAW solo en campos editados y escapa el nombre de pestaña',async()=>{
  const before=book('uno'),calls=[];const provider=new Google({GOOGLE_SHEET_ID:'s',GOOGLE_FOLDER_ID:'f',GOOGLE_SHEET_NAME:"Cat'álogo"},'.',{client:{getAccessToken:async()=>({token:'test-token'})},fetcher:async(url,o)=>{calls.push({url,o});return response(o.method==='GET'?{values:[HEADERS,bookToRow(before)]}:{});}});
  await provider.patch('uno',{titulo:'=Texto literal'},before);const write=calls.find(c=>c.o.method==='POST');const data=JSON.parse(write.o.body);assert.equal(data.valueInputOption,'RAW');assert.equal(data.data.length,2);assert.ok(data.data.some(c=>c.range==="'Cat''álogo'!B2"&&c.values[0][0]==='=Texto literal'));assert.ok(data.data.some(c=>c.range.endsWith('A2')&&c.values[0][0]===''));
});
test('Google pagina las fotos y excluye documentos nativos de Google',async()=>{
  let page=0;const provider=new Google({GOOGLE_SHEET_ID:'s',GOOGLE_FOLDER_ID:'f'},'.',{client:{getAccessToken:async()=>({token:'test-token'})},fetcher:async()=>response(++page===1?{files:[{id:'1',name:'foto.jpg',size:'40',mimeType:'image/jpeg'}],nextPageToken:'next'}:{files:[{id:'2',name:'Documento',mimeType:'application/vnd.google-apps.document'}]})});assert.equal((await provider.listMedia()).length,1);assert.equal(page,2);
});
test('Una fila nueva escrita en Microsoft recibe un ID sin cambiar los existentes',async()=>{
  const row=bookToRow(book('uno'));row[11]='';let ids;
  const provider=new Microsoft({MS_DRIVE_ID:'u',MS_EXCEL_ID:'e',MS_FOLDER_ID:'f'},'.',{client:msClient,fetcher:async(url,o)=>{if(o.method==='PATCH'){ids=JSON.parse(o.body).values;return response({});}return response({address:'Catalogo!A1:S2',values:[HEADERS,row]});}});
  const result=await provider.listBooks();assert.match(result[0].id,/^[a-f0-9-]{36}$/);assert.equal(ids[0][0],result[0].id);
});
test('Google asigna ID a las altas de la hoja antes de incorporarlas al catálogo',async()=>{
  const row=bookToRow(book('uno'));row[11]='';let write;
  const provider=new Google({GOOGLE_SHEET_ID:'s',GOOGLE_FOLDER_ID:'f'},'.',{client:{getAccessToken:async()=>({token:'test-token'})},fetcher:async(url,o)=>{if(o.method==='POST'){write=JSON.parse(o.body);return response({});}return response({values:[HEADERS,row]});}});
  const result=await provider.listBooks();assert.equal(write.data[0].range,"'Catalogo'!L2");assert.equal(write.data[0].values[0][0],result[0].id);
});
