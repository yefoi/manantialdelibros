# Alternativa 3 · Nube independiente

Elige esta opción si solo hay navegador e Internet o no se permite conectar Microsoft/Google. Las fichas y las fotos se editan en la propia web; el alojamiento guarda todos los datos.

1. Sigue la preparación de datos de la [guía común](../README.md).
2. Copia este `.env.example` a `.env` en la raíz. Completa `ADMIN_PASSWORD` y `SESSION_SECRET`.
3. Ejecuta `npm ci` y `npm start` para probar. Para uso permanente, despliega con disco persistente y HTTPS según la guía común.
4. Pulsa **Entrar**, entra con las credenciales que configuraste y abre **Gestión**.
5. Importa `manantial-nube.xlsx`. Solo se permite importar sobre un catálogo vacío para evitar borrar ediciones por accidente.
6. Sube los archivos de `libros FINAL` por lotes de hasta 100 archivos/32 MB. Los nombres de la preparación conservan las asociaciones.
7. Consulta desde otro navegador como visitante; edita fichas como socio y comprueba que se actualizan.

**Excel:** puedes descargar el catálogo actualizado en cualquier momento. La edición diaria se hace en los formularios de la web. Un Excel descargado y editado por separado no se sincroniza automáticamente. Si se necesita editar la hoja en Internet, utiliza Microsoft 365 o Google.

Los datos están en `DATA_DIR` (o `/data` en Docker). Haz copia completa periódicamente; no dependas solo de descargar el Excel. Un cambio de alojamiento requiere trasladar ese volumen y su configuración.
