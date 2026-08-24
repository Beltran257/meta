/* ===========================================================================
   RESCATE DE VERSIÓN — se ejecuta ANTES que nada, en cada apertura.

   EL PROBLEMA QUE RESUELVE (visto de verdad en meta al publicar la 2.0.1):
   el service worker de la versión anterior sirve el HTML desde la red pero los
   .js y .css desde SU caché. Al publicar una versión que cambia la estructura
   del HTML, el navegador junta el HTML NUEVO con el JavaScript VIEJO y la app
   revienta con un error de "null" — una pantalla en blanco, no un fallo
   discreto. Se arregla sola en la siguiente apertura, pero la primera queda
   rota, y "publicado pero roto" es indistinguible de "no publicado".

   Este archivo se carga con ?v=<versión> en la URL. Eso es lo que lo salva:
   el service worker antiguo manda a la RED cualquier petición con query, así
   que este código siempre es el nuevo, aunque todo lo demás esté cacheado.
   Si encuentra el armazón de una versión anterior, lo borra, desregistra el
   worker y recarga UNA vez. A partir de ahí todo viene de la red y encaja.

   SOLO borra las cachés del armazón (las que empiezan por el prefijo de abajo
   y no son la de esta versión), nunca todas.
   meta tiene una sola caché, así que aquí "el armazón caducado" es todo lo que
   hay; se filtra igual por prefijo para que las cuatro apps lleven exactamente
   el mismo rescate y no vuelvan a divergir.

   La versión la reescribe tools/publica.sh y la vigila tools/audita.mjs.
   =========================================================================== */
(function () {
  var VERSION = '2.0.16';
  var PREFIJO = 'meta-v';

  if (!('serviceWorker' in navigator) || !window.caches) return;

  // Una sola vez por versión y por pestaña: si algo fallara, mejor una app
  // rota que un bucle de recargas.
  var marca = 'meta.rescate.' + VERSION;
  try {
    if (sessionStorage.getItem(marca)) return;
  } catch (e) { return; }

  caches.keys().then(function (llaves) {
    // Solo el armazón de versiones anteriores. Si no hay ninguno, no hay nada
    // que rescatar: ni primera visita, ni versión ya al día.
    var viejas = llaves.filter(function (k) {
      return k.indexOf(PREFIJO) === 0 && k !== PREFIJO + VERSION;
    });
    if (!viejas.length) return;

    try { sessionStorage.setItem(marca, '1'); } catch (e) { return; }

    Promise.all(viejas.map(function (k) { return caches.delete(k); }))
      .then(function () { return navigator.serviceWorker.getRegistrations(); })
      .then(function (rs) {
        return Promise.all(rs.map(function (r) { return r.unregister(); }));
      })
      .then(function () { location.reload(); })
      .catch(function () { /* si no se puede, la app sigue e intentará actualizarse sola */ });
  }).catch(function () {});
})();
