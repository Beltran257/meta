/* ===========================================================================
   ARCHIVOS — el contenido REAL de fotos y PDF de apuntes, en KV.

   Antes de esto, un apunte de tipo foto/pdf solo tenía título y fecha en el
   buzón de sync (ver worker/sync.js): el archivo en sí vivía nada más que en
   IndexedDB de cada aparato (app/js/core/apuntesdb.js). Eso seguía siendo
   cierto y sigue siéndolo — la copia local rápida no se ha tocado — pero
   ahora, si hay sesión, el archivo TAMBIÉN sube aquí. Es lo que hace posible
   verlo en otro aparato y lo que usa el enlace de carpeta de un Mac
   (tools/enlace-carpeta.mjs): sin un sitio donde el servidor pueda leer el
   archivo, no hay nada que bajar a una carpeta.

   KV y no R2 a propósito: R2 exige tarjeta en la cuenta para activarse
   (aunque no cobre nada dentro de lo gratis) y se prefirió evitarlo. KV es
   gratis sin tarjeta, con un tope más corto — 25 MB por valor, ~1 GB en
   total — de sobra para fotos y PDF de apuntes. Si algún día se queda corto,
   solo hay que cambiar este archivo (subir/leer/borrar), nada más lo sabe.

   ARCHIVOS GRANDES (hasta 100 MB): un valor de KV no pasa de 25 MB, así que lo
   que pesa más viaja y se guarda EN TROZOS de ≤10 MB. La clave de siempre
   (`<espacio>/<id>`) guarda entonces solo un resumen {partes, tam} con los
   metadatos, y los trozos van en `<espacio>/<id>.p0`, `.p1`… Al descargar se
   sirven uno detrás de otro como un solo archivo (en flujo: nunca hay 100 MB
   en memoria). Lo pequeño sigue exactamente como antes: un solo valor.

   La clave es solo `<espacio>/<id-de-apunte>`: la asignatura y la evaluación
   viajan como metadatos del propio apunte en apuntesMeta, no en la clave,
   para que renombrar una asignatura no obligue a mover nada. */

import { leerBuzon, fusionar } from './sync.js';

// KV no admite valores de más de 25 MiB; se deja margen para no rozar el borde.
const MAX_BYTES = 24 * 1024 * 1024;
export const MAX_PARTE = 12 * 1024 * 1024;        // un trozo (el cliente manda de 10 MB)
export const MAX_TOTAL = 100 * 1024 * 1024;       // un archivo entero
export const MAX_PARTES = 12;

/** ¿Demasiado para subirlo de UNA vez? (los grandes van por trozos) */
export const demasiadoGrande = n => n > MAX_BYTES;

const clave = (espacio, id) => `${espacio}/${id}`;
const clavePte = (espacio, id, i) => `${espacio}/${id}.p${i}`;

/** Lee de las cabeceras si la subida es de una pieza o un trozo. Función pura
    (se prueba sin red). {trozos:false} o {trozos:true, partes, parte, total}
    o {error}. */
export function leerParte(cabeceras) {
  const h = n => cabeceras.get(n);
  if (!h('X-Meta-Partes')) return { trozos: false };
  const partes = Number(h('X-Meta-Partes')), parte = Number(h('X-Meta-Parte')), total = Number(h('X-Meta-Total'));
  if (!Number.isInteger(partes) || partes < 2 || partes > MAX_PARTES) return { error: 'partes' };
  if (!Number.isInteger(parte) || parte < 0 || parte >= partes) return { error: 'parte' };
  if (!Number.isFinite(total) || total <= 0 || total > MAX_TOTAL) return { error: 'total', demasiado: total > MAX_TOTAL };
  return { trozos: true, partes, parte, total };
}

export async function subir(env, espacio, id, bytes, tipoContenido) {
  await env.META_ARCHIVOS.put(clave(espacio, id), bytes, {
    metadata: { contentType: tipoContenido || 'application/octet-stream' },
  });
}

/** Un trozo de un archivo grande. */
export const subirParte = (env, espacio, id, i, bytes) => env.META_ARCHIVOS.put(clavePte(espacio, id, i), bytes);

/** Todas las claves de este archivo: la principal y sus trozos (con sus metadatos). */
async function clavesDe(env, espacio, id) {
  const cabeza = clave(espacio, id);
  const salida = [];
  let cursor;
  do {
    const r = await env.META_ARCHIVOS.list({ prefix: cabeza, cursor });
    for (const k of r.keys) if (k.name === cabeza || /^\.p\d+$/.test(k.name.slice(cabeza.length))) salida.push(k);
    cursor = r.list_complete ? undefined : r.cursor;
  } while (cursor);
  return salida;
}

/** Cierra una subida por trozos: la clave principal pasa a ser el resumen. Si
    antes había un archivo más largo con este id, sus trozos sobrantes se quitan. */
export async function cerrarPartes(env, espacio, id, partes, tam, tipoContenido) {
  for (const k of await clavesDe(env, espacio, id)) {
    const m = /\.p(\d+)$/.exec(k.name);
    if (m && Number(m[1]) >= partes) await env.META_ARCHIVOS.delete(k.name);
  }
  await env.META_ARCHIVOS.put(clave(espacio, id), JSON.stringify({ partes, tam }), {
    metadata: { contentType: tipoContenido || 'application/octet-stream', partes, tam },
  });
}

/** El archivo, listo para servir: { cuerpo, tipo, tam } o null si no está (o
    está a medias). Los grandes salen como un flujo que une los trozos. Lo normal
    (un archivo pequeño) es UNA lectura, sin listar nada. */
export async function abrir(env, espacio, id) {
  const { value, metadata } = await env.META_ARCHIVOS.getWithMetadata(clave(espacio, id), 'arrayBuffer');
  if (!value) return null;
  const meta = metadata || {};
  if (!(meta.partes > 1)) return { cuerpo: value, tipo: meta.contentType || '', tam: value.byteLength };
  let i = 0;
  const cuerpo = new ReadableStream({
    async pull(c) {
      if (i >= meta.partes) return c.close();
      const b = await env.META_ARCHIVOS.get(clavePte(espacio, id, i), 'arrayBuffer');
      if (!b) return c.error(new Error(`falta el trozo ${i}`));   // se corta: nunca se entrega un archivo "completo" que no lo es
      c.enqueue(new Uint8Array(b));
      i++;
    },
  });
  return { cuerpo, tipo: meta.contentType || '', tam: meta.tam };
}

/** Borra el archivo entero: la clave principal y todos sus trozos. */
export async function borrar(env, espacio, id) {
  for (const k of await clavesDe(env, espacio, id)) await env.META_ARCHIVOS.delete(k.name);
}

/** Añade o actualiza la entrada de este apunte en apuntesMeta y la marca con
    `r2: true` (el archivo de verdad vive en R2, no solo en un aparato).
    Reutiliza fusionar() de sync.js: se lee el buzón, se sustituye SOLO esta
    entrada dentro de la lista y se escribe con fecha nueva, igual que hace
    cualquier aparato al sincronizar — así el resto del sistema (fusión por
    fecha más reciente, conectores) no necesita saber que esto existe. */
export async function registrarApunte(env, espacio, entrada, reemplazaId = null) {
  const buzon = (await leerBuzon(env.META_DATOS, espacio)) || { claves: {}, creado: Date.now() };
  const actual = buzon.claves?.apuntesMeta?.datos || [];
  // `reemplazaId`: la versión nueva de un archivo sustituye a la anterior. Se
  // quita aquí, en la misma escritura: si solo se quitara en el aparato, esta
  // lista (que aún la trae y lleva fecha más nueva) la devolvería al sincronizar.
  const lista = [...actual.filter(a => a.id !== entrada.id && a.id !== reemplazaId), entrada];
  if (reemplazaId && reemplazaId !== entrada.id) await borrar(env, espacio, reemplazaId);
  return fusionar(env.META_DATOS, espacio, {
    claves: { apuntesMeta: { ts: Date.now(), datos: lista } },
  });
}

/** Quita el apunte de apuntesMeta y borra su archivo de R2. Se usa al borrar
    un apunte desde la app (ver apuntes.js): el título ya se había quitado por
    la vía normal de guardarLista(), esto solo limpia el archivo huérfano. */
export async function borrarApunte(env, espacio, id) {
  await borrar(env, espacio, id);
  const buzon = (await leerBuzon(env.META_DATOS, espacio)) || { claves: {}, creado: Date.now() };
  const actual = buzon.claves?.apuntesMeta?.datos || [];
  if (!actual.some(a => a.id === id)) return buzon; // ya no estaba, nada que fusionar
  return fusionar(env.META_DATOS, espacio, {
    claves: { apuntesMeta: { ts: Date.now(), datos: actual.filter(a => a.id !== id) } },
  });
}
