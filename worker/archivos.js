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

   La clave es solo `<espacio>/<id-de-apunte>`: la asignatura y la evaluación
   viajan como metadatos del propio apunte en apuntesMeta, no en la clave,
   para que renombrar una asignatura no obligue a mover nada. */

import { leerBuzon, fusionar } from './sync.js';

// KV no admite valores de más de 25 MiB; se deja margen para no rozar el borde.
const MAX_BYTES = 24 * 1024 * 1024;

export const demasiadoGrande = n => n > MAX_BYTES;

const clave = (espacio, id) => `${espacio}/${id}`;

export async function subir(env, espacio, id, bytes, tipoContenido) {
  await env.META_ARCHIVOS.put(clave(espacio, id), bytes, {
    metadata: { contentType: tipoContenido || 'application/octet-stream' },
  });
}

export const leer = (env, espacio, id) => env.META_ARCHIVOS.getWithMetadata(clave(espacio, id), 'arrayBuffer');

export const borrar = (env, espacio, id) => env.META_ARCHIVOS.delete(clave(espacio, id));

/** Añade o actualiza la entrada de este apunte en apuntesMeta y la marca con
    `r2: true` (el archivo de verdad vive en R2, no solo en un aparato).
    Reutiliza fusionar() de sync.js: se lee el buzón, se sustituye SOLO esta
    entrada dentro de la lista y se escribe con fecha nueva, igual que hace
    cualquier aparato al sincronizar — así el resto del sistema (fusión por
    fecha más reciente, conectores) no necesita saber que esto existe. */
export async function registrarApunte(env, espacio, entrada) {
  const buzon = (await leerBuzon(env.META_DATOS, espacio)) || { claves: {}, creado: Date.now() };
  const actual = buzon.claves?.apuntesMeta?.datos || [];
  const lista = [...actual.filter(a => a.id !== entrada.id), entrada];
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
