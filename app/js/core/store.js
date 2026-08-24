/* ===========================================================================
   ALMACÉN — envoltorio de localStorage sobre el registro de claves.
   Nadie llama a localStorage directamente: así el backup nunca se queda corto.
   =========================================================================== */
import { CLAVES, LISTA_CLAVES, CLAVES_SINCRONIZABLES, APP } from './registry.js';

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
  return { claves };
}

/** Adopta lo remoto SOLO donde sea más nuevo. Devuelve las secciones cambiadas. */
export function adoptar(buzon) {
  const e = estadoSync();
  const cambiadas = [];
  for (const nombre of CLAVES_SINCRONIZABLES) {
    const remoto = buzon?.claves?.[nombre];
    if (!remoto || typeof remoto.ts !== 'number') continue;
    if (remoto.ts <= (e.ts[nombre] || 0)) continue;
    const clave = CLAVES[nombre].k;
    if (remoto.datos == null) memoria.delete(clave);
    else memoria.set(clave, remoto.datos);
    try {
      if (remoto.datos == null) localStorage.removeItem(clave);
      else localStorage.setItem(clave, JSON.stringify(remoto.datos));
    } catch {}
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
  for (const clave of LISTA_CLAVES) {
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
