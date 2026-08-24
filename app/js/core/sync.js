/* ===========================================================================
   SINCRONIZACIÓN (cliente) — mantiene iguales el móvil, la tablet y el
   ordenador de UNA MISMA CUENTA.

   Cómo funciona, en corto: cada aparato sube lo que tiene con la fecha de cada
   sección, el servidor devuelve la fusión (gana la fecha más nueva por
   sección) y el aparato adopta lo que sea más reciente que lo suyo. Así, si en
   el móvil añades una tarea y en el portátil una nota, al sincronizar quedan
   las dos: con un bloque único, una de las dos se perdería.

   Ya no hay códigos de emparejamiento: el espacio de datos lo decide la sesión
   en el servidor. Entrar con tu cuenta en otro aparato ES enlazarlo.
   =========================================================================== */

import { estadoSync, guardarSync, instantaneas, adoptar, limpiarDatos } from './store.js';
import { emitir, on } from './bus.js';
import * as sesion from './sesion.js';

export const ultimaVez = () => estadoSync().ultima;
export const activo = () => sesion.dentro();

/* ------------------------- cambio de usuario en este aparato ---------------
   Si los datos que hay guardados aquí son de OTRA cuenta, se borran antes de
   traer los del que acaba de entrar. Es la frontera de aislamiento en el lado
   del navegador; la de verdad está en el servidor, que solo sirve el espacio
   del usuario de la cookie. */
export function prepararPara(usuario) {
  const e = estadoSync();
  if (e.uid && e.uid !== usuario.id) {
    limpiarDatos();
    emitir('datos-cambio', ['todo']);
  }
  guardarSync({ uid: usuario.id });
}

/* --------------------------------- red ------------------------------------ */

/** Primera bajada tras entrar: se adopta TODO lo del servidor. Después ya
    manda la fusión por fechas de siempre. */
export async function traerTodo() {
  const buzon = await sesion.pedir('/api/datos');
  const cambiadas = adoptar(buzon);
  if (cambiadas.length) avisar(cambiadas);
  guardarSync({ ultima: Date.now() });
  return cambiadas;
}

let enCurso = null;

export async function sincronizar({ forzar = false } = {}) {
  if (!sesion.dentro()) return null;
  if (enCurso && !forzar) return enCurso;

  enCurso = (async () => {
    try {
      const buzon = await sesion.pedir('/api/datos', { metodo: 'POST', datos: instantaneas() });
      const cambiadas = adoptar(buzon);
      avisar(cambiadas);
      emitir('sync-estado', { ok: true, cuando: Date.now() });
      return cambiadas;
    } catch (e) {
      console.warn('sync:', e.message);
      emitir('sync-estado', { ok: false, error: e.message });
      return null;
    } finally {
      enCurso = null;
    }
  })();
  return enCurso;
}

function avisar(cambiadas) {
  if (!cambiadas?.length) return;
  emitir('datos-cambio', cambiadas);
}

/* ------------------------------- automático -------------------------------- */

let temporizador = null;
const masTarde = () => {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => sincronizar(), 3000);
};

/* Los oyentes se registran SIEMPRE, aunque todavía no haya sesión:
   sincronizar() se protege sola. Si el gateo fuera "solo si ya hay sesión",
   entrar a media sesión sin recargar dejaría el aparato sin sincronización
   automática hasta la siguiente apertura, y un cambio hecho justo después de
   entrar podría no subirse nunca. */
export function arrancar() {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) sincronizar();
  });
  window.addEventListener('online', () => sincronizar());
  on('local-cambio', masTarde);
}

/** URL del feed ICS de esta cuenta, para suscribirlo en Calendario de Apple,
    Google Calendar u Outlook. */
export function urlIcs() {
  const u = sesion.usuario();
  return u?.espacio ? `${location.origin}/ics/${u.espacio}.ics` : null;
}
