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
  // tasks.readonly -> saber qué bloques de estudio del calendario marcó como
  //                   hechos (ver bloquesDeEstudio). Solo lectura.
  'https://www.googleapis.com/auth/tasks.readonly',
  // calendar.calendarlist.readonly -> encontrar sus otros calendarios (el
  //                   del horario, donde están las particulares). Solo la
  //                   lista: los eventos ya los cubre calendar.events.
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
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
  /* `verificado` NO es decorativo: auth.entrarConGoogle lo usa para decidir si
     puede reconocer una cuenta de meta por el CORREO. Sin él, quien
     consiguiera una identidad de Google con un correo sin verificar igual al
     de una cuenta creada con correo+contraseña entraba en su espacio sin
     saber la contraseña. Es el fallo clásico de enlazar cuentas por un correo
     que el proveedor no garantiza. */
  return { sub: p.id, email: p.email || '', nombre: p.name || '', verificado: p.verified_email === true };
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
    // Sin esto el estudio no se puede leer del calendario: conexiones de
    // antes de octubre de 2026 (ver tieneTareas).
    tareas: String(g?.scope || '').includes('tasks.readonly') && String(g?.scope || '').includes('calendar.calendarlist.readonly'),
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

/** ¿Esta conexión puede leer Google Tasks? Las hechas antes de octubre de
    2026 no: hay que volver a conectar, igual que con Drive. */
export async function tieneTareas(env, codigo) {
  const g = await env.META_DATOS.get(`google:${codigo}`, 'json');
  const scope = String(g?.scope || '');
  return !!g?.refresh_token && scope.includes('tasks.readonly') && scope.includes('calendar.calendarlist.readonly');
}

/* --- ESTUDIO DESDE EL CALENDARIO -----------------------------------------
   Él planifica en Google Tasks con hora: cada tarea con hora aparece en su
   calendario como un bloque, con un enlace a la tarea en la descripción
   ("…ve a https://tasks.google.com/task/<id>"). El bloque dice CUÁNDO y
   CUÁNTO; la casilla de la tarea dice si lo HIZO. Aquí se juntan las dos
   cosas y no se decide nada más: qué asignatura es, si cuenta como estudio y
   cuántos minutos suma lo calcula la app (app/js/core/calendario.js), que es
   donde están sus asignaturas y lo que ya ha corregido a mano. */
const TASKS_BASE = 'https://tasks.googleapis.com/tasks/v1';
const RE_TAREA = /tasks\.google\.com\/task\/([A-Za-z0-9_-]+)/;
const normaTitulo = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

/** Función pura: bloques del calendario + tareas -> bloques ya terminados con
    su estado. `estado` es 'hecha', 'pendiente' o 'sin-tarea' (no se encontró
    la tarea: borrada, o de una lista que no se pudo leer). */
export function bloquesDeEstudio(eventos, tareas, ahora = Date.now()) {
  const porId = new Map(), porTituloDia = new Map();
  for (const t of tareas || []) {
    const id = RE_TAREA.exec(String(t?.webViewLink || ''))?.[1];
    if (id) porId.set(id, t);
    if (t?.id) porId.set(String(t.id), t);
    if (t?.due) porTituloDia.set(`${normaTitulo(t.title)}|${String(t.due).slice(0, 10)}`, t);
  }
  const salida = [];
  for (const e of eventos || []) {
    const enlace = RE_TAREA.exec(String(e?.description || ''))?.[1];
    if (!enlace || e.status === 'cancelled') continue;
    const inicio = e.start?.dateTime, fin = e.end?.dateTime;
    if (!inicio || !fin) continue;                        // de día entero: no es un bloque
    const fi = Date.parse(fin), ii = Date.parse(inicio);
    if (!(fi > ii) || fi > ahora) continue;               // aún no ha terminado
    const t = porId.get(enlace) || porTituloDia.get(`${normaTitulo(e.summary)}|${inicio.slice(0, 10)}`);
    salida.push({
      id: String(e.id),
      titulo: String(e.summary || '').trim().slice(0, 140),
      inicio, fin,
      estado: !t ? 'sin-tarea' : t.status === 'completed' ? 'hecha' : 'pendiente',
      // La lista de Tasks donde está (si las tiene por asignatura, es la
      // pista más clara cuando el título no la dice).
      ...(t?.lista ? { lista: String(t.lista).slice(0, 80) } : {}),
    });
  }
  return salida.sort((a, b) => a.inicio.localeCompare(b.inicio));
}

/** Función pura: las clases particulares de sus OTROS calendarios (el del
    horario). No tienen tarea que marcar: una clase que ya pasó se da por
    hecha — si un día no la hay, se borra esa del calendario y deja de
    contar. Solo eventos con hora y con "particular" en el título: las
    clases del instituto no son estudio. */
const RE_PARTICULAR = /\bparticular(es)?\b/;
export function clasesParticulares(eventos, ahora = Date.now()) {
  const salida = [];
  for (const e of eventos || []) {
    if (e?.status === 'cancelled' || !RE_PARTICULAR.test(normaTitulo(e?.summary))) continue;
    const inicio = e.start?.dateTime, fin = e.end?.dateTime;
    if (!inicio || !fin || !(Date.parse(fin) > Date.parse(inicio)) || Date.parse(fin) > ahora) continue;
    salida.push({ id: 'p-' + e.id, titulo: String(e.summary).trim().slice(0, 140), inicio, fin, estado: 'hecha', fuente: 'particular' });
  }
  return salida;
}

async function todasLasPaginas(url, accessToken, clave, tope = 20) {
  const items = [];
  let token = null;
  for (let i = 0; i < tope; i++) {
    const u = new URL(url);
    if (token) u.searchParams.set('pageToken', token);
    const r = await fetch(u, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!r.ok) throw Object.assign(new Error(`google ${r.status}`), { status: r.status });
    const d = await r.json();
    items.push(...(d[clave] || []));
    token = d.nextPageToken;
    if (!token) break;
  }
  return items;
}

/** Bloques de estudio desde `desde` (YYYY-MM-DD) hasta ahora. */
export async function estudioDelCalendario(env, codigo, desde, ahora = new Date()) {
  const accessToken = await accessTokenDe(env, codigo).catch(() => null);
  if (!accessToken) return { error: 'Google no está conectado.', motivo: 'sin-google', status: 409 };
  if (!(await tieneTareas(env, codigo))) {
    return { error: 'Vuelve a conectar Google para que META pueda ver qué tareas has marcado como hechas.', motivo: 'sin-permiso-tareas', status: 409 };
  }
  const timeMin = new Date(`${desde}T00:00:00Z`).toISOString();
  try {
    const qCal = new URLSearchParams({
      timeMin, timeMax: ahora.toISOString(), singleEvents: 'true', orderBy: 'startTime',
      maxResults: '2500', fields: 'items(id,summary,description,start,end,status),nextPageToken',
    });
    const eventos = await todasLasPaginas(`${CAL_BASE}/calendars/primary/events?${qCal}`, accessToken, 'items');
    const listas = await todasLasPaginas(`${TASKS_BASE}/users/@me/lists?maxResults=100`, accessToken, 'items', 5);
    const tareas = [];
    for (const l of listas) {
      const qT = new URLSearchParams({
        showCompleted: 'true', showHidden: 'true', updatedMin: timeMin, maxResults: '100',
        fields: 'items(id,title,status,due,webViewLink),nextPageToken',
      });
      const deLista = await todasLasPaginas(`${TASKS_BASE}/lists/${encodeURIComponent(l.id)}/tasks?${qT}`, accessToken, 'items');
      tareas.push(...deLista.map(t => ({ ...t, lista: l.title })));
    }
    // Sus otros calendarios propios (no los festivos ni los compartidos):
    // solo se quedan las particulares. Sin `q` a propósito: la búsqueda de
    // Google no garantiza que "particular" encuentre "Particulares".
    const calendarios = await todasLasPaginas(`${CAL_BASE}/users/me/calendarList?minAccessRole=owner&maxResults=50`, accessToken, 'items', 2);
    const otros = [];
    for (const c of calendarios.filter(c => !c.primary)) {
      const qP = new URLSearchParams({
        timeMin, timeMax: ahora.toISOString(), singleEvents: 'true',
        maxResults: '2500', fields: 'items(id,summary,start,end,status),nextPageToken',
      });
      otros.push(...await todasLasPaginas(`${CAL_BASE}/calendars/${encodeURIComponent(c.id)}/events?${qP}`, accessToken, 'items'));
    }
    return {
      bloques: [...bloquesDeEstudio(eventos, tareas, ahora.getTime()), ...clasesParticulares(otros, ahora.getTime())]
        .sort((a, b) => a.inicio.localeCompare(b.inicio)),
    };
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      return { error: 'Google no deja leer el calendario o las tareas: vuelve a conectar Google.', motivo: 'sin-permiso-tareas', status: 409 };
    }
    return { error: 'No se pudo leer tu calendario ahora mismo.', motivo: 'google', status: 502 };
  }
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

/* ===========================================================================
   LA SONDA DE LA CONEXIÓN

   El permiso de Google se cae solo, y esa es la parte que no se puede
   arreglar desde aquí: mientras la pantalla de consentimiento esté "en
   pruebas" en Google Cloud, Google caduca el refresh token a los SIETE DÍAS
   hagas lo que hagas. Ya pasó el 7 sep 2026.

   Lo que sí se puede arreglar es enterarse. `roto` solo se marca cuando algo
   INTENTA usar el token, y lo que lo usa —el bloqueo por recuperación de
   Salud, o él abriendo esta app— puede tardar semanas en volver a intentarlo.
   Mientras tanto la app dice "conectado" y el calendario se queda en blanco.

   Esto lo intenta a propósito, una vez cada seis horas como mucho, para que
   el fallo aparezca solo. Lo lee `GET /api/salud`, que es lo que Morning
   Briefing consulta cada mañana y acaba en el aviso del iPad.
   =========================================================================== */
const K_SONDA = 'sonda:google';
const SONDA_CADA_MS = 6 * 3600 * 1000;

export async function sondaGoogle(env) {
  const guardado = await env.META_DATOS.get(K_SONDA, 'json').catch(() => null);
  if (guardado && Date.now() - (guardado.cuando || 0) < SONDA_CADA_MS) return guardado.estado;

  let estado = 'sin conectar';
  try {
    const { keys } = await env.META_DATOS.list({ prefix: 'google:' });
    const codigos = keys.map(k => k.name.slice('google:'.length)).filter(Boolean);
    let conectadas = 0;
    const rotas = [];
    for (const codigo of codigos) {
      const g = await env.META_DATOS.get(`google:${codigo}`, 'json');
      if (!g?.refresh_token) continue;
      conectadas++;
      // accessTokenDe marca `roto` él solo si Google contesta invalid_grant.
      try { await accessTokenDe(env, codigo); } catch { /* lo dirá el flag */ }
      const despues = await env.META_DATOS.get(`google:${codigo}`, 'json');
      if (despues?.roto) rotas.push(codigo);
    }
    /* Se dice QUÉ conexión hay que reconectar, no solo cuántas: un aviso que
       repite "hay una conexión rota" todos los días sin decir cuál se acaba
       ignorando, y él tiene dos espacios.
       PERO EL CÓDIGO ENTERO NO PUEDE SALIR DE AQUÍ. `sondaGoogle` la lee
       `GET /api/salud`, que se resuelve ANTES de la comprobación de sesión
       (worker/index.js): es una ruta pública. Y el código de espacio ES la
       llave del feed ICS — `GET /ics/<codigo>.ics` no pide cookie a propósito
       (worker/index.js, apiIcs). Publicarlo entero regalaba a cualquiera el
       horario de exámenes y entregas del curso. Y no era un caso raro: con la
       pantalla de consentimiento "en pruebas" Google caduca el token cada 7
       días, así que `rotas` casi nunca está vacío.
       Con dos caracteres sobran para distinguir sus espacios, y quedan 30 bits
       que el límite por IP hace inservibles. El arreglo de verdad es separar
       el identificador del espacio del testigo del feed ICS, para poder
       rotarlo; eso es otro cambio. */
    const tapado = c => `${String(c).slice(0, 2)}${'·'.repeat(Math.max(0, String(c).length - 2))}`;
    estado = !conectadas ? 'sin conectar'
      : rotas.length ? `HAY QUE RECONECTAR: ${rotas.map(tapado).join(', ')} (${rotas.length} de ${conectadas})`
        : 'conectado';
  } catch (e) {
    estado = `error: ${String(e?.message || e).slice(0, 80)}`;
  }
  await env.META_DATOS.put(K_SONDA, JSON.stringify({ cuando: Date.now(), estado })).catch(() => {});
  return estado;
}
