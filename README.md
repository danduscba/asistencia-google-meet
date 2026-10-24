# Asistencia para Google Meet

Extensión de navegador (Manifest V3) que registra los nombres de las personas que participan en una reunión de Google Meet, con hora de entrada, última vez visto y minutos de permanencia. Funciona en Chrome, Edge, Brave, Opera y Firefox (128+).

## Instalación (modo desarrollador)

**Chrome / Edge / Brave / Opera**
1. Abrí `chrome://extensions` (o `edge://extensions`).
2. Activá **Modo de desarrollador**.
3. Hacé clic en **Cargar descomprimida** y elegí esta carpeta.

**Firefox**
1. Abrí `about:debugging#/runtime/this-firefox`.
2. Hacé clic en **Cargar complemento temporal…** y elegí `manifest.json`.
3. En `about:addons` → Asistencia para Google Meet → Permisos, verificá que esté permitido el acceso a `meet.google.com`.

## Uso

1. Entrá a una reunión de Meet. El registro empieza automáticamente al entrar a la llamada (no en la sala de espera).
2. Hacé clic en el ícono de la extensión para ver los participantes, copiar los nombres, descargarlos en Excel o abrirlos en Google Sheets (se copian y se abre una hoja nueva: solo hay que pegar con Ctrl+V).
3. Para reuniones grandes, **abrí el panel "Personas"** de Meet: Meet solo muestra algunos mosaicos de video a la vez, y el panel tiene la lista completa.

## Cómo funciona

- `src/content.js` revisa la página de Meet cada 3 segundos y busca participantes en los mosaicos de video (`[data-participant-id]`) y en el panel "Personas" (`[role="listitem"][aria-label]`).
- Los datos se guardan solo en tu equipo (`storage.local`) y nunca se envían a ningún servidor.
- Si alguien desaparece menos de 20 segundos, se cuenta como la misma presencia.
- **Tiempo hablado:** cada 250 ms se revisa qué mosaicos muestran el indicador de voz de Meet. Se agrega 1 segundo de margen para cubrir las pausas entre palabras. El popup y la planilla ordenan a los participantes de quien más habló a quien menos.
- Solo se mide el habla de quienes tienen su mosaico **visible** en la grilla. En reuniones grandes, usá la vista "Mosaico" con la mayor cantidad de recuadros posible.

## Mantenimiento

Google cambia el HTML de Meet seguido. Si la extensión deja de detectar nombres, ajustá el objeto `SELECTORS` al principio de `src/content.js`.

Si deja de medir el tiempo hablado, las clases del indicador de voz cambiaron. Ejecutá `diagnostico/prueba-habla.js` en la consola de Meet, buscá las clases que solo suben en la fase "HABLA" y actualizá `SELECTORS.speaking`.

## Estructura

```
manifest.json                 Configuración de la extensión
src/content.js                Detección de participantes y de quién habla en Meet
src/popup.html/js/css         Ventana emergente: reunión en curso, ranking, historial y exportación
icons/                        Íconos (generados)
herramientas/generar-iconos.js  Regenera los íconos: node herramientas/generar-iconos.js
diagnostico/prueba-habla.js   Prueba para encontrar el indicador de voz si Meet cambia
```
