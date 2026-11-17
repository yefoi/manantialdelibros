'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createProvider } = require('./proveedores.cjs');
const { Catalogo } = require('./catalogo.cjs');
const { error, writeExcel, safeName, readJson, atomic } = require('./modelo.cjs');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8' };
function createApp(env = process.env, deps = {}) {
  if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 12) throw error('Configura ADMIN_PASSWORD con al menos 12 caracteres.');
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw error('Configura SESSION_SECRET con al menos 32 caracteres aleatorios.');
  const publicUrl = new URL(env.PUBLIC_URL || 'http://localhost:8080');
  if (env.NODE_ENV === 'production' && publicUrl.protocol !== 'https:') throw error('PUBLIC_URL debe empezar por https:// en producción.');
  const dataDir = path.resolve(env.DATA_DIR || '.nube-datos'); fs.mkdirSync(dataDir, { recursive: true });
  const provider = deps.provider || createProvider(env, dataDir);
  const source = [env.CLOUD_PROVIDER || 'independiente', env.MS_DRIVE_ID || '', env.MS_EXCEL_ID || '', env.MS_FOLDER_ID || '', env.GOOGLE_SHEET_ID || '', env.GOOGLE_FOLDER_ID || ''].join(':');
  const catalog = new Catalogo(provider, dataDir, source);
  const passwordSalt = crypto.randomBytes(16), passwordHash = crypto.scryptSync(env.ADMIN_PASSWORD, passwordSalt, 64);
  const username = env.ADMIN_USER || 'biblioteca'; const attempts = new Map();
  const sessionFile = path.join(dataDir, 'sesiones.json');
  let sessionEpoch = readJson(sessionFile, { epoch: crypto.randomBytes(16).toString('hex') }).epoch;
  atomic(sessionFile, { epoch: sessionEpoch });
  function sign(data) { return crypto.createHmac('sha256', env.SESSION_SECRET).update(data).digest('base64url'); }
  function token() { const s = Buffer.from(JSON.stringify({ user: username, exp: Date.now() + 12 * 3600000, epoch: sessionEpoch })).toString('base64url'); return s + '.' + sign(s); }
  function logged(req) {
    try {
      const cookie = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('manantial='))?.slice(10);
      if (!cookie) return false; const [s, mac] = cookie.split('.'), expected = sign(s);
      if (!mac || Buffer.byteLength(mac) !== Buffer.byteLength(expected) || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return false;
      const payload = JSON.parse(Buffer.from(s, 'base64url')); return payload.user === username && payload.exp > Date.now() && payload.epoch === sessionEpoch;
    } catch { return false; }
  }
  function cookie(value, age) { return 'manantial=' + value + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + age + (publicUrl.protocol === 'https:' ? '; Secure' : ''); }
  function send(res, status, body, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; font-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'", ...headers });
    res.end(Buffer.isBuffer(body) ? body : JSON.stringify(body));
  }
  async function body(req, limit = 32 * 1024 * 1024) {
    let size = 0; const chunks = [];
    for await (const part of req) { size += part.length; if (size > limit) throw error('La subida supera el tamaño permitido (32 MB por envío).', 413); chunks.push(part); }
    return Buffer.concat(chunks);
  }
  async function json(req) {
    if (!(req.headers['content-type'] || '').startsWith('application/json')) throw error('Se esperaba JSON.', 415);
    try { return JSON.parse((await body(req, 128 * 1024)).toString('utf8')); } catch (e) { if (e.status) throw e; throw error('JSON no válido.'); }
  }
  async function multipart(req) { try { return await new Response(await body(req), { headers: { 'Content-Type': req.headers['content-type'] || '' } }).formData(); } catch (e) { if (e.status) throw e; throw error('La subida no es válida.'); } }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, publicUrl), route = decodeURIComponent(url.pathname), method = req.method;
      const isLogged = logged(req);
      if (method === 'GET' && route === '/healthz') return send(res, 200, { ok: true });
      if (method === 'GET' && route === '/readyz') return send(res, !provider.listBooks || catalog.lastSync || catalog.state.libros.length ? 200 : 503, { listo: !!(!provider.listBooks || catalog.lastSync || catalog.state.libros.length) });
      if (method === 'GET' && route === '/api/estado') return send(res, 200, { logueado: isLogged, usuario: isLogged ? username : '', proveedor: provider.name, independiente: !provider.listBooks, version: catalog.state.generado, actualizando: catalog.busy, desactualizado: !!catalog.lastError, error: isLogged ? catalog.lastError : catalog.lastError ? 'No se ha podido actualizar el catálogo. Se muestra la última copia disponible.' : '', ultimaSincronizacion: catalog.lastSync });
      if (method === 'GET' && route === '/api/libros') return send(res, 200, { libros: catalog.publicBooks(), generado: catalog.state.generado });
      if (method === 'GET' && route.startsWith('/media/')) {
        const parts = route.slice(7).split('/'); const thumb = parts[0] === 'thumb'; const name = parts.slice(1).join('/');
        if (!['img', 'thumb', 'doc'].includes(parts[0])) throw error('Archivo no encontrado.', 404);
        const buffer = await catalog.media(name, thumb);
        return send(res, 200, buffer, { 'Content-Type': thumb ? 'image/jpeg' : MIME[path.extname(name).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'public, max-age=60', ...(parts[0] === 'doc' ? { 'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(name), 'Content-Security-Policy': 'sandbox' } : {}) });
      }
      if (!['GET', 'HEAD'].includes(method)) {
        if (req.headers.origin && req.headers.origin !== publicUrl.origin) throw error('Origen de la petición no permitido.', 403);
        if (route !== '/api/login' && !isLogged) throw error('Entra como socio para realizar cambios.', 401);
      }
      if (method === 'POST' && route === '/api/login') {
        // Use socket IP by default. Only trust a proxy header after explicitly enabling it.
        const ip = env.TRUST_PROXY === 'true' ? (req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim() : req.socket.remoteAddress;
        const previous = attempts.get(ip); const attempt = previous && previous.until > Date.now() ? previous : { count: 0, until: Date.now() + 15 * 60000 };
        if (attempt.count >= 10 || (!previous && attempts.size >= 10000)) throw error('Demasiados intentos. Espera 15 minutos.', 429);
        const values = await json(req); attempt.count++; attempts.set(ip, attempt);
        if (attempts.size > 10000) for (const [k, v] of attempts) if (v.until < Date.now()) attempts.delete(k);
        const hash = crypto.scryptSync(String(values.clave || '').slice(0, 1000), passwordSalt, 64);
        if (values.usuario !== username || !crypto.timingSafeEqual(hash, passwordHash)) throw error('Usuario o contraseña incorrectos.', 401);
        attempts.delete(ip); return send(res, 200, { ok: true }, { 'Set-Cookie': cookie(token(), 12 * 3600) });
      }
      if (method === 'POST' && route === '/api/logout') { sessionEpoch = crypto.randomBytes(16).toString('hex'); atomic(sessionFile, { epoch: sessionEpoch }); return send(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) }); }
      if (route.startsWith('/api/')) {
        if (!isLogged) throw error('Entra como socio.', 401);
        if (method === 'POST' && route === '/api/sync') { await catalog.sync(); return send(res, 200, { ok: true }); }
        if (method === 'GET' && route === '/api/historial') return send(res, 200, { cambios: catalog.state.historial });
        if (method === 'POST' && route === '/api/historial/deshacer') { const input = await json(req); return send(res, 200, { libro: await catalog.undo(input.id) }); }
        if (method === 'GET' && route === '/api/exportar.xlsx') return send(res, 200, await writeExcel(catalog.state.libros), { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="manantial-nube.xlsx"' });
        if (method === 'GET' && route === '/api/copia.json') return send(res, 200, Buffer.from(JSON.stringify(catalog.state, null, 2)), { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="catalogo-nube-copia.json"' });
        if (method === 'POST' && route === '/api/importar') { const form = await multipart(req); const file = form.get('archivo'); if (!file || typeof file.arrayBuffer !== 'function') throw error('Selecciona un Excel .xlsx.'); return send(res, 200, { total: await catalog.import(Buffer.from(await file.arrayBuffer())) }); }
        if (method === 'POST' && route === '/api/archivos') { const form = await multipart(req); const files = form.getAll('archivos'); if (!files.length || files.length > 100) throw error('Selecciona entre 1 y 100 archivos por envío.'); const items = []; for (const f of files) { if (!f.name || !safeName(f.name)) throw error('Archivo no válido.'); items.push({ name: f.name, buffer: Buffer.from(await f.arrayBuffer()) }); } return send(res, 200, await catalog.bulk(items)); }
        if (method === 'POST' && route === '/api/libros') return send(res, 201, { libro: await catalog.add(await json(req)) });
        const match = route.match(/^\/api\/libros\/([a-zA-Z0-9_-]{1,80})(\/media)?$/);
        if (match && method === 'PATCH' && !match[2]) return send(res, 200, { libro: await catalog.patch(match[1], await json(req), req.headers['if-match']) });
        if (match && method === 'POST' && match[2]) {
          const form = await multipart(req), file = form.get('archivo');
          if (!file?.name || typeof file.arrayBuffer !== 'function') throw error('Selecciona un archivo.');
          return send(res, 200, { libro: await catalog.upload(match[1], form.get('tipo'), Buffer.from(await file.arrayBuffer()), path.extname(file.name).toLowerCase(), req.headers['if-match']) });
        }
        throw error('Ruta no encontrada.', 404);
      }
      if (!['GET', 'HEAD'].includes(method)) throw error('Método no admitido.', 405);
      const root = route.startsWith('/assets/') ? path.resolve(__dirname, '../web') : path.resolve(__dirname, 'web');
      const rel = route.startsWith('/assets/') ? route.slice(8) : route === '/' ? 'index.html' : route.slice(1);
      const file = path.resolve(root, rel); const relative = path.relative(root, file);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw error('Archivo no encontrado.', 404);
      return send(res, 200, method === 'HEAD' ? Buffer.alloc(0) : fs.readFileSync(file), { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    } catch (e) { if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'No se ha podido completar la operación. Revisa la configuración y la conexión del proveedor.' }); else res.end(); }
  });
  server.requestTimeout = 60000; server.headersTimeout = 15000;
  let timer;
  async function start() {
    const port = env.PORT ? Number(env.PORT) : 8080;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, env.HOST || '0.0.0.0', resolve); });
    await catalog.sync().catch(() => {});
    const seconds = Math.max(30, Number(env.SYNC_SECONDS) || 60);
    timer = setInterval(() => { if (!catalog.busy) catalog.sync().catch(() => {}); }, seconds * 1000); timer.unref();
    return server.address();
  }
  async function close() { clearInterval(timer); await catalog.queue; await new Promise(resolve => server.close(resolve)); }
  return { server, catalog, start, close };
}
if (require.main === module) {
  try {
    const app = createApp(); app.start().then(address => console.log('Manantial de Libros nube en puerto ' + address.port)).catch(e => { console.error(e.message); process.exitCode = 1; });
    for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => app.close().then(() => process.exit(0)));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = { createApp };
