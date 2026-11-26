/* ===========================================================================
   UNIÓN DE TAREAS POR ELEMENTO — la usan el aparato (core/store.js) y el
   servidor (worker/sync.js). Es el mismo archivo a propósito: si las dos
   mitades unieran distinto, cada sincronización deshacería la anterior.

   Por qué existe: el resto de secciones siguen la regla de siempre, «gana la
   más nueva, entera». Para `tareas` esa regla pierde datos en cuanto escriben
   dos a la vez: si desde fuera (el conector de Claude) se apunta un examen y
   un aparato con la lista de antes sincroniza después, su sección es más nueva
   y el examen desaparece. Aquí cada tarea se decide por separado.

   La regla, por `id`:
   · cada tarea lleva `mod` (cuándo cambió por última vez); gana la de `mod`
     más alto. Las tareas de antes de esto no lo llevan: cuentan como 0.
   · lo borrado se apunta en `borrados` (id → cuándo): una LÁPIDA. Sin ella,
     unir resucitaría en un aparato lo que se borró en otro.
   · una tarea está borrada si su lápida es tan nueva o más que su `mod`.
     Deshacer un borrado = volver a escribirla con un `mod` posterior.
   · las lápidas caducan a los 400 días, más que la vida del buzón.
   Todo es puro (sin red ni almacenamiento): unir dos veces lo mismo da lo
   mismo, y da igual el orden en que lleguen las cosas.
   =========================================================================== */

export const VIDA_LAPIDA = 400 * 24 * 3600 * 1000;

const modDe = t => (typeof t?.mod === 'number' && Number.isFinite(t.mod) ? t.mod : 0);

/** Une varias listas de lápidas: por id, la fecha más alta. Quita las caducadas. */
export function unirLapidas(listas, ahora = Date.now()) {
  const u = {};
  for (const lap of listas) {
    if (!lap || typeof lap !== 'object') continue;
    for (const [id, t] of Object.entries(lap)) {
      if (typeof t === 'number' && Number.isFinite(t) && ahora - t < VIDA_LAPIDA) u[id] = Math.max(u[id] || 0, t);
    }
  }
  return u;
}

/** Une varias listas de tareas. Por id gana el `mod` más alto; a igualdad,
    la de la lista que va DESPUÉS (así quien llama decide qué es lo más
    reciente cuando no hay `mod`, como con las tareas antiguas). Después se
    quitan las que tienen una lápida igual o más nueva. El orden es el de
    primera aparición: la vista ordena por su cuenta. */
export function unirTareas(listas, lapidas = {}) {
  const porId = new Map();
  for (const lista of listas) {
    if (!Array.isArray(lista)) continue;
    for (const t of lista) {
      if (!t || typeof t !== 'object' || t.id == null) continue;
      const previa = porId.get(t.id);
      if (!previa || modDe(t) >= modDe(previa)) porId.set(t.id, t);
    }
  }
  return [...porId.values()].filter(t => !(t.id in lapidas && lapidas[t.id] >= modDe(t)));
}

/** Lo que cuenta para saber si una tarea cambió: todo menos su propio `mod`. */
const sinMod = t => { const { mod, ...resto } = t; return JSON.stringify(resto); };

/** Al guardar en un aparato: compara la lista de antes con la nueva y pone
    `mod = ahora` a lo nuevo o cambiado, y una lápida a lo que ya no está.
    Devuelve { lista, lapidas } (solo las lápidas NUEVAS). Es el único sitio
    donde el aparato pone fechas: así lo cubren todas las vistas que guardan
    la lista entera, sin tocarlas una a una. */
export function sellarTareas(vieja, nueva, ahora = Date.now()) {
  const antes = new Map((Array.isArray(vieja) ? vieja : []).filter(t => t && t.id != null).map(t => [t.id, t]));
  const lista = (Array.isArray(nueva) ? nueva : []).map(t => {
    if (!t || typeof t !== 'object' || t.id == null) return t;
    const previa = antes.get(t.id);
    if (previa && sinMod(previa) === sinMod(t)) return previa;   // sin cambios: conserva su fecha
    return { ...t, mod: Math.max(ahora, modDe(previa) + 1) };
  });
  const siguen = new Set(lista.filter(t => t && t.id != null).map(t => t.id));
  const lapidas = {};
  for (const [id, t] of antes) if (!siguen.has(id)) lapidas[id] = Math.max(ahora, modDe(t) + 1);
  return { lista, lapidas };
}

/** Las tareas de un aparato con la app vieja (sin `mod` ni lápidas): lo que
    trae distinto de lo guardado cuenta como cambiado cuando él dice que
    cambió su sección (`ts`). Lo que NO trae no se toca: una app vieja no puede
    borrar. Peor caso: algo borrado reaparece; nunca se pierde nada. */
export function sellarAntiguas(guardadas, entrantes, ts) {
  const antes = new Map((Array.isArray(guardadas) ? guardadas : []).filter(t => t && t.id != null).map(t => [t.id, t]));
  return (Array.isArray(entrantes) ? entrantes : []).filter(t => t && typeof t === 'object' && t.id != null).map(t => {
    const previa = antes.get(t.id);
    if (previa && sinMod(previa) === sinMod(t)) return previa;
    return { ...t, mod: Math.max(ts, modDe(t)) };
  });
}

/** Huella para saber si lo unido difiere de lo que trae un aparato. */
export const huella = valor => JSON.stringify(
  Array.isArray(valor)
    ? [...valor].sort((a, b) => String(a?.id).localeCompare(String(b?.id)))
    : Object.entries(valor || {}).sort(([a], [b]) => a.localeCompare(b)),
);
