/* ===========================================================================
   CUENTAS (local) — el correo+contraseña ya NO vive aquí: vive en el Worker
   compartido `cuentas` (mismo correo+contraseña para meta, bolsa y
   morning-briefing, por service binding — nunca fetch() a la URL pública,
   ver el error 1042 en lessons_pwa_web_apps). Lo que sigue siendo de meta:

     1. El mapa LOCAL identidad -> espacio (el buzón de datos de META,
        conectores de Google/Outlook/Notion incluidos: todo eso sigue
        colgando de `usuario.espacio` exactamente igual que siempre).
     2. "Entrar con Google" — sigue siendo 100% local a meta, no pasa por
        `cuentas`. Se reconcilia por CORREO con una cuenta de `cuentas` si
        ya existiera una (para no partir sus datos en dos).
     3. El testigo de aparato local (`token-aparato`), que sigue usando
        tools/enlace-carpeta.mjs — no confundir con el testigo de `cuentas`
        que usa Morning Briefing: `usuarioDe` reconoce los DOS.
   =========================================================================== */

import { crearBuzon, leerBuzon } from './sync.js';

const COOKIE = 'meta_ses';
const VIDA_LARGA = 60 * 60 * 24 * 30;
const VIDA_CORTA = 60 * 60 * 12;
const VIDA_USUARIO = 60 * 60 * 24 * 400;
const VIDA_APARATO = 60 * 60 * 24 * 400;

const CUENTAS = 'https://cuentas.beltranfersan.workers.dev';

const enc = new TextEncoder();
export const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
export async function sha256Hex(texto) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(texto))); }
const azar = n => crypto.getRandomValues(new Uint8Array(n));

export const normalizaEmail = e => String(e || '').trim().toLowerCase().slice(0, 160);
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
export const emailValido = e => RE_EMAIL.test(e) && e.length <= 160;
const RE_CLAVE = /^[0-9a-f]{64}$/;
export const claveValida = c => RE_CLAVE.test(String(c || ''));
export const nombreLimpio = n => {
  let s = '';
  for (const c of String(n || '')) { const cp = c.codePointAt(0); if (cp > 31 && cp !== 127) s += c; }
  return s.trim().slice(0, 80);
};

/* ------------------------- llamadas al Worker de identidad ------------------ */
async function cuentasFetch(env, ruta, cuerpo) {
  const r = await env.CUENTAS.fetch(`${CUENTAS}${ruta}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo || {}),
  }).catch(() => null);
  if (!r) return { error: 'No se pudo contactar con el servicio de cuentas.', status: 503 };
  const d = await r.json().catch(() => null);
  if (!r.ok) return { error: d?.error || 'Fallo de identidad.', status: r.status };
  return d;
}

/* ------------------------------- almacenamiento local ------------------------ */
const kUsuario = uid => `usuario:${uid}`;
const kEmail = email => `email:${email}`;
const kGoogle = sub => `gsub:${sub}`;
const kSesion = hash => `sesion:${hash}`;

export const leerUsuario = (env, uid) => env.META_DATOS.get(kUsuario(uid), 'json');
const guardarUsuario = (env, u) => env.META_DATOS.put(kUsuario(u.id), JSON.stringify(u), { expirationTtl: VIDA_USUARIO });
export const uidPorEmail = (env, email) => env.META_DATOS.get(kEmail(email));

async function marcarDuenyo(env, codigo, uid) {
  const buzon = (await leerBuzon(env.META_DATOS, codigo)) || { claves: {}, creado: Date.now() };
  if (buzon.duenyo && buzon.duenyo !== uid) return false;
  buzon.duenyo = uid;
  await env.META_DATOS.put(`sync:${codigo}`, JSON.stringify(buzon), { expirationTtl: VIDA_USUARIO });
  return true;
}

/** El registro local de una identidad de `cuentas`, reconciliado por CORREO:
    si ya había una cuenta de meta con ese correo (típicamente porque entró
    antes con Google), se reutiliza esa — nunca se le crea una segunda y se
    le parten los datos en dos. Solo si es la primera vez de verdad se crea
    una nueva, con el propio uid de `cuentas` como id local. */
async function espacioDeIdentidad(env, { uid, email, nombre, codigoImportar }) {
  const idPorCorreo = email ? await uidPorEmail(env, email) : null;
  if (idPorCorreo) {
    const u = await leerUsuario(env, idPorCorreo);
    if (u) return { usuario: u, importado: false };
  }
  const porUid = await leerUsuario(env, uid);
  if (porUid) return { usuario: porUid, importado: false };

  let espacio = null, importado = false;
  if (codigoImportar) {
    const buzon = await leerBuzon(env.META_DATOS, codigoImportar);
    if (buzon && !buzon.duenyo) { espacio = codigoImportar; importado = true; }
  }
  if (!espacio) espacio = await crearBuzon(env.META_DATOS);
  if (!(await marcarDuenyo(env, espacio, uid))) {
    espacio = await crearBuzon(env.META_DATOS);
    importado = false;
    await marcarDuenyo(env, espacio, uid);
  }

  const usuario = { id: uid, email, nombre: nombreLimpio(nombre) || (email ? email.split('@')[0] : 'Yo'), creado: Date.now(), generacion: 1, espacio };
  await guardarUsuario(env, usuario);
  if (email) await env.META_DATOS.put(kEmail(email), uid, { expirationTtl: VIDA_USUARIO });
  return { usuario, importado };
}

/* --------------------------------- sesiones -------------------------------- */
export async function crearSesion(env, uid, recordar) {
  const testigo = hex(azar(32));
  const vida = recordar ? VIDA_LARGA : VIDA_CORTA;
  const u = await leerUsuario(env, uid);
  await env.META_DATOS.put(kSesion(await sha256Hex(testigo)), JSON.stringify({
    uid, creado: Date.now(), recordar, generacion: u?.generacion || 1,
  }), { expirationTtl: vida });
  return { testigo, vida };
}

/** Testigo de aparato LOCAL de meta (el que usa tools/enlace-carpeta.mjs
    desde siempre). Distinto del testigo de `cuentas` que usa Morning
    Briefing — `usuarioDe` reconoce los dos, ver más abajo. */
export async function crearTokenAparato(env, uid) {
  const testigo = hex(azar(32));
  const u = await leerUsuario(env, uid);
  await env.META_DATOS.put(kSesion(await sha256Hex(testigo)), JSON.stringify({
    uid, creado: Date.now(), aparato: true, generacion: u?.generacion || 1,
  }), { expirationTtl: VIDA_APARATO });
  return testigo;
}

const trozosCookie = seguro => `Path=/; HttpOnly; ${seguro ? 'Secure; ' : ''}SameSite=Lax`;
export function cookieDeSesion(testigo, vida, seguro = true) { return `${COOKIE}=${testigo}; ${trozosCookie(seguro)}; Max-Age=${vida}`; }
export const cookieBorrada = (seguro = true) => `${COOKIE}=; ${trozosCookie(seguro)}; Max-Age=0`;

function testigoDe(request) {
  const cookies = request.headers.get('Cookie') || '';
  const m = cookies.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([0-9a-f]{64})`));
  return m ? m[1] : null;
}
function testigoCabecera(request) {
  const m = (request.headers.get('Authorization') || '').match(/^Bearer ([0-9a-f]{64})$/);
  return m ? m[1] : null;
}

/** Usuario autenticado de esta petición. Tres caminos, en orden:
    1. Cookie de meta (navegador).
    2. Testigo LOCAL de meta (Bearer) — enlace-carpeta.mjs.
    3. Testigo de `cuentas` (Bearer) — Morning Briefing u otra app que se
       enlazó por la identidad compartida; si es la primera vez que meta ve
       este uid, se le da espacio en el momento (reconciliado por correo). */
export async function usuarioDe(request, env) {
  const testigo = testigoDe(request) || testigoCabecera(request);
  if (testigo) {
    const s = await env.META_DATOS.get(kSesion(await sha256Hex(testigo)), 'json');
    if (s?.uid) {
      const u = await leerUsuario(env, s.uid);
      if (u && (s.generacion || 1) === (u.generacion || 1)) return u;
    }
    // No es un testigo local: probar contra la identidad compartida.
    const r = await cuentasFetch(env, '/api/identidad/verificar', { token: testigo });
    if (!r.error) {
      const { usuario } = await espacioDeIdentidad(env, { uid: r.usuario.uid, email: r.usuario.email, nombre: r.usuario.nombre });
      return usuario;
    }
    return null;
  }
  return null;
}

export async function cerrarSesion(request, env) {
  const testigo = testigoDe(request);
  if (testigo) await env.META_DATOS.delete(kSesion(await sha256Hex(testigo)));
}

/* --------------------------------- registro --------------------------------- */
export async function registrar(env, { email, clave, nombre, codigoImportar, recordar }) {
  let r = await cuentasFetch(env, '/api/identidad/registrar', { email, clave, nombre });
  let codigoRecuperacion = r.codigoRecuperacion;
  if (r.error) {
    const intento = await cuentasFetch(env, '/api/identidad/entrar', { email, clave });
    if (intento.error) return { error: r.error, status: r.status };
    r = intento; codigoRecuperacion = null;
  }
  const { usuario, importado } = await espacioDeIdentidad(env, { uid: r.usuario.uid, email: r.usuario.email, nombre: r.usuario.nombre, codigoImportar });
  return { usuario, sesion: await crearSesion(env, usuario.id, recordar), codigoRecuperacion, importado };
}

/* ---------------------------------- entrar --------------------------------- */
export async function entrar(env, { email, clave, recordar }) {
  const r = await cuentasFetch(env, '/api/identidad/entrar', { email, clave });
  if (r.error) return { error: r.error, status: r.status };
  const { usuario } = await espacioDeIdentidad(env, { uid: r.usuario.uid, email: r.usuario.email, nombre: r.usuario.nombre });
  return { usuario, sesion: await crearSesion(env, usuario.id, recordar) };
}

/* ------------------------------ entrar con Google ---------------------------
   Sigue siendo local: no todo el mundo que entra con Google tiene por qué
   tener una cuenta de identidad compartida. Si ya existía una cuenta de
   `cuentas` con el mismo correo, sigue siendo una cuenta LOCAL aparte —
   unificar también Google queda fuera de lo pedido (correo+contraseña). */
export async function entrarConGoogle(env, { sub, email, nombre, recordar }) {
  let uid = await env.META_DATOS.get(kGoogle(sub));
  if (!uid && email) uid = await uidPorEmail(env, email);

  if (uid) {
    const u = await leerUsuario(env, uid);
    if (!u) return { error: 'No se encontró la cuenta.', status: 404 };
    if (u.google !== sub) { u.google = sub; await guardarUsuario(env, u); }
    await env.META_DATOS.put(kGoogle(sub), uid, { expirationTtl: VIDA_USUARIO });
    return { usuario: u, sesion: await crearSesion(env, uid, recordar), nuevo: false };
  }

  const nuevoId = 'u' + hex(azar(12));
  const espacio = await crearBuzon(env.META_DATOS);
  const usuario = {
    id: nuevoId, email: normalizaEmail(email), nombre: nombreLimpio(nombre) || normalizaEmail(email).split('@')[0],
    creado: Date.now(), generacion: 1, google: sub, espacio,
  };
  await guardarUsuario(env, usuario);
  if (usuario.email) await env.META_DATOS.put(kEmail(usuario.email), nuevoId, { expirationTtl: VIDA_USUARIO });
  await env.META_DATOS.put(kGoogle(sub), nuevoId, { expirationTtl: VIDA_USUARIO });
  await marcarDuenyo(env, espacio, nuevoId);
  return { usuario, sesion: await crearSesion(env, nuevoId, recordar), nuevo: true };
}

/* ---------------------------- contraseña y perfil --------------------------- */
export async function cambiarClave(env, usuario, { claveActual, claveNueva }) {
  const r = await cuentasFetch(env, '/api/identidad/clave', { uid: usuario.id, claveActual, claveNueva });
  if (r.error) return { error: r.error, status: r.status };
  usuario.generacion = (usuario.generacion || 1) + 1; // tira las sesiones/testigos locales anteriores
  await guardarUsuario(env, usuario);
  return { usuario, sesion: await crearSesion(env, usuario.id, true) };
}

export async function recuperar(env, { email, codigoRecuperacion, clave }) {
  const r = await cuentasFetch(env, '/api/identidad/recuperar', { email, codigoRecuperacion, clave });
  if (r.error) return { error: r.error, status: r.status };
  const { usuario } = await espacioDeIdentidad(env, { uid: r.usuario.uid, email: r.usuario.email, nombre: r.usuario.nombre });
  usuario.generacion = (usuario.generacion || 1) + 1;
  await guardarUsuario(env, usuario);
  return { usuario, sesion: await crearSesion(env, usuario.id, true), codigoRecuperacion: r.codigoRecuperacion };
}

export async function nuevoCodigoParaUsuario(env, usuario) {
  const r = await cuentasFetch(env, '/api/identidad/codigo-recuperacion', { uid: usuario.id });
  return r.codigoRecuperacion || null;
}

export async function actualizarPerfil(env, usuario, { nombre }) {
  if (nombre != null) usuario.nombre = nombreLimpio(nombre) || usuario.nombre;
  await guardarUsuario(env, usuario);
  await cuentasFetch(env, '/api/identidad/perfil', { uid: usuario.id, nombre: usuario.nombre }).catch(() => {});
  return usuario;
}

/* -------------------------------- borrar cuenta ---------------------------- */
export async function borrarCuenta(env, usuario) {
  await cuentasFetch(env, '/api/identidad/borrar', { uid: usuario.id }).catch(() => {});
  const c = usuario.espacio;
  const claves = [
    kUsuario(usuario.id), kEmail(usuario.email), usuario.google ? kGoogle(usuario.google) : null,
    `sync:${c}`, `google:${c}`, `gmap:${c}`, `ms:${c}`, `msmap:${c}`, `notion:${c}`, `notionTareaMap:${c}`, `notionApunteMap:${c}`,
  ].filter(Boolean);
  for (const k of claves) await env.META_DATOS.delete(k);
}

export function usuarioPublico(u) {
  return { id: u.id, email: u.email, nombre: u.nombre, espacio: u.espacio, google: !!u.google, tieneClave: true, creado: u.creado };
}
