/* ===========================================================================
   ASIGNATURAS — helpers compartidos por todas las vistas. Las asignaturas son
   la única lista que hace falta tener resuelta para que el resto de la app
   (horario, tareas, notas, apuntes) tenga sentido.
   =========================================================================== */
import { leer, guardar } from './store.js';
import { emitir } from './bus.js';

/* Paleta fija: nada de colores al azar, así dos aperturas de la app pintan la
   misma asignatura igual. Se asigna por orden de alta.
   Todos son tonos medios a propósito: el color de una asignatura aparece como
   un punto de 7px sobre blanco Y sobre negro, y tiene que leerse en los dos. */
export const PALETA = [
  '#6857e8', '#2f8f74', '#c2683b', '#3f7bd1', '#a4508b',
  '#7a8b3d', '#c9903a', '#5b6470', '#b04a5a', '#2f8fa8',
];

export const listaAsignaturas = () => leer('asignaturas', []);

export const asignaturaDe = id => listaAsignaturas().find(a => a.id === id) || null;

export const nombreDe = id => asignaturaDe(id)?.nombre || 'Sin asignatura';

export const colorDe = id => asignaturaDe(id)?.color || '#9a9ca3';

export const siguienteColor = () => {
  const usados = listaAsignaturas().length;
  return PALETA[usados % PALETA.length];
};

export const nuevoId = () => 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* Dos clases de "asignatura":
   · académica  — la del curso oficial: temario, notas, exámenes.
   · bloque     — un hueco del horario que no es clase (un recreo, una
     tutoría): solo existe para pintarse en una casilla.
   Hubo una tercera, 'particular', y se quitó (octubre 2026): las clases
   particulares son horas de la asignatura del curso que refuerzan, no otra
   asignatura. Las que quedaran guardadas se tratan como académicas hasta que
   se fusionen (ver fusionarAsignatura). */
export const TIPOS_ASIGNATURA = [
  ['academica', 'Asignatura del curso'],
  ['bloque', 'Bloque del horario'],
];

export const tipoDe = a => a?.tipo || 'academica';

/** Asignaturas con algo académico de verdad: fuera quedan los bloques del
    horario, que no tienen temario, notas ni tareas y no pintan nada en el
    resumen de META AI ni en los selectores de "elige asignatura". */
export const contenido = () => listaAsignaturas().filter(a => tipoDe(a) !== 'bloque');

/** Borra una asignatura PASANDO todo lo suyo a otra (`destinoId`), o dejándolo
    sin asignatura si es null. Cubre lo que cuelga de ella: sesiones, tareas y
    exámenes, apuntes, temas, notas, las casillas del horario y lo que ya
    había decidido sobre los bloques del calendario. Solo se escribe lo que
    cambia: cada escritura de una sección viaja a los demás aparatos. */
export function fusionarAsignatura(origenId, destinoId = null) {
  if (!origenId || origenId === destinoId) return false;
  const nuevo = destinoId || null;
  const cambiar = nombre => {
    const l = leer(nombre, []);
    if (!l.some(x => x.asignaturaId === origenId)) return;
    guardar(nombre, l.map(x => (x.asignaturaId === origenId ? { ...x, asignaturaId: nuevo } : x)));
  };
  cambiar('sesiones'); cambiar('tareas'); cambiar('apuntesMeta');

  // Temas: sin destino se borran (como siempre); con destino pasan a él.
  const temas = leer('temas', []);
  if (temas.some(t => t.asignaturaId === origenId)) {
    guardar('temas', nuevo
      ? temas.map(t => (t.asignaturaId === origenId ? { ...t, asignaturaId: nuevo } : t))
      : temas.filter(t => t.asignaturaId !== origenId));
  }

  // Notas: por asignatura. Si el destino ya tiene las suyas, mandan esas.
  const notas = leer('notas', {});
  if (notas && origenId in notas) {
    const { [origenId]: suyas, ...resto } = notas;
    guardar('notas', nuevo && !(nuevo in resto) ? { ...resto, [nuevo]: suyas } : resto);
  }

  const horario = leer('horario', null);
  if (horario?.dias && JSON.stringify(horario.dias).includes(origenId)) {
    const dias = Object.fromEntries(Object.entries(horario.dias)
      .map(([d, casillas]) => [d, (casillas || []).map(c => (c === origenId ? nuevo : c))]));
    guardar('horario', { ...horario, dias });
  }

  const cal = leer('calendario', null);
  if (cal && JSON.stringify(cal).includes(origenId)) {
    const aNuevo = v => (v === origenId ? (nuevo || 'no') : v);
    guardar('calendario', {
      ...cal,
      reglas: Object.fromEntries(Object.entries(cal.reglas || {}).map(([k, v]) => [k, aNuevo(v)])),
      decisiones: Object.fromEntries(Object.entries(cal.decisiones || {}).map(([k, d]) => [k, d.asignaturaId === origenId ? { ...d, asignaturaId: aNuevo(d.asignaturaId) } : d])),
    });
  }

  guardar('asignaturas', listaAsignaturas().filter(a => a.id !== origenId));
  emitir('local-cambio');
  emitir('datos-cambio', ['asignaturas', 'sesiones', 'tareas', 'apuntesMeta', 'temas', 'notas', 'horario', 'calendario']);
  return true;
}
