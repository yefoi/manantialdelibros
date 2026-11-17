# Elegir una alternativa en el centro

Las tres alternativas están en este repositorio, en la rama **codex/alternativas-nube**. Comparten programa y tienen configuraciones diferentes. La rama `main` conserva la versión Windows que funciona en la red local.

| Lo que hay disponible | Alternativa | Cómo se edita | Requisitos pendientes |
|---|---|---|---|
| Microsoft 365 con OneDrive de empresa/educativo o SharePoint y autorización para conectar una aplicación | [Microsoft 365](microsoft365/README.md) | Excel Online y fichas de la web | Conectar una cuenta autorizada y contratar/configurar alojamiento |
| Google Drive y posibilidad de crear una conexión OAuth de Google | [Google](google/README.md) | Google Sheets y fichas de la web | Convertir una copia del Excel y conectar Google |
| Ninguna de las anteriores o la organización impide las conexiones | [Independiente](independiente/README.md) | Fichas y formularios de la propia web; importación y descarga de Excel | Alojamiento con disco persistente |

**Si hay dudas, la independiente es la que tiene menos requisitos de cuentas externas.** En ella el Excel se importa inicialmente; después los cambios se hacen desde la web. Editar una copia descargada no actualiza el catálogo automáticamente. Las otras dos sí consultan la hoja alojada en Internet.

## Comprobación rápida en el centro

1. ¿Se puede abrir OneDrive con la cuenta del centro y crear un Excel desde el navegador? Si sí, pregunta al responsable de Microsoft 365 si permite una aplicación con acceso delegado a los archivos necesarios. No hace falta crear un sitio de SharePoint para usar OneDrive empresarial.
2. Si no, ¿se puede utilizar Google Drive/Sheets y configurar una aplicación OAuth? Usa la alternativa Google.
3. Si las integraciones están restringidas, usa la independiente en un alojamiento externo autorizado.

Tener Excel instalado no confirma que exista OneDrive empresarial. Tampoco garantiza que la organización permita conectar aplicaciones. OneDrive empresarial utiliza tecnología de SharePoint internamente; estas opciones no evitan las políticas del centro.

## Qué se conserva y qué cambia

Las alternativas de nube incluyen catálogo público, búsqueda, categorías, estados, mapa de estanterías, acceso de socios, altas, edición de fichas, portadas, contraportadas, documentos, descarga de Excel e historial con deshacer cambios de fichas/archivos. La web comprueba el catálogo cada 30 segundos y el servidor la fuente externa cada 60 segundos, configurable con `SYNC_SECONDS` (mínimo 30).

- Las credenciales iniciales de la versión local no se reutilizan. Configura una contraseña de al menos 12 caracteres y una clave de sesión aleatoria de al menos 32.
- Los libros tienen un `ID_WEB` estable. **No cambies ni borres esa columna.** Para ordenar, ordena las filas completas. No cambies los nombres de las columnas, la hoja `Catalogo`, ni la tabla `Catalogo` de Excel.
- Las nuevas fichas creadas desde la web se añaden directamente a la hoja conectada. Si añades una fila desde Excel/Sheets, deja `ID_WEB` vacío: el servidor asignará uno al sincronizar. En Excel añade la fila dentro de la tabla `Catalogo` para que forme parte del catálogo. No copies el ID de otro ejemplar.
- La información de las fichas (sinopsis, páginas, etc.) se guarda en las columnas adicionales. Los `.docx` originales se pueden consultar y sustituir; **la edición de una ficha no reescribe el Word original**. Al subir un nuevo `.docx` se extraen sinopsis, páginas, género y fecha. Los cambios de Word hechos en Drive/OneDrive por fuera de la web requieren volver a subir el documento desde su ficha para extraer el texto.
- El historial registra las operaciones de la web. Excel/Google conservan su propio historial para las ediciones realizadas allí. Deshacer altas/importaciones no está incluido; los estados permiten marcar libros donados sin borrar registros.
- Las coincidencias dudosas de fotos se dejan para revisión. La preparación desde el proyecto original conserva las asociaciones que ya tenía ese catálogo.
- Si la conexión externa falla se mantiene el último catálogo válido. Una edición que el proveedor rechaza devuelve error: la web no la da por guardada.
- Se detectan fichas cambiadas desde que se abrieron y se comprueban los campos antes de escribir en la hoja. Las API de hojas no ofrecen una transacción conjunta con las fotos: evita que dos personas ordenen o editen el mismo libro durante un guardado. Un fallo de red con respuesta perdida puede exigir actualizar y revisar antes de repetir un alta.

## Preparar los datos actuales sin modificar los originales

Desde esta rama, con Node.js 22 o 24:

```powershell
npm ci
npm run nube:preparar -- --proyecto C:\manantialdelibros --salida C:\manantial-preparado
```

Antes de prepararlos, actualiza el catálogo de la versión local. El comando lee `biblioteca.json`, `cambios.json` y `nuevos.json` y crea **una copia**, `manantial-nube.xlsx`, con la tabla `Catalogo`, IDs estables y las columnas A:S. Copia las fotos/documentos referenciados a `libros FINAL` y genera `informe.json` con los archivos que falten. No modifica el proyecto original ni sube datos a GitHub.

Si solo tienes el Excel y las fotos:

```powershell
npm run nube:preparar -- --excel "C:\ruta\listado_biblioteca_excel.xlsx" --fotos "C:\ruta\libros FINAL" --salida C:\manantial-preparado
```

Este segundo modo relaciona solo títulos inequívocos con archivos `título 01`, `02`, `03`. Para títulos repetidos es preferible preparar desde el proyecto original o asignar las fotos manualmente después.

## Probar cualquier alternativa

1. Copia **uno** de los `.env.example` a `.env` en la raíz y completa su configuración. Conserva tu configuración anterior si cambias de alternativa.
2. Genera una clave de sesión en tu terminal: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Guárdala en `SESSION_SECRET`; elige también `ADMIN_PASSWORD`.
3. Completa la conexión de Microsoft/Google si corresponde. La independiente no necesita conexión externa.
4. Ejecuta `npm start` y abre `http://localhost:8080`. Esta es una prueba en tu ordenador; la disponibilidad permanente se consigue desplegando el servidor en la nube.

## Alojamiento y copias

El programa funciona en Node.js sobre Windows o Linux. Incluye `Dockerfile` y `compose.yaml`. Requiere **una instancia con disco persistente**, sin escalado a varias réplicas. Un alojamiento estático como GitHub Pages no ejecuta este servidor. No utilices un disco temporal para los datos.

Para probar el contenedor localmente: `docker compose up -d --build`. El puerto se publica solo en `127.0.0.1`. Para un alojamiento público configura su dominio HTTPS, `NODE_ENV=production`, `PUBLIC_URL=https://...`, las mismas variables y un volumen persistente montado en `/data`. El proveedor debe dirigir las peticiones HTTPS al puerto 8080. La plantilla no configura un dominio ni un certificado automáticamente. `TRUST_PROXY=true` solo procede detrás de un proxy propio o de confianza que reemplace `X-Forwarded-For`.

Cada alternativa usa un volumen separado mediante `COMPOSE_PROJECT_NAME`. Si conectaste Microsoft/Google con `npm` en el ordenador, copia el archivo de conexión correspondiente al `/data` del contenedor usando `docker compose cp` y reinicia. Nunca lo añadas al repositorio. Las cuentas pueden exigir volver a iniciar sesión por MFA o por políticas de la organización.

Para una copia completa del servicio Docker:

```powershell
docker compose stop
docker compose cp catalogo:/data ./respaldo-manantial
docker compose start
```

Conserva el respaldo en un lugar privado: incluye la conexión de la cuenta. Para restaurar, detén el servicio y copia el contenido del respaldo al mismo `/data` con `docker compose cp`, conserva `.env` por separado y arranca. En Microsoft/Google conserva además las copias/versiones de los archivos originales del proveedor. La descarga JSON de la web contiene las fichas y el historial, **no las imágenes ni las credenciales**. Cambia `SESSION_SECRET` para invalidar todas las sesiones.

Antes de arrancar una restauración en Docker, recupera el propietario del volumen con `docker compose run --rm --user root --entrypoint chown catalogo -R node:node /data`.

## Validación incluida

`npm test` comprueba importación/exportación, IDs, autenticación, restricciones de escritura, persistencia, conflictos, historial y peticiones de los adaptadores con servicios simulados. Las conexiones reales requieren las cuentas del centro y deben probarse allí con copias de los archivos antes de adoptarlas. Guardar el código en GitHub no despliega la web ni habilita las cuentas externas.
