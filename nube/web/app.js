'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
let books = [], session = {}, shown = 60, opened = null, mapMode = false, editingNew = false;
function toast(message, bad = false) { const p = document.createElement('p'); p.textContent = message; if (bad) p.className = 'error'; $('#avisos').append(p); setTimeout(() => p.remove(), 7000); }
async function api(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  const data = await res.json(); if (!res.ok) throw new Error(data.error || 'No se ha podido completar la operación.'); return data;
}
async function task(button, work) { if (button) button.disabled = true; try { await work(); } catch (e) { toast(e.message, true); } finally { if (button) button.disabled = false; } }
const media = (type, name) => '/media/' + type + '/' + encodeURIComponent(name) + '?v=' + encodeURIComponent(session.version || '');
async function reload() {
  session = await api('/api/estado'); books = (await api('/api/libros')).libros;
  $('#acceso').textContent = session.logueado ? 'Gestión' : 'Entrar'; $('#nuevo').hidden = !session.logueado;
  $('#proveedor').textContent = session.proveedor; $('#conexion').hidden = !session.error; $('#conexion').textContent = session.error || '';
  $('#resumen').textContent = books.length + ' libros · ' + books.filter(b => b.estado === 'Disponible').length + ' disponibles';
  const category = $('#categoria').value; $('#categoria').innerHTML = '<option value="">Todas</option>' + [...new Set(books.map(b => b.signatura).filter(Boolean))].sort().map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join(''); $('#categoria').value = category;
  render();
}
function filtered() { const q = norm($('#texto').value); return books.filter(b => (!q || norm([b.titulo, b.autor, b.editorial].join(' ')).includes(q)) && (!$('#estado').value || b.estado === $('#estado').value) && (!$('#categoria').value || b.signatura === $('#categoria').value)).sort((a, b) => a.titulo.localeCompare(b.titulo, 'es')); }
function card(b) {
  const image = b.portadas?.[0];
  return `<button class="tarjeta" data-libro="${esc(b.id)}" aria-label="Ver ${esc(b.titulo)}"><span class="portada ${image ? '' : 'sin'}"><img src="${image ? media('thumb', image) : '/assets/img/logo-libros.png'}" alt="${image ? 'Portada de ' + esc(b.titulo) : ''}" loading="lazy"></span><span class="texto"><b>${esc(b.titulo)}</b><span class="autor">${esc(b.autor || 'Autor sin indicar')}</span><span class="etiqueta ${esc(b.estado)}">${esc(b.estado || 'Sin estado')}</span></span></button>`;
}
function render() {
  const list = filtered(); $('#catalogo').hidden = mapMode; $('#mapa').hidden = !mapMode; $('#vacio').hidden = mapMode || list.length > 0; $('#mas').hidden = mapMode || shown >= list.length;
  $('#verMapa').textContent = mapMode ? 'Catálogo' : 'Estanterías';
  if (!mapMode) { $('#catalogo').innerHTML = list.slice(0, shown).map(card).join(''); return; }
  const shelves = new Map(); for (const b of list.filter(b => b.estado !== 'Donado')) { const key = b.estanteria !== '' ? b.estanteria : 'Sin ubicación'; if (!shelves.has(key)) shelves.set(key, []); shelves.get(key).push(b); }
  $('#estantes').innerHTML = [...shelves].sort(([a], [b]) => a.localeCompare(b, 'es', { numeric: true })).map(([shelf, bs]) => `<details class="estante" open><summary>${shelf === 'Sin ubicación' ? shelf : 'Estantería ' + esc(shelf)} · ${bs.length} libros</summary><div class="balda">${bs.sort((a,b) => a.balda.localeCompare(b.balda, 'es', {numeric:true})).map(b => `<button data-libro="${esc(b.id)}">${b.balda ? 'Balda ' + esc(b.balda) + ' · ' : ''}${esc(b.titulo)} <span class="etiqueta ${esc(b.estado)}">${esc(b.estado)}</span></button>`).join('')}</div></details>`).join('') || '<p class="nota">No hay libros en estas estanterías.</p>';
}
function editor(book) {
  const fields = [['titulo','Título'],['autor','Autor'],['editorial','Editorial'],['signatura','Categoría'],['estanteria','Estantería'],['balda','Balda'],['paginas','Páginas'],['fechaEntrada','Fecha de entrada'],['fechaSalida','Fecha de salida'],['genero','Género'],['fechaPublicacion','Fecha de publicación'],['observaciones','Observaciones']];
  return `<form id="formFicha" class="editor"><h3>${editingNew ? 'Añadir libro' : 'Editar ficha'}</h3><div class="formrejilla">${fields.map(([key,label]) => `<label>${label}<input name="${key}" value="${esc(book[key])}" ${key === 'titulo' ? 'required' : ''}></label>`).join('')}<label>Estado<select name="estado">${['','Disponible','Prestado','Donado'].map(s => `<option ${book.estado === s ? 'selected' : ''} value="${s}">${s || 'Sin estado'}</option>`).join('')}</select></label><label class="ancho">Sinopsis<textarea name="sinopsis" rows="5">${esc(book.sinopsis)}</textarea></label></div><button class="principal">Guardar ficha</button></form>`;
}
function detail(id) {
  const book = books.find(b => b.id === id); if (!book) return;
  opened = structuredClone(book); editingNew = false;
  const images = [...(book.portadas || []), ...(book.contraportadas || [])];
  $('#ficha').innerHTML = `<div class="detalle"><div class="galeria">${images.length ? images.map(n => `<img src="${media('img', n)}" alt="Imagen de ${esc(book.titulo)}">`).join('') : '<img src="/assets/img/logo-libros.png" alt="Sin portada">'}</div><div><span class="etiqueta ${esc(book.estado)}">${esc(book.estado || 'Sin estado')}</span><h2>${esc(book.titulo)}</h2><p>${esc(book.autor)}</p><dl class="meta">${[['Editorial',book.editorial],['Categoría',book.signatura],['Estantería',book.estanteria],['Balda',book.balda],['Páginas',book.paginas]].filter(([,v]) => v !== '').map(([k,v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl><p class="sinopsis">${esc(book.sinopsis || 'Sin sinopsis todavía.')}</p>${book.observaciones ? `<h3>Observaciones</h3><p class="sinopsis">${esc(book.observaciones)}</p>` : ''}${book.infoArchivo ? `<a class="boton" href="${media('doc', book.infoArchivo)}">Descargar documento</a>` : ''}</div></div>${session.logueado ? editor(book) + `<section class="editor archivo"><h3>Portadas y documento</h3>${[['portada','Cambiar portada'],['contraportada','Cambiar contraportada'],['info','Cambiar documento']].map(([type,label]) => `<form class="formMedia"><input type="hidden" name="tipo" value="${type}"><label>${label}<input name="archivo" type="file" accept="${type === 'info' ? '.docx,.txt,.md,.pdf' : '.jpg,.jpeg,.png,.webp'}" required></label><button>Subir ${type === 'info' ? 'documento' : type}</button></form>`).join('')}</section>` : ''}`;
  if (!$('#detalle').open) $('#detalle').showModal();
}
function admin() { $('#importacion').hidden = !session.independiente; $('#estadoNube').textContent = session.proveedor + ' · ' + (session.ultimaSincronizacion ? 'Última comprobación: ' + new Date(session.ultimaSincronizacion).toLocaleString('es-ES') : 'Sin conexión al origen todavía.') + (session.error ? ' · ' + session.error : ''); $('#admin').showModal(); }
document.addEventListener('click', e => {
  const close = e.target.closest('[data-cerrar]'); if (close) $('#' + close.dataset.cerrar).close();
  const book = e.target.closest('[data-libro]'); if (book) detail(book.dataset.libro);
  const undo = e.target.closest('[data-deshacer]'); if (undo) task(undo, async () => { await api('/api/historial/deshacer', { method:'POST', body:JSON.stringify({ id:undo.dataset.deshacer }) }); await reload(); await history(); toast('Cambio deshecho.'); });
});
document.addEventListener('submit', e => {
  if (e.target.id === 'formFicha') { e.preventDefault(); const form = e.target; const changes = Object.fromEntries(new FormData(form)); const snapshot = opened; const adding = editingNew; task(form.querySelector('button'), async () => { const data = await api(adding ? '/api/libros' : '/api/libros/' + snapshot.id, { method:adding ? 'POST':'PATCH', headers:adding ? {} : { 'If-Match':snapshot._revision }, body:JSON.stringify(changes) }); await reload(); detail(data.libro.id); toast('Ficha guardada.'); }); }
  if (e.target.matches('.formMedia')) { e.preventDefault(); const form = e.target, snapshot = opened; task(form.querySelector('button'), async () => { await api('/api/libros/' + snapshot.id + '/media', { method:'POST', headers:{ 'If-Match':snapshot._revision }, body:new FormData(form) }); await reload(); detail(snapshot.id); toast('Archivo guardado.'); }); }
});
$('#formLogin').addEventListener('submit', e => { e.preventDefault(); const form=e.target; $('#errorLogin').textContent=''; task(form.querySelector('button'), async () => { try { await api('/api/login', {method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))}); form.reset(); $('#login').close(); await reload(); if ($('#detalle').open && opened) detail(opened.id); toast('Sesión iniciada.'); } catch(e) { $('#errorLogin').textContent=e.message; } }); });
$('#acceso').addEventListener('click', () => session.logueado ? admin() : $('#login').showModal());
$('#verMapa').addEventListener('click', () => { mapMode=!mapMode; render(); });
$('#busqueda').addEventListener('submit', e => e.preventDefault());
for(const selector of ['#texto','#estado','#categoria']) $(selector).addEventListener('input', () => { shown=60; render(); });
$('#mas').addEventListener('click', () => { shown+=60; render(); });
$('#nuevo').addEventListener('click', () => { editingNew=true; opened=null; $('#ficha').innerHTML='<h2>Un nuevo libro para compartir</h2>'+editor({estado:'Disponible',fechaEntrada:new Date().toISOString().slice(0,10)}); $('#detalle').showModal(); });
$('#sincronizar').addEventListener('click', e => task(e.target, async () => { await api('/api/sync',{method:'POST'}); await reload(); $('#admin').close(); admin(); toast('Catálogo actualizado.'); }));
$('#salir').addEventListener('click', e => task(e.target, async () => { await api('/api/logout',{method:'POST'}); $('#admin').close(); if ($('#detalle').open) $('#detalle').close(); await reload(); }));
$('#formImportar').addEventListener('submit', e => { e.preventDefault(); const form=e.target; task(form.querySelector('button'), async () => { const data=await api('/api/importar',{method:'POST',body:new FormData(form)}); form.reset(); await reload(); toast(data.total+' libros importados.'); }); });
$('#formArchivos').addEventListener('submit', e => { e.preventDefault(); const form=e.target; task(form.querySelector('button'), async () => { const data=await api('/api/archivos',{method:'POST',body:new FormData(form)}); $('#informe').textContent=data.subidos+' archivos subidos; '+data.asociados+' asociados.\n'+data.avisos.join('\n'); form.reset(); await reload(); }); });
async function history() { const data=await api('/api/historial'); $('#historial').innerHTML=data.cambios.map(h => `<div class="historia"><b>${esc(h.titulo || h.accion)}</b><br>${esc(new Date(h.fecha).toLocaleString('es-ES'))} · ${esc(h.accion)}${h.antes&&h.despues&&!h.deshecho ? `<button data-deshacer="${esc(h.id)}">Deshacer</button>` : h.deshecho ? ' · Deshecho' : ''}</div>`).join('') || '<p class="nota">Todavía no hay cambios realizados desde la web.</p>'; }
$('#cargarHistorial').addEventListener('click', e => task(e.target, history));
document.addEventListener('error', e => { if(e.target.tagName==='IMG'&&!e.target.dataset.fallback) {e.target.dataset.fallback='1';e.target.src='/assets/img/logo-libros.png';} },true);
reload().catch(e => {$('#resumen').textContent='No se ha podido cargar el catálogo.';toast(e.message,true);});
setInterval(() => { if (!$('#detalle').open) reload().catch(()=>{}); },30000);
