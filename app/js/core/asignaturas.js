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
