'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { microsoftClient, googleClient, MS_SCOPES, GOOGLE_SCOPES } = require('./proveedores.cjs');
const { atomic } = require('./modelo.cjs');
async function main() {
  const dataDir = path.resolve(process.env.DATA_DIR || '.nube-datos'); fs.mkdirSync(dataDir, { recursive: true });
  if (process.argv[2] === 'microsoft') {
    const client = microsoftClient(process.env, dataDir);
    const result = await client.acquireTokenByDeviceCode({ scopes: MS_SCOPES, deviceCodeCallback: result => console.log(result.message) });
    for (const account of await client.getTokenCache().getAllAccounts()) if (account.homeAccountId !== result.account.homeAccountId) await client.getTokenCache().removeAccount(account);
    console.log('Conexión Microsoft guardada en la carpeta privada de datos.'); return;
  }
  if (process.argv[2] !== 'google') throw new Error('Indica microsoft o google.');
  const port = Number(process.env.GOOGLE_CALLBACK_PORT || 53682);
  const redirect = 'http://localhost:' + port + '/oauth2callback';
  const client = googleClient(process.env, dataDir, redirect);
  const state = crypto.randomBytes(32).toString('hex');
  const codes = await client.generateCodeVerifierAsync();
  const url = client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: GOOGLE_SCOPES, state, code_challenge: codes.codeChallenge, code_challenge_method: 'S256' });
  await new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const input = new URL(req.url, redirect);
      if (input.pathname !== '/oauth2callback') { res.writeHead(404); res.end(); return; }
      if (input.searchParams.get('state') !== state || !input.searchParams.get('code')) { res.writeHead(400); res.end('Respuesta no válida. Repite la conexión.'); return; }
      try {
        const { tokens } = await client.getToken({ code: input.searchParams.get('code'), redirect_uri: redirect, codeVerifier: codes.codeVerifier });
        if (!tokens.refresh_token) throw new Error('No se recibió acceso permanente. Revoca la conexión anterior y repite el consentimiento.');
        atomic(path.join(dataDir, 'google-token.json'), tokens);
        res.end('Google conectado. Puedes cerrar esta ventana.'); clearTimeout(timeout); server.close(); resolve();
      } catch (e) { res.writeHead(400); res.end('No se ha podido conectar. Revisa la consola.'); clearTimeout(timeout); server.close(); reject(new Error('No se pudo obtener el acceso de Google. Repite la conexión.')); }
    });
    const timeout = setTimeout(() => { server.close(); reject(new Error('Se agotó el tiempo para conectar.')); }, 10 * 60000);
    server.on('error', e => { clearTimeout(timeout); reject(e); });
    server.listen(port, '127.0.0.1', () => console.log('Abre este enlace en el navegador de ESTE ordenador:\n' + url + '\nEsperando autorización (10 minutos)…'));
  });
  console.log('Conexión Google guardada en la carpeta privada de datos.');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
