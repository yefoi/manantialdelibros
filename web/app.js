/* =====================================================================
   Manantial de Libros · aplicación del catálogo
   ===================================================================== */
(function () {
  'use strict';

  const $ = (sel, raiz) => (raiz || document).querySelector(sel);
  const $$ = (sel, raiz) => Array.from((raiz || document).querySelectorAll(sel));
  const LOTE = 60;

  const estado = {
    libros: [],
    sesion: { logueado: false, usuario: '', clavePorDefecto: false },
    filtros: { texto: '', estado: '', signatura: '', orden: 'titulo', soloPortada: false, porCompletar: false },
    visibles: LOTE,
    detalleId: null,
    imagenActiva: 0,
    version: '',
    actualizando: false,
    novedades: { altas: [], bajas: [] },
    diagnostico: { avisos: [], totalArchivos: 0 },
    historial: { cambios: [] }
  };

  /* ------------------------------------------------------------ utilidades */
  const norm = (s) => String(s == null ? '' : s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

  const escap = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const sinArticulo = (t) => String(t || '').replace(/^(el|la|los|las|un|una|unos|unas)\s+/i, '');
  const claveTitulo = (t) => norm(sinArticulo(t));
  // para ordenar por estantería: "0", "1"… y los que no tienen, al final
  const claveEstante = (l) => l.estanteria
    ? String(l.estanteria).padStart(4, '0') + '·' + String(l.balda || '')
    : 'zzzz';
  const urlMedia = (tipo, nombre) => '/media/' + tipo + '/' + encodeURIComponent(nombre) +
    (estado.version ? '?v=' + encodeURIComponent(estado.version) : '');
  const img = (nombre) => urlMedia('thumb', nombre === undefined ? '' : nombre);

  const ETIQUETA_ESTADO = { Disponible: 'Disponible', Prestado: 'Prestado', Donado: 'Donado', '': 'Sin estado' };

  const hoyISO = () => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };

  // "Estantería 7 · 5b"  (la balda 0 significa "sin balda concreta")
  const ubicacion = (l) => l.estanteria
    ? 'Estantería ' + l.estanteria + (l.balda && l.balda !== '0' ? ' · ' + l.balda : '')
    : '';

  function toast(texto, esError) {
    const caja = $('#avisos');
    const el = document.createElement('div');
    el.className = 'toast' + (esError ? ' toast-error' : '');
    el.textContent = texto;
    caja.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2600);
    setTimeout(() => el.remove(), 3000);
  }

  async function api(ruta, opciones) {
    const res = await fetch(ruta, Object.assign({ headers: {} }, opciones));
    let datos = null;
    try { datos = await res.json(); } catch (e) { /* sin cuerpo */ }
    if (!res.ok) throw new Error((datos && datos.error) || ('Error ' + res.status));
    return datos;
  }

  /* ------------------------------------------------------------ tarjeta */
  function tarjetaHTML(l) {
    const portada = (l.portadas && l.portadas.length) ? l.portadas[0] : null;
    const claseInsignia = 'insignia insignia-' + (l.estado || 'vacia');
    const pie = [l.signatura, l.estanteria ? ubicacion(l).replace('Estantería ', 'Est. ') : '', l.observaciones || '']
      .filter(Boolean).join(' · ');
    return `
      <button class="tarjeta" data-id="${escap(l.id)}" type="button">
        <span class="tarjeta-portada">
          ${portada
            ? `<img src="${img(portada)}" alt="Portada de ${escap(l.titulo)}" loading="lazy"
                 onerror="this.onerror=null;this.src='${urlMedia('img', portada)}'">`
            : `<span class="tarjeta-sinPortada"><img src="/img/logo-libros.png" alt=""><small>Sin portada</small></span>`}
          <span class="${claseInsignia}"><i></i>${escap(ETIQUETA_ESTADO[l.estado] || l.estado)}</span>
          ${l.origen === 'nuevo' ? '<span class="insignia insignia-nuevo">Nuevo</span>'
            : l.origen === 'carpeta' ? '<span class="insignia insignia-nuevo">Por completar</span>' : ''}
        </span>
        <span class="tarjeta-texto">
          <span class="tarjeta-titulo">${escap(l.titulo)}</span>
          ${l.autor ? `<span class="tarjeta-autor">${escap(l.autor)}</span>` : ''}
          ${pie ? `<span class="tarjeta-pie">${escap(pie)}</span>` : ''}
        </span>
      </button>`;
  }

  /* ------------------------------------------------------------ filtrado */
  function filtra() {
    const f = estado.filtros;
    const texto = norm(f.texto);
    const palabras = texto ? texto.split(/\s+/) : [];
    let lista = estado.libros.filter((l) => {
      if (f.estado && (l.estado || '') !== f.estado) return false;
      if (f.signatura && (l.signatura || '') !== f.signatura) return false;
      if (f.soloPortada && !(l.portadas && l.portadas.length)) return false;
      if (f.porCompletar && l.origen !== 'carpeta') return false;
      if (palabras.length) {
        const pajar = norm([l.titulo, l.autor, l.editorial, l.sinopsis, l.signatura, l.estanteria, l.balda, l.observaciones].join(' '));
        for (const p of palabras) if (!pajar.includes(p)) return false;
      }
      return true;
    });

    const cmp = {
      titulo: (a, b) => claveTitulo(a.titulo).localeCompare(claveTitulo(b.titulo), 'es'),
      autor: (a, b) => String(a.autor || 'zzz').localeCompare(String(b.autor || 'zzz'), 'es'),
      estanteria: (a, b) => claveEstante(a).localeCompare(claveEstante(b), 'es'),
      listado: () => 0,
      recientes: (a, b) => String(b.creado || b.fechaEntrada || '').localeCompare(String(a.creado || a.fechaEntrada || ''))
    }[f.orden];
    if (cmp) lista.sort(cmp);
    return lista;
  }

  function pintar(desdeCero) {
    if (desdeCero) estado.visibles = LOTE;
    const lista = filtra();
    const trozo = lista.slice(0, estado.visibles);
    $('#rejilla').innerHTML = trozo.map(tarjetaHTML).join('');
    $('#vacio').hidden = lista.length > 0;
    $('#btnMas').hidden = lista.length <= estado.visibles;
    $('#contador').textContent = lista.length
      ? lista.length.toLocaleString('es-ES') + (lista.length === 1 ? ' libro' : ' libros')
        + (lista.length > estado.visibles ? ' · mostrando ' + trozo.length : '')
      : '';
  }

  function pintarFranja() {
    const pendientes = estado.libros.filter((l) => l.origen === 'carpeta').length;
    const franja = $('#franja');
    if (!pendientes) { franja.hidden = true; return; }
    franja.hidden = false;
    $('#franjaTexto').textContent =
      'Hay ' + pendientes + ' libros que estaban fotografiados pero no aparecían en el listado del Excel, así que se crearon como fichas nuevas. Revísalas y complétalas cuando puedas.';
    $('#btnPorCompletar').textContent = estado.filtros.porCompletar ? 'Ver todo el catálogo' : 'Ver solo esas fichas';
    $('#btnPorCompletar').classList.toggle('boton-principal', estado.filtros.porCompletar);
  }

  function pintarPortadaDatos() {
    const libs = estado.libros;
    const cuenta = (e) => libs.filter((l) => l.estado === e).length;
    const conPortada = libs.filter((l) => l.portadas && l.portadas.length).length;
    $('#datosPortada').innerHTML =
      '<b>' + libs.length.toLocaleString('es-ES') + '</b> libros en el catálogo · ' +
      '<b class="n-disponible">' + cuenta('Disponible').toLocaleString('es-ES') + '</b> disponibles · ' +
      (cuenta('Prestado') ? '<b class="n-prestado">' + cuenta('Prestado').toLocaleString('es-ES') + '</b> prestados · ' : '') +
      '<b class="n-donado">' + cuenta('Donado').toLocaleString('es-ES') + '</b> donados · ' +
      '<b>' + conPortada.toLocaleString('es-ES') + '</b> con portada';
    $('#pieNota').textContent = 'Catálogo con ' + libs.length.toLocaleString('es-ES') + ' libros. Los socios pueden actualizar estados y subir portadas e información.';
  }

  function pintarFiltrosCategoria() {
    const conteo = new Map();
    for (const l of estado.libros) {
      const s = l.signatura || '';
      if (!s) continue;
      conteo.set(s, (conteo.get(s) || 0) + 1);
    }
    const opciones = Array.from(conteo.entries()).sort((a, b) => b[1] - a[1]);
    $('#selSignatura').innerHTML = '<option value="">Todas las categorías</option>' +
      opciones.map(([s, n]) => `<option value="${escap(s)}">${escap(s)} (${n})</option>`).join('');
    $('#listaSignaturas').innerHTML = opciones.map(([s]) => `<option value="${escap(s)}">`).join('');
  }

  /* ------------------------------------------------------------ detalle */
  function imagenesDe(l) {
    const lista = [];
    for (const n of (l.portadas || [])) lista.push({ nombre: n, tipo: 'Portada' });
    for (const n of (l.contraportadas || [])) lista.push({ nombre: n, tipo: 'Contraportada' });
    return lista;
  }

  function abrirDetalle(id) {
    const l = estado.libros.find((x) => x.id === id);
    if (!l) return;
    estado.detalleId = id;
    estado.imagenActiva = 0;
    pintarDetalle();
    const panel = $('#panelDetalle');
    if (!panel.open) panel.showModal();
    if (location.hash !== '#libro/' + id) history.replaceState(null, '', '#libro/' + id);
  }

  function cerrarDetalle() {
    const panel = $('#panelDetalle');
    if (panel.open) panel.close();
    estado.detalleId = null;
    if (location.hash) history.replaceState(null, '', location.pathname);
  }

  function pintarDetalle() {
    const l = estado.libros.find((x) => x.id === estado.detalleId);
    if (!l) return;
    const imagenes = imagenesDe(l);
    const activa = imagenes[estado.imagenActiva] || imagenes[0];
    const socio = estado.sesion.logueado;

    const meta = [
      l.autor ? ['Autor', l.autor] : null,
      l.editorial ? ['Editorial', l.editorial] : null,
      l.signatura ? ['Categoría', l.signatura] : null,
      l.estanteria ? ['Ubicación', ubicacion(l)] : null,
      l.paginas ? ['Páginas', l.paginas] : null,
      l.genero ? ['Género', l.genero] : null,
      l.fechaEntrada ? ['Entrada', l.fechaEntrada] : null,
      l.fechaSalida && l.estado === 'Donado' ? ['Donado el', l.fechaSalida] : null
    ].filter(Boolean);

    $('#detEtiqueta').textContent = (l.origen === 'listado' ? 'Ficha del listado' : l.origen === 'nuevo' ? 'Añadido por los socios' : 'Por completar') +
      (l.fila ? ' · línea ' + l.fila : '');

    $('#detCuerpo').innerHTML = `
      <div class="detalle">
        <div class="detalle-imagenes">
          <div class="detalle-principal">
            ${activa
              ? `<img id="detImagen" src="${urlMedia('img', activa.nombre)}" alt="${escap(activa.tipo)} de ${escap(l.titulo)}"
                   onerror="this.onerror=null;this.src='${img(activa.nombre)}'">`
              : `<span class="tarjeta-sinPortada"><img src="/img/logo-libros.png" alt=""><small>Sin imágenes</small></span>`}
          </div>
          <div class="detalle-miniaturas" id="detMiniaturas">
            ${imagenes.map((im, i) => `
              <button class="${i === estado.imagenActiva ? 'activa' : ''}" data-indice="${i}" title="${escap(im.tipo)}">
                <img src="${img(im.nombre)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${urlMedia('img', im.nombre)}'">
                ${socio ? `<span class="quitar" data-quitar="${escap(im.nombre)}" title="Quitar imagen">×</span>` : ''}
              </button>`).join('')}
          </div>
          <p class="nota">${imagenes.length ? imagenes.length + ' imagen(es) disponibles' : 'Este libro todavía no tiene foto'}</p>
        </div>

        <div class="detalle-info">
          <h2>${escap(l.titulo)}</h2>
          ${l.autor ? `<p class="detalle-autor">${escap(l.autor)}</p>` : ''}
          <p class="estado-linea"><span class="insignia insignia-${l.estado || 'vacia'}"><i></i>${escap(ETIQUETA_ESTADO[l.estado] || l.estado)}</span></p>

          ${meta.length ? `<dl class="detalle-meta">${meta.map(([k, v]) => `<div><dt>${escap(k)}</dt><dd>${escap(v)}</dd></div>`).join('')}</dl>` : ''}
          ${l.sinopsis ? `<p class="detalle-sinopsis">${escap(l.sinopsis)}</p>` : '<p class="detalle-sinopsis nota">Sin sinopsis todavía.</p>'}
          <div class="detalle-seccion">
            <h3>Observaciones</h3>
            <p class="detalle-observaciones ${l.observaciones ? '' : 'vacia'}">${l.observaciones ? escap(l.observaciones) : 'Sin observaciones'}</p>
          </div>
          ${l.infoArchivo ? `<a class="enlace-doc" href="${urlMedia('doc', l.infoArchivo)}" target="_blank" rel="noopener">Ver la ficha original (${escap(l.infoArchivo)})</a>` : ''}

          <div class="detalle-seccion solo-socios-detalle">
            <h3>Cambiar el estado</h3>
            <div class="estados">
              ${['Disponible', 'Prestado', 'Donado'].map((e) =>
                `<button data-estado="${e}" class="${l.estado === e ? 'activo' : ''}"><i class="punto punto-${e.toLowerCase()}"></i>${e}</button>`).join('')}
            </div>
          </div>

          <div class="detalle-seccion solo-socios-detalle">
            <h3>Portadas e información</h3>
            <div class="detalle-acciones">
              <label class="boton boton-contorno">Cambiar portada
                <input type="file" accept="image/*" data-subir="portada" hidden></label>
              <label class="boton boton-contorno">Añadir contraportada
                <input type="file" accept="image/*" data-subir="contraportada" hidden></label>
              <label class="boton boton-contorno">Subir info (.docx, .txt, .pdf)
                <input type="file" accept=".docx,.doc,.txt,.md,.pdf,application/pdf" data-subir="info" hidden></label>
              <button class="boton boton-contorno" id="btnEditarFicha">Editar ficha</button>
              ${l.origen === 'nuevo' ? `<button class="boton boton-contorno" id="btnExportarLibro"
                title="Anade su fila al Excel y copia a la carpeta la portada, la contraportada y el documento">Exportar al listado</button>` : ''}
            </div>
            <div id="editorFicha" hidden></div>
          </div>
        </div>
      </div>`;
  }

  function editorFicha(l) {
    return `
      <form class="formulario" id="formEditar" style="margin-top:16px">
        <div class="formulario-rejilla">
          <label class="campo ancho"><span>Título</span><input type="text" name="titulo" value="${escap(l.titulo)}"></label>
          <label class="campo"><span>Autor</span><input type="text" name="autor" value="${escap(l.autor || '')}"></label>
          <label class="campo"><span>Editorial</span><input type="text" name="editorial" value="${escap(l.editorial || '')}"></label>
          <label class="campo"><span>Categoría</span><input type="text" name="signatura" value="${escap(l.signatura || '')}" list="listaSignaturas"></label>
          <label class="campo"><span>Estantería</span><input type="text" name="estanteria" value="${escap(l.estanteria || '')}"></label>
          <label class="campo"><span>Balda</span><input type="text" name="balda" value="${escap(l.balda || '')}"></label>
          <label class="campo"><span>Páginas</span><input type="text" name="paginas" value="${escap(l.paginas || '')}"></label>
          <label class="campo ancho"><span>Sinopsis</span><textarea name="sinopsis" rows="5">${escap(l.sinopsis || '')}</textarea></label>
          <label class="campo ancho"><span>Observaciones</span><input type="text" name="observaciones" value="${escap(l.observaciones || '')}"></label>
        </div>
        <p class="error" id="editarError" hidden></p>
        <div class="formulario-acciones">
          <button class="boton boton-peligro" type="button" id="btnBorrarLibro" hidden>Eliminar del catálogo</button>
          <button class="boton boton-contorno" type="button" id="btnCancelarEdicion">Cancelar</button>
          <button class="boton boton-principal" type="submit">Guardar</button>
        </div>
      </form>`;
  }

  async function guardarLibro(id, campos) {
    const res = await api('/api/libros/' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(campos)
    });
    const i = estado.libros.findIndex((x) => x.id === id);
    if (i >= 0 && res.libro) estado.libros[i] = Object.assign(estado.libros[i], res.libro);
    return res;
  }

  async function subirArchivo(id, tipo, archivo) {
    const fd = new FormData();
    fd.append('tipo', tipo);
    fd.append('archivo', archivo, archivo.name);
    const res = await api('/api/libros/' + encodeURIComponent(id) + '/media', { method: 'POST', body: fd });
    const i = estado.libros.findIndex((x) => x.id === id);
    if (i >= 0 && res.libro) estado.libros[i] = Object.assign(estado.libros[i], res.libro);
    return res.libro;
  }

  /* ------------------------------------------------------------ sesión */
  function pintarSesion() {
    const s = estado.sesion;
    document.body.classList.toggle('socio', s.logueado);
    $('#btnAcceso').textContent = s.logueado ? (s.usuario || 'Socio') : 'Entrar';
    $('#btnNuevoLibro').hidden = !s.logueado;
    $('#btnAjustes').hidden = !s.logueado;
    $('#btnRevision').hidden = !s.logueado;
    $('#btnHistorial').hidden = !s.logueado;
    $('#avisoClave').hidden = !s.clavePorDefecto;
    $('#ajusteUsuario').value = s.usuario || '';
  }

  /* ------------------------------------------- rutas y explorador de carpetas */
  let explorarTipo = 'carpeta';
  let explorarDestino = '';

  function abrirAjustes() {
    $('#panelAjustes').showModal();
    cargarRutas();
    cargarSalud();
    $('#ajusteActual').focus();
  }

  async function cargarRutas() {
    try {
      const r = await api('/api/rutas');
      $('#rutaExcel').value = r.origenExcel || '';
      $('#rutaLibros').value = r.origenLibros || '';
      $('#chkVigilar').checked = r.vigilar !== false;
      $('#rutasEstado').textContent = (r.existeExcel ? '✓ Listado encontrado' : '✗ No encuentro el listado') +
        '   ·   ' + (r.existeLibros ? '✓ Carpeta encontrada' : '✗ No encuentro la carpeta');
    } catch (e) { /* sin sesion */ }
  }

  async function abrirExplorador(tipo) {
    explorarTipo = tipo;
    $('#explorarTitulo').textContent = tipo === 'archivo' ? 'Elegir el archivo del listado' : 'Elegir la carpeta de fotos';
    $('#btnExplorarElegir').hidden = tipo === 'archivo';
    $('#panelExplorar').showModal();
    const inicio = tipo === 'archivo' ? $('#rutaExcel').value : $('#rutaLibros').value;
    await explorar(inicio || '');
  }

  async function explorar(ruta) {
    let datos;
    try {
      datos = await api('/api/explorar?tipo=' + encodeURIComponent(explorarTipo) + '&ruta=' + encodeURIComponent(ruta || ''));
    } catch (e) { toast(e.message, true); return; }
    explorarDestino = datos.ruta || '';
    $('#explorarRuta').textContent = datos.ruta || 'Este equipo';
    $('#btnExplorarArriba').disabled = !datos.padre;
    $('#btnExplorarArriba').dataset.padre = datos.padre || '';
    if (!datos.ruta) {
      $('#explorarResumen').textContent = 'Elige una unidad para empezar.';
    } else {
      $('#explorarResumen').textContent = 'Esta carpeta tiene ' + datos.archivos + ' archivos' +
        (datos.subcarpetas ? ' y ' + datos.subcarpetas + ' subcarpetas' : ' y ninguna subcarpeta') +
        (explorarTipo === 'archivo' ? ' · Archivos .xlsx encontrados: ' + datos.entradas.length : '');
    }
    $('#explorarLista').innerHTML = datos.entradas.length
      ? datos.entradas.map((e) => `
        <button class="explorar-item ${e.d ? 'carpeta' : 'archivo'}" type="button" data-ruta="${escap(e.r)}" data-carpeta="${e.d ? 1 : 0}">
          <span class="icono">${e.d ? '📁' : '📄'}</span>
          <span>${escap(e.n)}</span>
          ${e.d ? '' : '<span class="detalle">' + Math.round(e.t / 1024) + ' KB</span>'}
        </button>`).join('')
      : '<p class="explorar-vacio">' +
        (explorarTipo === 'carpeta'
          ? 'No hay subcarpetas dentro. Si esta es la carpeta correcta, pulsa «Elegir esta carpeta».'
          : 'No hay archivos .xlsx en esta carpeta.') + '</p>';
  }

  async function abrirEnWindows(ruta) {
    if (!ruta) return;
    try { await api('/api/abrir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ruta }) }); }
    catch (e) { toast(e.message, true); }
  }

  /* ------------------------------------------- revision del catalogo */
  let revisionGrupo = 'sinFoto';

  const GRUPOS_REVISION = [
    { id: 'altas', nombre: 'Nuevos en el listado' },
    { id: 'bajas', nombre: 'Ya no están' },
    { id: 'sinFoto', nombre: 'Sin foto' },
    { id: 'sinUbicacion', nombre: 'Sin ubicación' },
    { id: 'incompletos', nombre: 'Ficha incompleta' },
    { id: 'sinEstado', nombre: 'Sin estado' }
  ];

  function librosDeGrupo(g) {
    const L = estado.libros;
    const nov = estado.novedades || { altas: [], bajas: [] };
    if (g === 'altas') return (nov.altas || []).map((a) => L.find((l) => l.id === a.id) || a);
    if (g === 'bajas') return (nov.bajas || []).map((b) => Object.assign({ titulo: b.titulo, autor: b.autor, _baja: true }, b));
    if (g === 'sinFoto') return L.filter((l) => !(l.portadas && l.portadas.length));
    if (g === 'sinUbicacion') return L.filter((l) => !l.estanteria);
    if (g === 'incompletos') return L.filter((l) => !l.autor && !l.editorial);
    if (g === 'sinEstado') return L.filter((l) => !l.estado);
    return [];
  }

  function revisionLista() {
    const texto = norm($('#revisionBuscar').value);
    const est = $('#revisionEstanteria').value;
    const estFiltro = $('#revisionEstado').value;
    let lista = librosDeGrupo(revisionGrupo);
    if (estFiltro) {
      lista = estFiltro === '__sin__' ? lista.filter((l) => !l.estado) : lista.filter((l) => l.estado === estFiltro);
    }
    if (texto) lista = lista.filter((l) => norm([l.titulo, l.autor, l.editorial, l.signatura].join(' ')).includes(texto));
    if (est) lista = lista.filter((l) => String(l.estanteria || '') === est);
    return lista.slice().sort((a, b) => {
      const ua = String(a.estanteria || '') + '·' + String(a.balda || '');
      const ub = String(b.estanteria || '') + '·' + String(b.balda || '');
      if (ua !== ub) return ua.localeCompare(ub, 'es');
      return claveTitulo(a.titulo || '').localeCompare(claveTitulo(b.titulo || ''), 'es');
    });
  }

  function pintarRevision() {
    const nov = estado.novedades || { altas: [], bajas: [], primeraVez: true, generado: '' };
    $('#revisionResumen').textContent = nov.primeraVez
      ? 'Todavía no hay una importación anterior con la que comparar. A partir de la próxima verás aquí los libros nuevos y los que desaparecen.'
      : 'Última comparación: ' + String(nov.generado || '').replace('T', ' ').slice(0, 16) + ' · ' +
        (nov.altas || []).length + ' libros nuevos y ' + (nov.bajas || []).length + ' que ya no están en el listado.';

    $('#revisionGrupos').innerHTML = GRUPOS_REVISION.map((g) => {
      const n = (g.id === 'altas' || g.id === 'bajas') ? (nov[g.id] || []).length : librosDeGrupo(g.id).length;
      return '<button type="button" data-grupo="' + g.id + '" class="' + (g.id === revisionGrupo ? 'activa' : '') + '">' +
        g.nombre + ' <b>' + n.toLocaleString('es-ES') + '</b></button>';
    }).join('');

    const sel = $('#revisionEstanteria');
    const ests = Array.from(new Set(librosDeGrupo(revisionGrupo).map((l) => String(l.estanteria || '')).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, 'es'));
    const elegida = sel.value;
    sel.innerHTML = '<option value="">Todas</option>' + ests.map((e) => '<option value="' + escap(e) + '">' + escap(e) + '</option>').join('');
    if (ests.includes(elegida)) sel.value = elegida;

    const lista = revisionLista();
    const trozo = lista.slice(0, 300);
    $('#revisionContador').textContent = lista.length
      ? lista.length.toLocaleString('es-ES') + (lista.length === 1 ? ' libro' : ' libros') +
        (lista.length > trozo.length ? ' · mostrando los primeros ' + trozo.length : '')
      : (librosDeGrupo(revisionGrupo).length ? 'Ningún libro coincide con el filtro.' : '');

    // pista: recordar cuantos de la lista estan donados (ya no estan en las estanterias)
    const pista = $('#revisionPista');
    const todos = librosDeGrupo(revisionGrupo);
    const donados = todos.filter((l) => l.estado === 'Donado').length;
    if (!$('#revisionEstado').value && !$('#revisionBuscar').value && donados >= 20 && donados < todos.length &&
        (revisionGrupo === 'sinFoto' || revisionGrupo === 'sinUbicacion' || revisionGrupo === 'incompletos')) {
      pista.hidden = false;
      pista.textContent = 'De estos ' + todos.length.toLocaleString('es-ES') + ' hay ' + donados.toLocaleString('es-ES') +
        ' que están donados (ya se regalaron, por eso no tienen foto ni estantería) y ' +
        (todos.length - donados).toLocaleString('es-ES') + ' que sí pueden necesitar atención. ' +
        'Elige «Disponible» en el filtro de estado para ver solo esos.';
    } else {
      pista.hidden = true;
    }

    $('#revisionLista').innerHTML = trozo.length ? trozo.map((l) => {
      const etiqueta = l.id ? 'button' : 'div';
      const donde = [l.estanteria ? ubicacion(l).replace('Estantería ', 'Est. ') : '', l.estado || '', l._baja ? 'venía ' + (l.veces || 1) + ' vez/veces' : '']
        .filter(Boolean).join(' · ');
      return '<' + etiqueta + ' class="revision-fila ' + (l.id ? 'pulsable' : '') + '" ' +
        (l.id ? 'type="button" data-id="' + escap(l.id) + '"' : '') + '>' +
        '<span class="texto"><span class="titulo">' + escap(l.titulo || '') + '</span>' +
        '<span class="sub">' + escap([l.autor, l.editorial, l.observaciones].filter(Boolean).join(' · ')) + '</span></span>' +
        '<span class="donde">' + escap(donde) + '</span></' + etiqueta + '>';
    }).join('') : '<p class="revision-vacio">No hay libros en esta lista.</p>';

    pintarDiagnostico();
  }

  /* ------------------------------------------- diagnostico de archivos */
  function diagnosticoFila(it) {
    const etiqueta = it.id ? 'button' : 'div';
    return '<' + etiqueta + ' class="revision-fila ' + (it.id ? 'pulsable' : '') + '" ' +
      (it.id ? 'type="button" data-id="' + escap(it.id) + '"' : '') + '>' +
      '<span class="texto"><span class="titulo">' + escap(it.texto || '') + '</span>' +
      (it.detalle ? '<span class="sub">' + escap(it.detalle) + '</span>' : '') + '</span></' + etiqueta + '>';
  }

  function pintarDiagnostico() {
    const caja = $('#diagnosticoCaja');
    if (!caja) return;
    caja.hidden = false;
    const diag = estado.diagnostico || { avisos: [], totalArchivos: 0 };
    const avisos = (diag.avisos || []).filter((a) => (a.items || []).length);
    const total = avisos.reduce((n, a) => n + a.items.length, 0);
    $('#diagnosticoTotal').textContent = total
      ? total.toLocaleString('es-ES') + ' aviso' + (total === 1 ? '' : 's') +
        ' en ' + avisos.length + ' grupo' + (avisos.length === 1 ? '' : 's')
      : 'todo correcto';
    $('#diagnosticoResumen').textContent = 'Se han revisado ' +
      Number(diag.totalArchivos || 0).toLocaleString('es-ES') +
      ' archivos de la carpeta de fotos. Son avisos de nombres y asignación: no se toca ni el Excel ni la carpeta.';
    $('#diagnosticoLista').innerHTML = avisos.length ? avisos.map((a) =>
      '<section class="diagnostico-grupo">' +
        '<h4>' + escap(a.nombre) + ' <b>' + (a.items || []).length.toLocaleString('es-ES') + '</b></h4>' +
        (a.detalle ? '<p class="nota">' + escap(a.detalle) + '</p>' : '') +
        '<div class="revision-lista">' + (a.items || []).slice(0, 60).map(diagnosticoFila).join('') + '</div>' +
        ((a.items || []).length > 60
          ? '<p class="nota">Se muestran los primeros 60 de ' + a.items.length.toLocaleString('es-ES') + '.</p>' : '') +
      '</section>'
    ).join('') : '<p class="revision-vacio">No se han encontrado problemas de nombres ni archivos sin asignar.</p>';
  }

  async function abrirRevision() {
    const panel = $('#panelRevision');
    if (!panel.open) panel.showModal();
    try { estado.novedades = await api('/api/novedades'); } catch (e) { estado.novedades = { altas: [], bajas: [] }; }
    try { estado.diagnostico = await api('/api/diagnostico'); } catch (e) { estado.diagnostico = { avisos: [], totalArchivos: 0 }; }
    pintarRevision();
  }

  function descargarRevisionCsv() {
    const lista = revisionLista();
    const cabecera = ['Titulo', 'Autor', 'Editorial', 'Categoria', 'Estanteria', 'Balda', 'Estado', 'Observaciones'];
    const filas = lista.map((l) => [l.titulo, l.autor, l.editorial, l.signatura, l.estanteria, l.balda, l.estado, l.observaciones]
      .map((v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(';'));
    const texto = '\uFEFF' + cabecera.join(';') + '\r\n' + filas.join('\r\n');
    const blob = new Blob([texto], { type: 'text/csv;charset=utf-8' });
    const enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(blob);
    const grupo = (GRUPOS_REVISION.find((g) => g.id === revisionGrupo) || {}).nombre || revisionGrupo;
    enlace.download = 'revision-' + grupo.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + new Date().toISOString().slice(0, 10) + '.csv';
    enlace.click();
    setTimeout(() => URL.revokeObjectURL(enlace.href), 5000);
  }

  /* ------------------------------------------- mapa de estanterias */
  function mapaChip(l) {
    const ayuda = (ETIQUETA_ESTADO[l.estado] || 'Sin estado') + (l.autor ? ' · ' + l.autor : '');
    return '<button type="button" class="mapa-libro" data-id="' + escap(l.id) + '" title="' + escap(ayuda) + '">' +
      '<span class="punto ' + (l.estado ? 'punto-' + norm(l.estado) : 'punto-vacia') + '"></span>' +
      '<span class="mapa-libro-texto"><b>' + escap(l.titulo) + '</b>' +
      (l.autor ? '<small>' + escap(l.autor) + '</small>' : '') + '</span></button>';
  }

  function claveBalda(a, b) {
    if (a === '') return 1;
    if (b === '') return -1;
    return a.localeCompare(b, 'es', { numeric: true });
  }

  function pintarMapa() {
    const filtro = norm($('#mapaBuscar').value);
    const estantes = new Map();
    let total = 0, donados = 0;
    for (const l of estado.libros) {
      if (l.estado === 'Donado') { donados++; continue; }
      if (filtro && !norm([l.titulo, l.autor, l.editorial, l.signatura].join(' ')).includes(filtro)) continue;
      const est = l.estanteria ? String(l.estanteria) : '';
      const balda = l.balda ? String(l.balda) : '';
      if (!estantes.has(est)) estantes.set(est, new Map());
      const baldas = estantes.get(est);
      if (!baldas.has(balda)) baldas.set(balda, []);
      baldas.get(balda).push(l);
      total++;
    }
    const listaEstantes = Array.from(estantes.keys()).sort((a, b) => {
      if (a === '') return 1;
      if (b === '') return -1;
      const na = parseFloat(a.replace(',', '.'));
      const nb = parseFloat(b.replace(',', '.'));
      if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
      return a.localeCompare(b, 'es', { numeric: true });
    });
    const conEstante = listaEstantes.filter((e) => e !== '').length;
    $('#mapaResumen').textContent = total.toLocaleString('es-ES') +
      (total === 1 ? ' libro' : ' libros') + ' en ' + conEstante +
      (conEstante === 1 ? ' estantería' : ' estanterías') +
      (donados ? ' · ' + donados.toLocaleString('es-ES') + ' donados no se muestran' : '') +
      (filtro ? ' · filtro: «' + $('#mapaBuscar').value.trim() + '»' : '');
    $('#mapaEstantes').innerHTML = listaEstantes.length ? listaEstantes.map((est) => {
      const baldas = estantes.get(est);
      const librosEstante = Array.from(baldas.values()).reduce((n, x) => n + x.length, 0);
      const listaBaldas = Array.from(baldas.keys()).sort(claveBalda);
      const abierta = !!filtro || mapaEstado.get(est) === true;
      return '<details class="mapa-estante" data-est="' + escap(est) + '"' + (abierta ? ' open' : '') + '>' +
        '<summary class="mapa-estante-cabecera"><h3>' + (est ? 'Estantería ' + escap(est) : 'Sin estantería') + '</h3>' +
        '<span>' + librosEstante.toLocaleString('es-ES') + ' libro' + (librosEstante === 1 ? '' : 's') + '</span>' +
        '<i class="mapa-flecha" aria-hidden="true"></i></summary>' +
        listaBaldas.map((balda) => {
          const libros = baldas.get(balda).slice().sort((a, b) =>
            claveTitulo(a.titulo).localeCompare(claveTitulo(b.titulo), 'es'));
          const etiqueta = (!balda || balda === '0')
            ? (est ? 'Sin balda concreta' : 'Sin ubicación')
            : 'Balda ' + escap(balda);
          return '<div class="mapa-balda"><p class="mapa-balda-titulo"><span>' + etiqueta + '</span>' +
            '<b>' + libros.length + ' libro' + (libros.length === 1 ? '' : 's') + '</b></p>' +
            '<div class="mapa-libros">' + libros.map(mapaChip).join('') + '</div></div>';
        }).join('') +
        '</details>';
    }).join('') : '<p class="revision-vacio">No hay libros que mostrar' + (filtro ? ' con ese filtro.' : '.') + '</p>';

    $$('.mapa-estante', $('#mapaEstantes')).forEach((d) => {
      d.addEventListener('toggle', () => mapaEstado.set(d.dataset.est, d.open));
    });
    actualizarBotonMapa();
  }

  const mapaEstado = new Map();

  function actualizarBotonMapa() {
    const detalles = $$('.mapa-estante', $('#mapaEstantes'));
    const boton = $('#btnMapaTodo');
    if (!boton) return;
    boton.hidden = !detalles.length;
    boton.textContent = detalles.length && detalles.every((d) => d.open) ? 'Plegar todo' : 'Desplegar todo';
  }

  function mapaTodo() {
    const detalles = $$('.mapa-estante', $('#mapaEstantes'));
    if (!detalles.length) return;
    const abrir = !detalles.every((d) => d.open);
    detalles.forEach((d) => { d.open = abrir; mapaEstado.set(d.dataset.est, abrir); });
    actualizarBotonMapa();
  }

  function abrirMapa() {
    const panel = $('#panelMapa');
    if (!panel.open) panel.showModal();
    $('#mapaBuscar').value = '';
    pintarMapa();
  }

  /* ------------------------------------------- historial de cambios */
  const ETIQUETA_ACCION = {
    estado: 'Estado', ficha: 'Ficha', alta: 'Alta', borrado: 'Borrado',
    media: 'Archivos', deshacer: 'Deshacer', clave: 'Clave'
  };

  function fechaHora(iso) {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? String(iso || '')
      : d.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function historialEntrada(e) {
    const puede = e.accion !== 'deshacer' && e.accion !== 'clave' && !e.deshecho &&
      (e.accion === 'alta' || e.accion === 'borrado' || !!e.antes);
    const meta = [fechaHora(e.fecha), e.usuario, e.desde].filter(Boolean).join(' · ') +
      (e.deshecho ? ' · deshecho' : '');
    return '<article class="historial-fila' + (e.deshecho ? ' deshecho' : '') + '"' +
      (e.id ? ' data-id="' + escap(e.id) + '"' : '') + '>' +
      '<span class="insignia-accion">' + escap(ETIQUETA_ACCION[e.accion] || e.accion) + '</span>' +
      '<div class="historial-texto">' +
        '<p class="historial-titulo">' + escap(e.titulo || '—') + '</p>' +
        '<p class="historial-detalle">' + escap(e.detalle || '') + '</p>' +
        '<p class="historial-meta">' + escap(meta) + '</p>' +
      '</div>' +
      (puede ? '<button type="button" class="boton boton-contorno boton-pequeno" data-deshacer="' + e.n + '">Deshacer</button>' : '') +
    '</article>';
  }

  function pintarHistorial() {
    const h = estado.historial || { cambios: [] };
    const total = (h.cambios || []).length;
    const filtro = norm($('#historialBuscar').value);
    const lista = (h.cambios || []).slice().reverse()
      .filter((e) => !filtro || norm([e.titulo, e.detalle, e.usuario, e.desde, e.accion].join(' ')).includes(filtro));
    $('#historialResumen').textContent = total
      ? (filtro
        ? lista.length.toLocaleString('es-ES') + ' coincidencias de ' + total.toLocaleString('es-ES') + ' cambios registrados.'
        : total.toLocaleString('es-ES') + ' cambios registrados (se conservan los últimos 400). Los deshechos quedan como testigo.')
      : 'Todavía no hay cambios registrados.';
    $('#historialLista').innerHTML = lista.length
      ? lista.slice(0, 200).map(historialEntrada).join('')
      : '<p class="revision-vacio">' + (total
        ? 'Ningún cambio coincide con el filtro.'
        : 'Aquí aparecerán los cambios de estado y de ficha, quién los hizo y cuándo.') + '</p>';
  }

  async function abrirHistorial() {
    const panel = $('#panelHistorial');
    if (!panel.open) panel.showModal();
    try { estado.historial = await api('/api/historial'); } catch (e) { estado.historial = { cambios: [] }; }
    pintarHistorial();
  }

  /* ------------------------------------------- estado del sistema (salud) */
  function tamano(bytes) {
    const b = Number(bytes) || 0;
    if (b >= 1024 * 1024 * 1024) return (b / (1024 * 1024 * 1024)).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' GB';
    if (b >= 1024 * 1024) return (b / (1024 * 1024)).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' MB';
    if (b >= 1024) return Math.round(b / 1024).toLocaleString('es-ES') + ' KB';
    return b.toLocaleString('es-ES') + ' B';
  }

  function hace(iso) {
    const ms = Date.now() - new Date(iso).getTime();
    if (!isFinite(ms) || ms < 0) return '';
    const min = Math.round(ms / 60000);
    if (min < 1) return 'hace unos segundos';
    if (min < 60) return 'hace ' + min + ' min';
    const h = Math.floor(min / 60);
    if (h < 48) return 'hace ' + h + ' h' + (min % 60 ? ' y ' + (min % 60) + ' min' : '');
    return 'hace ' + Math.round(h / 24) + ' días';
  }

  function saludFila(nivel, titulo, detalle) {
    return '<div class="salud-fila">' +
      '<span class="salud-punto salud-' + nivel + '"></span>' +
      '<div class="salud-texto"><b>' + escap(titulo) + '</b>' +
      (detalle ? '<small>' + escap(detalle) + '</small>' : '') + '</div></div>';
  }

  function pintarSalud(s) {
    const filas = [];
    let problemas = 0;
    const nivel = (bien, siMal) => {
      if (!bien) problemas++;
      return bien ? 'ok' : (siMal || 'mal');
    };

    const dirs = s.direcciones || [];
    filas.push(saludFila('ok', 'Servidor en marcha',
      'Puerto ' + s.servidor.puerto + ' · Node ' + s.servidor.node +
      ' · desde ' + fechaHora(s.servidor.desde) + ' (' + hace(s.servidor.desde) + ')' +
      (dirs.length ? ' · En la wifi: ' + dirs[0] : '')));

    const imp = (s.catalogo && s.catalogo.importacion) || {};
    let detCat = s.catalogo.total.toLocaleString('es-ES') + ' libros';
    let nivelCat = 'ok';
    if (s.catalogo.importando) { nivelCat = 'aviso'; detCat += ' · actualizando ahora…'; }
    else if (imp.ok === false) { nivelCat = 'mal'; problemas++; detCat += ' · la última actualización falló: ' + (imp.error || 'error'); }
    else if (s.catalogo.version) { detCat += ' · última actualización ' + fechaHora(s.catalogo.version); }
    filas.push(saludFila(nivelCat, 'Catálogo', detCat));

    filas.push(saludFila(nivel(s.vigilancia.activa, 'aviso'), 'Vigilancia automática',
      s.vigilancia.activa
        ? (s.vigilancia.ultimoCambio ? 'Último cambio detectado ' + hace(s.vigilancia.ultimoCambio) : 'Sin cambios desde que arrancó')
        : 'Desactivada: hay que actualizar a mano'));

    filas.push(saludFila(nivel(s.rutas.existeExcel && s.rutas.existeLibros), 'Rutas de los datos',
      (s.rutas.existeExcel ? '✓ Excel' : '✗ No encuentro el Excel') + ' · ' +
      (s.rutas.existeLibros ? '✓ Carpeta de fotos' : '✗ No encuentro la carpeta de fotos')));

    filas.push(saludFila(nivel(s.excelPendiente === 0, 'aviso'), 'Excel al día',
      s.excelPendiente === 0 ? 'No hay cambios pendientes' : s.excelPendiente + ' cambio(s) en cola para el Excel'));

    if (s.diagnostico) {
      filas.push(saludFila(nivel(s.diagnostico.totalAvisos === 0, 'aviso'), 'Diagnóstico de archivos',
        s.diagnostico.totalAvisos === 0
          ? 'Sin avisos (' + (s.diagnostico.totalArchivos || 0) + ' archivos revisados)'
          : s.diagnostico.totalAvisos + ' aviso(s) · míralos en Revisión'));
    }

    const clave = s.clave || {};
    const faltan = Object.keys(clave).filter((k) => !clave[k]);
    const t = s.tamanos || {};
    const detDatos = (s.espacio ? 'Libre ' + tamano(s.espacio.libre) + ' de ' + tamano(s.espacio.total) + ' · ' : '') +
      'datos ' + tamano((t.datos || {}).bytes) +
      ' (subidas ' + tamano((t.subidas || {}).bytes) + ', miniaturas ' + tamano((t.miniaturas || {}).bytes) +
      ', copias ' + tamano((t.copias || {}).bytes) + ')';
    filas.push(saludFila(nivel(faltan.length === 0), 'Datos y disco',
      faltan.length ? 'Faltan ficheros: ' + faltan.join(', ') : detDatos));

    if ((s.errores || []).length) {
      filas.push(saludFila('aviso', 'Últimos avisos del registro', ''));
      filas.push('<pre class="salud-errores">' + escap(s.errores.join('\n')) + '</pre>');
    } else {
      filas.push(saludFila('ok', 'Registro', 'Sin errores ni avisos recientes'));
    }

    $('#saludLista').innerHTML = filas.join('');
    const resumen = $('#saludResumen');
    resumen.textContent = problemas ? problemas + ' cosa(s) a revisar' : 'todo correcto';
    resumen.className = 'nota ' + (problemas ? 'salud-resumen-mal' : 'salud-resumen-ok');
  }

  async function cargarSalud() {
    try { pintarSalud(await api('/api/salud')); }
    catch (e) { $('#saludLista').innerHTML = '<p class="nota">No se ha podido consultar el estado: ' + escap(e.message) + '</p>'; }
  }

  /* ------------------------------------------------------------ arranque */
  async function cargarSesion() {
    try { estado.sesion = await api('/api/estado'); } catch (e) { /* sin conexion */ }
    pintarSesion();
  }

  async function cargarLibros() {
    const datos = await api('/api/libros');
    estado.libros = datos.libros || [];
    estado.version = datos.generado || '';
    pintarPortadaDatos();
    pintarFiltrosCategoria();
    pintar(true);
    pintarFranja();
    if ($('#panelRevision').open) {
      try { estado.novedades = await api('/api/novedades'); } catch (e) { /* nada */ }
      try { estado.diagnostico = await api('/api/diagnostico'); } catch (e) { /* nada */ }
      pintarRevision();
    }
    if ($('#panelMapa').open) pintarMapa();
    if ($('#panelHistorial').open) {
      try { estado.historial = await api('/api/historial'); } catch (e) { /* nada */ }
      pintarHistorial();
    }
  }

  /* -------------------------------------------------- aviso de catalogo */
  async function revisarCatalogo() {
    const caja = $('#avisoCatalogo');
    let s;
    try { s = await api('/api/estado'); } catch (e) { return; }
    estado.actualizando = !!s.actualizando;
    if (s.actualizando) {
      $('#avisoCatalogoTexto').textContent = 'Actualizando el catálogo… puede tardar un minuto';
      $('#btnActualizarVista').hidden = true;
      caja.hidden = false;
      return;
    }
    if (s.version && estado.version && s.version !== estado.version && estado.libros.length) {
      $('#avisoCatalogoTexto').textContent = 'El catálogo se ha actualizado';
      $('#btnActualizarVista').hidden = false;
      caja.hidden = false;
    } else {
      caja.hidden = true;
    }
    // cambios de estado pendientes de pasar al Excel (solo socios)
    const pendientes = Number(s.excelPendiente || 0);
    const aviso = $('#excelPendiente');
    if (aviso) {
      aviso.hidden = !(estado.sesion.logueado && pendientes > 0);
      aviso.textContent = pendientes > 0
        ? 'Hay ' + pendientes + ' cambio(s) de estado pendientes de pasar al Excel (normalmente porque el Excel estaba abierto). Se reintenta solo cada minuto.'
        : '';
      $('#btnVolcarExcel').hidden = pendientes <= 0;
    }
  }

  /* ------------------------------------------------------------ eventos */
  function conectar() {
    $('#formBuscador').addEventListener('submit', (e) => e.preventDefault());
    let temporizador;
    $('#campoBuscar').addEventListener('input', (e) => {
      const v = e.target.value;
      $('#btnLimpiar').hidden = !v;
      clearTimeout(temporizador);
      temporizador = setTimeout(() => { estado.filtros.texto = v; pintar(true); }, 140);
    });
    $('#btnLimpiar').addEventListener('click', () => {
      $('#campoBuscar').value = '';
      $('#btnLimpiar').hidden = true;
      estado.filtros.texto = '';
      pintar(true);
      $('#campoBuscar').focus();
    });
    $('#formBuscador').addEventListener('submit', () => { });

    $$('.pildora').forEach((p) => p.addEventListener('click', () => {
      $$('.pildora').forEach((x) => x.classList.toggle('activa', x === p));
      estado.filtros.estado = p.dataset.estado;
      pintar(true);
    }));
    $('#selSignatura').addEventListener('change', (e) => { estado.filtros.signatura = e.target.value; pintar(true); });
    $('#selOrden').addEventListener('change', (e) => { estado.filtros.orden = e.target.value; pintar(true); });
    $('#chkPortada').addEventListener('change', (e) => { estado.filtros.soloPortada = e.target.checked; pintar(true); });
    $('#btnMas').addEventListener('click', () => { estado.visibles += LOTE; pintar(false); });

    document.addEventListener('click', (e) => {
      const t = e.target.closest('.tarjeta');
      if (t) { abrirDetalle(t.dataset.id); return; }
    });

    $('#btnPorCompletar').addEventListener('click', () => {
      estado.filtros.porCompletar = !estado.filtros.porCompletar;
      pintarFranja();
      pintar(true);
      $('#rejilla').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    $('#btnCerrarDetalle').addEventListener('click', cerrarDetalle);
    $('#panelDetalle').addEventListener('close', () => {
      estado.detalleId = null;
      if (location.hash) history.replaceState(null, '', location.pathname);
    });
    $('#panelDetalle').addEventListener('click', (e) => {
      if (e.target === $('#panelDetalle')) cerrarDetalle();
    });

    // galería + acciones de la ficha
    $('#detCuerpo').addEventListener('click', async (e) => {
      const l = estado.libros.find((x) => x.id === estado.detalleId);
      if (!l) return;

      const mini = e.target.closest('[data-indice]');
      if (mini) { estado.imagenActiva = Number(mini.dataset.indice); pintarDetalle(); return; }

      const quitar = e.target.closest('[data-quitar]');
      if (quitar) {
        e.preventDefault(); e.stopPropagation();
        if (!confirm('¿Quitar la imagen «' + quitar.dataset.quitar + '» de esta ficha?')) return;
        try {
          const res = await api('/api/libros/' + encodeURIComponent(l.id) + '/media?archivo=' + encodeURIComponent(quitar.dataset.quitar), { method: 'DELETE' });
          Object.assign(l, res.libro); estado.imagenActiva = 0; pintarDetalle(); pintar(false);
          toast('Imagen quitada');
        } catch (err) { toast(err.message, true); }
        return;
      }

      const botonEstado = e.target.closest('.estados button');
      if (botonEstado) {
        try {
          await guardarLibro(l.id, { estado: botonEstado.dataset.estado });
          pintarDetalle(); pintar(false);
          toast('Estado: ' + botonEstado.dataset.estado);
          revisarCatalogo();
        }
        catch (err) { toast(err.message, true); }
        return;
      }

      if (e.target.closest('#btnEditarFicha')) {
        $('#editorFicha').innerHTML = editorFicha(l);
        $('#editorFicha').hidden = false;
        $('#btnEditarFicha').hidden = true;
        $('#btnBorrarLibro').hidden = l.origen !== 'nuevo';
        return;
      }
      if (e.target.closest('#btnCancelarEdicion')) {
        $('#editorFicha').hidden = true; $('#editorFicha').innerHTML = '';
        $('#btnEditarFicha').hidden = false;
        return;
      }
      if (e.target.closest('#btnExportarLibro')) {
        const boton = e.target.closest('#btnExportarLibro');
        if (!confirm('Se añadirá «' + l.titulo + '» al Excel y sus archivos (portada, contraportada y documento) a la carpeta de fotos con el nombre estándar. ¿Continuar?')) return;
        boton.disabled = true;
        try {
          const res = await api('/api/libros/' + encodeURIComponent(l.id) + '/exportar', { method: 'POST' });
          toast(res.mensaje || 'Libro exportado al listado');
          cerrarDetalle();
          await cargarLibros();
          if (res.libro && res.libro.id) abrirDetalle(res.libro.id);
        } catch (err) { toast(err.message, true); boton.disabled = false; }
        return;
      }
      if (e.target.closest('#btnBorrarLibro')) {
        if (!confirm('¿Eliminar «' + l.titulo + '» del catálogo? Podrás deshacerlo desde el Historial.')) return;
        try {
          await api('/api/libros/' + encodeURIComponent(l.id), { method: 'DELETE' });
          estado.libros = estado.libros.filter((x) => x.id !== l.id);
          cerrarDetalle(); pintar(false); pintarPortadaDatos();
          toast('Libro eliminado');
        } catch (err) { toast(err.message, true); }
        return;
      }
    });

    // guardar el editor de ficha
    $('#detCuerpo').addEventListener('submit', async (e) => {
      if (e.target.id !== 'formEditar') return;
      e.preventDefault();
      const l = estado.libros.find((x) => x.id === estado.detalleId);
      if (!l) return;
      const datos = new FormData(e.target);
      const campos = {};
      datos.forEach((v, k) => { campos[k] = String(v); });
      try {
        const res = await guardarLibro(l.id, campos);
        $('#editorFicha').hidden = true; $('#editorFicha').innerHTML = '';
        $('#btnEditarFicha').hidden = false;
        pintarDetalle(); pintar(false); pintarPortadaDatos();
        toast(res.docx ? 'Ficha guardada · documento .docx actualizado' : 'Ficha guardada');
      } catch (err) {
        const err1 = $('#editarError'); err1.textContent = err.message; err1.hidden = false;
      }
    });

    // subidas
    $('#detCuerpo').addEventListener('change', async (e) => {
      const input = e.target.closest('[data-subir]');
      if (!input || !input.files || !input.files.length) return;
      const l = estado.libros.find((x) => x.id === estado.detalleId);
      const tipo = input.dataset.subir;
      const archivo = input.files[0];
      if (archivo.size > 30 * 1024 * 1024) { toast('El archivo es demasiado grande (máx. 30 MB)', true); input.value = ''; return; }
      toast('Subiendo ' + tipo + '…');
      try {
        await subirArchivo(l.id, tipo, archivo);
        estado.imagenActiva = 0;
        pintarDetalle(); pintar(false); pintarPortadaDatos();
        toast('Listo: ' + tipo + ' actualizada');
      } catch (err) { toast(err.message, true); }
      input.value = '';
    });

    // acceso
    $('#btnAjustes').addEventListener('click', () => {
      if (estado.sesion.logueado) abrirAjustes();
    });
    $('#btnAcceso').addEventListener('click', () => {
      if (estado.sesion.logueado) { abrirAjustes(); return; }
      $('#panelAcceso').showModal();
      $('#accesoUsuario').value = 'koine';
      $('#accesoClave').value = '';
      setTimeout(() => $('#accesoClave').focus(), 50);
    });
    $('#formAcceso').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#accesoError');
      err.hidden = true;
      try {
        await api('/api/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ usuario: $('#accesoUsuario').value, clave: $('#accesoClave').value })
        });
        $('#panelAcceso').close();
        await cargarSesion();
        if (estado.detalleId) pintarDetalle();
        toast('Bienvenido/a, ' + (estado.sesion.usuario || ''));
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    });

    // historial de cambios
    $('#btnHistorial').addEventListener('click', abrirHistorial);
    $('#historialBuscar').addEventListener('input', pintarHistorial);
    $('#historialLista').addEventListener('click', async (e) => {
      const boton = e.target.closest('[data-deshacer]');
      if (boton) {
        e.stopPropagation();
        if (!confirm('¿Deshacer este cambio?')) return;
        boton.disabled = true;
        try {
          await api('/api/historial/deshacer', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ n: Number(boton.dataset.deshacer) })
          });
          toast('Cambio deshecho');
          await abrirHistorial();
          await cargarLibros();
        } catch (err) { toast(err.message, true); boton.disabled = false; }
        return;
      }
      const fila = e.target.closest('[data-id]');
      if (fila) abrirDetalle(fila.dataset.id);
    });

    // mapa de estanterias
    $('#btnMapa').addEventListener('click', abrirMapa);
    $('#mapaBuscar').addEventListener('input', pintarMapa);
    $('#btnMapaTodo').addEventListener('click', mapaTodo);
    $('#mapaEstantes').addEventListener('click', (e) => {
      const b = e.target.closest('.mapa-libro');
      if (b) abrirDetalle(b.dataset.id);
    });

    // revision del catalogo
    $('#btnRevision').addEventListener('click', abrirRevision);
    $('#revisionGrupos').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-grupo]');
      if (!b) return;
      revisionGrupo = b.dataset.grupo;
      $('#revisionBuscar').value = '';
      pintarRevision();
    });
    $('#revisionBuscar').addEventListener('input', () => pintarRevision());
    $('#revisionEstado').addEventListener('change', () => pintarRevision());
    $('#revisionEstanteria').addEventListener('change', () => pintarRevision());
    $('#revisionLista').addEventListener('click', (e) => {
      const fila = e.target.closest('[data-id]');
      if (fila) abrirDetalle(fila.dataset.id);
    });
    $('#diagnosticoLista').addEventListener('click', (e) => {
      const fila = e.target.closest('[data-id]');
      if (fila) abrirDetalle(fila.dataset.id);
    });
    $('#btnRevisionCsv').addEventListener('click', descargarRevisionCsv);
    $('#btnRevisionCerrar').addEventListener('click', () => $('#panelRevision').close());

    // ajustes
    $('#btnSaludRefrescar').addEventListener('click', cargarSalud);
    $('#btnCopiaSeguridad').addEventListener('click', async () => {
      const boton = $('#btnCopiaSeguridad');
      boton.disabled = true;
      try {
        const r = await api('/api/copia-seguridad', { method: 'POST' });
        toast(r.mensaje || (r.ok ? 'Copia creada' : 'No se ha podido crear la copia'), !r.ok);
        cargarSalud();
      } catch (e) { toast(e.message, true); }
      boton.disabled = false;
    });
    $('#btnExaminarExcel').addEventListener('click', () => abrirExplorador('archivo'));
    $('#btnExaminarLibros').addEventListener('click', () => abrirExplorador('carpeta'));
    $('#btnAbrirExcel').addEventListener('click', () => abrirEnWindows($('#rutaExcel').value));
    $('#btnAbrirLibros').addEventListener('click', () => abrirEnWindows($('#rutaLibros').value));
    $('#btnExplorarArriba').addEventListener('click', () => explorar($('#btnExplorarArriba').dataset.padre || ''));
    $('#btnExplorarElegir').addEventListener('click', () => {
      $('#rutaLibros').value = explorarDestino;
      $('#panelExplorar').close();
    });
    $('#explorarLista').addEventListener('click', (e) => {
      const item = e.target.closest('.explorar-item');
      if (!item) return;
      if (item.dataset.carpeta === '1') { explorar(item.dataset.ruta); return; }
      if (explorarTipo === 'archivo') { $('#rutaExcel').value = item.dataset.ruta; $('#panelExplorar').close(); }
    });
    $('#btnGuardarRutas').addEventListener('click', async () => {
      const boton = $('#btnGuardarRutas');
      boton.disabled = true;
      try {
        const r = await api('/api/rutas', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            origenExcel: $('#rutaExcel').value.trim(),
            origenLibros: $('#rutaLibros').value.trim(),
            vigilar: $('#chkVigilar').checked
          })
        });
        $('#rutasEstado').textContent = '✓ Guardado: ' + r.imagenes + ' imágenes y ' + r.docs + ' documentos en la carpeta';
        toast('Rutas guardadas. Actualizando el catálogo…');
        setTimeout(revisarCatalogo, 1500);
      } catch (ex) { toast(ex.message, true); }
      boton.disabled = false;
    });
    $('#btnVolcarExcel').addEventListener('click', async () => {
      try {
        const r = await api('/api/excel/volcar', { method: 'POST' });
        toast(r.ok ? 'Cambios pasados al Excel' : (r.mensaje || 'No se ha podido pasar al Excel'), !r.ok);
      } catch (ex) { toast(ex.message, true); }
      revisarCatalogo();
    });
    $('#btnForzarCatalogo').addEventListener('click', async () => {
      try {
        await api('/api/actualizar', { method: 'POST' });
        toast('Actualizando el catálogo…');
        setTimeout(revisarCatalogo, 1500);
      } catch (ex) { toast(ex.message, true); }
    });
    $('#btnActualizarVista').addEventListener('click', async () => {
      const boton = $('#btnActualizarVista');
      boton.disabled = true;
      try {
        await cargarLibros();
        if (estado.detalleId) pintarDetalle();
        toast('Catálogo actualizado');
      } catch (ex) { toast(ex.message, true); }
      boton.disabled = false;
      revisarCatalogo();
    });

    // revisar de vez en cuando si el catalogo ha cambiado
    setInterval(revisarCatalogo, 20000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) revisarCatalogo(); });
    setTimeout(revisarCatalogo, 4000);
    $('#formAjustes').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#ajusteError');
      err.hidden = true;
      try {
        await api('/api/clave', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ usuario: $('#ajusteUsuario').value, actual: $('#ajusteActual').value, nueva: $('#ajusteNueva').value })
        });
        $('#panelAjustes').close();
        $('#ajusteActual').value = ''; $('#ajusteNueva').value = '';
        await cargarSesion();
        toast('Contraseña actualizada');
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    });
    $('#btnSalir').addEventListener('click', async () => {
      await api('/api/logout', { method: 'POST' });
      $('#panelAjustes').close();
      await cargarSesion();
      if (estado.detalleId) pintarDetalle();
      toast('Sesión cerrada');
    });

    // libro nuevo
    $('#btnNuevoLibro').addEventListener('click', () => {
      $('#formNuevo').reset();
      $('#nuevoEntrada').value = hoyISO();
      $('#campoNuevoSalida').hidden = true;
      $('#panelNuevo').showModal();
      setTimeout(() => $('#nuevoTitulo').focus(), 50);
    });
    $('#nuevoEstado').addEventListener('change', () => {
      const donado = $('#nuevoEstado').value === 'Donado';
      $('#campoNuevoSalida').hidden = !donado;
      if (donado && !$('#nuevoSalida').value) $('#nuevoSalida').value = hoyISO();
    });
    $('#formNuevo').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#nuevoError');
      err.hidden = true;
      const campos = {
        titulo: $('#nuevoTitulo').value, autor: $('#nuevoAutor').value, editorial: $('#nuevoEditorial').value,
        signatura: $('#nuevoSignatura').value, estanteria: $('#nuevoEstanteria').value, balda: $('#nuevoBalda').value,
        estado: $('#nuevoEstado').value, sinopsis: $('#nuevoSinopsis').value, observaciones: $('#nuevoObservaciones').value,
        fechaEntrada: $('#nuevoEntrada').value, fechaSalida: $('#nuevoSalida').value
      };
      try {
        const res = await api('/api/libros', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(campos) });
        estado.libros.push(res.libro);
        $('#panelNuevo').close();
        e.target.reset();
        pintar(false); pintarPortadaDatos(); pintarFiltrosCategoria();
        toast('Libro añadido');
        abrirDetalle(res.libro.id);
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    });

    // menú de la cabecera en móvil
    (function () {
      const cabecera = $('.cabecera');
      const boton = $('#btnMenu');
      const nav = $('#cabeceraAcciones');
      if (!cabecera || !boton || !nav) return;
      const cerrarMenu = () => { cabecera.classList.remove('menu-abierto'); boton.setAttribute('aria-expanded', 'false'); };
      boton.addEventListener('click', (e) => {
        e.stopPropagation();
        const abierto = cabecera.classList.toggle('menu-abierto');
        boton.setAttribute('aria-expanded', abierto ? 'true' : 'false');
      });
      nav.addEventListener('click', (e) => { if (e.target.closest('.boton')) cerrarMenu(); });
      document.addEventListener('click', (e) => {
        if (!cabecera.classList.contains('menu-abierto')) return;
        if (e.target.closest('#cabeceraAcciones') || e.target.closest('#btnMenu')) return;
        cerrarMenu();
      });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarMenu(); });
      window.addEventListener('resize', () => { if (window.innerWidth > 720) cerrarMenu(); });
    })();

    $$('[data-cerrar]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
    $$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $('#panelDetalle').open) cerrarDetalle();
      if (e.key === '/' && document.activeElement !== $('#campoBuscar')) { e.preventDefault(); $('#campoBuscar').focus(); }
    });
    window.addEventListener('hashchange', () => {
      const m = /^#libro\/(.+)$/.exec(location.hash);
      if (m) abrirDetalle(decodeURIComponent(m[1]));
    });
  }

  /* ------------------------------------------------------------ inicio */
  (async function iniciar() {
    conectar();
    await cargarSesion();
    try { await cargarLibros(); } catch (e) { toast('No se pudo cargar el catálogo: ' + e.message, true); }
    const m = /^#libro\/(.+)$/.exec(location.hash);
    if (m) abrirDetalle(decodeURIComponent(m[1]));
  })();
})();
