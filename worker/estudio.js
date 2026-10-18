/* ===========================================================================
   ESTUDIO DESDE EL CALENDARIO — lo que entrega su Apps Script.

   Él planifica en Google Tasks con hora: cada tarea con hora aparece en su
   calendario como un bloque, con un enlace a la tarea en la descripción
   ("…ve a https://tasks.google.com/task/<id>"). El bloque dice CUÁNDO y
   CUÁNTO; la casilla de la tarea dice si lo HIZO.

   Por qué un Apps Script y no la conexión de Google de META: leer tareas y
   la lista de calendarios son permisos "sensibles", y pedirlos desde META
   obligaba a verificar la app en Google (dominio en Search Console, portada
   pública, revisión…) y aun así enseñaba "app no verificada". Un script que
   vive en SU cuenta lee lo suyo sin nada de eso, no caduca, y cada hora manda
   aquí los datos en bruto (app/js/core/script-estudio.js es su código).

   El script tiene SU PROPIA clave, que solo sirve para entregar bloques
   (/api/estudio/recibir): no abre la cuenta como la clave de aparato del
   enlace de carpeta. Generar una nueva invalida la anterior.

   Aquí solo se juntan bloques y tareas; qué asignatura es, si cuenta y
   cuántos minutos suma lo decide la app (app/js/core/calendario.js), que es
   donde están sus asignaturas y lo que ya ha corregido a mano.
   =========================================================================== */

import { hex, sha256Hex } from './auth.js';

const RE_TAREA = /tasks\.google\.com\/task\/([A-Za-z0-9_-]+)/;
const RE_PARTICULAR = /\bparticular(es)?\b/;
const normaTitulo = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
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
      id: String(e.id).slice(0, 200),
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
export function clasesParticulares(eventos, ahora = Date.now()) {
  const salida = [];
  for (const e of eventos || []) {
    if (e?.status === 'cancelled' || !RE_PARTICULAR.test(normaTitulo(e?.summary))) continue;
    const inicio = e.start?.dateTime, fin = e.end?.dateTime;
    if (!inicio || !fin || !(Date.parse(fin) > Date.parse(inicio)) || Date.parse(fin) > ahora) continue;
    salida.push({ id: 'p-' + String(e.id).slice(0, 200), titulo: String(e.summary).trim().slice(0, 140), inicio, fin, estado: 'hecha', fuente: 'particular' });
  }
  return salida;
}

const TOPE = 5000;

/** Función pura: lo que manda el script -> bloques, o un error si no tiene
    la forma esperada. No se fía de nada: listas acotadas y solo los campos
    que se usan. */
export function procesarEnvio(cuerpo, ahora = Date.now()) {
  const lista = v => (Array.isArray(v) ? v.slice(0, TOPE) : null);
  const eventos = lista(cuerpo?.eventos), tareas = lista(cuerpo?.tareas), particulares = lista(cuerpo?.particulares) || [];
  if (!eventos || !tareas) return { error: 'faltan eventos o tareas' };
  const bloques = [...bloquesDeEstudio(eventos, tareas, ahora), ...clasesParticulares(particulares, ahora)]
    .sort((a, b) => a.inicio.localeCompare(b.inicio));
  return { bloques };
}

/* ------------------------------- la clave --------------------------------- */

const kClave = hash => `estudioclave:${hash}`;
const kClaveDe = espacio => `estudioclavede:${espacio}`;
const kDatos = espacio => `estudio:${espacio}`;

/** Clave nueva para el script de este espacio; la anterior deja de valer. */
export async function nuevaClave(env, espacio) {
  const anterior = await env.META_DATOS.get(kClaveDe(espacio));
  if (anterior) await env.META_DATOS.delete(kClave(anterior));
  const clave = hex(crypto.getRandomValues(new Uint8Array(32)));
  const hash = await sha256Hex(clave);
  await env.META_DATOS.put(kClave(hash), JSON.stringify({ espacio, creado: Date.now() }));
  await env.META_DATOS.put(kClaveDe(espacio), hash);
  return clave;
}

/** Espacio al que pertenece la clave del script de esta petición, o null. */
export async function espacioDeClave(request, env) {
  const m = (request.headers.get('Authorization') || '').match(/^Bearer ([0-9a-f]{64})$/);
  if (!m) return null;
  return (await env.META_DATOS.get(kClave(await sha256Hex(m[1])), 'json'))?.espacio || null;
}

export async function guardar(env, espacio, bloques) {
  await env.META_DATOS.put(kDatos(espacio), JSON.stringify({ bloques, ultima: Date.now() }));
}

export async function leer(env, espacio) {
  const d = await env.META_DATOS.get(kDatos(espacio), 'json');
  const instalado = !!(await env.META_DATOS.get(kClaveDe(espacio)));
  return { bloques: d?.bloques || [], ultima: d?.ultima || null, instalado };
}

/** Al borrar la cuenta: la clave del script y lo que mandó. */
export async function borrar(env, espacio) {
  const hash = await env.META_DATOS.get(kClaveDe(espacio));
  if (hash) await env.META_DATOS.delete(kClave(hash));
  await env.META_DATOS.delete(kClaveDe(espacio));
  await env.META_DATOS.delete(kDatos(espacio));
}
