/* ===========================================================================
   SESIÓN (cliente) — quién eres, y la única puerta por la que la app habla
   con el servidor.

   LA CONTRASEÑA NUNCA SALE DE ESTE ARCHIVO. Antes de mandar nada se deriva
   aquí con PBKDF2-SHA256 y 150.000 iteraciones; lo que viaja es la clave
   derivada. El servidor no puede reconstruir la contraseña ni aunque quiera,
   y quien mirase el tráfico o los registros del servidor tampoco.

   La sal se calcula a partir del correo (SHA-256 de "identidad.v1|correo") en
   vez de pedírsela al servidor: preguntar "dame la sal de este correo" antes
   de entrar sería un buscador de qué correos tienen cuenta.

   LA SAL ES COMPARTIDA CON BOLSA Y MORNING BRIEFING desde el 16 ago 2026: el
   mismo correo+contraseña vale en las tres, porque las tres piden la
   identidad al mismo Worker, `cuentas` (ver worker/auth.js). "Entrar con
   Google" sigue siendo solo de esta app.

   La sesión en sí es una cookie HttpOnly que este código NO puede leer — esa
   es justo la gracia: ni un fallo de XSS podría llevársela.
   =========================================================================== */

import { emitir } from './bus.js';

const ITERACIONES = 150_000;
const enc = new TextEncoder();

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

export const normalizaEmail = e => String(e || '').trim().toLowerCase();

/** Deriva la contraseña. Tarda un momento a propósito: ese coste es lo que
    hace cara cada prueba de un atacante que se llevara la base de datos. */
export async function derivar(email, contrasena) {
  if (!crypto?.subtle) throw new Error('Este navegador no puede cifrar la contraseña (hace falta https).');
  const correo = normalizaEmail(email);
  const sal = await crypto.subtle.digest('SHA-256', enc.encode('identidad.v1|' + correo));
  const material = await crypto.subtle.importKey('raw', enc.encode(contrasena), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new Uint8Array(sal), iterations: ITERACIONES, hash: 'SHA-256' },
    material, 256);
  return hex(bits);
}

/* --------------------------------- red ------------------------------------ */

/** Toda petición que cambia algo lleva la cabecera X-Meta. Un formulario de
    otra web no puede ponerla (necesitaría un preflight CORS que el servidor
    no concede), así que esto corta el CSRF sin necesidad de tokens. */
export async function pedir(ruta, { metodo = 'GET', datos, silencioso = false } = {}) {
  const opciones = { method: metodo, headers: {}, credentials: 'same-origin' };
  if (metodo !== 'GET') {
    opciones.headers['Content-Type'] = 'application/json';
    opciones.headers['X-Meta'] = '1';
    opciones.body = JSON.stringify(datos || {});
  }

  let r;
  try {
    r = await fetch(ruta, opciones);
  } catch {
    throw new Error('Sin conexión.');
  }

  let cuerpo = null;
  try { cuerpo = await r.json(); } catch { /* respuesta sin JSON */ }

  if (r.status === 401 && !silencioso) {
    // La sesión se ha caducado o la ha cerrado otro aparato: la app entera
    // tiene que enterarse, no solo quien hizo esta llamada.
    if (usuarioActual) { usuarioActual = null; emitir('sesion-fuera'); }
  }
  if (!r.ok) throw Object.assign(new Error(cuerpo?.error || `Error ${r.status}`), { status: r.status });
  return cuerpo;
}

/* ------------------------------- estado ----------------------------------- */

let usuarioActual = null;

export const usuario = () => usuarioActual;
export const dentro = () => !!usuarioActual;

function fijar(u) {
  usuarioActual = u || null;
  emitir('sesion-cambio', usuarioActual);
  return usuarioActual;
}

/** ¿Hay sesión abierta? Es lo primero que hace la app al arrancar. */
export async function comprobar() {
  try {
    const r = await pedir('/api/auth/yo', { silencioso: true });
    return fijar(r.usuario);
  } catch {
    return fijar(null);
  }
}

/* ------------------------------- acciones --------------------------------- */

export async function registrar({ email, contrasena, nombre, recordar, codigoImportar }) {
  const clave = await derivar(email, contrasena);
  const r = await pedir('/api/auth/registro', {
    metodo: 'POST',
    datos: { email: normalizaEmail(email), clave, nombre, recordar: !!recordar, codigoImportar },
  });
  fijar(r.usuario);
  return r;   // trae también codigoRecuperacion e importado
}

export async function entrar({ email, contrasena, recordar }) {
  const clave = await derivar(email, contrasena);
  const r = await pedir('/api/auth/entrar', {
    metodo: 'POST',
    datos: { email: normalizaEmail(email), clave, recordar: !!recordar },
  });
  return fijar(r.usuario);
}

/** Entrar con Google es una NAVEGACIÓN de verdad, nunca un fetch: el flujo
    OAuth tiene que salir del sitio y volver. */
export const urlGoogle = recordar => `/api/auth/google?recordar=${recordar ? '1' : '0'}`;

export async function salir() {
  try { await pedir('/api/auth/salir', { metodo: 'POST' }); } catch { /* igual se sale en local */ }
  fijar(null);
}

export async function cambiarContrasena({ actual, nueva }) {
  const email = usuarioActual?.email;
  const datos = { claveNueva: await derivar(email, nueva) };
  if (usuarioActual?.tieneClave) datos.claveActual = await derivar(email, actual);
  return pedir('/api/auth/clave', { metodo: 'POST', datos });
}

export async function recuperar({ email, codigoRecuperacion, contrasena }) {
  const clave = await derivar(email, contrasena);
  const r = await pedir('/api/auth/recuperar', {
    metodo: 'POST',
    datos: { email: normalizaEmail(email), codigoRecuperacion, clave },
  });
  fijar(r.usuario);
  return r;
}

export async function nuevoCodigoRecuperacion() {
  return (await pedir('/api/auth/codigo-recuperacion', { metodo: 'POST' })).codigoRecuperacion;
}

export async function guardarNombre(nombre) {
  const r = await pedir('/api/auth/perfil', { metodo: 'POST', datos: { nombre } });
  return fijar(r.usuario);
}

export async function borrarCuenta() {
  await pedir('/api/auth/borrar', { metodo: 'POST' });
  fijar(null);
}
