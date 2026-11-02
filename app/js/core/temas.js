/* ===========================================================================
   TEMAS — la pieza que conecta todo lo demás.

   Un tema pertenece a una asignatura y guarda un DOMINIO estimado (0-100).
   Ese número no se lo inventa nadie: sube y baja solo con lo que haces
   (repasos, sesiones de estudio) y a mano, y es lo que alimenta la preparación
   de un examen, la detección de puntos flojos y el plan del día.

   El repaso espaciado es deliberadamente sencillo y explicable: cinco pasos
   (1, 3, 7, 16 y 35 días). Contestar bien avanza un paso, regular repite el
   mismo y mal retrocede al principio. No hace falta SM-2 para un curso.
   =========================================================================== */

import { leer, guardar } from './store.js';
import { emitir } from './bus.js';
import { hoyLocal, sumaDias, diasHasta } from './fmt.js';
import { comparaOrden, enlacesDeApuntes, unirNombres, unidadDe } from './temario.js';

export const PASOS = [1, 3, 7, 16, 35];

export const listaTemas = () => leer('temas', []);
export const temaDe = id => listaTemas().find(t => t.id === id) || null;
/* Siempre en orden natural ("Tema 2" antes que "Tema 10", A1 antes que B1); lo
   que no tiene número va detrás, en el orden en que se creó. Así el temario
   queda ordenado lo apunte como lo apunte, y no hay botón de ordenar. */
const numerosDe = c => String(c).split('.').map(Number);
/** Orden de dos códigos de subtema ("1.2" < "1.10" < "2.1"). */
export function comparaCodigos(a, b) {
  const x = numerosDe(a), y = numerosDe(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? -1) - (y[i] ?? -1); if (d) return d; }
  return 0;
}
export const temasDe = asigId => listaTemas().filter(t => t.asignaturaId === asigId)
  .map((t, i) => [t, i]).sort((a, b) =>
    (a[0].codigo && b[0].codigo ? comparaCodigos(a[0].codigo, b[0].codigo) : comparaOrden(a[0].nombre, b[0].nombre)) || a[1] - b[1]).map(([t]) => t);

export const nuevoId = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function guardarTemas(lista) {
  guardar('temas', lista);
  emitir('local-cambio');
  emitir('datos-cambio', ['temas']);
}

export function crearTema({ asignaturaId, nombre, dominio = 0 }) {
  const t = {
    id: nuevoId(),
    asignaturaId,
    nombre: String(nombre || '').trim().slice(0, 120),
    dominio: Math.max(0, Math.min(100, dominio)),
    paso: 0,
    ultimoRepaso: null,
    proximoRepaso: null,
    creado: Date.now(),
  };
  guardarTemas([...listaTemas(), t]);
  return t;
}

/** Varios temas de golpe, de una lista de nombres. Se saltan los vacíos y los
    que ya existen en esa asignatura (sin mirar mayúsculas ni tildes). Devuelve
    los creados. Una sola escritura: así viaja una vez, no una por tema. */
export function crearTemas(asignaturaId, nombres) {
  // unirNombres quita vacíos y repetidos (también "la misma unidad": dos
  // líneas "Tema 3" se quedan con la más completa) y lo que ya hay.
  const nuevos = unirNombres([nombres || []], temasDe(asignaturaId).map(t => t.nombre));
  const creados = [];
  for (const crudo of nuevos) {
    const nombre = String(crudo || '').trim().slice(0, 120);
    if (!nombre) continue;
    creados.push({
      id: nuevoId(), asignaturaId, nombre, dominio: 0, paso: 0,
      ultimoRepaso: null, proximoRepaso: null, creado: Date.now(),
    });
  }
  if (creados.length) guardarTemas([...listaTemas(), ...creados]);
  return creados;
}

/** Cuelga de su tema los apuntes de la asignatura que no tienen ninguno, por
    el número de unidad en su título. `soloContar` no toca nada: dice cuántos
    se colgarían (para ofrecerlo). Devuelve cuántos. */
export function enlazarApuntes(asignaturaId, { soloContar = false } = {}) {
  const apuntes = leer('apuntesMeta', []);
  const enlaces = enlacesDeApuntes(apuntes.filter(a => a.asignaturaId === asignaturaId), temasDe(asignaturaId));
  if (soloContar || !enlaces.length) return enlaces.length;
  const porApunte = new Map(enlaces.map(e => [e.apunteId, e.temaId]));
  guardar('apuntesMeta', apuntes.map(a => (porApunte.has(a.id) ? { ...a, temaId: porApunte.get(a.id) } : a)));
  emitir('local-cambio');
  emitir('datos-cambio', ['apuntesMeta']);
  return enlaces.length;
}

/* ============================== SUBTEMAS ===================================
   Solo para las asignaturas con `subtemas: true` (Matemáticas). El temario se
   divide en sus apartados ("1.2 Tipos de matrices"): cada uno es un TEMA de
   verdad (con su dominio, repaso, examen y sesiones) que cuelga de su tema
   grande (`padre`, solo para agrupar: el tema grande no es otro tema, así nada
   se cuenta dos veces). Los subapartados (1.2.1…) son el detalle del subtema
   (`apartados`), con la marca de "nuevo" al ampliarse el archivo. */

/** De los apartados leídos a los subtemas: [{codigo, nombre, padre, detalle}].
    Un tema sin apartados es un subtema él mismo. */
export function subtemasDeGrupos(grupos, nombresTemas = []) {
  const grande = num => nombresTemas.find(n => unidadDe(n)?.num === num) || `Tema ${num}`;
  const items = [];
  for (const g of grupos || []) {
    const hijos = g.apartados.filter(a => a.n === 2);
    if (!hijos.length) { items.push({ codigo: String(g.num), nombre: grande(g.num), padre: null, detalle: [] }); continue; }
    for (const h of hijos) {
      items.push({ codigo: h.c, nombre: `${h.c} ${h.t}`, padre: grande(g.num),
        detalle: g.apartados.filter(a => a.n === 3 && a.c.startsWith(h.c + '.')) });
    }
  }
  return items.sort((a, b) => comparaCodigos(a.codigo, b.codigo));
}

/** Qué hay de nuevo en esos subtemas respecto a lo que ya está guardado. */
export function novedadesSubtemas(asignaturaId, items) {
  const propios = temasDe(asignaturaId);
  const nuevos = [], conocidos = [], ampliados = [];
  for (const it of items) {
    const t = propios.find(x => x.codigo === it.codigo);
    if (!t) { nuevos.push(it.nombre); continue; }
    conocidos.push(it.nombre);
    const tenia = new Set((t.apartados || []).map(a => a.c));
    const mas = t.apartados ? it.detalle.filter(a => !tenia.has(a.c)) : [];
    if (mas.length) ampliados.push({ tema: t.nombre, apartados: mas.map(a => a.c) });
  }
  return { nuevos, conocidos, ampliados };
}

/** Crea los subtemas elegidos (por su código) y anota el detalle de todos los
    que existen. Una sola escritura. Devuelve { creados, detalles }. */
export function guardarSubtemas(asignaturaId, items, codigosElegidos) {
  const elegidos = new Set(codigosElegidos);
  const hoy = Date.now();
  const lista = listaTemas();
  const existentes = lista.filter(t => t.asignaturaId === asignaturaId);
  let creados = 0, detalles = 0;
  const nuevos = [];
  for (const it of items) {
    if (existentes.some(t => t.codigo === it.codigo) || !elegidos.has(it.codigo)) continue;
    nuevos.push({
      id: nuevoId(), asignaturaId, nombre: it.nombre.slice(0, 120), codigo: it.codigo, padre: it.padre,
      dominio: 0, paso: 0, ultimoRepaso: null, proximoRepaso: null, creado: hoy,
      ...(it.detalle.length ? { apartados: it.detalle.map(a => ({ ...a, desde: null })) } : {}),
    });
    creados++;
  }
  const todas = [...lista, ...nuevos].map(t => {
    if (t.asignaturaId !== asignaturaId || !t.codigo || nuevos.includes(t)) return t;
    const it = items.find(x => x.codigo === t.codigo);
    if (!it) return t;
    const tenia = new Set((t.apartados || []).map(a => a.c));
    const mas = it.detalle.filter(a => !tenia.has(a.c)).map(a => ({ ...a, desde: t.apartados ? hoy : null }));
    if (!mas.length) return t;
    detalles += mas.length;
    return { ...t, apartados: [...(t.apartados || []), ...mas].sort((a, b) => comparaCodigos(a.c, b.c)) };
  });
  if (creados || detalles) guardarTemas(todas);
  return { creados, detalles };
}

/** Qué aporta un archivo de temario que se va ampliando, SIN guardar nada:
    temas nuevos, temas que ya estaban y, de estos, los apartados nuevos. */
/** ¿Este grupo de apartados es de este tema? Un grupo con `tema` (el archivo ES
    ese tema) se casa por nombre; el resto, por el número de tema del índice. */
const casa = (t, g) => (g.tema ? normaNombre(t.nombre) === normaNombre(g.tema) : unidadDe(t.nombre)?.num === g.num);
const normaNombre = n => String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function novedadesDeTemario(asignaturaId, nombres, grupos) {
  const propios = temasDe(asignaturaId);
  const numDe = n => unidadDe(n)?.num ?? null;
  const tieneNum = new Set(propios.map(t => numDe(t.nombre)).filter(x => x != null));
  const nuevosNombres = unirNombres([nombres || []], propios.map(t => t.nombre));
  const nuevosNum = new Set(nuevosNombres.map(numDe).filter(x => x != null));
  const ampliados = [];
  for (const g of grupos || []) {
    const t = propios.find(x => casa(x, g));
    if (!t) continue;
    const tenia = new Set((t.apartados || []).map(a => a.c));
    const nuevos = t.apartados ? g.apartados.filter(a => !tenia.has(a.c)) : [];     // sin apartados guardados aún: se guardan, no son "novedad"
    if (nuevos.length) ampliados.push({ tema: t.nombre, apartados: nuevos.map(a => a.c) });
  }
  return { nuevos: nuevosNombres, conocidos: (nombres || []).filter(n => tieneNum.has(numDe(n)) && !nuevosNum.has(numDe(n))), ampliados };
}

/** Guarda los apartados en sus temas (los que ya había se conservan con su
    fecha; los nuevos llevan la de hoy para poder marcarlos "nuevo"). */
export function guardarApartados(asignaturaId, grupos) {
  const propios = temasDe(asignaturaId);
  const hoy = Date.now();
  let cambios = 0;
  const lista = listaTemas().map(t => {
    if (t.asignaturaId !== asignaturaId) return t;
    const g = (grupos || []).find(x => casa(t, x));
    if (!g) return t;
    const previos = t.apartados || [];
    const tenia = new Set(previos.map(a => a.c));
    const primeraVez = !t.apartados;
    const nuevos = g.apartados.filter(a => !tenia.has(a.c)).map(a => ({ ...a, desde: primeraVez ? null : hoy }));
    if (!nuevos.length) return t;
    cambios += nuevos.length;
    return { ...t, apartados: [...previos, ...nuevos].sort((a, b) => a.c.localeCompare(b.c, 'es', { numeric: true })) };
  });
  if (cambios && propios.length) guardarTemas(lista);
  return cambios;
}

export function editarTema(id, cambios) {
  guardarTemas(listaTemas().map(t => (t.id === id ? { ...t, ...cambios } : t)));
}

export function borrarTema(id) {
  guardarTemas(listaTemas().filter(t => t.id !== id));
}

/* ------------------------------- repaso ------------------------------------ */

/** Registra un repaso. resultado: 'mal' | 'regular' | 'bien'.
    Devuelve el tema ya actualizado (dominio nuevo y próxima fecha). */
export function registrarRepaso(id, resultado) {
  const lista = listaTemas();
  const t = lista.find(x => x.id === id);
  if (!t) return null;

  const salto = resultado === 'bien' ? 1 : resultado === 'regular' ? 0 : -1;
  const paso = Math.max(0, Math.min(PASOS.length - 1, (t.paso || 0) + salto));

  // El dominio se mueve hacia un objetivo, no a saltos bruscos: un solo
  // repaso bueno no convierte un tema en dominado, ni uno malo lo hunde.
  const objetivo = resultado === 'bien' ? 100 : resultado === 'regular' ? 65 : 25;
  const dominio = Math.round((t.dominio || 0) + (objetivo - (t.dominio || 0)) * 0.4);

  const hoy = hoyLocal();
  const nuevo = {
    ...t, paso, dominio: Math.max(0, Math.min(100, dominio)),
    ultimoRepaso: hoy, proximoRepaso: sumaDias(hoy, PASOS[paso]),
  };
  guardarTemas(lista.map(x => (x.id === id ? nuevo : x)));
  return nuevo;
}

/** Mueve el dominio por algo que no es un repaso formal: una sesión de
    estudio o el resultado de un test. `peso` de 0 a 1. */
export function ajustarDominio(id, objetivo, peso = 0.25) {
  const lista = listaTemas();
  const t = lista.find(x => x.id === id);
  if (!t) return null;
  const dominio = Math.round(Math.max(0, Math.min(100,
    (t.dominio || 0) + (objetivo - (t.dominio || 0)) * peso)));
  const nuevo = { ...t, dominio };
  guardarTemas(lista.map(x => (x.id === id ? nuevo : x)));
  return nuevo;
}

/** Temas que tocan hoy o que ya se han pasado de fecha. */
export function tocaRepasar() {
  const hoy = hoyLocal();
  return listaTemas()
    .filter(t => t.proximoRepaso && t.proximoRepaso <= hoy)
    .sort((a, b) => a.proximoRepaso.localeCompare(b.proximoRepaso));
}

/** Temas sin tocar desde hace mucho: ni repasados ni estudiados. */
export function abandonados(dias = 21) {
  return listaTemas().filter(t => {
    if (!t.ultimoRepaso) return false;          // uno nunca empezado no está "abandonado"
    return -diasHasta(t.ultimoRepaso) >= dias && (t.dominio || 0) < 70;
  });
}

/** Los más flojos, para atacar primero. */
export function flojos(limite = 8) {
  return listaTemas()
    .slice()
    .sort((a, b) => (a.dominio || 0) - (b.dominio || 0))
    .slice(0, limite);
}

/** Dominio medio de una lista de temas, o null si no hay ninguno. */
export function dominioMedio(temas) {
  if (!temas?.length) return null;
  return Math.round(temas.reduce((s, t) => s + (t.dominio || 0), 0) / temas.length);
}
