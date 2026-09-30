/* ===========================================================================
   OUTLOOK / MICROSOFT 365 — conexión real al calendario del centro, mismo
   patrón que worker/google.js: un solo scope (Calendars.ReadWrite), token
   atado al código de sincronización, nunca a una cuenta guardada aparte.
   La app está registrada en el propio tenant del instituto (no multi-tenant),
   así que el endpoint de token lleva el ID de ese tenant, no "common".
   =========================================================================== */

const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPE = 'offline_access https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/User.Read';

const authUrl = env => `https://login.microsoftonline.com/${env.MS_TENANT_ID}/oauth2/v2.0/authorize`;
const tokenUrl = env => `https://login.microsoftonline.com/${env.MS_TENANT_ID}/oauth2/v2.0/token`;

export function urlAutorizacion(env, redirectUri, state) {
  const u = new URL(authUrl(env));
  u.searchParams.set('client_id', env.MS_CLIENT_ID);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('response_mode', 'query');
  u.searchParams.set('scope', SCOPE);
  u.searchParams.set('state', state);
  // 'consent' fuerza a que Microsoft vuelva a pedir el visto bueno y a
  // devolver refresh_token siempre, igual que 'prompt=consent' en Google.
  u.searchParams.set('prompt', 'consent');
  return u.toString();
}

export async function intercambiarCodigo(env, code, redirectUri) {
  const r = await fetch(tokenUrl(env), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: env.MS_CLIENT_ID, client_secret: env.MS_CLIENT_SECRET,
      redirect_uri: redirectUri, grant_type: 'authorization_code', scope: SCOPE,
    }),
  });
  if (!r.ok) throw new Error('token exchange failed: ' + (await r.text()).slice(0, 200));
  return r.json();
}

async function refrescarToken(env, refreshToken) {
  const r = await fetch(tokenUrl(env), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken, client_id: env.MS_CLIENT_ID, client_secret: env.MS_CLIENT_SECRET,
      grant_type: 'refresh_token', scope: SCOPE,
    }),
  });
  if (!r.ok) throw new Error('refresh failed: ' + (await r.text()).slice(0, 200));
  return r.json();
}

export async function emailDe(accessToken) {
  const r = await fetch(`${GRAPH}/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) return null;
  const d = await r.json();
  return d.mail || d.userPrincipalName || null;
}

async function accessTokenDe(env, codigo) {
  const clave = `ms:${codigo}`;
  const g = await env.META_DATOS.get(clave, 'json');
  if (!g?.refresh_token) return null;

  if (g.access_token && Date.now() < (g.expira || 0)) return g.access_token;

  const t = await refrescarToken(env, g.refresh_token);
  g.access_token = t.access_token;
  if (t.refresh_token) g.refresh_token = t.refresh_token; // MS rota el refresh_token a veces
  g.expira = Date.now() + Math.max(0, (t.expires_in || 3600) - 60) * 1000;
  await env.META_DATOS.put(clave, JSON.stringify(g));
  return g.access_token;
}

async function llamarGraph(accessToken, method, path, cuerpo) {
  return fetch(GRAPH + path, {
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
  const fin = new Date(a, m - 1, d + 1);
  const finYmd = `${fin.getFullYear()}-${String(fin.getMonth() + 1).padStart(2, '0')}-${String(fin.getDate()).padStart(2, '0')}`;
  return {
    subject: `${esExamen ? 'Examen' : 'Entrega'}: ${nombreAsig} — ${t.titulo}`,
    isAllDay: true,
    start: { dateTime: `${t.fecha}T00:00:00`, timeZone: 'Europe/Madrid' },
    end: { dateTime: `${finYmd}T00:00:00`, timeZone: 'Europe/Madrid' },
    body: t.notas ? { contentType: 'text', content: t.notas } : undefined,
  };
}

/** Mismo criterio que reconciliar() de Google: deja el calendario de Outlook
    igual que la lista de tareas del buzón, con un mapa tareaId->eventId. */
export async function reconciliar(env, codigo, buzon) {
  const accessToken = await accessTokenDe(env, codigo);
  if (!accessToken) return;

  const asignaturas = buzon?.claves?.asignaturas?.datos || [];
  // Lo importado DEL calendario del centro (origenMs) ya vive ahí: escribirlo
  // de vuelta lo duplicaría en el propio calendario del instituto.
  const tareas = (buzon?.claves?.tareas?.datos || []).filter(t => t.fecha && !t.origenMs);
  const nombreDe = id => asignaturas.find(a => a.id === id)?.nombre || 'Sin asignatura';

  const mk = `msmap:${codigo}`;
  const mapa = (await env.META_DATOS.get(mk, 'json')) || {};
  const vivos = new Set(tareas.map(t => t.id));

  for (const [tareaId, eventId] of Object.entries(mapa)) {
    if (vivos.has(tareaId)) continue;
    await llamarGraph(accessToken, 'DELETE', `/me/events/${eventId}`).catch(() => {});
    delete mapa[tareaId];
  }

  for (const t of tareas) {
    const cuerpo = eventoDeTarea(t, nombreDe(t.asignaturaId));
    if (mapa[t.id]) {
      const r = await llamarGraph(accessToken, 'PATCH', `/me/events/${mapa[t.id]}`, cuerpo);
      if (r.status === 404) delete mapa[t.id];
      else continue;
    }
    const r = await llamarGraph(accessToken, 'POST', '/me/events', cuerpo);
    if (r.ok) mapa[t.id] = (await r.json()).id;
  }

  await env.META_DATOS.put(mk, JSON.stringify(mapa));
}

/* ---------------------- LEER el calendario del centro (P5) ----------------------
   Con el mismo scope (Calendars.ReadWrite) que ya escribe las tareas. Solo se
   devuelven los eventos que PARECEN un examen o una entrega, y solo título y
   día: el resto del calendario del instituto no sale de aquí. Se descartan los
   que creó META (están en `msmap:` y llevan el prefijo "Examen:"/"Entrega:"),
   porque proponerle sus propias tareas de vuelta sería un bucle. */
const RE_EXAMEN = /\b(examen(es)?|control|prueba|parcial|evaluaci[oó]n|recuperaci[oó]n)\b/i;
const RE_ENTREGA = /\b(entrega|trabajo)\b/i;
const RE_PROPIO = /^(Examen|Entrega): /;

/** Función pura: de los eventos de Graph a lo que se propone importar. */
export function candidatosDeEventos(eventos, propios = new Set()) {
  const vistos = new Set();
  const salida = [];
  for (const e of eventos || []) {
    const titulo = String(e?.subject || '').trim();
    const fecha = String(e?.start?.dateTime || '').slice(0, 10);
    if (!titulo || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || e.isCancelled) continue;
    if (propios.has(e.id) || RE_PROPIO.test(titulo)) continue;
    const tipo = RE_EXAMEN.test(titulo) ? 'examen' : RE_ENTREGA.test(titulo) ? 'entrega' : null;
    if (!tipo || vistos.has(e.id)) continue;
    vistos.add(e.id);
    salida.push({ id: String(e.id), titulo: titulo.slice(0, 120), fecha, tipo });
  }
  return salida.sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(0, 50);
}

export async function eventosDelCentro(env, codigo, ahora = new Date()) {
  const accessToken = await accessTokenDe(env, codigo);
  if (!accessToken) return { error: 'Outlook no está conectado.', status: 409 };
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const hasta = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + 180);
  const q = new URLSearchParams({
    startDateTime: `${ymd(ahora)}T00:00:00`, endDateTime: `${ymd(hasta)}T00:00:00`,
    $select: 'id,subject,start,isCancelled', $top: '250', $orderby: 'start/dateTime',
  });
  const r = await fetch(`${GRAPH}/me/calendarView?${q}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'outlook.timezone="Europe/Madrid"' },
  });
  if (r.status === 401 || r.status === 403) {
    return { error: 'Microsoft no deja leer el calendario: vuelve a conectar Outlook.', status: 409 };
  }
  if (!r.ok) return { error: 'No se pudo leer el calendario del instituto.', status: 502 };
  const mapa = (await env.META_DATOS.get(`msmap:${codigo}`, 'json')) || {};
  const propios = new Set(Object.values(mapa));
  return { eventos: candidatosDeEventos((await r.json()).value, propios) };
}

export async function estadoConexion(env, codigo) {
  const g = await env.META_DATOS.get(`ms:${codigo}`, 'json');
  return { conectado: !!g?.refresh_token, email: g?.email || null, ultima: g?.ultima || null };
}

export async function guardarConexion(env, codigo, tokens, email) {
  await env.META_DATOS.put(`ms:${codigo}`, JSON.stringify({
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token,
    expira: Date.now() + Math.max(0, (tokens.expires_in || 3600) - 60) * 1000,
    email,
    ultima: Date.now(),
  }));
}

export async function desconectar(env, codigo) {
  // Microsoft no tiene un endpoint de revocación de refresh_token como
  // Google: basta borrarlo de KV, deja de poder renovarse y caduca solo.
  await env.META_DATOS.delete(`ms:${codigo}`);
  await env.META_DATOS.delete(`msmap:${codigo}`);
}
