/* ===========================================================================
   BUS — eventos + delegación de [data-accion].
   Nunca se escribe onclick="fn('texto')": con un apóstrofo revienta en
   silencio y además no funciona bajo CSP. Aquí todo va por data-accion.
   =========================================================================== */

const oyentes = new Map();

export function on(evento, fn) {
  if (!oyentes.has(evento)) oyentes.set(evento, new Set());
  oyentes.get(evento).add(fn);
  return () => oyentes.get(evento).delete(fn);
}

export function emitir(evento, datos) {
  oyentes.get(evento)?.forEach(fn => {
    try { fn(datos); } catch (e) { console.error('Error en oyente', evento, e); }
  });
}

/* ------------------------- acciones declarativas -------------------------- */
const acciones = new Map();

export function accion(nombre, fn) { acciones.set(nombre, fn); }

export function iniciarAcciones(raiz = document) {
  raiz.addEventListener('click', ev => {
    const el = ev.target.closest('[data-accion]');
    if (!el) return;
    const fn = acciones.get(el.dataset.accion);
    if (!fn) return;
    ev.preventDefault();
    fn(el.dataset, el, ev);
  });

  raiz.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const el = ev.target.closest('[data-accion]');
    if (!el || el.tagName === 'BUTTON' || el.tagName === 'A') return;
    const fn = acciones.get(el.dataset.accion);
    if (!fn) return;
    ev.preventDefault();
    fn(el.dataset, el, ev);
  });
}

/* Antirrebote para búsquedas/entradas mientras se escribe. */
export function retardar(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
