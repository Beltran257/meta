/* ===========================================================================
   ALMACÉN — envoltorio de localStorage sobre el registro de claves.
   Nadie llama a localStorage directamente: así el backup nunca se queda corto.
   =========================================================================== */
import { CLAVES, LISTA_CLAVES, CLAVES_SINCRONIZABLES, CLAVES_OBSOLETAS, CLAVES_UNIDAS, APP } from './registry.js';
import { sellarTareas, unirTareas, unirLapidas, huella } from './union.js';

const memoria = new Map(); // espejo en RAM: sobrevive a modo privado / cuota llena

export function leer(nombre, porDefecto) {
  const clave = CLAVES[nombre]?.k;
  if (!clave) throw new Error(`Clave no registrada: ${nombre}`);
  if (memoria.has(clave)) return memoria.get(clave);
  try {
    const crudo = localStorage.getItem(clave);
    /* El valor POR DEFECTO no se memoriza: si se memorizara, la sincronización
       (que llama a leer(nombre, null) para empaquetar lo que envía) dejaría
       todas las secciones vacías devueltas como null para siempre, aunque
       quien leyera después pidiera [] por defecto. */
    if (crudo == null) return porDefecto;
    const v = JSON.parse(crudo) ?? porDefecto;
    memoria.set(clave, v);
    return v;
  } catch {
    return porDefecto;
  }
}

export function guardar(nombre, valor) {
  const clave = CLAVES[nombre]?.k;
  if (!clave) throw new Error(`Clave no registrada: ${nombre}`);
  /* Las tareas se unen elemento a elemento al sincronizar (core/union.js):
     aquí, y solo aquí, se pone la fecha de cada tarea que cambia y la lápida
     de cada una que desaparece. Todas las vistas guardan la lista entera por
     este camino, así que ninguna puede olvidarse. */
  let lapidas = null;
  if (nombre === 'tareas') {
    const sellado = sellarTareas(leer('tareas', []), valor);
    valor = sellado.lista;
    if (Object.keys(sellado.lapidas).length) lapidas = sellado.lapidas;
  }
  memoria.set(clave, valor);
  let ok = true;
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
  } catch (e) {
    console.warn('No se pudo guardar', clave, e);
    ok = false;
  }
  // Cada sección lleva su propia fecha de cambio: es lo que permite fusionar
  // dos dispositivos sin que uno pise el trabajo del otro.
  if (ok && CLAVES_SINCRONIZABLES.includes(nombre)) sellar(nombre);
  if (ok && lapidas) guardar('borrados', unirLapidas([leer('borrados', {}), lapidas]));
  return ok;
}

/* -------------------------- estado de sincronización ---------------------- */

/* uid = de QUIÉN son los datos que hay ahora mismo en este navegador. Si al
   entrar no coincide con quien acaba de iniciar sesión, se limpian antes de
   traer los suyos: en un ordenador compartido, los datos del anterior no
   pueden colarse en el espacio del siguiente. */
const syncPorDefecto = { uid: null, ts: {}, ultima: null };

export const estadoSync = () => ({ ...syncPorDefecto, ...leer('sync', {}) });

/** Marca "esta sección cambió ahora". No pasa por guardar() para no recursar. */
function sellar(nombre) {
  const e = estadoSync();
  e.ts = { ...e.ts, [nombre]: Date.now() };
  memoria.set(CLAVES.sync.k, e);
  try { localStorage.setItem(CLAVES.sync.k, JSON.stringify(e)); } catch {}
}

export function guardarSync(parcial) {
  const e = { ...estadoSync(), ...parcial };
  memoria.set(CLAVES.sync.k, e);
  try { localStorage.setItem(CLAVES.sync.k, JSON.stringify(e)); } catch {}
  return e;
}

/** Lo que este dispositivo envía: cada sección con sus datos y su fecha. */
export function instantaneas() {
  const e = estadoSync();
  const claves = {};
  for (const nombre of CLAVES_SINCRONIZABLES) {
    claves[nombre] = { ts: e.ts[nombre] || 0, datos: leer(nombre, null) };
  }
  // formato 2 = este aparato pone fecha a cada tarea y deja lápidas al borrar:
  // el servidor puede unir sus tareas sin miedo (ver worker/sync.js).
  return { formato: 2, claves };
}

/** Escribe lo que llega del servidor SIN pasar por guardar(): no es un cambio
    de este aparato, así que no lleva fecha nueva ni se vuelve a sellar. */
function escribirRemoto(clave, datos) {
  if (datos == null) memoria.delete(clave);
  else memoria.set(clave, datos);
  try {
    if (datos == null) localStorage.removeItem(clave);
    else localStorage.setItem(clave, JSON.stringify(datos));
  } catch {}
}

/** `tareas` y `borrados` no se adoptan: se UNEN con lo de aquí, para no perder
    un cambio hecho mientras la sincronización iba y venía. Devuelve las
    secciones que cambiaron en este aparato. */
function adoptarUnidas(buzon, e) {
  const rt = buzon?.claves?.tareas, rb = buzon?.claves?.borrados;
  if (!rt && !rb) return [];
  const lt = leer('tareas', []), lb = leer('borrados', {});
  const lapidas = unirLapidas([lb, rb?.datos]);
  // A igualdad de fecha gana lo que va después: lo remoto si su sección es más nueva.
  const remotoMasNuevo = (rt?.ts || 0) > (e.ts.tareas || 0);
  const tareas = unirTareas(remotoMasNuevo ? [lt, rt?.datos] : [rt?.datos, lt], lapidas);
  const cambiadas = [];
  if (huella(tareas) !== huella(lt)) { escribirRemoto(CLAVES.tareas.k, tareas); cambiadas.push('tareas'); }
  if (huella(lapidas) !== huella(lb)) { escribirRemoto(CLAVES.borrados.k, lapidas); cambiadas.push('borrados'); }
  if (rt) e.ts.tareas = Math.max(e.ts.tareas || 0, rt.ts || 0);
  if (rb) e.ts.borrados = Math.max(e.ts.borrados || 0, rb.ts || 0);
  return cambiadas;
}

/** Adopta lo remoto SOLO donde sea más nuevo. Devuelve las secciones cambiadas. */
export function adoptar(buzon) {
  const e = estadoSync();
  const cambiadas = adoptarUnidas(buzon, e);
  for (const nombre of CLAVES_SINCRONIZABLES) {
    if (CLAVES_UNIDAS.includes(nombre)) continue;
    const remoto = buzon?.claves?.[nombre];
    if (!remoto || typeof remoto.ts !== 'number') continue;
    if (remoto.ts <= (e.ts[nombre] || 0)) continue;
    escribirRemoto(CLAVES[nombre].k, remoto.datos);
    e.ts[nombre] = remoto.ts;
    cambiadas.push(nombre);
  }
  guardarSync({ ts: e.ts, ultima: Date.now() });
  return cambiadas;
}

/** Borra las secciones que se sincronizan (no las preferencias de este
    aparato) y olvida sus fechas, para que la próxima sincronización se traiga
    entero lo que haya en el servidor. */
export function limpiarDatos() {
  for (const nombre of CLAVES_SINCRONIZABLES) {
    const clave = CLAVES[nombre].k;
    memoria.delete(clave);
    try { localStorage.removeItem(clave); } catch {}
  }
  // El cronómetro no viaja, pero apunta a asignaturas y temas de la cuenta
  // anterior: guardarlo después lo colgaría de una asignatura que no existe.
  // Lo mismo con los bloques leídos del calendario de la cuenta anterior.
  for (const nombre of ['cronometro', 'calendarioBloques']) {
    memoria.delete(CLAVES[nombre].k);
    try { localStorage.removeItem(CLAVES[nombre].k); } catch {}
  }
  guardarSync({ ts: {}, ultima: null });
}

export function actualizar(nombre, fn, porDefecto) {
  const v = fn(leer(nombre, porDefecto));
  guardar(nombre, v);
  return v;
}

/* ---- copia de seguridad DERIVADA del registro (no hay lista que mantener) -- */
export function exportar() {
  const datos = {};
  for (const [nombre, def] of Object.entries(CLAVES)) {
    const crudo = localStorage.getItem(def.k);
    if (crudo != null) datos[nombre] = JSON.parse(crudo);
  }
  return {
    app: APP.nombre,
    version: APP.version,
    fecha: new Date().toISOString(),
    claves: LISTA_CLAVES,
    datos,
  };
}

export function importar(copia) {
  if (!copia || !copia.datos) throw new Error('Copia no válida');
  let n = 0;
  for (const [nombre, valor] of Object.entries(copia.datos)) {
    if (!CLAVES[nombre]) continue; // clave de una versión futura: se ignora
    guardar(nombre, valor);
    n++;
  }
  return n;
}

/** Borrado total, DERIVADO del registro igual que la copia de seguridad. */
export function borrarTodo() {
  for (const clave of [...LISTA_CLAVES, ...CLAVES_OBSOLETAS]) {
    try { localStorage.removeItem(clave); } catch {}
  }
  memoria.clear();
  return LISTA_CLAVES.length;
}

/* iOS borra el almacenamiento tras ~7 días sin abrir: pedir persistencia. */
export async function pedirPersistencia() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      return await navigator.storage.persist();
    }
  } catch {}
  return false;
}

/** Quita lo que dejaron las secciones que ya no existen (ver CLAVES_OBSOLETAS). */
export function limpiarObsoletas() {
  for (const clave of CLAVES_OBSOLETAS) {
    try { localStorage.removeItem(clave); } catch {}
  }
}
