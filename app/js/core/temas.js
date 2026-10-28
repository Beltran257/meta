/* ===========================================================================
   TEMAS — la pieza que conecta todo lo demás.

   Un tema pertenece a una asignatura y guarda un DOMINIO estimado (0-100).
   Ese número no se lo inventa nadie: sube y baja solo con lo que haces
   (repasos, tests, sesiones de estudio), y es lo que alimenta la preparación
   de un examen, la detección de puntos flojos y el plan del día.

   El repaso espaciado es deliberadamente sencillo y explicable: cinco pasos
   (1, 3, 7, 16 y 35 días). Contestar bien avanza un paso, regular repite el
   mismo y mal retrocede al principio. No hace falta SM-2 para un curso.
   =========================================================================== */

import { leer, guardar } from './store.js';
import { emitir } from './bus.js';
import { hoyLocal, sumaDias, diasHasta } from './fmt.js';
import { comparaOrden, enlacesDeApuntes, unirNombres } from './temario.js';

export const PASOS = [1, 3, 7, 16, 35];

export const listaTemas = () => leer('temas', []);
export const temaDe = id => listaTemas().find(t => t.id === id) || null;
/* Siempre en orden natural ("Tema 2" antes que "Tema 10", A1 antes que B1); lo
   que no tiene número va detrás, en el orden en que se creó. Así el temario
   queda ordenado lo apunte como lo apunte, y no hay botón de ordenar. */
export const temasDe = asigId => listaTemas().filter(t => t.asignaturaId === asigId)
  .map((t, i) => [t, i]).sort((a, b) => comparaOrden(a[0].nombre, b[0].nombre) || a[1] - b[1]).map(([t]) => t);

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
