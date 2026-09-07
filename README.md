# Meta · organizador académico

> Organizador académico: horario, exámenes, tareas, apuntes y notas.
> Versión desplegada: **2.0.23** · `https://meta.beltranfersan.workers.dev`

## Qué es

La app académica: horario, asignaturas, exámenes, tareas, sesiones de estudio,
apuntes (foto y PDF), notas y un análisis del estado académico.

Pantallas: `hoy`, `horario`, `asignaturas`, `examenes`, `tareas`, `estudiar`,
`apuntes`, `captura`, `notas`, `analisis`, `buscar`, `perfil`, `acceso`.

## Dónde está la inteligencia

**Los números los calcula el algoritmo, no el modelo.** `app/js/core/motor.js`
calcula estado académico, prioridades y plan — y funciona sin conexión. La IA
(Workers AI, binding `IA`) solo **redacta y explica** lo que el motor ya ha
decidido. Es a propósito: el modelo gratuito es flojo y una nota calculada por
un modelo no se puede reproducir ni discutir.

## Integraciones

- **Feed ICS** al que se suscriben Google Calendar / Apple Calendar / Outlook.
- **Google y Microsoft** (OAuth) — el `state` es un número al azar de un solo
  uso en los dos flujos.
- **Notion** y **NotebookLM**: `worker/dossier.js` arma un documento por
  asignatura que NotebookLM lee como fuente. `tools/prueba-dossier.mjs` vigila
  sobre todo que **no se cuele contenido de una asignatura en el dossier de
  otra** — sería lo peor que puede pasar y no se notaría.

## Arquitectura

```
app/       PWA: HTML + CSS + módulos ES, sin framework y sin paso de compilación
           shell.js  precaché y versión
           sw.js     service worker
           _headers   cabeceras de seguridad y caché
worker/    Cloudflare Worker: el router está en index.js, un archivo por área
tools/     audita.mjs, prueba-*.mjs, backup.mjs, publica.sh
```

Un solo Worker sirve **la app y la API**: lo que no empieza por `/api/` lo
responde el binding `ASSETS` (los estáticos), y lo demás pasa por el router.
No hay build: lo que está en `app/` es exactamente lo que llega al navegador.

## Cómo se trabaja

```bash
npm run audita     # análisis estático: precaché, CSP, ids, acciones, versiones, guardas del worker
npm run prueba     # pruebas sin red (tools/prueba-*.mjs)
npm run publica    # sube versión, audita, despliega y VERIFICA en producción
```

`tools/publica.sh` es el único camino a producción: sube la versión en
`app/shell.js` + `app/sw.js` + `app/arranque.js` a la vez (si se descuadran,
Safari se queda con el JS viejo), pasa la auditoría, despliega, y luego
**comprueba contra la URL real** que la versión servida es la nueva, que el
service worker pide el shell nuevo y que las cabeceras de seguridad siguen
puestas. Si algo de eso no cuadra, sale con error.

Los secretos van con `npx wrangler secret put NOMBRE`, nunca en un archivo del
repo. `.dev.vars` es solo para local y está en `.gitignore`.

## Qué vigila que esto no se rompa

| Capa | Dónde |
|---|---|
| Análisis estático | `tools/audita.mjs`, obligatorio antes de cada despliegue |
| Pruebas sin red | `tools/prueba-*.mjs` |
| CI | `.github/workflows/audita.yml` — auditoría y pruebas en cada push y cada PR |
| Verificación en producción | el segundo tramo de `tools/publica.sh` |
| Logs | `[observability]` en `wrangler.toml`: 7 días de errores con traza |
| Estado en vivo | `GET /api/salud` |
| Vigilancia cruzada | Morning Briefing comprueba `/api/salud` de las demás una vez al día y lo dice en el informe |
| Límite de peticiones | binding `LIMITE` (ratelimit de Cloudflare) sobre `/api/*` |

## Seguridad

- CSP estricta (`default-src 'none'`, sin `unsafe-inline` ni `unsafe-eval`), en
  el `<meta>` del HTML **y** en `app/_headers`; el navegador aplica la más
  estricta de las dos, así que las dos tienen que decir lo mismo.
- `X-Frame-Options: DENY`, HSTS, `Referrer-Policy: no-referrer`,
  `Permissions-Policy` cerrada salvo lo que la app usa de verdad.
- Sin manejadores `onclick=` ni atributos `style=""`: todo por `data-accion` y
  CSS/CSSOM. La auditoría falla si aparece alguno.
- La contraseña se deriva en el navegador (PBKDF2-SHA256, 150.000 iteraciones)
  y nunca viaja en claro.

## Límites conocidos

- Los archivos de apuntes van a **KV y no a R2** a propósito: R2 pide tarjeta en
  la cuenta (aunque no cobre dentro de lo gratis). KV es gratis sin tarjeta, con
  tope de 1 GB y 25 MB por valor — de sobra para fotos y PDF de bachillerato. Si
  se queda corto, se pasa a R2 cambiando solo `worker/archivos.js`.
- Sin cron propio (tope de 5 por cuenta).
