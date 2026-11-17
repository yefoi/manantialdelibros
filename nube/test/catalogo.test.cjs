'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os');const path = require('node:path');
const { Catalogo }=require('../catalogo.cjs'); const { Independiente }=require('../proveedores.cjs'); const { revision, cleanBook }=require('../modelo.cjs');
function fixture(t,provider){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'manantial-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return new Catalogo(provider||new Independiente(dir),dir,'test');}
test('Las fichas y el historial sobreviven al reinicio',async t=>{const c=fixture(t);await c.sync();const b=await c.add({titulo:'Libro',estado:'Disponible'});await c.patch(b.id,{estado:'Prestado'},b._revision);const next=new Catalogo(new Independiente(c.dataDir),c.dataDir,'test');assert.equal(next.state.libros[0].estado,'Prestado');assert.equal(next.state.historial.length,2);});
test('Una edición obsoleta no pisa cambios posteriores y puede deshacerse',async t=>{const c=fixture(t);const b=await c.add({titulo:'Libro'});await c.patch(b.id,{estado:'Prestado'},b._revision);await assert.rejects(c.patch(b.id,{estado:'Donado'},b._revision),e=>e.status===409);const h=c.state.historial[0];await c.undo(h.id);assert.equal(c.get(b.id).estado,'Disponible');});
test('Deshacer no revierte un campo ajeno editado desde la hoja',async t=>{
  const original={...cleanBook({titulo:'Libro',autor:'Antes',estado:'Disponible'}),id:'uno'};
  const provider={name:'Test',listMedia:async()=>[],listBooks:async()=>[original],patch:async(id,patch)=>({...original,autor:'Desde Excel',...patch})};const c=fixture(t,provider);await c.sync();await c.patch('uno',{estado:'Prestado'},revision(original));const h=c.state.historial[0];assert.equal(h.antes.autor,'Desde Excel');assert.equal(h.despues.autor,'Desde Excel');
});
test('Un error de sincronización conserva el último catálogo válido',async t=>{let fail=false;const b={...cleanBook({titulo:'Libro'}),id:'uno'};const c=fixture(t,{name:'Test',listMedia:async()=>[],listBooks:async()=>{if(fail)throw new Error('Sin conexión');return[b];}});await c.sync();fail=true;await assert.rejects(c.sync(),/Sin conexión/);assert.equal(c.get('uno').titulo,'Libro');assert.match(c.lastError,/conexión/);});
test('Un volumen no se reutiliza silenciosamente para otra fuente',async t=>{const c=fixture(t);await c.sync();assert.throws(()=>new Catalogo(c.provider,c.dataDir,'otra'),/otra alternativa/);});
