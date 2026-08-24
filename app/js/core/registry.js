/* ===========================================================================
   REGISTRO ÚNICO DE CLAVES DE ALMACENAMIENTO
   Toda clave que la app guarde en el navegador se declara AQUÍ.
   La copia de seguridad, el borrado y la sincronización se derivan de esta
   lista, así que una sección nueva entra sola en las tres: no se puede olvidar.
   =========================================================================== */

export const APP = { nombre: 'Meta', version: '2.0.14' };

export const CLAVES = {
  prefs:        { k: 'meta.prefs.v1',        desc: 'Preferencias de ESTE aparato (vista abierta, tema, avisos vistos)' },
  sync:         { k: 'meta.sync.v1',         desc: 'Estado de sincronización: de quién son estos datos y fecha de cada sección' },

  perfil:       { k: 'meta.perfil.v2',       desc: 'Perfil académico: curso, nivel, disponibilidad para estudiar' },
  asignaturas:  { k: 'meta.asignaturas.v1',  desc: 'Asignaturas del curso (nombre, color, profesor, aula)' },
  horario:      { k: 'meta.horario.v1',      desc: 'Horario semanal: franjas y qué asignatura va en cada casilla' },
  temas:        { k: 'meta.temas.v2',        desc: 'Temas de cada asignatura, con dominio estimado y fechas de repaso' },
  tareas:       { k: 'meta.tareas.v1',       desc: 'Tareas Y exámenes con fecha (el tipo los distingue)' },
  notas:        { k: 'meta.notas.v1',        desc: 'Calificaciones por asignatura y evaluación, con objetivo' },
  sesiones:     { k: 'meta.sesiones.v2',     desc: 'Sesiones de estudio registradas (asignatura, tema, minutos, resultado)' },
  flashcards:   { k: 'meta.flashcards.v2',   desc: 'Tarjetas de repaso por tema, con su caja de repaso espaciado' },
  tests:        { k: 'meta.tests.v2',        desc: 'Tests y simulacros hechos, con aciertos y fallos' },
  notasRapidas: { k: 'meta.rapidas.v2',      desc: 'Notas rápidas: captura al vuelo, sin estructura' },
  apuntesMeta:  { k: 'meta.apuntesMeta.v1',  desc: 'Apuntes (fotos y PDF: copia rápida en IndexedDB, y en la cuenta si hay sesión)' },
};

export const LISTA_CLAVES = Object.values(CLAVES).map(c => c.k);

/* Lo que viaja entre dispositivos. Fuera a propósito:
   · prefs -> es de ESTE aparato (vista abierta, tema, avisos ya vistos)
   · sync  -> es el propio mecanismo; sincronizarlo se mordería la cola
   Los apuntes viajan como metadatos (título, texto, asignatura) por el buzón
   de siempre. El contenido de fotos y PDF es aparte (ver worker/archivos.js y
   app/js/core/archivos.js): copia rápida en IndexedDB de cada aparato, y
   además en la cuenta cuando hay sesión — así se ve entre aparatos y es lo
   que usa el enlace de carpeta (tools/enlace-carpeta.mjs). */
export const CLAVES_SINCRONIZABLES = [
  'perfil', 'asignaturas', 'horario', 'temas', 'tareas', 'notas',
  'sesiones', 'flashcards', 'tests', 'notasRapidas', 'apuntesMeta',
];

/* Por qué los exámenes están dentro de 'tareas' y no en su propia clave:
   el feed ICS y los conectores de Google Calendar, Outlook y Notion leen esa
   lista y distinguen por t.tipo. Partirla en dos habría dejado los exámenes
   fuera del calendario de tres sitios a la vez. Un examen es una entrada con
   tipo 'examen' y campos propios (temaIds, dificultad). */
export const TIPOS_TAREA = ['tarea', 'examen'];
export const ESTADOS_TAREA = ['pendiente', 'haciendo', 'hecha'];
export const TIPOS_SESION = ['teoria', 'ejercicios', 'repaso', 'flashcards', 'test', 'simulacro'];
