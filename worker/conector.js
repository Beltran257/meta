/* ===========================================================================
   PUERTA DEL CONECTOR — por aquí lee Centralita (el conector de Claude).

   Solo LECTURA y solo por service binding. Cada ruta de `/api/conector/`
   comprueba tres cosas, siempre en este orden y siempre las tres:

     1. Que la llamada viene de otro Worker de la cuenta y no de internet
        (sin CF-Connecting-IP ni cf-ray: el borde de Cloudflare las pone en
        todo lo que entra por fuera y quien llama no puede quitarlas).
     2. El testigo de conector (`cx_…`, cabecera X-Conector), preguntando a
        `cuentas` si sigue valiendo. No es una sesión: `cuentas` lo guarda
        aparte y esta app no lo acepta en ninguna otra ruta, ni al revés.
     3. El permiso de ESA acción (`app:accion`) en la lista que `cuentas`
        devuelve para esa llamada. Apagado en /permisos de Centralita = 403.

   Los datos son los del espacio de la cuenta del testigo, nunca el de un
   código que venga en la URL. Y el espacio se busca SIN crearlo: la ruta de
   entrada normal (`espacioDeIdentidad`) crea un buzón si no existe, y una
   lectura no escribe nada.

   A `cuentas` solo se le llama por `conector/verificar`. Nunca por token ni
   por verificar: eso son sesiones.
   =========================================================================== */
import { leerBuzon } from './sync.js';
import { leerUsuario, uidPorEmail, normalizaEmail } from './auth.js';
import { resumenBriefing, agendaPendiente } from './briefing.js';
import { historicoSalud } from './historico.js';

export const esInterna = request => !request.headers.get('CF-Connecting-IP') && !request.headers.get('cf-ray');

const RUTA_VERIFICAR = 'https://cuentas.beltranfersan.workers.dev/api/identidad/conector/verificar';
const RE_TESTIGO = /^cx_[0-9a-f]{64}$/;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_FECHAS = 60;

/** El espacio de esa cuenta, o null si nunca ha entrado en meta. Solo lee:
    mismo criterio que `espacioDeIdentidad` (primero por correo, luego por
    uid) pero sin crear nada. */
export async function espacioDe(env, { uid, email }) {
  const correo = email ? normalizaEmail(email) : '';
  const idPorCorreo = correo ? await uidPorEmail(env, correo) : null;
  const u = (idPorCorreo && await leerUsuario(env, idPorCorreo)) || await leerUsuario(env, uid);
  return u?.espacio || null;
}

const SIN_DATOS = { estado: 404, cuerpo: { error: 'esta cuenta todavia no tiene datos en meta' } };

/** Las rutas y el permiso de cada una. `atiende` no ejecuta ninguna sin pasar
    por las tres comprobaciones de arriba. */
const RUTAS = {
  '/api/conector/hoy': {
    permiso: 'meta:hoy',
    lee: (buzon, url, ahora) => ({ estado: 200, cuerpo: { hoy: resumenBriefing(buzon, new Date(ahora)) } }),
  },
  '/api/conector/agenda': {
    permiso: 'meta:agenda',
    lee: (buzon, url, ahora) => ({ estado: 200, cuerpo: { agenda: agendaPendiente(buzon, new Date(ahora)) } }),
  },
  '/api/conector/dias': {
    permiso: 'meta:dias',
    lee(buzon, url) {
      const fechas = (url.searchParams.get('fechas') || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!fechas.length || fechas.length > MAX_FECHAS || !fechas.every(f => RE_FECHA.test(f))) {
        return { estado: 400, cuerpo: { error: `fechas: entre 1 y ${MAX_FECHAS}, separadas por comas y con la forma AAAA-MM-DD` } };
      }
      return { estado: 200, cuerpo: { dias: historicoSalud(buzon, fechas) } };
    },
  },
};

const NO_RESPONDE = { estado: 503, cuerpo: { error: 'No se pudo contactar con el servicio de cuentas.' } };

/** Pregunta a `cuentas` por el testigo. { uid, email, permisos } o { respuesta }. */
async function verifica(env, testigo) {
  if (!RE_TESTIGO.test(testigo)) return { respuesta: { estado: 401, cuerpo: { error: 'testigo de conector no valido' } } };
  const r = await env.CUENTAS.fetch(RUTA_VERIFICAR, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(env.CUENTAS_SECRETO ? { 'X-Cuentas-Secreto': env.CUENTAS_SECRETO } : {}) },
    body: JSON.stringify({ testigo }),
  }).catch(() => null);
  if (!r) return { respuesta: NO_RESPONDE };
  if (r.status === 401) return { respuesta: { estado: 401, cuerpo: { error: 'testigo de conector no valido' } } };
  const d = r.status === 200 ? await r.json().catch(() => null) : null;
  if (typeof d?.usuario?.uid !== 'string' || !d.usuario.uid || !Array.isArray(d?.permisos)) return { respuesta: NO_RESPONDE };
  return { uid: d.usuario.uid, email: String(d.usuario.email || ''), permisos: d.permisos };
}

/** La puerta entera. Devuelve { estado, cuerpo }. */
export async function atiendeConector(request, url, env, ahora = Date.now()) {
  const ruta = RUTAS[url.pathname];
  if (!ruta) return { estado: 404, cuerpo: { error: 'ruta desconocida' } };
  // 1. Origen interno.
  if (!esInterna(request)) return { estado: 403, cuerpo: { error: 'no autorizado' } };
  if (request.method !== 'GET') return { estado: 405, cuerpo: { error: 'metodo no permitido' } };
  // 2. Testigo de conector, contra cuentas.
  const v = await verifica(env, request.headers.get('X-Conector') || '');
  if (v.respuesta) return v.respuesta;
  // 3. Permiso de esta acción.
  if (!v.permisos.includes(ruta.permiso)) return { estado: 403, cuerpo: { error: 'esta accion esta apagada', permiso: ruta.permiso } };
  const espacio = await espacioDe(env, v);
  const buzon = espacio ? await leerBuzon(env.META_DATOS, espacio) : null;
  if (!buzon) return SIN_DATOS;
  return ruta.lee(buzon, url, ahora);
}
