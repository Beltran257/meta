/* ===========================================================================
   DOSSIER — el documento de estudio de UNA asignatura, en HTML, para que
   NotebookLM (Gemini Notebook) lo tenga como fuente y lo siga solo.

   Función PURA sobre el buzón, igual que worker/briefing.js: el Worker no
   tiene localStorage, así que se relee del buzón con el mismo criterio que
   core/motor.js — nunca se inventa aquí un cálculo nuevo.

   QUÉ ENTRA Y POR QUÉ. Esto no es un volcado de la base de datos: es lo que
   sirve para preguntarle a un cuaderno de NotebookLM sobre la asignatura.
     · El temario con su dominio, para que el cuaderno sepa qué lleva flojo.
     · El TEXTO de los apuntes — incluido el que el OCR sacó de las fotos y
       los PDF (ver worker/ocr.js). Esto es la carne del asunto.
     · Las tarjetas de repaso, que ya son pares pregunta/respuesta.
     · Exámenes y entregas con fecha, para que pueda preguntar "qué me queda".
     · Las notas de cada evaluación y su objetivo.
   Se quedan fuera las notas rápidas, que no tienen asignatura (son captura al
   vuelo), y los blobs de fotos y PDF, que no caben en un documento.

   HTML y no texto plano: al convertirlo a Documento de Google se respetan
   títulos y listas, y NotebookLM cita "según el apartado de Temario" en vez
   de devolver un muro de texto sin referencias.
   =========================================================================== */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const e = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);

const EVALUACIONES = { 1: '1ª evaluación', 2: '2ª evaluación', 3: '3ª evaluación', pau: 'PAU' };

/** Fecha de hoy en Madrid, no en UTC: de madrugada el día UTC sería el de
    ayer. Mismo criterio que worker/briefing.js. */
function hoyMadrid(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

const fechaLegible = ymd => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return '';
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${+m[3]} de ${MESES[+m[2] - 1]} de ${m[1]}`;
};

/** El texto de un apunte conserva sus saltos de línea: son la estructura que
    él escribió (guiones, apartados). Convertirlos en párrafos de verdad es lo
    que hace que el documento se lea, en vez de ser una parrafada. */
function parrafos(texto) {
  return String(texto || '')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => `<p>${e(l)}</p>`)
    .join('');
}

const seccion = (titulo, cuerpo) => (cuerpo ? `<h2>${e(titulo)}</h2>${cuerpo}` : '');

/* ------------------------------- las partes -------------------------------- */

function parteTemario(temas) {
  if (!temas.length) return '';
  const filas = temas.map(t => {
    const d = Number.isFinite(t.dominio) ? Math.round(t.dominio) : null;
    const nivel = d == null ? 'sin medir todavía'
      : d >= 85 ? 'lo llevo bien'
      : d >= 60 ? 'a medias'
      : 'flojo';
    return `<li><b>${e(t.nombre)}</b> — ${d == null ? 'sin medir todavía' : `dominio ${d} de 100 (${nivel})`}` +
      `${t.proximo ? `. Próximo repaso: ${e(fechaLegible(t.proximo))}` : ''}</li>`;
  }).join('');
  return `<p>El dominio va de 0 a 100 y no es una nota: lo calcula META sola a partir de los
    repasos, tests y sesiones de estudio. Sirve para saber por dónde hay que apretar.</p>
    <ul>${filas}</ul>`;
}

function parteApuntes(apuntes) {
  if (!apuntes.length) return '';
  const porEval = new Map();
  for (const a of apuntes) {
    const k = a.evaluacion || 'sin';
    if (!porEval.has(k)) porEval.set(k, []);
    porEval.get(k).push(a);
  }
  const orden = ['1', '2', '3', 'pau', 'sin'];
  return [...porEval.entries()]
    .sort((x, y) => orden.indexOf(x[0]) - orden.indexOf(y[0]))
    .map(([k, lista]) => {
      const titulo = EVALUACIONES[k] || 'Sin evaluación asignada';
      const cuerpo = lista
        .sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')))
        .map(a => {
          const origen = a.tipo === 'foto' ? ' (texto leído de una foto)'
            : a.tipo === 'pdf' ? ' (texto leído de un PDF)' : '';
          return `<h4>${e(a.titulo || 'Apunte sin título')}${e(origen)}</h4>` +
            (a.fecha ? `<p><i>${e(fechaLegible(a.fecha))}</i></p>` : '') +
            (parrafos(a.texto) || '<p><i>Este apunte es una foto o un PDF del que todavía no se ha extraído texto.</i></p>');
        }).join('');
      return `<h3>${e(titulo)}</h3>${cuerpo}`;
    }).join('');
}

function parteTarjetas(flashcards, temas) {
  if (!flashcards.length) return '';
  const nombreTema = id => temas.find(t => t.id === id)?.nombre || 'Sin tema';
  const porTema = new Map();
  for (const f of flashcards) {
    const k = nombreTema(f.temaId);
    if (!porTema.has(k)) porTema.set(k, []);
    porTema.get(k).push(f);
  }
  return [...porTema.entries()].map(([tema, lista]) =>
    `<h3>${e(tema)}</h3><ul>${lista.map(f =>
      `<li><b>${e(f.anverso)}</b> → ${e(f.reverso)}</li>`).join('')}</ul>`).join('');
}

function parteFechas(tareas, hoy) {
  const futuras = tareas
    .filter(t => t.fecha && t.fecha >= hoy)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (!futuras.length) return '';
  return `<ul>${futuras.map(t =>
    `<li><b>${t.tipo === 'examen' ? 'Examen' : 'Entrega'}: ${e(t.titulo)}</b> — ${e(fechaLegible(t.fecha))}` +
    `${t.notas ? `. ${e(t.notas)}` : ''}</li>`).join('')}</ul>`;
}

function parteNotas(entrada) {
  if (!entrada) return '';
  const trozos = [];
  for (const k of ['1', '2', '3']) {
    const lista = entrada.evaluaciones?.[k] || [];
    if (!lista.length) continue;
    trozos.push(`<li><b>${e(EVALUACIONES[k])}</b>: ${lista.map(n =>
      `${e(n.nombre || 'Prueba')} ${Number(n.valor).toLocaleString('es-ES')}`).join(', ')}</li>`);
  }
  if (entrada.objetivo != null) {
    trozos.push(`<li><b>Objetivo del curso</b>: ${Number(entrada.objetivo).toLocaleString('es-ES')}</li>`);
  }
  return trozos.length ? `<ul>${trozos.join('')}</ul>` : '';
}

/* --------------------------------- montaje --------------------------------- */

/** Devuelve { nombre, html, hash } de una asignatura, o null si no hay nada
    que contar todavía (no tiene sentido crear en su Drive un documento vacío). */
export function dossierDeAsignatura(buzon, asignaturaId, ahora = new Date()) {
  const c = buzon?.claves || {};
  const asignaturas = c.asignaturas?.datos || [];
  const asig = asignaturas.find(a => a.id === asignaturaId);
  if (!asig) return null;

  const hoy = hoyMadrid(ahora);
  const temas = (c.temas?.datos || []).filter(t => t.asignaturaId === asignaturaId);
  const idsTema = new Set(temas.map(t => t.id));
  const apuntes = (c.apuntesMeta?.datos || []).filter(a => a.asignaturaId === asignaturaId);
  const flashcards = (c.flashcards?.datos || []).filter(f => idsTema.has(f.temaId));
  const tareas = (c.tareas?.datos || []).filter(t => t.asignaturaId === asignaturaId);
  const notas = (c.notas?.datos || {})[asignaturaId] || null;

  const partes = [
    seccion('Temario y cómo lo llevo', parteTemario(temas)),
    seccion('Mis apuntes', parteApuntes(apuntes)),
    seccion('Tarjetas de repaso', parteTarjetas(flashcards, temas)),
    seccion('Exámenes y entregas que vienen', parteFechas(tareas, hoy)),
    seccion('Mis notas', parteNotas(notas)),
  ].filter(Boolean);

  if (!partes.length) return null;

  const html = `<html><body>
    <h1>${e(asig.nombre)}</h1>
    <p><i>Dossier generado por META el ${e(fechaLegible(hoy))}. No editar a mano: se
    reescribe entero cada vez que cambian los datos en la app.${asig.profesor ? ` Profesor: ${e(asig.profesor)}.` : ''}</i></p>
    ${partes.join('')}
  </body></html>`;

  return { nombre: `META · ${asig.nombre}`, html, hash: huella(html) };
}

/** Huella barata del contenido, para no reescribir el documento (ni gastar
    cuota de Drive) cuando no ha cambiado nada. No hace falta que sea
    criptográfica: solo tiene que cambiar cuando el texto cambia. */
export function huella(texto) {
  let h = 5381;
  for (let i = 0; i < texto.length; i++) h = ((h << 5) + h + texto.charCodeAt(i)) | 0;
  return `${texto.length}:${(h >>> 0).toString(36)}`;
}

/** Todas las asignaturas que tienen algo que contar. */
export function dossieres(buzon, ahora = new Date()) {
  const asignaturas = buzon?.claves?.asignaturas?.datos || [];
  return asignaturas
    .map(a => {
      const d = dossierDeAsignatura(buzon, a.id, ahora);
      return d ? { asignaturaId: a.id, asignatura: a.nombre, ...d } : null;
    })
    .filter(Boolean);
}
