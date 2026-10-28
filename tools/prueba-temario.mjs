/* ===========================================================================
   PRUEBA DEL TEMARIO — sin red y sin navegador.

   Sacar los temas de un archivo es donde un fallo no se ve: un tema que falta,
   dos que se funden o uno con otro número, y se cree el temario que sale. Los
   textos de aquí son como los suelta de verdad un PDF (entradas partidas en
   dos líneas, etiquetas CORTA/LARGA al final, índices con puntos y página,
   numeración reiniciada por apartados) — algunos son trozos de archivos
   reales de sus carpetas.

   Uso:  node tools/prueba-temario.mjs
   =========================================================================== */
import { deflateRawSync } from 'node:zlib';

const almacen = new Map();
globalThis.localStorage = {
  getItem: k => (almacen.has(k) ? almacen.get(k) : null),
  setItem: (k, v) => { almacen.set(k, String(v)); },
  removeItem: k => { almacen.delete(k); },
  clear: () => almacen.clear(),
};

const T = await import('../app/js/core/temario.js');
const { guardar, leer } = await import('../app/js/core/store.js');
const { crearTemas, temasDe, enlazarApuntes } = await import('../app/js/core/temas.js');
const { tipoDeArchivo } = await import('../app/js/core/temario-lectura.js');
const { leerArchivo } = await import('../worker/temario.js');

let fallos = 0;
const mal = m => { console.log('❌ ' + m); fallos++; };
const bien = m => console.log('✅ ' + m);
const igual = (que, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? bien(que) : mal(`${que}\n     salió:    ${JSON.stringify(a)}\n     tocaba:   ${JSON.stringify(b)}`));

/* ------------------------ 1. "Tema N" / "Bloque N" ------------------------- */
igual('"Tema N" con título y con página de índice (puntos de relleno)',
  T.temasDeTexto(`ÍNDICE
Tema 1. Matrices ............ 5
Tema 2. Determinantes ......... 29
Tema 3. Sistemas de ecuaciones ...... 36`).temas,
  ['Tema 1. Matrices', 'Tema 2. Determinantes', 'Tema 3. Sistemas de ecuaciones']);

igual('Markdown de un PDF: títulos con #, negritas y bloques de metadatos',
  T.temasDeTexto(`# guia.pdf
## Metadata
- PDFFormatVersion=1.4
- Producer=Prince 20150210
## Contents
### Page 1
## **TEMA 1** EL NACIMIENTO DE LA FILOSOFÍA
### Page 2
## **TEMA 2** EL PENSAMIENTO DE PLATÓN`).temas,
  ['Tema 1. El nacimiento de la filosofía', 'Tema 2. El pensamiento de platón']);

igual('el título en la línea de abajo ("BLOQUE 1 · VOCABULARIO" / "Tipologías")',
  T.temasDeTexto(`BLOQUE 0 · VOCABULARIO PREVIO
Tipologías artísticas
Los términos que se usan en todos los bloques siguientes.
BLOQUE 1 · ARTE PREHISTÓRICO
Del paleolítico al neolítico`).temas,
  ['Bloque 0. Vocabulario previo', 'Bloque 1. Arte prehistórico']);

igual('Tema 10 va DESPUÉS de Tema 9 (orden natural, no de texto) y los números romanos valen',
  T.temasDeTexto('Tema 10. Los medios\nTema 2. La empresa\nTema IX. El dinero\nTema 1. Introducción').temas,
  ['Tema 1. Introducción', 'Tema 2. La empresa', 'Tema IX. El dinero'.replace('IX', '9'), 'Tema 10. Los medios']);

igual('la misma unidad dos veces (índice y cabecera) se queda con la más completa',
  T.temasDeTexto('Tema 3\nTema 4. Ideas\nTema 3. Aristóteles y el helenismo').temas,
  ['Tema 3. Aristóteles y el helenismo', 'Tema 4. Ideas']);

igual('una frase suelta que empieza por "Unidad" NO es un temario (hacen falta dos unidades distintas)',
  T.temasDeTexto('Unidad 5 de medida utilizada en el laboratorio es el metro.').modo, 'ninguno');

/* ---------- 2. lista numerada con apartados (la guía de PAU de verdad) ------- */
{
  const guia = `TEMARIO “HISTORIA DE ESPAÑA” (2º BACH)

TEMARIO APARTADO A. LA HISTORIA DESDE 218 A.C. HASTA 1474 D.C.
1. La importancia de la romanización en la configuración de la cultura española.  CORTA
2. Las invasiones germánicas y la s características de la  monarquía visigoda.  CORTA
3. La e volución política de Al -Ándalus.  LARGA


TEMARIO APARTADO B. LA HISTORIA DESDE 1474 D.C. HASTA 1788 D.C.
1. La unión dinástica de los RRCC y la formación del Estado Moderno.  PRÁCTICA
2. La unidad católica de la monarquía y la situació n de las minorías religiosas durante el reinado
de los RRCC.
PRÁCTICA
3. El descubrimiento de América y la organización administrativa del imperio colonial hispánico.  LARGA
10. La Ilustración en España; el despotismo ilustrado.  CORTA

TEMARIO APARTADO C. LA HISTORIA DESDE 1788 D.C.
1. La Guerra de la Independencia: antecedentes y bandos.  LARGA`;
  const r = T.temasDeTexto(guia);
  r.modo === 'lista' && r.temas.length === 8 ? bien('guía de PAU: 8 entradas en 3 apartados, la numeración reiniciada no las funde') : mal(`guía PAU: ${r.modo} ${r.temas.length}`);
  igual('…con prefijo de apartado, sin etiquetas CORTA/LARGA y palabras reparadas',
    [r.temas[1], r.temas[2], r.temas[4]],
    ['A2. Las invasiones germánicas y las características de la monarquía visigoda',
      'A3. La e volución política de Al-Ándalus',
      'B2. La unidad católica de la monarquía y la situación de las minorías religiosas durante el reinado de los RRCC']);
  igual('…y en orden: A antes que B, y B10 después de B3',
    [r.temas[0].slice(0, 2), r.temas[3].slice(0, 2), r.temas[6].slice(0, 3), r.temas[7].slice(0, 2)], ['A1', 'B1', 'B10', 'C1']);
}

igual('lista numerada sin apartados explícitos: si la numeración reinicia, se separan en A, B',
  T.temasDeTexto('1. Uno primero\n2. Dos primero\n3. Tres primero\n1. Uno segundo\n2. Dos segundo').temas,
  ['A1. Uno primero', 'A2. Dos primero', 'A3. Tres primero', 'B1. Uno segundo', 'B2. Dos segundo']);

igual('una lista numerada normal queda como "1. título"',
  T.temasDeTexto('Contenidos\n1. La empresa y su entorno\n2. El mercado y la demanda\n3. La producción y los costes\n1.1 Tipos de costes').temas,
  ['1. La empresa y su entorno', '2. El mercado y la demanda', '3. La producción y los costes']);

igual('con menos de 3 entradas numeradas no se fía (podría ser una enumeración dentro de un párrafo)',
  T.temasDeTexto('Pasos:\n1. Leer\n2. Subrayar').modo, 'ninguno');

/* ----------------------------- 3. arreglo de texto ------------------------- */
igual('reparaTexto arregla las consonantes sueltas del PDF y respeta las palabras de una letra',
  ['la s características', 'situació n', 'Al -Ándalus', 'el proceso y s us', 'siglo XIX y s. XX', 'a b c'].map(T.reparaTexto),
  ['las características', 'situación', 'Al-Ándalus', 'el proceso y s us', 'siglo XIX y s. XX', 'a b c']);

/* -------------------- 4. propuesta desde TÍTULOS de apuntes ---------------- */
igual('de los títulos de apuntes sale un tema por número ("TEMA2…" sin espacios, "TEMA_3_…", repetidos)',
  T.temasDeTitulos(['TEMA2ELPENSAMIENTODEPLATON', 'TEMA 1 EL NACIMIENTO DE LA FILOSOFÍA', 'TEMA_3_ARISTO_TELES_Y_EL_HELENISMO',
    'Tema 1', 'ESQUEMA_SÓCRATES', 'CORECCIÓN COMENTARIO', 'BLOQUE 1. 1.1. Referentes 1-2']),
  ['Bloque 1. 1.1. Referentes 1-2', 'Tema 1. El nacimiento de la filosofía', 'Tema 2', 'Tema 3. Aristo teles y el helenismo']
    .sort((a, b) => T.comparaOrden(a, b)));

/* ------------------------------- 5. la IA ---------------------------------- */
igual('la respuesta de la IA vuelve a pasar por el analizador (y NINGUNO es "no hay")',
  [T.temasDeRespuestaIA('Aquí tienes:\nTema 2. Platón\nTema 1. Presocráticos\nTema 3. Aristóteles'), T.temasDeRespuestaIA('NINGUNO')],
  [['Tema 1. Presocráticos', 'Tema 2. Platón', 'Tema 3. Aristóteles'], []]);
igual('…y si el modelo ignora el formato, se aprovechan sus líneas sueltas',
  T.temasDeRespuestaIA('- La Prehistoria\n- Los pueblos prerromanos\n- La romanización').length, 3);

/* ----------------------- 6. ordenar y unir listas -------------------------- */
igual('unirNombres: sin repetidos (ni mayúsculas ni tildes), sin lo que ya existe, ordenado',
  T.unirNombres([['Tema 3. Café', 'tema 3. cafe', '', 'Sintaxis'], ['Tema 1. A', 'Tema 2. B']], ['Tema 2. B']),
  ['Tema 1. A', 'Tema 3. Café', 'Sintaxis']);

/* ------------------- 7. con datos: orden y apuntes por tema ---------------- */
{
  almacen.clear();
  guardar('temas', []);
  crearTemas('fil', ['Tema 10. Kant', 'Tema 2. Platón', 'Tema 1. Presocráticos', 'Introducción']);
  igual('los temas se muestran SIEMPRE en orden natural, aunque se crearan al revés',
    temasDe('fil').map(t => t.nombre), ['Tema 1. Presocráticos', 'Tema 2. Platón', 'Tema 10. Kant', 'Introducción']);

  const ids = Object.fromEntries(temasDe('fil').map(t => [t.nombre.slice(0, 7), t.id]));
  guardar('apuntesMeta', [
    { id: 'a1', asignaturaId: 'fil', titulo: 'TEMA 1 EL NACIMIENTO DE LA FILOSOFÍA', tipo: 'pdf' },
    { id: 'a2', asignaturaId: 'fil', titulo: 'TEMA2ELPENSAMIENTODEPLATON', tipo: 'pdf' },
    { id: 'a3', asignaturaId: 'fil', titulo: 'TEMA_10_KANT', tipo: 'pdf' },
    { id: 'a4', asignaturaId: 'fil', titulo: 'ESQUEMA_SÓCRATES', tipo: 'pdf' },
    { id: 'a5', asignaturaId: 'fil', titulo: 'TEMA 1 repaso', tipo: 'pdf', temaId: 'otro' },
    { id: 'a6', asignaturaId: 'lit', titulo: 'TEMA 1 Realismo', tipo: 'pdf' },
    { id: 'a7', asignaturaId: 'fil', titulo: 'TEMA 7 Hume', tipo: 'pdf' },
  ]);
  enlazarApuntes('fil', { soloContar: true }) === 3 ? bien('soloContar dice cuántos se colgarían sin tocar nada') : mal('soloContar');
  const n = enlazarApuntes('fil');
  const por = Object.fromEntries(leer('apuntesMeta', []).map(a => [a.id, a.temaId || null]));
  n === 3 && por.a1 === ids['Tema 1.'] && por.a2 === ids['Tema 2.'] && por.a3 === ids['Tema 10']
    ? bien('los apuntes se cuelgan del tema por su número ("TEMA2…", "TEMA_10_…")') : mal(`enlaces: ${JSON.stringify(por)}`);
  por.a4 === null && por.a5 === 'otro' && por.a6 === null && por.a7 === null
    ? bien('no toca: lo que no dice número, lo ya colgado, otra asignatura, ni un número que no está en el temario')
    : mal(`no debía tocar: ${JSON.stringify(por)}`);

  // Con apartados (A1, B1…) el número solo es ambiguo: no se cuelga nada.
  almacen.clear();
  crearTemas('his', ['A1. Romanización', 'B1. Reyes Católicos', 'A2. Visigodos']);
  guardar('apuntesMeta', [{ id: 'h1', asignaturaId: 'his', titulo: 'TEMA 1 ROMANIZACIÓN' }]);
  enlazarApuntes('his') === 0 ? bien('con apartados (A1, B1) el número solo no basta: no se adivina') : mal('enlazó con apartados ambiguos');
}

/* ----------------------------- 8. Word (.docx) ----------------------------- */
{
  // Un .docx mínimo: un zip con word/document.xml (deflate), construido a mano.
  const xml = '<?xml version="1.0"?><w:document><w:body>' +
    '<w:p><w:r><w:t>Temario de Economía</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Tema 1. La empresa &amp; su entorno</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>5</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Tema 2. El mercado</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Tema 3. Los costes</w:t></w:r></w:p></w:body></w:document>';
  const nombre = Buffer.from('word/document.xml');
  const datos = deflateRawSync(Buffer.from(xml));
  const cab = Buffer.alloc(30); cab.writeUInt32LE(0x04034b50, 0); cab.writeUInt16LE(8, 8); cab.writeUInt32LE(datos.length, 18); cab.writeUInt32LE(xml.length, 22); cab.writeUInt16LE(nombre.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(datos.length, 20); cd.writeUInt32LE(xml.length, 24); cd.writeUInt16LE(nombre.length, 28); cd.writeUInt32LE(0, 42);
  const local = Buffer.concat([cab, nombre, datos]);
  const fin = Buffer.alloc(22); fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(1, 8); fin.writeUInt16LE(1, 10);
  fin.writeUInt32LE(46 + nombre.length, 12); fin.writeUInt32LE(local.length, 16);
  const docx = Buffer.concat([local, cd, nombre, fin]);
  const texto = await T.docxATexto(docx.buffer.slice(docx.byteOffset, docx.byteOffset + docx.byteLength));
  igual('un .docx se lee en el navegador (zip + deflate), con entidades y tabuladores',
    T.temasDeTexto(texto).temas, ['Tema 1. La empresa & su entorno', 'Tema 2. El mercado', 'Tema 3. Los costes']);
  let lanza = false;
  try { await T.docxATexto(new TextEncoder().encode('esto no es un zip').buffer); } catch { lanza = true; }
  lanza ? bien('algo que no es un docx da un error claro, no un temario vacío') : mal('un no-docx no lanzó');
}

/* --------------------------- 9. tipos de archivo --------------------------- */
igual('tipo de archivo por extensión o MIME',
  [['a.PDF', ''], ['b.docx', ''], ['c.jpg', 'image/jpeg'], ['d.heic', ''], ['e.txt', 'text/plain'], ['f.xls', ''], ['g', 'application/pdf']]
    .map(([name, type]) => tipoDeArchivo({ name, type })),
  ['pdf', 'docx', 'foto', 'foto', 'texto', null, 'pdf']);

/* ---------------------- 10. el servidor, con IA simulada ------------------- */
{
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  const llamadas = [];
  const envPdf = { IA: { toMarkdown: async d => { llamadas.push('md:' + d.name); return [{ data: '# x\n## Contents\nTema 1. Matrices\nTema 2. Determinantes' }]; } } };
  const r1 = await leerArchivo(envPdf, bytes, 'application/pdf', 'guia.pdf');
  r1.texto?.includes('Tema 2') && r1.via === 'pdf' && llamadas.join() === 'md:guia.pdf' ? bien('PDF: lo lee toMarkdown') : mal(`PDF: ${JSON.stringify(r1)}`);

  const escaneado = await leerArchivo({ IA: { toMarkdown: async () => [{ data: '' }] } }, bytes, 'application/pdf', 'e.pdf');
  escaneado.motivo === 'vacio' && escaneado.status === 422 && /escaneado/.test(escaneado.error)
    ? bien('un PDF escaneado (sin texto) se dice con claridad, no se devuelve vacío como si nada') : mal(`escaneado: ${JSON.stringify(escaneado)}`);

  let modelos = [];
  const envFoto = { IA: {
    run: async (m, p) => { modelos.push(m); if (m.includes('scout')) throw new Error('modelo retirado'); return { response: 'Tema 1. Platón\nTema 2. Aristóteles\nTema 3. Descartes' }; },
    toMarkdown: async () => [{ data: 'Una foto de una lista' }],
  } };
  const r2 = await leerArchivo(envFoto, bytes, 'image/jpeg', 'foto.jpg');
  r2.via === 'vision' && r2.texto.includes('Aristóteles') && modelos.length === 2
    ? bien('foto: transcribe con visión y, si un modelo falla, pasa al siguiente') : mal(`foto: ${JSON.stringify(r2)} ${modelos}`);

  const sinVision = await leerArchivo({ IA: { run: async () => { throw new Error('x'); }, toMarkdown: async () => [{ data: 'Una hoja con la lista: Tema 1 Platón, Tema 2 Kant' }] } }, bytes, 'image/png', 'f.png');
  sinVision.via === 'descripcion' ? bien('foto: si ningún modelo de visión contesta, se cae a toMarkdown en vez de fallar') : mal(`sin visión: ${JSON.stringify(sinVision)}`);

  const raro = await leerArchivo(envPdf, bytes, 'application/zip', 'x.zip');
  const sinIa = await leerArchivo({}, bytes, 'application/pdf', 'x.pdf');
  raro.status === 415 && sinIa.status === 503 ? bien('formato raro → 415; sin IA enlazada → 503') : mal(`errores: ${raro.status} ${sinIa.status}`);
}

console.log(fallos ? `\n${fallos} fallo(s)` : '\ntodo bien');
process.exit(fallos ? 1 : 0);
