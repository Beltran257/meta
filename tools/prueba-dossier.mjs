/* ===========================================================================
   PRUEBA DEL DOSSIER — sin red. Es lo que acaba dentro de un Documento de
   Google que NotebookLM lee como fuente, así que un fallo aquí no se ve en la
   app: se ve en que el cuaderno responde con datos de otra asignatura, o con
   apuntes que ya no existen.

   Lo que más se vigila: que NO se cuele contenido de una asignatura en el
   dossier de otra (sería lo peor que puede pasar — respuestas mezcladas sin
   que se note) y que la huella cambie cuando cambia el contenido, porque de
   ella depende que el documento se reescriba.

   Uso:  node tools/prueba-dossier.mjs
   =========================================================================== */
import { dossierDeAsignatura, dossieres, huella } from '../worker/dossier.js';

let bien = 0;
const fallos = [];
const comprueba = (que, ok, detalle = '') => {
  if (ok) bien++;
  else fallos.push(`${que}${detalle ? ` — ${detalle}` : ''}`);
};

const AHORA = new Date('2026-08-25T10:00:00Z');

const buzon = {
  claves: {
    asignaturas: { datos: [
      { id: 'a1', nombre: 'Historia de España', profesor: 'Muñoz' },
      { id: 'a2', nombre: 'Matemáticas CCSS' },
      { id: 'a3', nombre: 'Inglés' },   // sin nada: no debe generar dossier
    ] },
    temas: { datos: [
      { id: 't1', asignaturaId: 'a1', nombre: 'La Restauración', dominio: 42, proximo: '2026-09-01' },
      { id: 't2', asignaturaId: 'a1', nombre: 'La Segunda República', dominio: 91 },
      { id: 't3', asignaturaId: 'a2', nombre: 'Derivadas', dominio: 70 },
    ] },
    apuntes: { datos: [] },
    apuntesMeta: { datos: [
      { id: 'p1', asignaturaId: 'a1', titulo: 'Canovismo', texto: 'Turno pacífico.\nCaciquismo.', tipo: 'texto', evaluacion: '1', fecha: '2026-09-10' },
      { id: 'p2', asignaturaId: 'a1', titulo: 'Foto de la pizarra', texto: 'Constitución de 1876', tipo: 'foto', evaluacion: '2', fecha: '2026-10-02' },
      { id: 'p3', asignaturaId: 'a2', titulo: 'Regla de la cadena', texto: 'f(g(x))', tipo: 'texto', evaluacion: '1' },
      { id: 'p4', asignaturaId: 'a1', titulo: 'PDF escaneado sin OCR', texto: '', tipo: 'pdf', evaluacion: 'pau' },
    ] },
    flashcards: { datos: [
      { id: 'f1', temaId: 't1', anverso: '¿Qué es el turno pacífico?', reverso: 'Alternancia pactada' },
      { id: 'f2', temaId: 't3', anverso: 'Derivada de x²', reverso: '2x' },
    ] },
    tareas: { datos: [
      { id: 'x1', asignaturaId: 'a1', tipo: 'examen', titulo: 'Examen de la Restauración', fecha: '2026-09-30', notas: 'Temas 1 y 2' },
      { id: 'x2', asignaturaId: 'a1', tipo: 'tarea', titulo: 'Comentario de texto', fecha: '2026-08-01' },  // pasada
      { id: 'x3', asignaturaId: 'a2', tipo: 'examen', titulo: 'Examen de derivadas', fecha: '2026-10-05' },
    ] },
    notas: { datos: {
      a1: { evaluaciones: { 1: [{ nombre: 'Primer parcial', valor: 7.5 }] }, objetivo: 9 },
    } },
    notasRapidas: { datos: [{ id: 'r1', texto: 'comprar cuaderno' }] },
  },
};

const historia = dossierDeAsignatura(buzon, 'a1', AHORA);
const mates = dossierDeAsignatura(buzon, 'a2', AHORA);

/* --- 1. Lo básico ---------------------------------------------------------- */
comprueba('genera dossier de una asignatura con contenido', !!historia);
comprueba('el nombre del documento lleva la asignatura', historia?.nombre === 'META · Historia de España', historia?.nombre);
comprueba('una asignatura sin nada NO genera documento', dossierDeAsignatura(buzon, 'a3', AHORA) === null);
comprueba('una asignatura que no existe NO genera documento', dossierDeAsignatura(buzon, 'nope', AHORA) === null);
comprueba('un buzón vacío no revienta', dossieres({ claves: {} }, AHORA).length === 0);

/* --- 2. LO MÁS IMPORTANTE: nada de otra asignatura se cuela ----------------
   Si esto falla, NotebookLM responde sobre Historia citando Matemáticas y no
   hay forma de notarlo desde fuera. */
comprueba('el dossier de Historia NO trae temas de Matemáticas', !historia.html.includes('Derivadas'));
comprueba('el dossier de Historia NO trae apuntes de Matemáticas', !historia.html.includes('Regla de la cadena'));
comprueba('el dossier de Historia NO trae tarjetas de Matemáticas', !historia.html.includes('Derivada de x'));
comprueba('el dossier de Historia NO trae exámenes de Matemáticas', !historia.html.includes('Examen de derivadas'));
comprueba('el dossier de Matemáticas NO trae nada de Historia',
  !mates.html.includes('Restauración') && !mates.html.includes('Canovismo') && !mates.html.includes('turno pacífico'));
comprueba('las notas son las de SU asignatura', historia.html.includes('7,5') && !mates.html.includes('7,5'));

/* --- 3. Está lo que tiene que estar ---------------------------------------- */
comprueba('lleva el temario con su dominio', historia.html.includes('La Restauración') && historia.html.includes('42'));
comprueba('lleva el texto de los apuntes', historia.html.includes('Turno pacífico') && historia.html.includes('Caciquismo'));
comprueba('lleva el texto que el OCR sacó de una foto', historia.html.includes('Constitución de 1876'));
comprueba('avisa de que un apunte viene de una foto', historia.html.includes('texto leído de una foto'));
comprueba('lleva las tarjetas de repaso', historia.html.includes('turno pacífico') && historia.html.includes('Alternancia pactada'));
comprueba('agrupa los apuntes por evaluación', historia.html.includes('1ª evaluación') && historia.html.includes('2ª evaluación'));
comprueba('el apunte de PAU va en su apartado', historia.html.includes('PAU'));
comprueba('un PDF sin OCR se explica en vez de salir vacío', historia.html.includes('todavía no se ha extraído texto'));
comprueba('lleva el profesor si lo hay', historia.html.includes('Muñoz'));
comprueba('las notas rápidas NO entran (no tienen asignatura)', !historia.html.includes('comprar cuaderno'));

/* --- 4. Fechas: solo lo que viene, no lo que ya pasó ------------------------ */
comprueba('el examen futuro entra', historia.html.includes('Examen de la Restauración'));
comprueba('la entrega ya pasada NO entra', !historia.html.includes('Comentario de texto'));
comprueba('la fecha se escribe en cristiano', historia.html.includes('30 de septiembre de 2026'));

/* --- 5. HTML válido para que Google lo convierta bien ---------------------- */
comprueba('abre y cierra el html', historia.html.startsWith('<html>') && historia.html.trimEnd().endsWith('</html>'));
comprueba('tiene un h1 con la asignatura', /<h1>Historia de España<\/h1>/.test(historia.html));
comprueba('usa títulos de verdad (los cita NotebookLM)', historia.html.includes('<h2>'));

/* --- 6. Escapado: un apunte con < o & no puede romper el documento --------- */
const conRaros = dossierDeAsignatura({
  claves: {
    asignaturas: { datos: [{ id: 'z', nombre: 'Química & <Física>' }] },
    apuntesMeta: { datos: [{ id: 'q', asignaturaId: 'z', titulo: '<script>alert(1)</script>', texto: 'a < b & c', tipo: 'texto' }] },
  },
}, 'z', AHORA);
comprueba('escapa el nombre de la asignatura', conRaros.html.includes('Química &amp; &lt;Física&gt;'));
comprueba('escapa el título de un apunte', conRaros.html.includes('&lt;script&gt;') && !conRaros.html.includes('<script>'));
comprueba('escapa el texto de un apunte', conRaros.html.includes('a &lt; b &amp; c'));

/* --- 7. La huella: de ella depende que el documento se reescriba -----------
   Si no cambia al cambiar el contenido, el documento se queda viejo para
   siempre y el cuaderno de NotebookLM con él, sin ningún aviso. */
comprueba('mismo contenido, misma huella', huella('hola mundo') === huella('hola mundo'));
comprueba('contenido distinto, huella distinta', huella('hola mundo') !== huella('hola mundes'));
comprueba('un cambio de una letra cambia la huella', huella('abc') !== huella('abd'));
comprueba('el dossier trae huella', typeof historia.hash === 'string' && historia.hash.length > 0);

const buzon2 = JSON.parse(JSON.stringify(buzon));
buzon2.claves.apuntesMeta.datos[0].texto = 'Turno pacífico. Caciquismo. Y algo más.';
comprueba('tocar un apunte cambia la huella de SU asignatura',
  dossierDeAsignatura(buzon2, 'a1', AHORA).hash !== historia.hash);
comprueba('tocar un apunte NO cambia la huella de las demás',
  dossierDeAsignatura(buzon2, 'a2', AHORA).hash === mates.hash);

/* --- 8. dossieres() devuelve solo las que tienen algo ---------------------- */
const todos = dossieres(buzon, AHORA);
comprueba('dossieres() salta la asignatura vacía', todos.length === 2, `salieron ${todos.length}`);
comprueba('dossieres() trae el id de asignatura', todos.every(d => d.asignaturaId && d.asignatura));

for (const f of fallos) console.log('❌ ' + f);
console.log(`${bien} correctas · ${fallos.length} fallidas`);
if (fallos.length) process.exit(1);
