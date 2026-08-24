/* ===========================================================================
   RESCATE DE VERSIÓN — se ejecuta ANTES que nada, en cada apertura.

   EL PROBLEMA QUE RESUELVE (visto de verdad al publicar la versión 2.0.1):
   el service worker de la versión anterior sirve el HTML desde la red pero los
   .js y .css desde SU caché. Al publicar una versión que cambia la estructura
   del HTML, el navegador junta el HTML NUEVO con el JavaScript VIEJO y la app
   revienta con un error de "null" — una pantalla en blanco, no un fallo
   discreto. Se arregla sola en la siguiente apertura, pero la primera queda
   rota, y "publicado pero roto" es indistinguible de "no publicado".

   Este archivo se carga con ?v=<versión> en la URL. Eso es lo que lo salva:
   el service worker antiguo manda a la RED cualquier petición con query, así
   que este código siempre es el nuevo, aunque todo lo demás esté cacheado.
   Si la caché que hay montada no es la de esta versión, la borra, desregistra
   el worker y recarga UNA vez. A partir de ahí todo viene de la red y encaja.

   La versión la reescribe tools/publica.sh y la vigila tools/audita.mjs.
   =========================================================================== */
(function () {
  var VERSION = '2.0.14';

  if (!('serviceWorker' in navigator) || !window.caches) return;

  // Una sola vez por versión y por pestaña: si algo fallara, mejor una app
  // rota que un bucle de recargas.
  var marca = 'meta.rescate.' + VERSION;
  try {
    if (sessionStorage.getItem(marca)) return;
  } catch (e) { return; }

  caches.keys().then(function (llaves) {
    // Sin cachés todavía (primera visita) no hay nada que rescatar.
    if (!llaves.length || llaves.indexOf('meta-v' + VERSION) !== -1) return;

    try { sessionStorage.setItem(marca, '1'); } catch (e) { return; }

    Promise.all(llaves.map(function (k) { return caches.delete(k); }))
      .then(function () { return navigator.serviceWorker.getRegistrations(); })
      .then(function (rs) {
        return Promise.all(rs.map(function (r) { return r.unregister(); }));
      })
      .then(function () { location.reload(); })
      .catch(function () { /* si no se puede, la app sigue e intentará actualizarse sola */ });
  }).catch(function () {});
})();
