/* ===========================================================================
   ASIGNATURAS — helpers compartidos por todas las vistas. Las asignaturas son
   la única lista que hace falta tener resuelta para que el resto de la app
   (horario, tareas, notas, apuntes) tenga sentido.
   =========================================================================== */
import { leer } from './store.js';

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

/* Tres clases de "asignatura", porque no todas cuelgan lo mismo:
   · académica  — la del curso oficial: temario, notas, exámenes.
   · particular — clases fuera del centro (una academia, un profesor
     particular) que sí generan temario y sesiones, pero nunca una nota
     oficial ni un examen del curso.
   · bloque     — un hueco del horario que no es clase (un recreo, una
     tutoría): solo existe para pintarse en una casilla. */
export const TIPOS_ASIGNATURA = [
  ['academica', 'Asignatura del curso'],
  ['particular', 'Clase particular'],
  ['bloque', 'Bloque del horario'],
];

export const tipoDe = a => a?.tipo || 'academica';

/** Asignaturas con algo académico de verdad: fuera quedan los bloques del
    horario, que no tienen temario, notas ni tareas y no pintan nada en el
    resumen de META AI ni en los selectores de "elige asignatura". */
export const contenido = () => listaAsignaturas().filter(a => tipoDe(a) !== 'bloque');
