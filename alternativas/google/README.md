# Alternativa 2 · Google Sheets y Drive

Elige esta opción si se puede utilizar Google y configurar una aplicación OAuth. Funciona con la cuenta real de una persona, incluida una cuenta personal de Google, y utiliza su espacio de Drive para las subidas.

## Preparación

1. Genera `manantial-nube.xlsx` y `libros FINAL` con la [guía común](../README.md).
2. Sube el Excel a Drive y **conviértelo al formato nativo de Google Sheets**. La API utilizada aquí no trabaja directamente sobre un `.xlsx` sin convertir. Conserva la pestaña `Catalogo`, las columnas A:S y `ID_WEB` en L.
3. Sube las fotos/documentos a una carpeta de Drive. Usa archivos normales (`.jpg`, `.docx`, etc.), sin convertir los documentos originales a Google Docs, y sin nombres duplicados.
4. En Google Cloud, crea/selecciona un proyecto, habilita **Google Sheets API** y **Google Drive API**, configura la pantalla de consentimiento OAuth y crea un cliente OAuth de tipo **Aplicación web**. Añade exactamente `http://localhost:53682/oauth2callback` como URI de redirección autorizada. La conexión inicial se realiza en tu ordenador; el alojamiento recibe después la credencial guardada.
5. Si la aplicación está en pruebas, añade la cuenta como usuario de prueba. Para uso permanente revisa el estado de publicación/consentimiento: en aplicaciones externas en pruebas, el token de actualización para estos permisos puede caducar a los siete días. Publicar o verificar la aplicación puede requerir trámites de Google; las cuentas de una organización también pueden bloquear la conexión. Esta alternativa no elimina esos requisitos.
6. Copia este `.env.example` a `.env` en la raíz. Completa las credenciales del acceso de socios y `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_SHEET_ID` y `GOOGLE_FOLDER_ID`. Los dos últimos son los IDs que aparecen en las URL de la hoja y la carpeta.
7. Ejecuta `npm ci` y `npm run conectar:google`. Abre en el navegador **de ese mismo ordenador** el enlace de la terminal, inicia sesión y acepta el acceso. No cierres la terminal hasta que confirme la conexión. Se guarda en `DATA_DIR/google-token.json`.
8. Ejecuta `npm start`, entra como socio y actualiza. Comprueba cambios desde la web y desde Google Sheets, y una subida de portada.

## Despliegue

Sigue la guía común y copia el archivo privado `google-token.json` a la carpeta de datos del alojamiento. Con Compose, después de conectar con npm:

```powershell
docker compose up -d --build
docker compose cp ./.nube-datos/google/google-token.json catalogo:/data/google-token.json
docker compose exec --user root catalogo chown node:node /data/google-token.json
docker compose exec --user root catalogo chmod 600 /data/google-token.json
docker compose restart
```

También se admite `GOOGLE_REFRESH_TOKEN` como secreto del alojamiento. Nunca subas el archivo de conexión, el secreto del cliente ni los tokens a GitHub. Las variables del cliente y los IDs deben coincidir en ambos lugares.

Se solicitan permisos de edición de Sheets y Drive. La conexión puede acceder a los archivos a los que tenga acceso la cuenta; usa una cuenta adecuada para la biblioteca. Se emplea OAuth de usuario para que las subidas funcionen también en Mi unidad; una cuenta de servicio compartida con una carpeta personal no dispone de la misma cuota de almacenamiento para crear archivos.

Fuentes: [API de valores de Sheets](https://developers.google.com/workspace/sheets/api/guides/values), [OAuth para aplicaciones web](https://developers.google.com/identity/protocols/oauth2/web-server), [caducidad de tokens](https://developers.google.com/identity/protocols/oauth2#expiration).
