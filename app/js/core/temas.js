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

export const PASOS = [1, 3, 7, 16, 35];

export const listaTemas = () => leer('temas', []);
export const temaDe = id => listaTemas().find(t => t.id === id) || null;
export const temasDe = asigId => listaTemas().filter(t => t.asignaturaId === asigId);

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
