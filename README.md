# Meta · organizador académico

> Organizador académico: horario, exámenes, tareas, apuntes y temario, con las
> horas de estudio sacadas solas de tu calendario.
> Versión desplegada: **2.0.48** · `https://meta.beltranfersan.workers.dev`

## Qué es

La app académica de Beltrán (2º de Bachillerato): horario, asignaturas,
exámenes, tareas, apuntes (foto, PDF y texto), notas, temario por asignatura y un
plan de "qué hago hoy". Es una PWA sin framework ni compilación sobre un
Cloudflare Worker.

Pantallas: `hoy`, `horario`, `tareas`, `examenes`, `estudiar`, `apuntes`,
`asignaturas`, `analisis`, `perfil`, `acceso`.

La idea central (nov 2026): **la app deduce, no pide**. Meta no obliga a apuntar
cada sesión de estudio: lee tu Google Tasks/Calendar y te pregunta solo lo que no
puede saber.

## Cómo funciona lo importante

**Estudio desde el calendario.** Tú planificas en Google Tasks con hora y marcas
las tareas cuando las haces. Un *Apps Script* que vive en TU cuenta de Google
(se genera desde Perfil → "Estudio desde tu calendario") lee cada hora esas
tareas y las clases particulares y se las manda a Meta con una clave propia que
solo sirve para eso. Así no hace falta ningún permiso nuevo de Google ni
verificar la app. `app/js/core/calendario.js` decide asignatura, tema y minutos;
`worker/estudio.js` guarda los bloques. Dos reglas que importan:

- un bloque **hecho** que desaparece del calendario (se limpian las tareas
  completadas) **sigue contando**: ya se estudió (`fusionarBloques`);
- lo que no se puede deducir se pregunta ("¿Lo hiciste?", "¿De qué asignatura
  es?", "¿Qué tema era?") y se recuerda.

**Temario.** Se sube el archivo del temario de cada asignatura (PDF, Word, foto o
texto) en Asignaturas → Temario. El PDF y la foto los lee el servidor
(`worker/temario.js`: `toMarkdown`, y un modelo de visión que *transcribe* las
fotos), el Word se abre en el navegador. `app/js/core/temario.js` saca los temas
(Tema N, Bloque N, listas numeradas con apartados A/B/C, índices con página,
entradas partidas…), los ordena y los deja revisar antes de guardar. Solo si no
encuentra estructura clara pregunta a la IA.
Reconoce también el formato del centro, una línea por punto
(`B1 2.6 OR. Y CARAC. DEL RÉGIMEN SEÑORIAL ... (REFERENTE 6)`): lo pasa a
«Bloque 1» con puntos `1.1`, `1.2`… (título en minúsculas, abreviaturas
expandidas, código y referente conservados entre paréntesis) y activa solo los
subtemas de la asignatura, así que cada punto se puntúa por separado. Se puede
pegar en la lista o subir como `.txt`.

**Examen = centro.** La ficha de cada examen marca qué temas entran, deja cambiar
tu porcentaje de cada tema (±10 %, son estimaciones tuyas), y enseña horas
dedicadas y apuntes por tema.

**Qué hago hoy.** `motor.planDelDia`: todos los exámenes (45 días), cada tema
pesa por lo cerca que está su examen y lo que tú dices que llevas; un examen sin
temario genera "poner el temario"; da una vuelta por todas las asignaturas antes
de repetir. Devuelve lo que cabe hoy y lo que seguiría ("si te sobra tiempo").

## Dónde está la inteligencia

**Los números los calcula el algoritmo, no el modelo.** `app/js/core/motor.js`
calcula estado académico, prioridades y plan — y funciona sin conexión. La IA
(Workers AI, binding `IA`) solo **redacta y explica** lo que el motor ya ha
decidido, y es el último recurso para leer un temario sin estructura. Es a
propósito: el modelo gratuito es flojo y un número calculado por un modelo no se
puede reproducir ni discutir.

## Integraciones

- **Feed ICS** al que se suscriben Google Calendar / Apple Calendar / Outlook.
- **Google** (OAuth, calendario y Drive) y **Microsoft** (Outlook del instituto,
  solo para proponer exámenes y entregas). El `state` es un número al azar de un
  solo uso en todos los flujos.
- **Apps Script del estudio** (ver arriba): lee Calendar y Tasks desde la cuenta
  del propio usuario.
- **Notion** y **NotebookLM**: `worker/dossier.js` arma un documento por
  asignatura (temario con tu estimación, apuntes, exámenes, notas) que NotebookLM
  lee como fuente. `tools/prueba-dossier.mjs` vigila sobre todo que **no se cuele
  contenido de una asignatura en el dossier de otra**.
- **Enlace de carpeta** (`tools/enlace-carpeta.mjs`): sincroniza una carpeta del
  Mac (asignatura/evaluación) con los apuntes de la cuenta.

## Arquitectura

```
app/       PWA: HTML + CSS + módulos ES, sin framework y sin paso de compilación
           shell.js  precaché y versión · sw.js  service worker
           js/core/  lógica (motor, calendario, temario, temas, store, sync…)
           js/vistas/ una pantalla por archivo
worker/    Cloudflare Worker: el router está en index.js, un archivo por área
           (estudio, temario, vigilancia, google, microsoft, notion, dossier…)
tools/     audita.mjs, prueba-*.mjs, vigila.mjs, papelera.mjs, backup.mjs, publica.sh
.github/   workflows (audita, vigila) y dependabot · .githooks/pre-push
```

Un solo Worker sirve **la app y la API**: lo que no empieza por `/api/` lo
responde el binding `ASSETS` (los estáticos), y lo demás pasa por el router. No
hay build: lo que está en `app/` es exactamente lo que llega al navegador. Todo
el estado del navegador pasa por `app/js/core/registry.js` (una sola lista de
claves: copia, borrado y sincronización salen de ella).

## Cómo se trabaja

```bash
npm run audita     # análisis estático: precaché, CSP, ids, acciones, imports, versiones, guardas del worker
npm run prueba     # pruebas sin red (tools/prueba-*.mjs)
npm run publica    # sube versión, audita, despliega, VERIFICA en producción, sube a GitHub y vigila
npm run vigila     # revisa producción AHORA (lo mismo que corre solo cada 6 h)
npm run hooks      # activa el guardián de git: audita y prueba antes de cada push
npm run papelera   # recupera datos que la vigilancia vio desaparecer (ver más abajo)
```

`tools/publica.sh` es el único camino a producción: sube la versión en
`app/shell.js` + `app/sw.js` + `app/arranque.js` a la vez (si se descuadran,
Safari se queda con el JS viejo), pasa la auditoría y **todas** las pruebas
(hay un guardián que falla si una prueba existe y no se ejecuta aquí), despliega,
y luego **comprueba contra la URL real** versión, service worker y cabeceras.

Los secretos van con `npx wrangler secret put NOMBRE`, nunca en un archivo del
repo. `.dev.vars` es solo para local y está en `.gitignore`.

## Qué vigila que esto no se rompa

| Capa | Dónde | Cuándo |
|---|---|---|
| Análisis estático (sintaxis, **imports que existen**, precaché, CSP, acciones…) | `tools/audita.mjs` | antes de publicar, en cada push/PR, cada lunes |
| Pruebas sin red | `tools/prueba-*.mjs` | antes de publicar, en cada push/PR, cada lunes |
| Guardián de git | `.githooks/pre-push` (`npm run hooks`) | antes de cada `git push` |
| **Producción, de fuera** | `.github/workflows/vigila.yml` → `tools/vigila.mjs` | **cada 6 h**, sola; abre/cierra una incidencia |
| Verificación tras desplegar | segundo tramo de `tools/publica.sh` | al publicar |
| Estado en vivo | `GET /api/salud` | Morning Briefing, una vez al día |
| Logs | `[observability]` en `wrangler.toml` | 7 días de errores con traza |
| Copia de seguridad | Morning Briefing, cada noche | diaria |
| Límite de peticiones | binding `LIMITE` sobre `/api/*` | siempre |
| Acciones de GitHub al día | `.github/dependabot.yml` | semanal |

### Qué mira `vigila` (y qué hacer si salta)

`GET /api/salud` devuelve, además de limitador/cuentas/ia: `google`, `datos`,
`estudio` y `errores`. Ninguno identifica a nadie.

| Alarma | Significa | Qué hacer |
|---|---|---|
| `google: HAY QUE RECONECTAR` | el permiso de Google caducó o se revocó | Perfil → Volver a conectar Google |
| `datos: ALERTA: sesiones 70→31` | una sección **encogió de golpe** al sincronizar (nació de perder ~13 h de estudio sin enterarse nadie) | `npm run papelera lista` y `npm run papelera restaura <espacio> <sección>`; la papelera guarda 30 días |
| `estudio: ATRASADO` | el Apps Script lleva >6 h sin enviar | abrir script.google.com → "Meta estudio" → Ejecuciones; o reinstalarlo desde Perfil |
| `errores: …` | un error de JavaScript le salió a un aparato (iPad…) | el mensaje trae archivo y línea; se corrige y publica |
| versiones no cuadran / precaché roto | despliegue a medias: el iPad se quedaría con una mezcla de app vieja y nueva | `npm run publica` |
| ruta privada abierta sin sesión | **fallo de seguridad** | corregir ya |

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
- La clave del Apps Script solo entrega bloques de estudio: no abre la cuenta.
- Lo privado pide sesión, y `vigila` lo comprueba de fuera cada 6 h.

## Límites conocidos

- Los archivos de apuntes van a **KV y no a R2** a propósito: R2 pide tarjeta en
  la cuenta (aunque no cobre dentro de lo gratis). KV es gratis sin tarjeta, con
  tope de 1 GB y 25 MB por valor. Los archivos de más de 20 MB (hasta 100 MB) se
  suben y se guardan **en trozos de 10 MB** y se sirven como uno solo; no se lee
  su contenido (ni OCR ni temas): se guardan en Apuntes y el tema lo dice el
  nombre del archivo o se indica a mano. Si se queda corto, se pasa a R2
  cambiando solo `worker/archivos.js`.
- Sin cron propio (tope de 5 por cuenta): lo periódico va por GitHub Actions
  (`vigila`) y por Morning Briefing.
- Un PDF escaneado (sin texto) no se puede leer para sacar temario: se suben
  fotos de las páginas del índice.
- El texto leído de un PDF en `apuntesMeta` se corta a 4.000 caracteres.
