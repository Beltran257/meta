/* ===========================================================================
   SERVICE WORKER — la lista de precaché NO se escribe aquí: se importa de
   shell.js, que es la única lista de archivos de la app. Añadir un módulo y
   olvidar el SW rompería el modo avión en silencio; con esto no puede pasar.

   EL `?v=` NO ES DECORATIVO — es lo que hace que las actualizaciones lleguen
   al iPhone. El navegador decide si hay versión nueva comparando los BYTES de
   este archivo. Si la versión viviera solo en shell.js, sw.js saldría
   idéntico en cada despliegue: Chrome lo pilla igual (compara también los
   scripts importados), pero SAFARI NO. Con la versión en esta línea, sw.js
   cambia en cada publicación y todos los navegadores ven la actualización.
   Lo pone tools/publica.sh y lo vigila tools/audita.mjs: no se toca a mano.
   =========================================================================== */
importScripts('./shell.js?v=2.0.17');

const CACHE = `meta-v${self.APP_VERSION}`;

self.addEventListener('install', ev => {
  ev.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(self.SHELL.map(async ruta => {
      const res = await fetch(ruta, { cache: 'reload' });
      if (!res.ok) throw new Error(`precaché ${ruta} -> ${res.status}`);
      await c.put(ruta, res);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', ev => {
  ev.waitUntil((async () => {
    const llaves = await caches.keys();
    await Promise.all(llaves.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', ev => {
  if (ev.data?.tipo === 'toma-el-control') self.skipWaiting();
});

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // --- navegación: SIEMPRE './'. Nunca '/index.html', que responde 307 y una
  //     redirección cacheada no se puede servir a una navegación.
  if (req.mode === 'navigate') {
    ev.respondWith((async () => {
      try {
        return await fetch(req);
      } catch {
        return (await caches.match('./', { cacheName: CACHE })) || Response.error();
      }
    })());
    return;
  }

  // --- API y feed ICS: siempre a la red, nunca cacheados por el SW (los
  //     datos cambian con cada tarea o nota que se apunta). ------------------
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ics/')) {
    ev.respondWith(fetch(req).catch(() =>
      new Response(JSON.stringify({ error: 'sin conexión' }), {
        status: 503, headers: { 'Content-Type': 'application/json' },
      })));
    return;
  }

  // --- comprobación de versión (./shell.js?c=…): siempre a la red y sin
  //     guardarla, o diría la versión vieja que estamos intentando detectar.
  if (url.search) {
    ev.respondWith(fetch(req).catch(() => Response.error()));
    return;
  }

  // --- estáticos: caché primero, y de fondo se refresca -------------------
  ev.respondWith((async () => {
    const hit = await caches.match(req, { cacheName: CACHE });
    if (hit) {
      ev.waitUntil((async () => {
        try {
          const res = await fetch(req);
          if (res.ok) (await caches.open(CACHE)).put(req, res);
        } catch {}
      })());
      return hit;
    }
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') (await caches.open(CACHE)).put(req, res.clone());
      return res;
    } catch {
      return Response.error();
    }
  })());
});
