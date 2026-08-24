/* ===========================================================================
   ICS — construye el feed de calendario a partir del buzón de sincronización.
   Es lo que permite suscribirse desde Apple Calendar, Google Calendar u
   Outlook: un enlace único por código, sin usuario ni contraseña (el código
   largo hace de llave, igual que en el resto de la sincronización).
   =========================================================================== */

function escapaICS(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/** YYYY-MM-DD -> YYYYMMDD (formato de fecha de todo el día en ICS). */
function comprime(ymd) {
  return String(ymd || '').replace(/-/g, '');
}

/** El día siguiente, para DTEND (en ICS el final de un evento de todo el día
    es EXCLUSIVO: un examen el 12 termina el 13). */
function diaSiguiente(ymd) {
  const [a, m, d] = ymd.split('-').map(Number);
  const f = new Date(a, m - 1, d + 1);
  return `${f.getFullYear()}${String(f.getMonth() + 1).padStart(2, '0')}${String(f.getDate()).padStart(2, '0')}`;
}

function plegar(linea) {
  // RFC 5545: el tope son 75 OCTETOS, no 75 caracteres, y la continuación
  // empieza por un espacio que no forma parte del valor.
  //
  // La versión anterior contaba `linea.length` (unidades UTF-16) y cortaba
  // con slice(), lo que fallaba de dos formas en español:
  //   - "Examen: Matemáticas Aplicadas a las Ciencias Sociales II" mide 74
  //     caracteres pero 78 octetos: se mandaba sin plegar, saltándose el tope.
  //   - un emoji en el título justo en el corte se partía por la mitad y
  //     llegaba al calendario como el carácter de reemplazo (?).
  // `for...of` recorre PUNTOS DE CÓDIGO, así que nunca parte un carácter.
  const enc = new TextEncoder();
  if (enc.encode(linea).length <= 75) return linea;

  const trozos = [];
  let actual = '', octetos = 0, tope = 75;   // las continuaciones llevan un
  for (const ch of linea) {                  // espacio delante: les quedan 74
    const n = enc.encode(ch).length;
    if (octetos + n > tope) { trozos.push(actual); actual = ''; octetos = 0; tope = 74; }
    actual += ch;
    octetos += n;
  }
  if (actual) trozos.push(actual);
  return trozos.join('\r\n ');
}

export function construirIcs(buzon, codigo) {
  const asignaturas = buzon?.claves?.asignaturas?.datos || [];
  const tareas = buzon?.claves?.tareas?.datos || [];
  const nombreDe = id => asignaturas.find(a => a.id === id)?.nombre || 'Sin asignatura';

  const ahora = new Date();
  const sello = `${ahora.getUTCFullYear()}${String(ahora.getUTCMonth() + 1).padStart(2, '0')}` +
    `${String(ahora.getUTCDate()).padStart(2, '0')}T${String(ahora.getUTCHours()).padStart(2, '0')}` +
    `${String(ahora.getUTCMinutes()).padStart(2, '0')}${String(ahora.getUTCSeconds()).padStart(2, '0')}Z`;

  const eventos = tareas.filter(t => t.fecha).map(t => {
    const esExamen = t.tipo === 'examen';
    const resumen = `${esExamen ? 'Examen' : 'Entrega'}: ${nombreDe(t.asignaturaId)} — ${t.titulo}`;
    return [
      'BEGIN:VEVENT',
      plegar(`UID:${t.id}@meta-${codigo}.beltranfersan.workers.dev`),
      `DTSTAMP:${sello}`,
      `DTSTART;VALUE=DATE:${comprime(t.fecha)}`,
      `DTEND;VALUE=DATE:${diaSiguiente(t.fecha)}`,
      plegar(`SUMMARY:${escapaICS(resumen)}`),
      t.notas ? plegar(`DESCRIPTION:${escapaICS(t.notas)}`) : null,
      `CATEGORIES:${escapaICS(esExamen ? 'Examen' : 'Tarea')}`,
      'END:VEVENT',
    ].filter(Boolean).join('\r\n');
  });

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Meta//Organizador académico//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    plegar('X-WR-CALNAME:Meta — tareas y exámenes'),
    'X-WR-TIMEZONE:Europe/Madrid',
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    ...eventos,
    'END:VCALENDAR',
  ].join('\r\n') + '\r\n';
}
