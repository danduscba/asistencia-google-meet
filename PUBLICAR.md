# Cómo publicar Asistencia para Google Meet en las tiendas

## 1. Antes de empezar

- [ ] **Identificador para Firefox:** en `manifest.json`, cambiá `asistencia-google-meet@example.com` por uno propio y único, por ejemplo `asistencia-google-meet@tu-dominio.com`. No tiene que ser un correo real, pero no se puede cambiar después de publicar.
- [ ] **Correo de contacto:** completalo al final de `PRIVACIDAD.md`.
- [ ] **Publicar la política de privacidad** en una dirección pública, porque Chrome la exige. Opciones gratuitas: un repositorio de GitHub (el archivo `.md` se ve como página), GitHub Pages, Google Sites o Notion.
- [x] **Nombre:** se usa "Asistencia para Google Meet", que describe para qué sirve sin parecer un producto oficial de Google. Si lo cambiás, cambialo en `manifest.json` (`name` y `default_title`), `src/popup.html` y `tienda/config.js`.
- [ ] **Versión:** cada vez que subas una actualización, aumentá `version` en `manifest.json` (por ejemplo, de 1.1.0 a 1.1.1).

## 2. Armar el paquete

```
node herramientas/empaquetar.js
```

Genera `dist/asistencia-google-meet-<versión>.zip` solo con los archivos necesarios. El mismo `.zip` sirve para las tres tiendas.

## 3. Subir a cada tienda

| | Chrome Web Store | Edge Add-ons | Firefox Add-ons |
|---|---|---|---|
| Panel | chrome.google.com/webstore/devconsole | partner.microsoft.com/dashboard/microsoftedge | addons.mozilla.org/developers |
| Costo | USD 5, pago único | Gratis | Gratis |
| Cuenta | Google | Microsoft | Firefox (Mozilla) |
| Revisión | De 1 a 7 días, aproximadamente | Hasta 7 días hábiles | Desde minutos hasta algunos días |

### Chrome Web Store
1. Registrate como desarrollador y pagá la tarifa.
2. Hacé clic en **Nuevo elemento** y subí el `.zip`.
3. **Ficha de Play Store:** completá la descripción, la categoría (*Productividad*), el idioma y las capturas de pantalla.
4. **Prácticas de privacidad:**
   - *Propósito único:* "Registrar la asistencia y el tiempo de habla de los participantes en reuniones de Google Meet".
   - *Justificación del permiso `storage`:* "Guardar localmente el historial de reuniones y la configuración".
   - *Justificación del acceso a meet.google.com:* "Leer los nombres de los participantes y el indicador de quién habla durante la reunión".
   - *Código remoto:* No.
   - *Datos recopilados:* marcá **Información de identificación personal** (los nombres de los participantes). Después marcá las tres declaraciones: no se venden, no se usan para fines ajenos y no se usan para crédito.
   - Pegá la dirección de la política de privacidad.
5. Enviá la extensión a revisión.

### Edge Add-ons
1. Registrate en Partner Center, en el programa de Microsoft Edge.
2. Hacé clic en **Crear extensión** y subí el mismo `.zip`.
3. Completá la disponibilidad (mercados), las propiedades (categoría *Productividad* y la dirección de la política de privacidad) y la ficha (descripción y capturas).
4. Enviá la extensión a revisión.

### Firefox Add-ons (AMO)
1. Iniciá sesión en addons.mozilla.org/developers.
2. Hacé clic en **Enviar un complemento nuevo**, elegí **En este sitio** y subí el `.zip`.
3. Cuando pregunte por el código fuente, respondé **No**: el código no está minificado ni compilado, así que no hace falta enviarlo aparte.
4. Completá la descripción, la categoría y la dirección de la política de privacidad.
5. Enviá la extensión a revisión.

## 4. Material para la ficha de la tienda

**Descripción breve** (hasta 132 caracteres, igual a la del manifest):
> Registra quién participa en tus reuniones de Google Meet y cuánto habla cada persona. Exporta la asistencia a CSV.

**Descripción completa:**
> Asistencia para Google Meet registra automáticamente quién participa en tus reuniones de Google Meet y cuánto habla cada persona.
>
> ✔ Lista de asistencia automática: nombre, hora de entrada y tiempo presente.
> ✔ Tiempo de habla de cada participante y ranking de quién habló más.
> ✔ Indicador en vivo de quién está hablando.
> ✔ Historial de reuniones, que podés renombrar.
> ✔ Exportación a CSV, compatible con Excel y Google Sheets.
> ✔ Copiar la lista de nombres con un clic.
>
> Ideal para docentes que toman asistencia, equipos que quieren reuniones más equilibradas y moderadores.
>
> 🔒 Privacidad: todos los datos quedan en tu navegador. La extensión no graba audio ni video y no envía información a ningún servidor.
>
> Cómo se usa: entrá a una reunión de Meet y abrí la extensión. El registro es automático.
>
> Nota: para medir el tiempo de habla, los participantes tienen que estar visibles en la grilla de Meet. Para listas completas en reuniones grandes, abrí el panel "Personas".

**Imágenes:** ya están listas en `tienda/imagenes/`, con nombres inventados.

| Archivo | Dónde se usa |
|---|---|
| `captura-1-ranking.png` (1280×800) | Capturas de pantalla en las 3 tiendas (ponela primera) |
| `captura-2-en-vivo.png` (1280×800) | Capturas de pantalla |
| `captura-3-exportar.png` (1280×800) | Capturas de pantalla |
| `promo-440x280.png` | Chrome: imagen promocional chica. Edge: también la acepta |
| `icons/icon-128.png` | Ícono de la tienda |

Para regenerarlas (por ejemplo, si cambiás el nombre en `tienda/config.js` o el diseño del popup):

```
powershell -ExecutionPolicy Bypass -File herramientas/capturas.ps1
```

## 5. Después de publicar

Google cambia Meet con frecuencia. Si la extensión deja de detectar nombres o voces, actualizá los selectores (ver `README.md`), aumentá la versión y volvé a empaquetar y subir. Las tres tiendas actualizan la extensión automáticamente a sus usuarios.
