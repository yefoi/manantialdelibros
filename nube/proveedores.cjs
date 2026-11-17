'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { PublicClientApplication } = require('@azure/msal-node');
const { OAuth2Client } = require('google-auth-library');
const { HEADERS, FIELDS, rowsToBooks, bookToRow, assertUnchanged, atomic, readJson, error } = require('./modelo.cjs');
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const MS_SCOPES = ['https://graph.microsoft.com/Files.ReadWrite', 'offline_access'];
const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'];
const enc = encodeURIComponent;
function assignMissingIds(rows) {
  const missing = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i]?.[1] ?? '').trim() && !String(rows[i][11] ?? '').trim()) {
      rows[i][11] = crypto.randomUUID(); missing.push({ row: i + 1, id: rows[i][11] });
    }
  }
  rowsToBooks(rows); // Validate the complete schema and duplicate IDs before writing.
  return missing;
}
function required(env, names) { for (const n of names) if (!env[n]) throw error('Falta configurar ' + n + '. Consulta la guía de esta alternativa.', 503); }
async function request(url, { token, method = 'GET', body, headers = {}, raw = false, fetcher = fetch } = {}) {
  const res = await fetcher(url, { method, headers: { Authorization: 'Bearer ' + token, ...(body && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body && (Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body)), signal: AbortSignal.timeout(45000) });
  if (!res.ok) {
    let detail = ''; try { const j = await res.json(); detail = j.error?.message || ''; } catch { }
    throw error(res.status === 401 ? 'La conexión ha caducado. Vuelve a conectar la cuenta.' : res.status === 429 ? 'El proveedor pide esperar. Inténtalo dentro de un minuto.' : 'El proveedor rechazó la operación (' + res.status + '). ' + detail.slice(0, 350), res.status === 409 || res.status === 412 ? 409 : 503);
  }
  if (raw) return Buffer.from(await res.arrayBuffer());
  return res.status === 204 ? {} : res.json();
}
function microsoftClient(env, dataDir) {
  required(env, ['MS_CLIENT_ID', 'MS_TENANT_ID']);
  const cacheFile = path.join(dataDir, 'msal-cache.json');
  return new PublicClientApplication({ auth: { clientId: env.MS_CLIENT_ID, authority: 'https://login.microsoftonline.com/' + enc(env.MS_TENANT_ID) }, cache: { cachePlugin: {
    beforeCacheAccess: async context => { if (fs.existsSync(cacheFile)) context.tokenCache.deserialize(fs.readFileSync(cacheFile, 'utf8')); },
    afterCacheAccess: async context => { if (context.cacheHasChanged) { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(cacheFile + '.tmp', context.tokenCache.serialize(), { mode: 0o600 }); fs.renameSync(cacheFile + '.tmp', cacheFile); } }
  } } });
}
function googleClient(env, dataDir, redirect) {
  required(env, ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']);
  const client = new OAuth2Client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirect);
  const tokenFile = path.join(dataDir, 'google-token.json');
  const credentials = readJson(tokenFile, {});
  if (env.GOOGLE_REFRESH_TOKEN) credentials.refresh_token = env.GOOGLE_REFRESH_TOKEN;
  client.setCredentials(credentials);
  client.on('tokens', tokens => atomic(tokenFile, { ...readJson(tokenFile, {}), ...tokens }));
  return client;
}
class Microsoft {
  constructor(env, dataDir, deps = {}) {
    required(env, ['MS_DRIVE_ID', 'MS_EXCEL_ID', 'MS_FOLDER_ID']);
    this.env = env; this.name = 'Microsoft 365 (OneDrive / SharePoint)'; this.fetcher = deps.fetcher || fetch;
    this.client = deps.client || microsoftClient(env, dataDir);
    this.root = GRAPH + '/drives/' + enc(env.MS_DRIVE_ID);
    this.workbook = this.root + '/items/' + enc(env.MS_EXCEL_ID) + '/workbook';
  }
  async token() {
    const accounts = await this.client.getTokenCache().getAllAccounts();
    if (accounts.length !== 1) throw error('Conecta una cuenta Microsoft del centro con npm run conectar:microsoft.', 503);
    try { return (await this.client.acquireTokenSilent({ account: accounts[0], scopes: MS_SCOPES })).accessToken; }
    catch { throw error('Microsoft necesita que vuelvas a iniciar sesión: npm run conectar:microsoft.', 503); }
  }
  async call(url, options) {
    if (!url.startsWith(GRAPH + '/')) throw error('Enlace inesperado del proveedor.', 502);
    return request(url, { ...options, token: await this.token(), fetcher: this.fetcher });
  }
  async rows() {
    const data = await this.call(this.workbook + '/tables/Catalogo/range');
    const rows = data.values || [];
    const address = data.address || '';
    if (!/!\$?A\$?1:/.test(address)) throw error('La tabla Catalogo debe comenzar en A1 y usar las columnas A:S.', 503);
    const missing = assignMissingIds(rows);
    if (missing.length) {
      const ids = rows.slice(1).map((row, i) => [missing.some(item => item.row === i + 2) ? row[11] : null]);
      await this.call(this.workbook + '/worksheets/' + enc(this.env.MS_SHEET_NAME || 'Catalogo') + "/range(address='L2:L" + rows.length + "')", { method: 'PATCH', body: { values: ids } });
    }
    return rows;
  }
  async listBooks() { return rowsToBooks(await this.rows()); }
  async patch(id, patch, before) {
    const rows = await this.rows(), books = rowsToBooks(rows);
    const current = books.find(x => x.id === id);
    if (!current) throw error('El libro ya no está en la hoja. Actualiza el catálogo.', 409);
    assertUnchanged(current, before, patch);
    // null leaves each untouched cell unchanged in the Excel API.
    const values = FIELDS.map(f => Object.hasOwn(patch, f) ? bookToRow({ ...current, ...patch })[FIELDS.indexOf(f)] : null);
    // Split a leading article into the existing A/B convention when changing a title.
    if (Object.hasOwn(patch, 'titulo')) values[0] = '';
    for (let i = 0; i < values.length; i++) if (typeof values[i] === 'string' && /^[=+@]/.test(values[i])) values[i] = "'" + values[i];
    const escaped = this.env.MS_SHEET_NAME || 'Catalogo';
    await this.call(this.workbook + '/worksheets/' + enc(escaped) + "/range(address='A" + current.fila + ':S' + current.fila + "')", { method: 'PATCH', body: { values: [values] } });
    return { ...current, ...patch };
  }
  async add(book) {
    const rows = await this.rows();
    if (rowsToBooks(rows).some(b => b.id === book.id)) return book; // Idempotent retry after a lost response.
    await this.call(this.workbook + '/tables/Catalogo/rows/add', { method: 'POST', body: { index: null, values: [bookToRow(book).map(v => /^[=+@]/.test(v) ? "'" + v : v)] } });
    return book;
  }
  async listMedia() {
    let url = this.root + '/items/' + enc(this.env.MS_FOLDER_ID) + '/children?$select=id,name,size,lastModifiedDateTime,eTag,file&$top=200'; const all = [];
    while (url) { const page = await this.call(url); all.push(...(page.value || []).filter(f => f.file)); url = page['@odata.nextLink']; }
    return all.map(f => ({ id: f.id, name: f.name, size: f.size, tag: f.eTag || f.lastModifiedDateTime }));
  }
  async download(file) { return this.call(this.root + '/items/' + enc(file.id) + '/content', { raw: true }); }
  async upload(name, buffer, mime) {
    const file = await this.call(this.root + '/items/' + enc(this.env.MS_FOLDER_ID) + ':/' + enc(name) + ':/content', { method: 'PUT', body: buffer, headers: { 'Content-Type': mime } });
    return { id: file.id, name: file.name, size: file.size, tag: file.eTag };
  }
}
class Google {
  constructor(env, dataDir, deps = {}) {
    required(env, ['GOOGLE_SHEET_ID', 'GOOGLE_FOLDER_ID']); this.env = env; this.name = 'Google Sheets + Drive';
    this.client = deps.client || googleClient(env, dataDir); this.fetcher = deps.fetcher || fetch;
    this.sheet = env.GOOGLE_SHEET_NAME || 'Catalogo'; this.root = SHEETS + '/' + enc(env.GOOGLE_SHEET_ID);
  }
  async token() { try { const r = await this.client.getAccessToken(); if (!r.token) throw new Error(); return r.token; } catch { throw error('Conecta Google con npm run conectar:google o renueva el acceso.', 503); } }
  async call(url, options) {
    if (!['https://sheets.googleapis.com/', 'https://www.googleapis.com/'].some(prefix => url.startsWith(prefix))) throw error('Enlace inesperado del proveedor.', 502);
    return request(url, { ...options, token: await this.token(), fetcher: this.fetcher });
  }
  range(range) { return "'" + this.sheet.replace(/'/g, "''") + "'!" + range; }
  async rows() {
    const r = await this.call(this.root + '/values/' + enc(this.range('A:S')) + '?valueRenderOption=FORMATTED_VALUE'); const rows = r.values || [];
    const missing = assignMissingIds(rows);
    if (missing.length) await this.call(this.root + '/values:batchUpdate', { method: 'POST', body: { valueInputOption: 'RAW', data: missing.map(item => ({ range: this.range('L' + item.row), values: [[item.id]] })) } });
    return rows;
  }
  async listBooks() { return rowsToBooks(await this.rows()); }
  async patch(id, patch, before) {
    const current = rowsToBooks(await this.rows()).find(x => x.id === id);
    if (!current) throw error('El libro ya no está en la hoja. Actualiza el catálogo.', 409);
    assertUnchanged(current, before, patch);
    const values = bookToRow({ ...current, ...patch });
    const columns = Object.keys(patch).map(f => FIELDS.indexOf(f)).filter(i => i >= 0);
    if (Object.hasOwn(patch, 'titulo')) columns.push(0);
    const data = [...new Set(columns)].map(i => ({ range: this.range(String.fromCharCode(65 + i) + current.fila), values: [[values[i]]] }));
    await this.call(this.root + '/values:batchUpdate', { method: 'POST', body: { valueInputOption: 'RAW', data } });
    return { ...current, ...patch };
  }
  async add(book) {
    if ((await this.listBooks()).some(b => b.id === book.id)) return book;
    await this.call(this.root + '/values/' + enc(this.range('A:S')) + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', { method: 'POST', body: { values: [bookToRow(book)] } });
    return book;
  }
  async listMedia() {
    const all = []; let pageToken = '';
    do {
      const q = "'" + this.env.GOOGLE_FOLDER_ID.replace(/'/g, "\\'") + "' in parents and trashed = false";
      const qs = new URLSearchParams({ q, fields: 'nextPageToken,files(id,name,size,modifiedTime,md5Checksum,mimeType)', pageSize: '1000', ...(pageToken ? { pageToken } : {}) });
      const page = await this.call(DRIVE + '/files?' + qs); all.push(...(page.files || []).filter(f => !f.mimeType.startsWith('application/vnd.google-apps.'))); pageToken = page.nextPageToken;
    } while (pageToken);
    return all.map(f => ({ id: f.id, name: f.name, size: Number(f.size || 0), tag: f.md5Checksum || f.modifiedTime }));
  }
  async download(file) { return this.call(DRIVE + '/files/' + enc(file.id) + '?alt=media', { raw: true }); }
  async upload(name, buffer, mime) {
    // OAuth of a real Google user also works with personal Drive storage quotas.
    const meta = await this.call(DRIVE + '/files?fields=id,name,size,modifiedTime', { method: 'POST', body: { name, parents: [this.env.GOOGLE_FOLDER_ID] } });
    const uploaded = await this.call('https://www.googleapis.com/upload/drive/v3/files/' + enc(meta.id) + '?uploadType=media&fields=id,name,size,md5Checksum,modifiedTime', { method: 'PATCH', body: buffer, headers: { 'Content-Type': mime } });
    return { id: uploaded.id, name: uploaded.name, size: Number(uploaded.size), tag: uploaded.md5Checksum || uploaded.modifiedTime };
  }
}
class Independiente {
  constructor(dataDir) { this.dataDir = dataDir; this.name = 'Nube independiente'; this.mediaDir = path.join(dataDir, 'media'); fs.mkdirSync(this.mediaDir, { recursive: true }); }
  async listMedia() { return fs.readdirSync(this.mediaDir).filter(n => !n.startsWith('.')).map(name => { const s = fs.statSync(path.join(this.mediaDir, name)); return { id: name, name, size: s.size, tag: String(s.mtimeMs) }; }); }
  async download(file) { return fs.readFileSync(path.join(this.mediaDir, file.name)); }
  async upload(name, buffer) { fs.writeFileSync(path.join(this.mediaDir, name), buffer); return { id: name, name, size: buffer.length, tag: String(Date.now()) }; }
}
function createProvider(env, dataDir) {
  switch (env.CLOUD_PROVIDER || 'independiente') {
    case 'independiente': return new Independiente(dataDir);
    case 'microsoft': return new Microsoft(env, dataDir);
    case 'google': return new Google(env, dataDir);
    default: throw error('CLOUD_PROVIDER debe ser independiente, microsoft o google.');
  }
}
module.exports = { createProvider, Microsoft, Google, Independiente, microsoftClient, googleClient, MS_SCOPES, GOOGLE_SCOPES };
