/* ===========================================================================
   PRUEBA DEL FEED ICS — sin red. Es el único trozo de meta que consume un
   programa ajeno (Apple Calendar, Google Calendar, Outlook), así que un
   formato mal puesto no se ve en la app: se ve en que el calendario no
   sincroniza, o peor, sincroniza mal y no dice nada.

   Uso:  node tools/prueba-ics.mjs
   =========================================================================== */
import { construirIcs } from '../worker/ics.js';

let bien = 0;
const fallos = [];
const comprueba = (que, ok, detalle = '') => {
  if (ok) bien++;
  else fallos.push(`${que}${detalle ? ` — ${detalle}` : ''}`);
};

const octetos = s => Buffer.byteLength(s, 'utf8');

const buzon = (tareas, asignaturas = []) => ({ claves: { tareas: { datos: tareas }, asignaturas: { datos: asignaturas } } });

/* --- 1. Tope de 75 OCTETOS por línea, que es lo que dice la RFC 5545 -------
   Este es el fallo que se encontró el 24 ago 2026: se contaban caracteres,
   así que un título con acentos (que en UTF-8 ocupan 2 octetos) se colaba
   por encima del tope sin plegar. En español pasa constantemente. */
const asignaturas = [{ id: 'a1', nombre: 'Matemáticas Aplicadas a las Ciencias Sociales II' }];
const ics = construirIcs(buzon([
  { id: 't1', fecha: '2026-09-12', tipo: 'examen', titulo: 'Función exponencial y logarítmica', asignaturaId: 'a1' },
], asignaturas), 'codigo-de-prueba');

const largas = ics.split('\r\n').filter(l => octetos(l) > 75);
comprueba('ninguna línea pasa de 75 octetos', largas.length === 0,
  largas.length ? `${largas.length} se pasan, la peor con ${Math.max(...largas.map(octetos))}` : '');

/* --- 2. Plegar y desplegar devuelve exactamente el texto original ----------
   Desplegar = quitar CRLF + el espacio siguiente. Si el resultado no es
   idéntico, el calendario enseña un título distinto del que él escribió. */
const desplegado = ics.replace(/\r\n /g, '');
comprueba('el título sobrevive al plegado',
  desplegado.includes('Matemáticas Aplicadas a las Ciencias Sociales II'));
comprueba('el título de la tarea sobrevive al plegado',
  desplegado.includes('Función exponencial y logarítmica'));

/* --- 3. Un emoji no se parte por la mitad ----------------------------------
   Cortar por unidades UTF-16 partía el par sustituto y el calendario recibía
   el carácter de reemplazo. Se prueba con el emoji colocado justo donde cae
   el corte, no en cualquier sitio. */
for (let relleno = 40; relleno <= 90; relleno++) {
  const titulo = 'x'.repeat(relleno) + '🎓fin';
  const salida = construirIcs(buzon([
    { id: 't2', fecha: '2026-09-12', tipo: 'tarea', titulo, asignaturaId: 'a1' },
  ], asignaturas), 'c');
  if (/�/.test(salida) || /[\uD800-\uDBFF]$/m.test(salida)) {
    fallos.push(`emoji partido con relleno de ${relleno} caracteres`);
    break;
  }
  if (!salida.replace(/\r\n /g, '').includes(titulo)) {
    fallos.push(`el emoji no sobrevive con relleno de ${relleno}`);
    break;
  }
  if (relleno === 90) bien++;
}

/* --- 4. Estructura mínima que exige un cliente de calendario --------------- */
comprueba('abre y cierra el VCALENDAR', ics.startsWith('BEGIN:VCALENDAR') && ics.trimEnd().endsWith('END:VCALENDAR'));
comprueba('los saltos son CRLF, no LF suelto', !/[^\r]\n/.test(ics));
comprueba('hay un VEVENT por tarea con fecha',
  (ics.match(/BEGIN:VEVENT/g) || []).length === 1);

/* --- 5. DTEND es EXCLUSIVO: un examen del 12 termina el 13 -----------------
   Si esto se rompe, el examen aparece un día corrido en el calendario y no
   hay forma de notarlo desde la app. */
comprueba('DTSTART es el día del examen', ics.includes('DTSTART;VALUE=DATE:20260912'));
comprueba('DTEND es el día siguiente (fin exclusivo)', ics.includes('DTEND;VALUE=DATE:20260913'));

const finDeMes = construirIcs(buzon([
  { id: 't3', fecha: '2026-12-31', tipo: 'examen', titulo: 'Fin de año', asignaturaId: 'a1' },
], asignaturas), 'c');
comprueba('el día siguiente cruza bien el cambio de año', finDeMes.includes('DTEND;VALUE=DATE:20270101'));

/* --- 6. Escapado ICS: ; , y \ tienen significado en el formato ------------- */
const conComas = construirIcs(buzon([
  { id: 't4', fecha: '2026-09-12', tipo: 'tarea', titulo: 'Leer; resumir, y comentar', asignaturaId: 'a1' },
], asignaturas), 'c');
// Sobre el texto DESPLEGADO: el plegado puede caer justo entre la barra y el
// signo, y ahí lo que importa es lo que el calendario reconstruye, no cómo
// viajó partido.
const comasPlano = conComas.replace(/\r\n /g, '');
comprueba('el punto y coma va escapado', comasPlano.includes('Leer\\;'));
comprueba('la coma va escapada', comasPlano.includes('resumir\\,'));

/* --- 7. Una tarea sin fecha no genera evento ------------------------------- */
const sinFecha = construirIcs(buzon([{ id: 't5', tipo: 'tarea', titulo: 'Algún día', asignaturaId: 'a1' }], asignaturas), 'c');
comprueba('una tarea sin fecha no entra en el calendario', !sinFecha.includes('BEGIN:VEVENT'));

/* --- 8. Un buzón vacío da un calendario válido, no un error ---------------- */
const vacio = construirIcs({ claves: {} }, 'c');
comprueba('un buzón vacío da un calendario válido', vacio.includes('BEGIN:VCALENDAR') && vacio.includes('END:VCALENDAR'));

for (const f of fallos) console.log('❌ ' + f);
console.log(`${bien} correctas · ${fallos.length} fallidas`);
if (fallos.length) process.exit(1);
