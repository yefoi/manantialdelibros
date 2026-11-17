'use strict';
const { test }=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const sharp=require('sharp');
const {createApp}=require('../server.cjs');const {writeExcel,cleanBook}=require('../modelo.cjs');
async function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'manantial-http-'));const app=createApp({DATA_DIR:dir,CLOUD_PROVIDER:'independiente',ADMIN_PASSWORD:'password-larga-solo-pruebas',SESSION_SECRET:'0123456789abcdef0123456789abcdef',HOST:'127.0.0.1',PORT:'0',PUBLIC_URL:'http://localhost:8080'});const addr=await app.start();const root='http://127.0.0.1:'+addr.port;t.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true});});return{app,root};}
async function login(root){const r=await fetch(root+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({usuario:'biblioteca',clave:'password-larga-solo-pruebas'})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];}
test('Flujo HTTP completo: acceso, alta, edición, conflicto, foto y descarga',async t=>{
  const{root}=await setup(t);const home=await fetch(root);assert.equal(home.status,200);assert.match(await home.text(),/Manantial de Libros/);
  assert.equal((await fetch(root+'/api/libros',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
  assert.equal((await fetch(root+'/api/historial')).status,401);
  const cookie=await login(root),headers={Cookie:cookie,'Content-Type':'application/json'};
  const added=await fetch(root+'/api/libros',{method:'POST',headers,body:JSON.stringify({titulo:'Prueba <script>',autor:'Autora',estanteria:'0'})});assert.equal(added.status,201);let b=(await added.json()).libro;
  const changed=await fetch(root+'/api/libros/'+b.id,{method:'PATCH',headers:{...headers,'If-Match':b._revision},body:JSON.stringify({estado:'Prestado'})});assert.equal(changed.status,200);
  assert.equal((await fetch(root+'/api/libros/'+b.id,{method:'PATCH',headers:{...headers,'If-Match':b._revision},body:JSON.stringify({estado:'Donado'})})).status,409);b=(await changed.json()).libro;
  const image=await sharp({create:{width:20,height:30,channels:3,background:'#4c6e87'}}).png().toBuffer();const form=new FormData();form.set('tipo','portada');form.set('archivo',new Blob([image],{type:'image/png'}),'portada.png');const uploaded=await fetch(root+'/api/libros/'+b.id+'/media',{method:'POST',headers:{Cookie:cookie,'If-Match':b._revision},body:form});assert.equal(uploaded.status,200);b=(await uploaded.json()).libro;
  assert.equal((await fetch(root+'/media/thumb/'+encodeURIComponent(b.portadas[0]))).status,200);assert.equal((await fetch(root+'/media/img/no-pertenece.png')).status,404);
  assert.equal((await fetch(root+'/api/exportar.xlsx',{headers:{Cookie:cookie}})).status,200);
  assert.equal((await fetch(root+'/api/libros',{method:'POST',headers:{...headers,Origin:'https://ajeno.example'},body:'{}'})).status,403);
  const backup=await fetch(root+'/api/copia.json',{headers:{Cookie:cookie}});const content=await backup.text();assert.ok(!content.includes('password-larga'));assert.ok(!content.includes('SESSION_SECRET'));
  await fetch(root+'/api/logout',{method:'POST',headers:{Cookie:cookie}});assert.equal((await fetch(root+'/api/historial',{headers:{Cookie:cookie}})).status,401);
});
test('Importación inicial no permite reemplazar un catálogo con ediciones',async t=>{
  const{root}=await setup(t),cookie=await login(root);const book={...cleanBook({titulo:'Desde Excel'}),id:'id-estable'};const data=await writeExcel([book]);
  async function send(){const form=new FormData();form.set('archivo',new Blob([data]),'catalogo.xlsx');return fetch(root+'/api/importar',{method:'POST',headers:{Cookie:cookie},body:form});}
  assert.equal((await send()).status,200);assert.equal((await send()).status,409);const list=await(await fetch(root+'/api/libros')).json();assert.equal(list.libros[0].id,'id-estable');
});
test('El despliegue rechaza claves vacías y una URL pública sin HTTPS en producción',()=>{assert.throws(()=>createApp({}),/ADMIN_PASSWORD/);assert.throws(()=>createApp({ADMIN_PASSWORD:'password-larga-prueba',SESSION_SECRET:'0123456789abcdef0123456789abcdef',NODE_ENV:'production',PUBLIC_URL:'http://example.com'}),/https/);});
test('Cerrar sesión sigue invalidando la cookie después de reiniciar el servidor',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'manantial-session-'));
  const env={DATA_DIR:dir,CLOUD_PROVIDER:'independiente',ADMIN_PASSWORD:'password-larga-solo-pruebas',SESSION_SECRET:'0123456789abcdef0123456789abcdef',HOST:'127.0.0.1',PORT:'0'};
  let app=createApp(env);let addr=await app.start();let root='http://127.0.0.1:'+addr.port;const cookie=await login(root);
  await fetch(root+'/api/logout',{method:'POST',headers:{Cookie:cookie}});await app.close();app=createApp(env);addr=await app.start();root='http://127.0.0.1:'+addr.port;
  t.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true});});assert.equal((await fetch(root+'/api/historial',{headers:{Cookie:cookie}})).status,401);
});
