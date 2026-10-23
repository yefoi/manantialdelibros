# Instalar Manantial de Libros en el servidor de ficheros

## Lo primero: qué significa "en el servidor"

`\\fundacionmanantial.org\dfs\parla2\CRL\talleres\entorno-diseno\Manantial de libros`
es una **carpeta compartida**. Ahí se pueden guardar los archivos del proyecto, el Excel y las
fotos, y es una buena idea (queda todo en un sitio, con copia de seguridad de la fundación).

Pero una carpeta compartida **no ejecuta programas**. El sitio web es un proceso de Node.js que
tiene que estar corriendo en **un ordenador**:

```
   PC que ejecuta Node  ──lee/escribe──►  \\...\Manantial de libros   (archivos y datos)
        │
        └── sirve la web en  http://IP-del-PC:8080  (móviles y otros PCs)
```

Hay dos formas de montarlo:

| | Dónde corre Node | Ventaja | Inconveniente |
|---|---|---|---|
| **A. En el PC de la biblioteca** (recomendado sin admin) | En ese PC, con el proyecto en el servidor de ficheros | No hace falta administrador; los datos quedan en el servidor | Si ese PC está apagado, la web no responde |
| **B. En el propio servidor** (24 h) | En el servidor, como servicio de Windows | Siempre disponible | Lo tiene que hacer informática (instalar Node, crear el servicio, abrir el puerto) |

---

## A. En el PC de la biblioteca (sin permisos de administrador)

1. Copia el proyecto completo a:
   `\\fundacionmanantial.org\dfs\parla2\CRL\talleres\entorno-diseno\Manantial de libros`
   (o clónalo ahí desde GitHub).

2. Comprueba que puedes escribir en esa carpeta (el sitio necesita guardar cambios):

   ```powershell
   New-Item -ItemType File "\\fundacionmanantial.org\dfs\parla2\CRL\talleres\entorno-diseno\Manantial de libros\prueba.txt" -Force
   Remove-Item "\\fundacionmanantial.org\dfs\parla2\CRL\talleres\entorno-diseno\Manantial de libros\prueba.txt"
   ```

   Si da "Acceso denegado", la carpeta es de solo lectura: pide permiso de escritura a
   informática o usa una carpeta local del PC.

3. Prepara Node en ese PC (no en el servidor de ficheros, y sin admin):

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File "\\fundacionmanantial.org\dfs\parla2\CRL\talleres\entorno-diseno\Manantial de libros\herramientas\instalar-node.ps1"
   ```

   Detecta que es una ruta de red y lo instala en `%LOCALAPPDATA%\Manantial de Libros\node`.
   No hay dependencias: **no hay que ejecutar `npm install`**.

4. Arranca:
   doble clic en `Iniciar Manantial de Libros.bat` (usa `pushd`, así funciona con rutas de red).

5. **Solo un PC debe tener el servidor arrancado a la vez**, o los datos se pisarían.
   Los demás entran por el navegador: `http://IP-del-PC:8080`.

6. Muy recomendable: que el **Excel y la carpeta de fotos también estén en el servidor**, y
   indicar esas rutas en *Ajustes → Listado y carpeta de fotos*. Así cualquier PC puede
   arrancar el sitio y los datos son los mismos.

---

## B. En el servidor, como servicio (lo hace informática)

Requisitos:

- Node.js 18 o superior instalado en el servidor (o el portable del proyecto, copiado al disco
  local del servidor, no a la carpeta de red).
- Permiso de escritura del usuario del servicio sobre la carpeta del proyecto (para `datos\`).
- El puerto **8080** abierto en el firewall del servidor para la red interna.

Pasos:

1. Copiar el proyecto a una carpeta local del servidor, por ejemplo `D:\Manantial`.
2. Probar a mano: `node app\server.js` (debe responder en `http://localhost:8080/api/estado`).
3. Registrar el proceso como servicio de Windows. Con [NSSM](https://nssm.cc/):
   ```
   nssm install ManantialDeLibros "C:\ruta\node.exe" "D:\Manantial\app\server.js"
   nssm set ManantialDeLibros AppDirectory D:\Manantial
   nssm set ManantialDeLibros Start SERVICE_AUTO_START
   nssm start ManantialDeLibros
   ```
   (o con el Programador de tareas, "al iniciar el sistema", ejecutando el mismo comando).
4. Abrir el puerto 8080 y comprobar desde otro PC: `http://IP-del-servidor:8080`.

> Aviso: si el proyecto se queda en la carpeta de red y el servicio se ejecuta en el servidor,
> la ruta del servicio debe ser la **ruta local** del servidor (por ejemplo `D:\...`), no la
> ruta `\\...`, y el usuario del servicio necesita permisos de escritura en ella.

---

## Resumen rápido

- Los **archivos** pueden (y conviene) estar en `\\fundacionmanantial.org\dfs\...`.
- El **proceso Node** tiene que correr en un PC o en el servidor.
- Sin admin: opción **A** (Node se instala en `%LOCALAPPDATA%`, sin permisos especiales).
- Con 24 h y siempre disponible: opción **B**, la monta informática.
