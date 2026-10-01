# Manantial de Libros

Sitio web de la biblioteca comunitaria **Manantial de Libros** (Refugio Koiné): un catálogo
para consultar qué libros hay en las estanterías, cuáles están disponibles, cuáles prestados
y cuáles se han donado.

- **Invitados:** pueden ver los libros, sus portadas y su información. Solo lectura.
- **Socios:** entran con un único usuario y contraseña y además pueden cambiar el estado de
  cada libro, subir portada / contraportada / información y editar o añadir fichas.

Funciona **en local**, dentro de la wifi del local (no hace falta internet ni hosting) y
sin dependencias: el servidor está escrito en Node.js usando solo la librería estándar.

---

## Puesta en marcha rápida (Windows)

1. **Preparar el ordenador** (solo la primera vez):
   doble clic en `Preparar (nuevo ordenador).bat`
   Descarga Node.js portable dentro de `runtime\`. No instala nada en el sistema.

2. **Importar el catálogo**:
   copia el Excel y la carpeta de fotos al escritorio (ver *Datos de entrada*) y ejecuta
   ```
   herramientas\importar.ps1
   herramientas\miniaturas.ps1
   ```

3. **Arrancar**:
   doble clic en `Iniciar Manantial de Libros.bat` → se abre `http://localhost:8080`

4. **Acceso desde móviles y otros ordenadores de la wifi** (una sola vez):
   doble clic en `Permitir acceso desde la red (una vez).bat` (pide permiso de administrador).
   Después, desde el móvil: `http://<ip-de-este-ordenador>:8080`

Usuario y contraseña iniciales: **`koine` / `refugio`** — se cambian desde *Ajustes* dentro del sitio.

---

## Datos de entrada

| Qué | Dónde |
|---|---|
| Listado de la biblioteca | `listado_biblioteca_excel.xlsx` en el escritorio |
| Portadas, contraportadas e información (`01.jpg`, `02.jpg`, `03.docx`) | carpeta `libros FINAL` en el escritorio |

Las rutas se configuran en `datos\ajustes.json` (se crea solo la primera vez):

```json
{
  "origenLibros": "C:\\Users\\...\\Desktop\\libros FINAL",
  "origenExcel":  "C:\\Users\\...\\Desktop\\listado_biblioteca_excel.xlsx",
  "puerto": 8080,
  "nombreSitio": "Manantial de Libros"
}
```

El **Excel nunca se modifica**. Todo lo que se cambia desde el sitio se guarda aparte en
`datos\cambios.json`, `datos\nuevos.json` y `datos\subidas\`, así que volver a importar el
Excel no borra nada.

---

## Estructura

```
app\          servidor HTTP sin dependencias (Node.js): API, sesiones, subidas, docx
web\          la interfaz: portada, buscador, rejilla, fichas (HTML + CSS + JS sin frameworks)
datos\        catálogo generado y cambios hechos desde el sitio (no se sube al repo)
herramientas\ importar.ps1 · miniaturas.ps1 · instalar-node.ps1 · firewall.ps1 ·
              copia-seguridad.ps1 · arranque-automatico.ps1 · crear-icono.ps1
runtime\      Node.js portable (no se sube al repo)
```

### Identidad

![Logo](web/img/logo-libros.png)

| | |
|---|---|
| Logo | `web/img/logo-libros.png` (original en `diseño\Logo Manantial de libros copia.png`) |
| Azul del logo | `#4C6E87` |
| Tinta del dibujo | `#1C3146` |
| Azul Fundación Manantial | `#3C579E` |
| Gris azulado del cartel | `#B5C2CB` |
| Tipografía | Montserrat (en `web\fuentes\`, licencia SIL OFL) |

Los iconos del navegador y del acceso directo se regeneran con `herramientas\crear-icono.ps1`.
En la cabecera, arriba a la derecha, aparece el símbolo de **Fundación Manantial**, la entidad
a la que pertenece la biblioteca.


### El servidor

`app\server.js` no usa ninguna dependencia externa. Incluye, escrito a mano:

- enrutado y ficheros estáticos, con protección frente a *path traversal*;
- sesiones firmadas con HMAC-SHA256 en cookie `HttpOnly` y contraseña con `scrypt`;
- subida de archivos (`multipart/form-data`) y lectura de `.docx` (ZIP + `inflateRaw`);
- catálogo en memoria con capa de cambios para no tocar los datos originales.

### La interfaz

`web\` es HTML, CSS y JavaScript sin frameworks. Portada minimalista, buscador que ignora
acentos, filtros por estado y categoría, ficha con galería de imágenes y acciones de socio.

El botón **Estanterías** abre el mapa de la biblioteca: estantería por estantería y balda por
balda, con el estado de cada libro (los donados no aparecen, porque ya no están en las
estanterías); al pulsar un libro se abre su ficha. Incluye buscador propio, las estanterías son
plegables (la búsqueda abre las que tienen resultados) y hay un botón «Desplegar/Plegar todo».

Los socios tienen además **Historial**: cada cambio de estado, de ficha, de archivos, alta o
borrado queda anotado con el usuario, el dispositivo (IP), la fecha y el detalle, y la mayoría
se pueden **deshacer** con un botón (el cambio original queda marcado como deshecho y el
deshacer se anota también). Se guarda en `datos\historial.json` (últimos 400 cambios).

---

## Tareas habituales

| Quiero… | Cómo |
|---|---|
| Actualizar el catálogo | automático al guardar el Excel o cambiar las fotos (1–2 min); también `Ajustes → Actualizar ahora` o `herramientas\importar.ps1` + `miniaturas.ps1` |
| Cambiar de sitio el Excel o las fotos | `Ajustes → Listado y carpeta de fotos` (explorador incluido); reimporta solo |
| Revisar el catálogo | botón `Revisión` (socios): nuevos, desaparecidos, sin foto, sin ubicación… con filtro por estantería y descarga CSV |
| Copia de seguridad | `herramientas\copia-seguridad.ps1` (ZIP con fecha en `copias\`) |
| Arrancar solo al encender el PC | `herramientas\arranque-automatico.ps1` (`-Quitar` para desactivar) |
| Cambiar el puerto | editar `puerto` en `datos\ajustes.json` |

## Revisión del catálogo

El importador compara el catálogo nuevo con el anterior usando una clave de **título + autor**
(sin el artículo inicial, para que los cambios de título no cuenten como altas o bajas) y escribe
`datos\novedades.json` con los libros nuevos y los desaparecidos. La pantalla *Revisión* (socios)
usa ese archivo y el propio catálogo para ofrecer las listas de trabajo:

| Grupo | Qué muestra |
|---|---|
| Nuevos en el listado | altas desde la última importación |
| Ya no están | bajas (desaparecidos del Excel) |
| Sin foto | sin ninguna portada |
| Sin ubicación | sin estantería asignada (la estantería 0 es una estantería real) |
| Ficha incompleta | sin autor ni editorial |
| Sin estado | sin disponible / prestado / donado |

Con filtro por estantería, búsqueda, apertura de la ficha al pulsar y descarga en CSV (con BOM,
separador `;`, listo para Excel).

Al pie de la pantalla aparece el bloque **Diagnóstico de archivos**, con avisos sobre los nombres
de los archivos de la carpeta de fotos: imágenes sin `01`/`02`, imágenes numeradas como `03`,
numeración no reconocida, varios documentos para el mismo libro, fotos compartidas por varias
fichas, extensiones no soportadas (por ejemplo fotos HEIC del móvil), fichas creadas desde
archivos, emparejamientos ambiguos y archivos sin asignar. Se guarda además en
`datos\diagnostico.json` y en `datos\revision.txt`. Es solo informativo: no modifica el Excel
ni la carpeta de fotos.

## Rutas configurables desde el sitio

`datos\ajustes.json` guarda las rutas del Excel y de la carpeta de fotos. Desde la pantalla
*Ajustes* (socios) se pueden ver y cambiar, con un explorador de carpetas propio
(`/api/explorar`), validación (`/api/rutas`) y la opción de abrir la carpeta en el Explorador de
Windows (`/api/abrir`). Al guardar, `app\server.js` reescribe `ajustes.json` y lanza una
reimportación. Mientras una ruta no sea válida, el sitio sigue sirviendo el último catálogo bueno.


## El Excel en las dos direcciones

Los cambios hechos en la web se escriben también en el Excel
(`herramientas\actualizar-excel.ps1`), en las columnas `A` artículo, `B` título, `C` autor,
`D` editorial, `E` signatura, `F` estantería, `G` balda, `H` estado, `J` F.SALIDA y
`K` observaciones:

- **Web → Excel**: al guardar un estado o una ficha, el servidor apunta el cambio en
  `datos\excel-pendiente.json` y actualiza esas celdas de la fila. Antes de escribir guarda una copia
  en `datos\copias-excel\` (las 30 últimas). Si el Excel está abierto (bloqueado), el cambio se
  guarda igualmente en la web y se reintenta cada minuto; `POST /api/excel/volcar` fuerza un intento
  y `GET /api/estado` informa de los pendientes.
- **Excel → web**: al reimportar, `importar.ps1` compara el Excel con lo último que escribió la web
  (`_excelEstado` y `_excelCampos` de `cambios.json`). Si ya no coincide es que alguien lo cambió a
  mano: manda el Excel y el cambio de la web se retira («gana el último cambio»).

## La web actualiza el documento del libro (.docx)

Al guardar una ficha desde el sitio, además de `datos\cambios.json` se reescribe el documento
de información del libro:

- si el libro ya tenía un `.docx` en la carpeta de fotos, se actualiza con el mismo nombre;
- si no tenía documento, se crea `<título> 03.docx` en la carpeta de fotos;
- si es un libro añadido desde el sitio, el documento se guarda en `datos\subidas\`;
- los `.pdf` y `.txt` originales no se tocan.

El documento conserva el formato que lee el importador (`TITULO:`, `AUTOR:`, `PAGINAS:`,
`EDITORIAL:`, `GENERO:`, `FECHA DE PUBLICACION:`, `SINOPSIS:`). Se puede desactivar con
`"sincronizarDocx": false` en `datos\ajustes.json`.

La sincronización es **bidireccional**: si después editas ese `.docx` a mano (Word, LibreOffice…),
al reimportar `importar.ps1` lo detecta comparándolo con lo último que escribió la web
(`_docxCampos` de `cambios.json`) y adopta el texto del documento («gana el último cambio»).

Ojo: si el `.docx` está abierto en Word/LibreOffice, puede estar bloqueado; en ese caso la
ficha se guarda igual y el documento se actualizará en el siguiente guardado.

## Actualización automática

`app\server.js` vigila cada 10 segundos el Excel y la carpeta de fotos. Cuando detecta un cambio(con 7 segundos de margen para que termine de copiarse), reimporta el catálogo y regenera las
miniaturas él solo, usando `herramientas\importar.ps1` y `herramientas\miniaturas.ps1`.
El sitio sigue funcionando mientras tanto, y al terminar:

- `/api/estado` publica la nueva `version` (la fecha de la última importación);
- la web la compara cada 20 segundos y muestra un aviso para refrescar.

Se puede desactivar con `"vigilar": false` en `datos\ajustes.json`.


---

## Notas

- Los libros que aparecían fotografiados pero no estaban en el Excel se crean como fichas
  nuevas y llevan la etiqueta **Por completar**.
- `datos\revision.txt` lista las coincidencias "aproximadas" de la última importación, por si
  alguna hay que corregirla a mano.
- El proyecto es privado en cuanto a datos: cada ordenador genera los suyos en `datos\`.
