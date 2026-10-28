/* ===========================================================================
   TEMARIO — sacar los temas de un archivo y dejarlos ordenados.

   Todo lo de este archivo es PURO (sin red, sin almacenamiento, sin DOM), para
   poder probarlo con textos reales en tools/prueba-temario.mjs: aquí es donde
   un fallo no se ve — un tema que falta o sale con otro número — y se cree.

   De dónde sale el texto: PDF y fotos los lee el servidor (worker/temario.js),
   Word se abre aquí mismo (docxATexto) y el texto plano entra tal cual. Lo que
   llega NO es limpio: un PDF trae entradas partidas en dos líneas, etiquetas
   al final ("CORTA", "LARGA"), puntos de relleno y número de página de un
   índice, palabras cortadas ("e volución") y la numeración reiniciada por
   apartados (A, B, C…). Por eso el analizador va por capas:

     1. "Tema 3", "Bloque 2", "Unidad 4"…      → lo más fiable
     2. lista numerada "1. …", con apartados    → los guiones de PAU, índices
     3. (fuera de aquí) la IA, solo si lo anterior no saca nada claro

   Y nunca se guarda nada sin que él lo vea antes: el resultado es una
   propuesta que se revisa en una hoja.
   =========================================================================== */

export const norma = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ').replace(/\s+/g, ' ').trim();

const ROMANOS = { I: 1, V: 5, X: 10, L: 50 };
const deRomano = s => {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const v = ROMANOS[s[i]], sig = ROMANOS[s[i + 1]] || 0;
    if (!v) return NaN;
    n += v < sig ? -v : v;
  }
  return n;
};

const PALABRAS = 'tema|bloque|unidad|ud|lecci[oó]n|cap[ií]tulo|m[oó]dulo';
const NOMBRE_PALABRA = { tema: 'Tema', bloque: 'Bloque', unidad: 'Unidad', ud: 'Unidad', leccion: 'Lección', capitulo: 'Capítulo', modulo: 'Módulo' };
const nombreDePalabra = p => NOMBRE_PALABRA[norma(p)] || 'Tema';

/* Línea que ES una entrada "Tema 3 …" (la palabra manda al principio de línea).
   El número va con \b para no pillar "Tema 2ELPENSAMIENTO" de un nombre de
   archivo; eso se arregla antes, en limpiaTitulo (core de la vista). */
const RE_ENTRADA = new RegExp(`^\\s*(?:[#>*•·\\-]+\\s*)*(${PALABRAS})\\s*(?:n[º°.]?\\s*)?(\\d{1,2}|[IVXL]{1,5})\\b\\s*[.:\\-–—·)]*\\s*(.*)$`, 'i');
/* Apartado/parte que reinicia la numeración: "TEMARIO APARTADO A. …". */
const RE_APARTADO = /^\s*(?:[#>*•·-]+\s*)?(?:temario\s+)?(?:apartado|parte|secci[oó]n|bloque)\s+([A-Z]|\d{1,2}|[IVX]{1,4})\b\s*[.:\-–—·)]*\s*(.*)$/i;
/* Lista numerada: "1. Algo" / "12) Algo". No "1.1" (eso es un subapartado). */
const RE_NUMERADA = /^\s*(?:[#>*•·-]+\s*)?(\d{1,2})\s*[.)]\s+(?=[A-Za-zÁÉÍÓÚÜÑ¿¡"“(])(\S.*)$/;
const RE_ETIQUETA = /\s+(CORTA|LARGA|PR[ÁA]CTICA|TE[ÓO]RICA|TEORÍA|TEORIA)\s*$/;
const SOLO_ETIQUETA = /^\s*(CORTA|LARGA|PR[ÁA]CTICA|TE[ÓO]RICA|TEORÍA|TEORIA)\s*$/;
const RUIDO = [
  /^#{1,6}\s*(page\s*\d+|metadata|contents)\s*$/i,
  /^\s*[-*]?\s*[A-Za-z]+(?:[A-Za-z]*)=\S*\s*$/,           // metadatos del PDF: "- PDFFormatVersion=1.4"
  /^\s*[-–—=_*·.\s]{3,}$/,                                  // rayas
  /^\s*\d+\s*\/\s*\d+\s*$/,                                 // "1 / 52"
];

/** Arregla lo que el PDF rompe al extraer el texto, SOLO lo que se puede
    arreglar sin diccionario: una consonante suelta pegada a la palabra de
    antes ("la s características", "situació n") y un guion con espacio
    ("Al -Ándalus"). Una vocal suelta puede ser una palabra ("o", "y", "a",
    "e"), así que esas no se tocan; "e volución" se queda para que lo corrija él. */
export function reparaTexto(t) {
  return String(t || '')
    .replace(/(\p{L}{2,}) (?<![.])([b-df-hj-np-tv-xzñ])(?![\p{L}.])/gu, '$1$2')
    .replace(/(\p{L}) -(\p{L})/gu, '$1-$2');
}

/** Título legible: sin viñetas de markdown, sin relleno de índice, sin
    número de página ni etiquetas finales; primera letra en mayúscula. */
export function limpiaNombre(t) {
  let x = reparaTexto(String(t || ''))
    .replace(/[*_`|]+/g, ' ')
    .replace(/\s*[.·…]{2,}\s*\d{1,3}\s*$/, '')          // "Tema 3 ........ 45"
    .replace(/(?:\s{3,}|\t+)\d{1,3}\s*$/, '')            // "Tema 3 La Edad Media     45" / tabulador
    .replace(RE_ETIQUETA, '')
    .replace(/\s+/g, ' ')
    .replace(/[\s.,;:–—-]+$/, '')
    .trim();
  if (x && x === x.toUpperCase() && /[A-ZÁÉÍÓÚÑ]{3}/.test(x)) x = x.charAt(0) + x.slice(1).toLowerCase();
  return x.charAt(0).toUpperCase() + x.slice(1);
}

/* ------------------------------ unidad y orden ---------------------------- */

/** Qué unidad es un título: {sec, num, sub, kind}, o null. "Tema 3. X" → num 3;
    "A1. X" → sec A, num 1; "1. X" → num 1; "Bloque 1. 1.2. X" → num 1, sub 2. */
export function unidadDe(nombre) {
  const s = String(nombre || '').trim();
  let m = /^([A-Z])\s?(\d{1,2})\b\s*[.:\-–—)]?(?!\d)/.exec(s);
  if (m) return { sec: m[1], num: +m[2], sub: null, kind: 'sec' };
  m = RE_ENTRADA.exec(s);
  if (m) {
    const num = /^\d+$/.test(m[2]) ? +m[2] : (/^[IVXL]+$/.test(m[2]) ? deRomano(m[2]) : NaN);
    if (Number.isNaN(num)) return null;
    const sub = new RegExp(`^${num}\\.(\\d{1,2})\\b`).exec(m[3].trim());
    return { sec: '', num, sub: sub ? +sub[1] : null, kind: norma(m[1]) };
  }
  m = /^(\d{1,2})\s*[.)]\s+/.exec(s);
  if (m) return { sec: '', num: +m[1], sub: null, kind: 'num' };
  return null;
}

/** Clave para ordenar: [apartado, número, subapartado]. Sin número → al final,
    y entre ellos manda el orden en que estaban. */
export function claveOrden(nombre) {
  const u = unidadDe(nombre);
  if (!u) return [1, 0, 0];
  return [0, (u.sec ? u.sec.charCodeAt(0) - 64 : 0) * 1000 + u.num, u.sub ?? 0];
}

export function comparaOrden(a, b) {
  const x = claveOrden(a), y = claveOrden(b);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

/** Ordena nombres (estable: los que empatan conservan su orden). */
export const ordenarNombres = nombres => nombres.map((n, i) => [n, i])
  .sort((a, b) => comparaOrden(a[0], b[0]) || a[1] - b[1]).map(([n]) => n);

/** Junta listas de nombres: sin vacíos, sin repetidos (ni por texto ni porque
    sean la misma unidad — se queda el título más largo, que suele ser el
    completo) y ordenados. `excluir` = nombres que ya existen. */
export function unirNombres(listas, excluir = []) {
  const porUnidad = new Map();
  const vistos = new Set(excluir.map(norma));
  const sueltos = [];
  for (const n of listas.flat()) {
    const nombre = String(n || '').trim();
    if (!nombre || vistos.has(norma(nombre))) continue;
    const u = unidadDe(nombre);
    if (!u) { vistos.add(norma(nombre)); sueltos.push(nombre); continue; }
    const k = `${u.sec}${u.num}.${u.sub ?? ''}`;
    const previo = porUnidad.get(k);
    if (!previo || nombre.length > previo.length) porUnidad.set(k, nombre);
  }
  const ya = new Set(excluir.map(e => { const u = unidadDe(e); return u ? `${u.sec}${u.num}.${u.sub ?? ''}` : null; }).filter(Boolean));
  const numerados = [...porUnidad.entries()].filter(([k]) => !ya.has(k)).map(([, v]) => v);
  return ordenarNombres([...numerados, ...sueltos]);
}

/* ------------------------------ el analizador ----------------------------- */

/** Deshace lo que la extracción de un PDF pega. Con la guía de PAU real, el
    servidor devuelve (comprobado en producción, no inventado):

        …el despotismo ilustrado. CORTATEMARIO APARTADO C. LA HISTORIA DESDE 1788 D.C. HASTA 1902.1. La Guerra…

    es decir: la etiqueta del último punto, la cabecera del apartado y el
    primer punto del siguiente, todo en una línea y sin espacios. Cada regla
    parte de un patrón muy concreto (mayúsculas de cabecera, etiqueta, año
    seguido de "1.") para no romper un texto normal. */
export function desglosa(texto) {
  return String(texto || '').replace(/\r/g, '')
    // el bloque de metadatos del PDF ("## Metadata" … hasta el siguiente título)
    .replace(/^#{1,6}\s*metadata\s*$[\s\S]*?(?=^#{1,6}\s)/gim, '')
    // "…CORTATEMARIO", "…PRÁCTICAT…": la etiqueta pegada a lo que viene en mayúsculas
    .replace(/(CORTA|LARGA|PR[ÁA]CTICA|TE[ÓO]RICA)(?=[A-ZÁÉÍÓÚÑ]{3,})/g, '$1\n')
    // cabecera de apartado pegada a lo de antes
    .replace(/(?<=\S)(?=TEMARIO\s+APARTADO\b)/g, '\n')
    .replace(/(?<=[.)])(?=APARTADO\s+[A-Z]\b)/g, '\n')
    // primer punto pegado a la cabecera: "…D.C.1. La…", "…ACTUALIDAD.1. Los…", "…1902.1. La…"
    .replace(/(?<=[A-Za-zÁ-ú][.:;»”"]|\b\d{4}\.)(?=\d{1,2}\.\s+[A-ZÁÉÍÓÚÑ¿¡“"(])/g, '\n')
    // punto nuevo en la misma línea que la etiqueta del anterior
    .replace(/(?<=\b(?:CORTA|LARGA|PR[ÁA]CTICA))[ \t]+(?=\d{1,2}\.\s+[A-ZÁÉÍÓÚÑ¿¡“"(])/g, '\n');
}

const lineasDe = texto => desglosa(texto).split('\n')
  .filter(l => !RUIDO.some(re => re.test(l)));

/** Si el título de una entrada no es legible ("TEMA2ELPENSAMIENTODEPLATON"). */
const ilegible = rest => rest && !/\s/.test(rest) && rest.length > 18;

/** Del texto de un temario a los temas que contiene, ya ordenados.
    Devuelve { temas: string[], modo }; modo = 'palabra' | 'lista' | 'ninguno'. */
export function temasDeTexto(texto) {
  const lineas = lineasDe(texto);

  // ---- Capa 1: "Tema N", "Bloque N", "Unidad N"… -------------------------
  const entradas = [];
  for (let i = 0; i < lineas.length; i++) {
    const m = RE_ENTRADA.exec(lineas[i]);
    if (!m) continue;
    const num = /^\d+$/.test(m[2]) ? +m[2] : deRomano(m[2].toUpperCase());
    if (Number.isNaN(num) || num > 60) continue;
    if (/^[IVXL]+$/i.test(m[2]) && !/^[IVXL]+$/.test(m[2])) continue;   // "Tema i" no es un romano
    let resto = m[3].trim();
    // El título a veces está en la línea siguiente ("BLOQUE 1 · VOCABULARIO" / "Tipologías").
    if (resto.length < 4) {
      const sig = (lineas[i + 1] || '').trim();
      if (sig && sig.length < 90 && !RE_ENTRADA.test(sig) && !SOLO_ETIQUETA.test(sig)) resto = sig;
    }
    if (ilegible(resto)) resto = '';
    const titulo = limpiaNombre(resto);
    entradas.push({ num, palabra: nombreDePalabra(m[1]), titulo, linea: i });
  }
  // Una "entrada" suelta suele ser una frase que empieza por "Unidad…"; hacen
  // falta al menos dos números distintos para fiarse de este modo.
  if (new Set(entradas.map(e => e.num)).size >= 2) {
    const nombres = entradas.map(e => (e.titulo ? `${e.palabra} ${e.num}. ${e.titulo}` : `${e.palabra} ${e.num}`));
    return { temas: unirNombres([nombres]), modo: 'palabra' };
  }

  // ---- Capa 2: lista numerada, con apartados que reinician la cuenta -------
  const items = [];
  let seccion = '', maxPrevio = 0, nSecciones = 0, hayApartado = false;
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    const ap = RE_APARTADO.exec(linea);
    if (ap && !RE_NUMERADA.test(linea)) { seccion = ap[1].toUpperCase(); hayApartado = true; maxPrevio = 0; continue; }
    const m = RE_NUMERADA.exec(linea);
    if (!m) continue;
    const num = +m[1];
    if (!hayApartado && num === 1 && maxPrevio > 1) { nSecciones++; seccion = String.fromCharCode(65 + nSecciones); }
    maxPrevio = Math.max(maxPrevio, num);
    // El título puede seguir en las líneas de abajo (hasta 2) si no acaba en punto.
    let texto = m[2].replace(RE_ETIQUETA, '').trim();
    for (let j = 1; j <= 2 && !/[.?!;:)]$/.test(texto) && i + j < lineas.length; j++) {
      const s = lineas[i + j].trim();
      if (!s || SOLO_ETIQUETA.test(s) || /^\d{1,2}[.)]/.test(s) || RE_APARTADO.test(s) || RE_ENTRADA.test(s) || texto.length + s.length > 170) break;
      texto = `${texto} ${s.replace(RE_ETIQUETA, '')}`.trim();
    }
    items.push({ sec: seccion, num, titulo: limpiaNombre(texto) });
  }
  if (items.length >= 3) {
    const hayVarias = new Set(items.map(x => x.sec)).size > 1;
    const nombres = items.map(x => (hayVarias || x.sec) ? `${x.sec || 'A'}${x.num}. ${x.titulo}` : `${x.num}. ${x.titulo}`);
    return { temas: unirNombres([nombres]), modo: 'lista' };
  }
  return { temas: [], modo: 'ninguno' };
}

/** Lo que devuelve la IA ("Tema 1. X" / "- X" / "1) X") a una lista de temas. */
export function temasDeRespuestaIA(texto) {
  const r = temasDeTexto(texto);
  if (r.temas.length) return r.temas;
  if (/^\s*ninguno\s*$/i.test(String(texto || ''))) return [];
  const sueltas = String(texto || '').split('\n')
    .map(l => limpiaNombre(l.replace(/^\s*(?:[-*•·]+|\d{1,2}[.)])\s*/, '')))
    .filter(l => l.length >= 4 && l.length <= 120 && !/^(aquí|estos son|los temas|lista)/i.test(l));
  return unirNombres([sueltas.slice(0, 40)]);
}

/** Título de archivo → texto normal: "_" fuera, y el número se separa de lo que
    le pegue ("TEMA2ELPENSAMIENTO" → "TEMA 2 ELPENSAMIENTO"). */
const normalizaTitulo = t => String(t || '').replace(/_+/g, ' ')
  .replace(new RegExp(`^(\\s*(?:${PALABRAS}))\\s*(\\d+)(?=\\p{L})`, 'iu'), '$1 $2 ')
  .replace(new RegExp(`^(\\s*(?:${PALABRAS}))\\s*(\\d+)`, 'i'), '$1 $2').replace(/\s{2,}/g, ' ').trim();

/** Propuesta a partir de los TÍTULOS de unos apuntes ("TEMA_3_ARISTO_TELES",
    "TEMA2ELPENSAMIENTO…", "BLOQUE 1. 1.2. …"): uno por unidad. */
export function temasDeTitulos(titulos) {
  const arreglados = [];
  for (const t of titulos || []) {
    const x = normalizaTitulo(t);
    if (!RE_ENTRADA.test(x)) continue;
    const m = RE_ENTRADA.exec(x);
    let resto = ilegible(m[3].trim()) ? '' : m[3].trim();
    resto = limpiaNombre(resto);
    arreglados.push(resto ? `${nombreDePalabra(m[1])} ${/^\d+$/.test(m[2]) ? m[2] : deRomano(m[2].toUpperCase())}. ${resto}`
      : `${nombreDePalabra(m[1])} ${/^\d+$/.test(m[2]) ? m[2] : deRomano(m[2].toUpperCase())}`);
  }
  return unirNombres([arreglados]);
}

/* --------------------------- apuntes -> tema ------------------------------ */

/** Qué apunte cuelga de qué tema, por el número de unidad en su título
    ("TEMA_3_…" → tema 3). Solo si el número identifica UN tema sin ambigüedad:
    sin apartados repetidos ni dos temas con el mismo número. Devuelve
    [{apunteId, temaId}] — no toca nada, solo propone. */
export function enlacesDeApuntes(apuntes, temas) {
  const porNum = new Map(), ambiguos = new Set();
  for (const t of temas || []) {
    const u = unidadDe(t.nombre);
    if (!u || u.sec) continue;                       // con apartados (A1, B1…) el número solo no basta
    if (porNum.has(u.num) && porNum.get(u.num) !== t.id) ambiguos.add(u.num);
    porNum.set(u.num, t.id);
  }
  const salida = [];
  for (const a of apuntes || []) {
    if (a.temaId) continue;
    const m = RE_ENTRADA.exec(normalizaTitulo(a.titulo));
    if (!m || !/^\d+$/.test(m[2])) continue;
    const num = +m[2];
    if (ambiguos.has(num) || !porNum.has(num)) continue;
    salida.push({ apunteId: a.id, temaId: porNum.get(num) });
  }
  return salida;
}

/* ---------------------------------- Word ---------------------------------- */

const decodifica = new TextDecoder('utf-8');

async function inflar(datos) {
  const flujo = new Blob([datos]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(flujo).arrayBuffer());
}

/** Texto de un .docx (un zip con word/document.xml). Se lee aquí, en el
    navegador: no hace falta mandar un Word a ningún servidor ni que el
    servidor sepa leerlos. Lanza si no es un docx. */
export async function docxATexto(buffer) {
  const b = new Uint8Array(buffer), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('No parece un documento de Word');
  const entradas = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  for (let n = 0; n < entradas && dv.getUint32(p, true) === 0x02014b50; n++) {
    const metodo = dv.getUint16(p + 10, true), tam = dv.getUint32(p + 20, true);
    const lNombre = dv.getUint16(p + 28, true), lExtra = dv.getUint16(p + 30, true), lCom = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const nombre = decodifica.decode(b.subarray(p + 46, p + 46 + lNombre));
    p += 46 + lNombre + lExtra + lCom;
    if (nombre !== 'word/document.xml') continue;
    const inicio = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const crudo = b.subarray(inicio, inicio + tam);
    const xml = decodifica.decode(metodo === 0 ? crudo : await inflar(crudo));
    return xml
      .replace(/<w:tab\s*\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n').replace(/<\/w:tc>/g, '\t').replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, '&')
      .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  throw new Error('El documento de Word no tiene texto que leer');
}
