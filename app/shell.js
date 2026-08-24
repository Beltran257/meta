/* ===========================================================================
   SHELL — ÚNICA lista de archivos de la app.
   La lee la página (para saber qué hay) y el service worker (para precachear).
   Añadir un archivo aquí y en ningún sitio más. tools/audita.mjs verifica que
   no exista ningún .js/.css en app/ que falte en esta lista.

   Además, en la página (no en el service worker) deja puesto el tema ANTES
   del primer pintado. Es el único sitio donde cabe: un script de módulo va
   diferido y llegaría tarde, y la CSP no permite un <script> en línea.
   =========================================================================== */
self.APP_VERSION = '2.0.17';

self.SHELL = [
  './',
  './manifest.webmanifest',
  './shell.js',
  './arranque.js',
  './icono.svg',
  './icono-180.png',
  './icono-192.png',
  './icono-512.png',

  './css/base.css',
  './css/app.css',

  './js/main.js',
  './js/core/registry.js',
  './js/core/store.js',
  './js/core/bus.js',
  './js/core/ui.js',
  './js/core/fmt.js',
  './js/core/device.js',
  './js/core/sesion.js',
  './js/core/sync.js',
  './js/core/asignaturas.js',
  './js/core/temas.js',
  './js/core/motor.js',
  './js/core/apuntesdb.js',
  './js/core/archivos.js',
  './js/core/grafico.js',
  './js/core/ia.js',
  './js/vistas/acceso.js',
  './js/vistas/hoy.js',
  './js/vistas/horario.js',
  './js/vistas/tareas.js',
  './js/vistas/examenes.js',
  './js/vistas/estudiar.js',
  './js/vistas/apuntes.js',
  './js/vistas/notas.js',
  './js/vistas/asignaturas.js',
  './js/vistas/analisis.js',
  './js/vistas/perfil.js',
  './js/vistas/captura.js',
  './js/vistas/buscar.js',
];

/* Tema guardado -> atributo en <html>, antes de que se pinte nada. En el
   service worker no hay document, de ahí la comprobación. */
if (typeof document !== 'undefined') {
  try {
    const prefs = JSON.parse(localStorage.getItem('meta.prefs.v1') || '{}');
    document.documentElement.setAttribute('data-tema', prefs.tema || 'auto');
  } catch { /* almacenamiento bloqueado: se queda en 'auto', que es el valor del HTML */ }
}
