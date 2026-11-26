/* ===========================================================================
   ESCRITURAS DEL CONECTOR — lo que Claude (vía Centralita) puede cambiar en
   meta. Solo `tareas`: apuntar una tarea o un examen, marcarla hecha, moverla
   de fecha, borrarla y devolverla a como estaba (deshacer). Nunca asignaturas,
   notas, temario ni nada más.

   Aquí no hay comprobaciones de acceso: las hace la puerta (worker/conector.js)
   ANTES de llamar aquí, siempre las tres (origen interno, testigo y permiso).

   Cómo se escribe sin pisar a nadie (ver core/union.js y worker/sync.js):
   1. Se lee el buzón UNIDO con la bandeja (lo último que escribió Claude,
      aunque un aparato lo haya pisado en el buzón).
   2. `aplicar` calcula el cambio: la tarea nueva o cambiada con `mod = ahora`,
      o una lápida. Es puro y está probado aparte.
   3. El cambio va a la bandeja (`conector:bandeja:<espacio>`) y al buzón por
      `fusionar`, la misma unión que usan los aparatos. Dos escrituras de KV.
   4. Los calendarios (Google, Outlook, Notion) se ponen al día en segundo
      plano, igual que cuando sincroniza un aparato.
   Cada respuesta lleva la tarea antes y después: Centralita lo guarda en su
   registro para poder deshacer.
   =========================================================================== */
import { leerBuzon, fusionar, leerBandeja, claveBandeja, VIDA_BANDEJA } from './sync.js';
import { unirTareas, unirLapidas } from '../app/js/core/union.js';

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const RE_ID = /^[A-Za-z0-9_-]{1,40}$/;
export const MAX_TITULO = 120;
const MAX_TAREA = 8 * 1024;   // una tarea pesa unos cientos de bytes; esto es un tope de seguridad

export const esFechaReal = f => {
  if (typeof f !== 'string' || !RE_FECHA.test(f)) return false;
  const d = new Date(`${f}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === f;
};

/** Texto de una línea, sin caracteres de control, recortado. */
const limpia = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const normal = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** La asignatura por su nombre, contra la lista real. Exacta, o la ÚNICA que
    empiece por o contenga lo pedido. Si no hay una sola, no se adivina. */
export function asignaturaPorNombre(asignaturas, nombre) {
  const q = normal(nombre);
  if (!q) return { id: '' };
  const lista = (Array.isArray(asignaturas) ? asignaturas : []).filter(a => a && a.id && a.nombre);
  const exacta = lista.filter(a => normal(a.nombre) === q);
  const parecidas = exacta.length ? exacta : lista.filter(a => normal(a.nombre).startsWith(q) || normal(a.nombre).includes(q));
  if (parecidas.length === 1) return { id: parecidas[0].id, nombre: parecidas[0].nombre };
  const nombres = lista.map(a => a.nombre);
  return {
    error: parecidas.length
      ? `«${limpia(nombre, 60)}» puede ser varias asignaturas: ${parecidas.map(a => a.nombre).join(', ')}. Di cuál.`
      : `no hay ninguna asignatura «${limpia(nombre, 60)}». Las que hay: ${nombres.join(', ') || 'ninguna'}.`,
  };
}

const nuevoId = ahora => 't' + ahora.toString(36) + [...crypto.getRandomValues(new Uint8Array(3))].map(b => (b % 36).toString(36)).join('');
const modDe = t => (typeof t?.mod === 'number' ? t.mod : 0);
const viva = (tareas, id) => tareas.find(t => t.id === id) || null;

/** El cambio, sin tocar nada. `estado` = { tareas, lapidas, asignaturas }
    (ya unido con la bandeja). Devuelve { tarea?, lapida?, antes, despues,
    nota? } o { error, estado: 400|404 }. */
export function aplicar(accion, args, estado, ahora = Date.now()) {
  const { tareas, lapidas, asignaturas } = estado;
  const a = args && typeof args === 'object' ? args : {};

  if (accion === 'apuntar') {
    const titulo = limpia(a.titulo, MAX_TITULO);
    if (!titulo) return { error: 'falta el título', estado: 400 };
    if (!esFechaReal(a.fecha)) return { error: 'la fecha tiene que ser real y con la forma AAAA-MM-DD', estado: 400 };
    const tipo = a.tipo === 'examen' ? 'examen' : 'tarea';
    const asig = asignaturaPorNombre(asignaturas, a.asignatura);
    if (asig.error) return { error: asig.error, estado: 400 };
    // Claude puede repetir una llamada: lo mismo dos veces no se apunta dos veces.
    const repe = tareas.find(t => t.titulo === titulo && t.fecha === a.fecha && (t.tipo || 'tarea') === tipo && (t.asignaturaId || '') === asig.id);
    if (repe) return { antes: repe, despues: repe, nota: 'ya estaba apuntada: no se ha cambiado nada', igual: true };
    const tarea = {
      id: nuevoId(ahora), titulo, asignaturaId: asig.id, fecha: a.fecha, notas: '', prioridad: 'normal',
      dificultad: 2, duracion: 45, temaIds: [], tipo, estado: 'pendiente', hecho: false,
      creado: ahora, origen: 'claude', mod: ahora,
    };
    return { tarea, antes: null, despues: tarea };
  }

  if (accion === 'restaurar') {
    // Deshacer: la tarea vuelve EXACTAMENTE a como estaba (la copia que
    // guardó Centralita), con una fecha nueva para que gane a la lápida y a
    // cualquier cambio posterior.
    const t = a.tarea;
    if (!t || typeof t !== 'object' || Array.isArray(t) || !RE_ID.test(String(t.id || ''))) return { error: 'falta la tarea que hay que devolver', estado: 400 };
    if (JSON.stringify(t).length > MAX_TAREA) return { error: 'esa tarea es demasiado grande', estado: 400 };
    if (!esFechaReal(t.fecha) || !limpia(t.titulo, MAX_TITULO)) return { error: 'esa copia de la tarea no es válida', estado: 400 };
    const ahoraViva = viva(tareas, t.id);
    if (!ahoraViva && !(t.id in lapidas)) return { error: 'esa tarea no existe ni se ha borrado', estado: 404 };
    const tarea = { ...t, mod: Math.max(ahora, modDe(ahoraViva) + 1, (lapidas[t.id] || 0) + 1) };
    return { tarea, antes: ahoraViva, despues: tarea };
  }

  const id = String(a.id || '');
  if (!RE_ID.test(id)) return { error: 'falta el id de la tarea (lo da meta_agenda)', estado: 400 };
  const antes = viva(tareas, id);
  if (!antes) return { error: 'no hay ninguna tarea con ese id (puede que se haya borrado)', estado: 404 };
  const mod = Math.max(ahora, modDe(antes) + 1);

  if (accion === 'hecha') {
    const hecha = a.hecha !== false;
    const tarea = { ...antes, estado: hecha ? 'hecha' : 'pendiente', hecho: hecha, mod };
    return { tarea, antes, despues: tarea };
  }
  if (accion === 'mover') {
    if (!esFechaReal(a.fecha)) return { error: 'la fecha tiene que ser real y con la forma AAAA-MM-DD', estado: 400 };
    const tarea = { ...antes, fecha: a.fecha, mod };
    return { tarea, antes, despues: tarea };
  }
  if (accion === 'borrar') return { lapida: { [id]: mod }, antes, despues: null };
  return { error: 'acción desconocida', estado: 400 };
}

/** El buzón con la bandeja ya unida: lo que de verdad hay, aunque un aparato
    haya pisado en el buzón lo último que escribió Claude. */
export async function leerUnido(kv, espacio, ahora = Date.now()) {
  const buzon = await leerBuzon(kv, espacio);
  if (!buzon) return null;
  const bandeja = await leerBandeja(kv, espacio);
  const lapidas = unirLapidas([buzon.claves?.borrados?.datos, bandeja.borrados], ahora);
  const tareas = unirTareas([buzon.claves?.tareas?.datos, bandeja.tareas], lapidas);
  return { ...buzon, claves: { ...buzon.claves, tareas: { ts: buzon.claves?.tareas?.ts || 0, datos: tareas }, borrados: { ts: buzon.claves?.borrados?.ts || 0, datos: lapidas } } };
}

/** Apunta el cambio en la bandeja: por id, lo último; fuera lo de más de 30 días. */
async function aLaBandeja(kv, espacio, cambio, ahora) {
  const b = await leerBandeja(kv, espacio);
  const vivo = t => ahora - modDe(t) < VIDA_BANDEJA;
  const tareas = unirTareas([b.tareas.filter(vivo), cambio.tarea ? [cambio.tarea] : []]);
  const borrados = Object.fromEntries(Object.entries(unirLapidas([b.borrados, cambio.lapida], ahora)).filter(([, t]) => ahora - t < VIDA_BANDEJA));
  await kv.put(claveBandeja(espacio), JSON.stringify({ tareas, borrados, ts: ahora }));
}

/** Escribe de verdad. `alDia(espacio, buzon)` pone al día los calendarios (lo pasa
    index.js, que es quien tiene los módulos de Google, Outlook y Notion). */
export async function escribir(env, espacio, accion, args, { ahora = Date.now(), alDia = null } = {}) {
  const kv = env.META_DATOS;
  const unido = await leerUnido(kv, espacio, ahora);
  if (!unido) return { estado: 404, cuerpo: { error: 'esta cuenta todavia no tiene datos en meta' } };
  const r = aplicar(accion, args, {
    tareas: unido.claves.tareas.datos,
    lapidas: unido.claves.borrados.datos,
    asignaturas: unido.claves.asignaturas?.datos || [],
  }, ahora);
  if (r.error) return { estado: r.estado, cuerpo: { error: r.error } };
  if (!r.igual) {
    await aLaBandeja(kv, espacio, r, ahora);
    const fusionado = await fusionar(kv, espacio, {
      formato: 2,
      claves: {
        ...(r.tarea ? { tareas: { ts: ahora, datos: [r.tarea] } } : {}),
        ...(r.lapida ? { borrados: { ts: ahora, datos: r.lapida } } : {}),
      },
    }, ahora);
    if (alDia) alDia(espacio, fusionado);
  }
  return { estado: 200, cuerpo: { ok: true, antes: r.antes, despues: r.despues, ...(r.nota ? { nota: r.nota } : {}) } };
}
