# Alternativa 1 · Microsoft 365

Sirve con **OneDrive de empresa/educativo o una biblioteca de SharePoint** accesible por la cuenta que conectes. Usa Microsoft Graph con permisos delegados: una persona autorizada conecta la aplicación. No necesita un servidor del centro.

## Preparación

1. Genera `manantial-nube.xlsx` y `libros FINAL` con la [guía común](../README.md).
2. Sube esa copia del Excel y esa carpeta a OneDrive o SharePoint. El Excel debe conservar la hoja `Catalogo`, la tabla `Catalogo` en `A1` y las 19 columnas A:S. Mantén las fotos/documentos en una única carpeta plana y evita nombres duplicados.
3. Pide al responsable de Microsoft 365 registrar una aplicación de **un solo inquilino** en Microsoft Entra, habilitar flujos de cliente público y configurar acceso **delegado** `Files.ReadWrite` de Microsoft Graph. Necesita acceso sin conexión (`offline_access`). La persona que la conecte debe poder editar el Excel y la carpeta. La organización puede exigir consentimiento administrativo o impedir el flujo de dispositivo: en ese caso utiliza otra alternativa.
4. Copia este `.env.example` a `.env` en la raíz. Completa contraseña y secreto, `MS_TENANT_ID` (inquilino), `MS_CLIENT_ID` (aplicación), `MS_DRIVE_ID` (unidad), `MS_EXCEL_ID` (archivo) y `MS_FOLDER_ID` (carpeta). Los dos elementos deben pertenecer a la misma unidad.
5. El administrador puede identificar esos IDs con Microsoft Graph Explorer: `/me/drive`, `/me/drive/root/children` y `/drives/{drive-id}/root:/ruta/al/archivo.xlsx`. Para SharePoint, `/sites/{site-id}/drives` permite localizar la biblioteca. Utiliza los IDs reales, no la URL de compartir.
6. Ejecuta `npm ci` y `npm run conectar:microsoft`. Abre la URL e introduce el código que muestre la terminal. Inicia sesión con la cuenta autorizada del centro. El acceso se guarda en `DATA_DIR/msal-cache.json`; es privado.
7. Ejecuta `npm start`. Entra como socio y pulsa **Actualizar desde la nube**. Comprueba las portadas y cambia un estado en la web. Después modifica otro libro en Excel Online y comprueba la actualización.

## Despliegue

Sigue el alojamiento de la guía común. Copia el archivo `msal-cache.json` privado a la carpeta de datos del alojamiento. No lo incluyas en el código, la imagen Docker ni GitHub. Si utilizas Compose después de conectar con npm:

```powershell
docker compose up -d --build
docker compose cp ./.nube-datos/microsoft/msal-cache.json catalogo:/data/msal-cache.json
docker compose exec --user root catalogo chown node:node /data/msal-cache.json
docker compose exec --user root catalogo chmod 600 /data/msal-cache.json
docker compose restart
```

Configura en el alojamiento las mismas variables de la aplicación y una URL HTTPS. La organización puede revocar el acceso o exigir nueva autenticación; el estado de Gestión avisa cuando toca reconectar.

## Límites que conviene comprobar

- Se ha preparado para la plataforma empresarial/educativa. No des por compatible una suscripción Microsoft 365 Personal o Family: Microsoft documenta limitaciones de la API de Excel sobre OneDrive personal.
- El permiso delegado `Files.ReadWrite` permite acceder a los archivos editables por la cuenta conectada; no promete aislamiento a una única carpeta. Conviene conectar una cuenta de la biblioteca con acceso limitado a los archivos que necesite. Consulta al administrador sobre los permisos efectivos.
- Las API de celdas no aceptan el mismo modelo de permisos de aplicación sin usuario que la descarga de archivos. Esta versión utiliza sesión delegada y renovación mediante MSAL.
- La web guarda las fichas en Excel; no reemplaza el archivo `.xlsx` entero para cada cambio. Si el libro está bloqueado o el proveedor rechaza la operación, muestra el error y conserva la última copia para consulta.

Fuentes: [Excel y Microsoft Graph](https://learn.microsoft.com/en-us/graph/api/resources/excel?view=graph-rest-1.0), [actualización de celdas](https://learn.microsoft.com/en-us/graph/api/range-update?view=graph-rest-1.0), [conexión por dispositivo](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code).
