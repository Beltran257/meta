/* ===========================================================================
   GOOGLE CALENDAR — conexión real (lectura y escritura), aparte del feed ICS.
   Un solo scope, calendar.events: crea/actualiza/borra en SU calendario
   principal los exámenes y entregas que él apunta en Meta. El token vive en
   KV, atado al mismo código de sincronización que ya usa el resto de la app
   (nunca a una cuenta ni a una contraseña).
   =========================================================================== */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const CAL_BASE = 'https://www.googleapis.com/calendar/v3';
/* calendar.events -> exámenes y entregas en su calendario.
   drive.file      -> los dossieres por asignatura que NotebookLM sigue.
                      Es el scope de Drive MÁS restringido que existe: la app
                      solo puede tocar los archivos que ella misma ha creado,
                      no ve nada más del Drive de nadie. Google lo clasifica
                      como no sensible, así que tampoco dispara su revisión
                      larga de scopes restringidos. */
const SCOPE = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

export function urlAutorizacion(env, redirectUri, state) {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPE);
  u.searchParams.set('access_type', 'offline');
  // 'consent' fuerza a Google a devolver refresh_token SIEMPRE, incluso si él
  // ya había autorizado antes: sin esto, una reconexión tras desconectar se
  // queda sin refresh_token y la app deja de poder renovar el acceso sola.
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('state', state);
  return u.toString();
}

export async function intercambiarCodigo(env, code, redirectUri) {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri, grant_type: 'authorization_code',
    }),
  });
  if (!r.ok) throw new Error('token exchange failed: ' + (await r.text()).slice(0, 200));
  return r.json();
}

async function refrescarToken(env, refreshToken) {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken, client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET, grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) throw new Error('refresh failed: ' + (await r.text()).slice(0, 200));
  return r.json();
}

/* --- ENTRAR CON GOOGLE ------------------------------------------------------
   Mismo cliente OAuth que la conexión de calendario, pero pidiendo solo los
   permisos de identidad: así "entrar con Google" no pide acceso al calendario
   a quien únicamente quiere una cuenta. No hace falta registrar otra URL de
   retorno en la consola de Google porque el callback es el mismo: lo que
   distingue los dos flujos es el prefijo del parámetro state. */
const SCOPE_LOGIN = 'openid email profile';

export function urlLogin(env, redirectUri, state) {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPE_LOGIN);
  u.searchParams.set('state', state);
  return u.toString();
}

/** Identidad de quien acaba de entrar: id estable de Google (sub), correo y
    nombre. El 'sub' es lo que se guarda; el correo puede cambiar. */
export async function perfilDe(accessToken) {
  const r = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) return null;
  const p = await r.json();
  return { sub: p.id, email: p.email || '', nombre: p.name || '' };
}

export async function emailDe(accessToken) {
  const r = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) return null;
  return (await r.json())?.email || null;
}

export async function revocar(refreshToken) {
  try {
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }),
    });
  } catch { /* si falla, el token igualmente se borra de KV: deja de usarse */ }
}

/** Access token válido para este código, renovando con el refresh_token si
    hace falta. Devuelve null si no hay conexión de Google para este buzón. */
async function accessTokenDe(env, codigo) {
  const clave = `google:${codigo}`;
  const g = await env.META_DATOS.get(clave, 'json');
  if (!g?.refresh_token) return null;

  if (g.access_token && Date.now() < (g.expira || 0)) return g.access_token;

  /* UN REFRESH QUE FALLA POR `invalid_grant` NO ES UN FALLO PASAJERO: el
     permiso ya no existe (caducó, se revocó, o cambió la contraseña de
     Google). Antes esto solo lanzaba una excepción, y como `estadoConexion`
     mira únicamente si hay refresh_token guardado, la app seguía diciendo
     "conectado" mientras llevaba semanas sin escribir nada en el calendario.
     Ahora se anota en la ficha, para que la pantalla pueda pedir volver a
     conectar en vez de callarse. Encontrado el 7 sep 2026: el token llevaba
     caducado sin que nada lo dijera. */
  let t;
  try {
    t = await refrescarToken(env, g.refresh_token);
  } catch (e) {
    const texto = String(e?.message || e);
    if (texto.includes('invalid_grant')) {
      g.roto = { desde: Date.now(), motivo: 'el permiso de Google ya no vale' };
      await env.META_DATOS.put(clave, JSON.stringify(g));
    }
    throw e;
  }

  g.access_token = t.access_token;
  g.expira = Date.now() + Math.max(0, (t.expires_in || 3600) - 60) * 1000;
  delete g.roto; // volvió a funcionar
  await env.META_DATOS.put(clave, JSON.stringify(g));
  return g.access_token;
}

async function llamarCalendar(accessToken, method, path, cuerpo) {
  return fetch(CAL_BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
}

function eventoDeTarea(t, nombreAsig) {
  const esExamen = t.tipo === 'examen';
  const [a, m, d] = t.fecha.split('-').map(Number);
  const fin = new Date(a, m - 1, d + 1); // fin EXCLUSIVO, como en el feed ICS
  const finYmd = `${fin.getFullYear()}-${String(fin.getMonth() + 1).padStart(2, '0')}-${String(fin.getDate()).padStart(2, '0')}`;
  return {
    summary: `${esExamen ? 'Examen' : 'Entrega'}: ${nombreAsig} — ${t.titulo}`,
    description: t.notas || undefined,
    start: { date: t.fecha },
    end: { date: finYmd },
  };
}

/** Deja SU Google Calendar igual que la lista de tareas del buzón: crea lo
    que falta, actualiza lo que cambió y borra lo que ya no está. Se apoya en
    un mapa tareaId -> eventId guardado aparte, así una tarea editada
    actualiza el MISMO evento en vez de duplicarlo. */
export async function reconciliar(env, codigo, buzon) {
  const accessToken = await accessTokenDe(env, codigo);
  if (!accessToken) return;

  const asignaturas = buzon?.claves?.asignaturas?.datos || [];
  const tareas = (buzon?.claves?.tareas?.datos || []).filter(t => t.fecha);
  const nombreDe = id => asignaturas.find(a => a.id === id)?.nombre || 'Sin asignatura';

  const mk = `gmap:${codigo}`;
  const mapa = (await env.META_DATOS.get(mk, 'json')) || {};
  const vivos = new Set(tareas.map(t => t.id));

  for (const [tareaId, eventId] of Object.entries(mapa)) {
    if (vivos.has(tareaId)) continue;
    await llamarCalendar(accessToken, 'DELETE', `/calendars/primary/events/${eventId}`).catch(() => {});
    delete mapa[tareaId];
  }

  for (const t of tareas) {
    const cuerpo = eventoDeTarea(t, nombreDe(t.asignaturaId));
    if (mapa[t.id]) {
      const r = await llamarCalendar(accessToken, 'PUT', `/calendars/primary/events/${mapa[t.id]}`, cuerpo);
      // el evento pudo borrarse a mano en Google: si ya no existe, se recrea
      if (r.status === 404 || r.status === 410) delete mapa[t.id];
      else {
        if (!r.ok) console.log('google-put-fallo', codigo, r.status, (await r.text()).slice(0, 200));
        continue;
      }
    }
    const r = await llamarCalendar(accessToken, 'POST', '/calendars/primary/events', cuerpo);
    if (r.ok) mapa[t.id] = (await r.json()).id;
    else console.log('google-post-fallo', codigo, r.status, (await r.text()).slice(0, 200));
  }

  await env.META_DATOS.put(mk, JSON.stringify(mapa));
}

/* ===========================================================================
   BLOQUEO DE RECUPERACIÓN — lo pide Salud (project_salud_sueno).

   Salud decide, con TUS medias de las últimas noches, si un día pide
   recuperación; el evento lo pone aquí porque es aquí donde vive la conexión
   con Google. La alternativa era que Salud tuviera su propio OAuth, y eso
   obliga a publicar OTRA app en Google: política de privacidad, condiciones y
   dominio verificado en Search Console, o el refresh token caduca a los 7
   días. Una conexión ya montada y mantenida en un solo sitio es mejor que dos
   a medias.

   Un evento por día como mucho, con su id guardado en `saludcal:<codigo>`
   igual que `gmap:` para las tareas: reenviar el mismo día actualiza el MISMO
   evento en vez de duplicarlo, y si el día deja de pedir recuperación (porque
   cambió un umbral) el evento se borra en vez de quedarse mintiendo.
   =========================================================================== */
const kBloqueos = codigo => `saludcal:${codigo}`;

export async function bloqueoRecuperacion(env, codigo, { fecha, inicio, fin, titulo, descripcion, activo }) {
  let accessToken;
  try {
    accessToken = await accessTokenDe(env, codigo);
  } catch (e) {
    // Que Salud reciba el motivo y lo enseñe, en vez de un 500 mudo.
    return { ok: false, estado: String(e?.message || e).includes('invalid_grant')
      ? 'hay que volver a conectar Google en Meta' : 'no se pudo renovar el acceso a Google' };
  }
  if (!accessToken) return { ok: false, estado: 'sin Google conectado en Meta' };

  const mapa = (await env.META_DATOS.get(kBloqueos(codigo), 'json')) || {};
  const eventId = mapa[fecha];

  if (!activo) {
    if (!eventId) return { ok: true, estado: 'no hacía falta' };
    await llamarCalendar(accessToken, 'DELETE', `/calendars/primary/events/${eventId}`).catch(() => {});
    delete mapa[fecha];
    await env.META_DATOS.put(kBloqueos(codigo), JSON.stringify(mapa));
    return { ok: true, estado: 'bloqueo retirado' };
  }

  const cuerpo = {
    summary: titulo,
    description: descripcion,
    start: { dateTime: `${fecha}T${inicio}:00`, timeZone: 'Europe/Madrid' },
    end: { dateTime: `${fecha}T${fin}:00`, timeZone: 'Europe/Madrid' },
    transparency: 'opaque',
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 15 }] },
  };

  if (eventId) {
    const r = await llamarCalendar(accessToken, 'PUT', `/calendars/primary/events/${eventId}`, cuerpo);
    if (r.ok) return { ok: true, estado: 'bloqueo actualizado' };
    // Se pudo borrar a mano en Google: entonces se recrea, como en reconciliar().
    if (r.status !== 404 && r.status !== 410) {
      console.log('salud-bloqueo-put-fallo', codigo, r.status, (await r.text()).slice(0, 200));
      return { ok: false, estado: `error ${r.status}` };
    }
    delete mapa[fecha];
  }

  const r = await llamarCalendar(accessToken, 'POST', '/calendars/primary/events', cuerpo);
  if (!r.ok) {
    console.log('salud-bloqueo-post-fallo', codigo, r.status, (await r.text()).slice(0, 200));
    return { ok: false, estado: `error ${r.status}` };
  }
  mapa[fecha] = (await r.json()).id;
  await env.META_DATOS.put(kBloqueos(codigo), JSON.stringify(mapa));
  return { ok: true, estado: 'bloqueo creado' };
}

export async function estadoConexion(env, codigo) {
  const g = await env.META_DATOS.get(`google:${codigo}`, 'json');
  // `roto` lo pone accessTokenDe cuando Google contesta invalid_grant. Sin
  // esto, "conectado" solo significaba "hay un refresh token guardado", que
  // es verdad incluso cuando ese token dejó de servir hace semanas.
  return {
    conectado: !!g?.refresh_token && !g?.roto,
    email: g?.email || null,
    ultima: g?.ultima || null,
    roto: g?.roto || null,
  };
}

export async function guardarConexion(env, codigo, tokens, email) {
  await env.META_DATOS.put(`google:${codigo}`, JSON.stringify({
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token,
    expira: Date.now() + Math.max(0, (tokens.expires_in || 3600) - 60) * 1000,
    email,
    // Google devuelve aquí lo que el usuario CONCEDIÓ de verdad, que no tiene
    // por qué ser todo lo que se pidió. Se guarda para poder decirle "hay que
    // reconectar" en vez de fallar con un 403 críptico cuando una conexión
    // vieja no tenga todavía el permiso de Drive.
    scope: tokens.scope || '',
    ultima: Date.now(),
  }));
}

/** ¿Esta conexión trae ya el permiso de Drive? Las conexiones hechas antes de
    agosto de 2026 no lo tienen: hay que volver a conectar (el flujo ya fuerza
    prompt=consent, así que reconectar vuelve a pedir permisos). */
export async function tieneDrive(env, codigo) {
  const g = await env.META_DATOS.get(`google:${codigo}`, 'json');
  if (!g?.refresh_token) return false;
  return String(g.scope || '').includes('drive.file');
}

export async function desconectar(env, codigo) {
  const clave = `google:${codigo}`;
  const g = await env.META_DATOS.get(clave, 'json');
  if (g?.refresh_token) await revocar(g.refresh_token);
  await env.META_DATOS.delete(clave);
  await env.META_DATOS.delete(`gmap:${codigo}`);
}

/* ===========================================================================
   DRIVE — los dossieres que NotebookLM sigue.

   POR QUÉ UN DOCUMENTO DE GOOGLE Y NO UN PDF, UN .txt NI UNA URL:
   desde el 26 de mayo de 2026 NotebookLM (Gemini Notebook) mantiene al día
   SOLO las fuentes que son Documentos, Hojas o Presentaciones de Google. Todo
   lo demás —páginas web, PDF, archivos subidos, YouTube— se queda congelado
   en el momento en que se añade y hay que volver a subirlo a mano. Así que un
   documento de verdad es lo único que consigue que él apunte algo en META y
   su cuaderno de NotebookLM se entere solo.

   Tampoco vale dejar caer un archivo en la carpeta de Drive del ordenador:
   Drive para escritorio sube tal cual, un .txt se queda en .txt (comprobado
   el 25 ago 2026), y NotebookLM lo trataría como archivo subido, sin seguirlo.

   Se sube HTML, no texto plano: al convertirlo, Google respeta los títulos y
   las listas, y NotebookLM cita "según el apartado X" en vez de soltar un
   muro de texto.
   =========================================================================== */

const DRIVE_SUBIDA = 'https://www.googleapis.com/upload/drive/v3/files';
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const MIME_DOC = 'application/vnd.google-apps.document';
const LIMITE = '\r\n--meta-dossier\r\n';
const CIERRE = '\r\n--meta-dossier--\r\n';

/** Traduce los fallos de Google a algo accionable. Un 403 aquí casi siempre
    es una de dos cosas muy concretas, y decir "error 403" no ayuda a nadie. */
function motivoDrive(status, texto) {
  const t = String(texto || '');
  if (/accessNotConfigured|has not been used in project|SERVICE_DISABLED/i.test(t)) {
    return { motivo: 'api-apagada', detalle: 'La API de Google Drive está apagada en el proyecto de Google Cloud.' };
  }
  if (status === 401 || /insufficientPermissions|insufficient authentication|invalid_grant/i.test(t)) {
    return { motivo: 'reconectar', detalle: 'La conexión con Google no tiene todavía permiso de Drive.' };
  }
  if (status === 429 || /rateLimitExceeded|userRateLimitExceeded/i.test(t)) {
    return { motivo: 'espera', detalle: 'Google está limitando las peticiones; se reintenta luego.' };
  }
  return { motivo: 'fallo', detalle: t.slice(0, 200) || `error ${status}` };
}

function cuerpoMultiparte(metadatos, html) {
  return LIMITE
    + 'Content-Type: application/json; charset=UTF-8\r\n\r\n'
    + JSON.stringify(metadatos)
    + LIMITE
    + 'Content-Type: text/html; charset=UTF-8\r\n\r\n'
    + html
    + CIERRE;
}

const cabeceras = token => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'multipart/related; boundary=meta-dossier',
});

/** Crea el documento la primera vez y lo ACTUALIZA en las siguientes. Es
    importante que sea el mismo archivo siempre: si se creara uno nuevo cada
    vez, la fuente que él añadió al cuaderno se quedaría apuntando al viejo y
    dejaría de actualizarse — justo lo que se quiere evitar. */
export async function guardarDossier(env, codigo, { fileId, nombre, html }) {
  const token = await accessTokenDe(env, codigo);
  if (!token) return { error: { motivo: 'sin-conexion', detalle: 'Google no está conectado.' } };

  const nuevo = !fileId;
  const url = nuevo
    ? `${DRIVE_SUBIDA}?uploadType=multipart&fields=id,name,webViewLink`
    : `${DRIVE_SUBIDA}/${fileId}?uploadType=multipart&fields=id,name,webViewLink`;

  const meta = nuevo ? { name: nombre, mimeType: MIME_DOC } : { name: nombre };
  let r = await fetch(url, { method: nuevo ? 'POST' : 'PATCH', headers: cabeceras(token), body: cuerpoMultiparte(meta, html) });

  // Si el documento ya no existe (lo borró él desde Drive), se crea otra vez
  // en vez de dejar la sincronización rota para siempre.
  if (!nuevo && (r.status === 404 || r.status === 403)) {
    const t = await r.text();
    if (/notFound|File not found/i.test(t)) {
      r = await fetch(`${DRIVE_SUBIDA}?uploadType=multipart&fields=id,name,webViewLink`, {
        method: 'POST', headers: cabeceras(token),
        body: cuerpoMultiparte({ name: nombre, mimeType: MIME_DOC }, html),
      });
    } else {
      return { error: motivoDrive(r.status, t) };
    }
  }

  if (!r.ok) return { error: motivoDrive(r.status, await r.text()) };
  const d = await r.json();
  return { fileId: d.id, url: d.webViewLink || `https://docs.google.com/document/d/${d.id}/edit` };
}

/** Se llama al desconectar Google y al borrar la cuenta: los documentos los
    creó META, así que también los retira. */
export async function borrarDossier(env, codigo, fileId) {
  const token = await accessTokenDe(env, codigo);
  if (!token || !fileId) return;
  await fetch(`${DRIVE_API}/${fileId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
    .catch(() => { /* si ya no está, mejor */ });
}
