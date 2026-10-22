// Nombre que aparece en las imágenes de la tienda. Si lo cambiás en
// manifest.json, cambialo también acá y volvé a generar las imágenes con:
//   powershell -File herramientas/capturas.ps1
window.APP_NAME = "Asistencia para Google Meet";

document.addEventListener("DOMContentLoaded", () => {
  for (const el of document.querySelectorAll("[data-app-name]")) el.textContent = window.APP_NAME;
});
