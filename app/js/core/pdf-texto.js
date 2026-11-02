/* ===========================================================================
   TEXTO DE UN PDF (cliente) — lo justo para leer apuntes y temarios.

   El servidor (Cloudflare toMarkdown) no saca NADA de algunos PDF con texto de
   verdad: pasó con los bloques de Historia de España (Word → ilovepdf: la
   app solo veía el nombre del archivo y ningún apartado). Este lector corre en
   el propio navegador y se usa cuando el servidor no devuelve texto.

   Cubre lo que producen Word, LibreOffice, Pages y las impresoras PDF: objetos
   normales y en flujos de objetos (PDF 1.5), flujos Flate, fuentes con ToUnicode
   (incluidas las de 2 bytes) y las sencillas en Windows-1252. NO cubre PDF
   escaneados (imágenes sin texto) ni cifrados: en ese caso devuelve ''.
   Sin dependencias ni compilación. Se prueba en tools/prueba-pdf-texto.mjs.
   =========================================================================== */

/* Latin-1 de verdad: un byte, un carácter (TextDecoder('latin1') es Windows-1252
   y cambiaría los bytes 0x80-0x9F). */
const latin1 = { decode(b) { let r = ''; for (let i = 0; i < b.length; i += 8192) r += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); return r; } };
const ES_ESPACIO = /[\s\0]/;

async function inflar(bytes) {
  const flujo = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(flujo).arrayBuffer());
}

/* --------------------------- diccionarios de PDF -------------------------- */

/** El valor de /Clave dentro de un texto de diccionario: un diccionario
    balanceado << >>, un array [ ], una referencia "5 0 R", un nombre o un número. */
export function valor(texto, clave) {
  const m = new RegExp(`/${clave}(?![A-Za-z0-9])\\s*`).exec(texto);
  if (!m) return null;
  let i = m.index + m[0].length;
  if (texto.startsWith('<<', i)) {
    let n = 0, j = i;
    for (; j < texto.length; j++) {
      if (texto.startsWith('<<', j)) { n++; j++; } else if (texto.startsWith('>>', j)) { n--; j++; if (!n) { j++; break; } }
    }
    return texto.slice(i, j);
  }
  if (texto[i] === '[') {
    let n = 0, j = i;
    for (; j < texto.length; j++) { if (texto[j] === '[') n++; else if (texto[j] === ']') { n--; if (!n) { j++; break; } } }
    return texto.slice(i, j);
  }
  const r = /^(\d+)\s+\d+\s+R/.exec(texto.slice(i));
  if (r) return r[0];
  const s = /^\/?[^\s/<>[\]]+/.exec(texto.slice(i));
  return s ? s[0] : null;
}
const refDe = v => { const m = v && /^(\d+)\s+\d+\s+R/.exec(v.trim()); return m ? +m[1] : null; };
const refsDe = v => [...String(v || '').matchAll(/(\d+)\s+\d+\s+R/g)].map(m => +m[1]);

/* ------------------------------- el archivo ------------------------------- */

/** { dic(n) → texto del diccionario, flujo(n) → Uint8Array descomprimido | null } */
export async function leerObjetos(bytes) {
  const s = latin1.decode(bytes);
  const objetos = new Map();                   // n -> { dic, ini, fin } (ini/fin del flujo, si lo hay)
  const re = /(?:^|[\r\n\s])(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(s))) {
    const n = +m[1];
    const cuerpoIni = m.index + m[0].length;
    const fin = s.indexOf('endobj', cuerpoIni);
    if (fin < 0) break;
    const cuerpo = s.slice(cuerpoIni, fin);
    const st = cuerpo.search(/stream\r?\n/);
    if (st >= 0) {
      const dic = cuerpo.slice(0, st);
      const ini = cuerpoIni + st + /stream\r?\n/.exec(cuerpo.slice(st))[0].length;
      const finFlujo = s.indexOf('endstream', ini);
      objetos.set(n, { dic, ini, fin: finFlujo < 0 ? fin : finFlujo });
    } else objetos.set(n, { dic: cuerpo });
    re.lastIndex = fin;
  }

  const flujo = async n => {
    const o = objetos.get(n);
    if (!o || o.ini == null) return null;
    let datos = bytes.subarray(o.ini, o.fin);
    const largo = /^\d+$/.test(valor(o.dic, 'Length') || '') ? +valor(o.dic, 'Length') : 0;
    if (largo && largo <= datos.length) datos = datos.subarray(0, largo);                       // sin los saltos de línea de antes de endstream
    else while (datos.length && (datos[datos.length - 1] === 10 || datos[datos.length - 1] === 13)) datos = datos.subarray(0, -1);
    const filtros = valor(o.dic, 'Filter') || '';
    if (/FlateDecode|\/Fl\b/.test(filtros)) { try { datos = await inflar(datos); } catch { return null; } }
    else if (filtros.trim()) return null;      // otros filtros (LZW, ASCII85…): no se leen
    return datos;
  };

  // Flujos de objetos (PDF 1.5): sus objetos viven comprimidos dentro de otro.
  for (const [n, o] of [...objetos]) {
    if (o.ini == null || !/\/Type\s*\/ObjStm/.test(o.dic)) continue;
    const datos = await flujo(n);
    if (!datos) continue;
    const t = latin1.decode(datos);
    const cuantos = +(valor(o.dic, 'N') || 0), primero = +(valor(o.dic, 'First') || 0);
    const cab = t.slice(0, primero).trim().split(/\s+/).map(Number);
    for (let i = 0; i < cuantos; i++) {
      const num = cab[i * 2], desde = primero + cab[i * 2 + 1];
      const hasta = i + 1 < cuantos ? primero + cab[(i + 1) * 2 + 1] : t.length;
      if (!objetos.has(num)) objetos.set(num, { dic: t.slice(desde, hasta) });
    }
  }
  return { dic: n => objetos.get(n)?.dic ?? null, flujo, objetos, cifrado: /\/Encrypt\b/.test(s.slice(-2000)) };
}

/* -------------------------------- fuentes --------------------------------- */

const hex = h => { const t = h.replace(/\s/g, ''); const o = []; for (let i = 0; i < t.length; i += 2) o.push(parseInt(t.slice(i, i + 2).padEnd(2, '0'), 16)); return o; };
const aCaracteres = bytes => { let r = ''; for (let i = 0; i + 1 < bytes.length; i += 2) r += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]); return r; };

/** CMap ToUnicode → { ancho: 1|2, mapa: Map<código, texto> }. */
export function leerCMap(texto) {
  const mapa = new Map();
  let ancho = 1;
  const cs = /begincodespacerange\s*<([0-9a-fA-F]+)>/.exec(texto);
  if (cs) ancho = Math.max(1, Math.round(cs[1].length / 2));
  const num = h => parseInt(h, 16);
  for (const b of texto.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const p of b[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) mapa.set(num(p[1]), aCaracteres(hex(p[2])));
  }
  for (const b of texto.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const p of b[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F]*>)/g)) {
      const lo = num(p[1]), hi = num(p[2]);
      if (p[3].startsWith('[')) {
        [...p[3].matchAll(/<([0-9a-fA-F]*)>/g)].forEach((d, i) => mapa.set(lo + i, aCaracteres(hex(d[1]))));
      } else {
        const base = hex(p[3].slice(1, -1));
        for (let c = lo; c <= hi && c - lo < 65536; c++) {
          const b2 = base.slice(); b2[b2.length - 1] += c - lo;
          mapa.set(c, aCaracteres(b2.length % 2 ? [0, ...b2] : b2));
        }
      }
    }
  }
  return { ancho, mapa };
}

const win1252 = new TextDecoder('windows-1252');

/** Decodifica los bytes de una cadena de texto según su fuente. */
function decodifica(bytes, fuente) {
  if (fuente?.cmap) {
    const { ancho, mapa } = fuente.cmap;
    let r = '';
    for (let i = 0; i < bytes.length; i += ancho) {
      let c = 0;
      for (let k = 0; k < ancho; k++) c = (c << 8) | (bytes[i + k] ?? 0);
      r += mapa.has(c) ? mapa.get(c) : (ancho === 1 ? win1252.decode(Uint8Array.of(c)) : '');
    }
    return r;
  }
  return win1252.decode(Uint8Array.from(bytes));
}

/* ------------------------ intérprete del contenido ------------------------ */

/** Trozos de un flujo de contenido: números, nombres, cadenas (bytes), arrays y operadores. */
function* tokens(s) {
  let i = 0;
  const n = s.length;
  const pila = [];                                   // arrays abiertos
  const emite = t => { if (pila.length) { pila[pila.length - 1].push(t); return null; } return t; };
  while (i < n) {
    const c = s[i];
    if (ES_ESPACIO.test(c)) { i++; continue; }
    if (c === '%') { while (i < n && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
    if (c === '[') { pila.push([]); i++; continue; }
    if (c === ']') { const a = pila.pop(); i++; const t = emite({ t: 'arr', v: a }); if (t) yield t; continue; }
    if (c === '(') {
      let prof = 1, j = i + 1; const b = [];
      while (j < n && prof) {
        let ch = s[j];
        if (ch === '\\') {
          const nx = s[j + 1];
          if (/[0-7]/.test(nx)) { let o = nx, k = j + 2; while (o.length < 3 && /[0-7]/.test(s[k])) o += s[k++]; b.push(parseInt(o, 8) & 255); j = k; continue; }
          const mapa = { n: 10, r: 13, t: 9, b: 8, f: 12 };
          if (nx === '\r' || nx === '\n') { j += nx === '\r' && s[j + 2] === '\n' ? 3 : 2; continue; }
          b.push(nx in mapa ? mapa[nx] : nx.charCodeAt(0)); j += 2; continue;
        }
        if (ch === '(') prof++;
        else if (ch === ')') { prof--; if (!prof) { j++; break; } }
        b.push(ch.charCodeAt(0) & 255); j++;
      }
      i = j; const t = emite({ t: 'str', v: b }); if (t) yield t; continue;
    }
    if (c === '<' && s[i + 1] === '<') { let n2 = 0, j = i; for (; j < n; j++) { if (s.startsWith('<<', j)) { n2++; j++; } else if (s.startsWith('>>', j)) { n2--; j++; if (!n2) { j++; break; } } } i = j; continue; }
    if (c === '<') { const j = s.indexOf('>', i); const t = emite({ t: 'str', v: hex(s.slice(i + 1, j)) }); i = j + 1; if (t) yield t; continue; }
    if (c === '/') { let j = i + 1; while (j < n && !/[\s/<>[\]()%]/.test(s[j])) j++; const t = emite({ t: 'nom', v: s.slice(i + 1, j) }); i = j; if (t) yield t; continue; }
    let j = i; while (j < n && !/[\s/<>[\]()%]/.test(s[j])) j++;
    if (j === i) { i++; continue; }
    const w = s.slice(i, j); i = j;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) { const t = emite({ t: 'num', v: parseFloat(w) }); if (t) yield t; }
    else if (!pila.length) yield { t: 'op', v: w };
  }
}

/** Texto de un flujo de contenido. Word y compañía sueltan cada palabra como un
    trozo con su posición: se juntan los trozos que están a la misma altura (en
    el orden en que vienen) y cada cambio de altura es un salto de línea. */
export function textoDeContenido(s, fuentes) {
  let fuente = null, tam = 10;
  let x = 0, y = 0, lead = 0, escala = 1;
  const trozos = [];                                 // { y, tam, t }
  let args = [];
  const pon = t => { if (t) trozos.push({ y, tam: tam * escala, t }); };
  const dec = a => decodifica(a.v, fuente);
  for (const t of tokens(s)) {
    if (t.t !== 'op') { args.push(t); continue; }
    const op = t.v;
    const nums = args.filter(a => a.t === 'num').map(a => a.v);
    if (op === 'BT') { x = 0; y = 0; escala = 1; }
    else if (op === 'Tf') { const nom = args.find(a => a.t === 'nom'); if (nom) fuente = fuentes.get(nom.v) || null; if (nums.length) tam = Math.abs(nums[nums.length - 1]) || tam; }
    else if (op === 'Td' || op === 'TD') { if (op === 'TD') lead = -(nums[1] || 0); x += nums[0] || 0; y += nums[1] || 0; }
    else if (op === 'Tm') { if (nums.length === 6) { x = nums[4]; y = nums[5]; escala = Math.abs(nums[3]) || 1; } }
    else if (op === 'T*') y -= lead;
    else if (op === 'TL') lead = nums[0] || 0;
    else if (op === 'Tj') { const a = args.find(q => q.t === 'str'); if (a) pon(dec(a)); }
    else if (op === "'" || op === '"') { y -= lead; const a = args.find(q => q.t === 'str'); if (a) pon(dec(a)); }
    else if (op === 'TJ') {
      const arr = args.find(q => q.t === 'arr');
      if (arr) {
        let r = '';
        for (const e of arr.v) {
          if (e.t === 'str') r += dec(e);
          else if (e.t === 'num' && e.v < -250 && !/\s$/.test(r)) r += ' ';   // un hueco grande es un espacio
        }
        pon(r);
      }
    }
    args = [];
  }
  let salida = '', ly = null;
  for (const z of trozos) {
    if (ly !== null && Math.abs(z.y - ly) > Math.max(1.5, z.tam * 0.4)) salida += '\n';
    salida += z.t;
    ly = z.y;
  }
  return salida;
}

/* --------------------------------- páginas -------------------------------- */

export async function fuentesDe(doc, recursos) {
  const mapa = new Map();
  let fuentesDic = valor(recursos || '', 'Font');
  if (!fuentesDic) return mapa;
  const r = refDe(fuentesDic);
  if (r != null) fuentesDic = doc.dic(r) || '';
  for (const m of fuentesDic.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
    const dic = doc.dic(+m[2]) || '';
    const tu = refDe(valor(dic, 'ToUnicode'));
    let cmap = null;
    if (tu != null) { const d = await doc.flujo(tu); if (d) cmap = leerCMap(latin1.decode(d)); }
    mapa.set(m[1], { cmap });
  }
  return mapa;
}

/** Las páginas, en orden, siguiendo el árbol /Pages desde el catálogo. */
export function paginasEnOrden(doc) {
  let raiz = null;
  for (const [n] of doc.objetos) { const d = doc.dic(n); if (d && /\/Type\s*\/Catalog/.test(d)) { raiz = refDe(valor(d, 'Pages')); break; } }
  const salida = [];
  const visita = (n, heredado, prof = 0) => {
    const d = doc.dic(n);
    if (!d || prof > 30) return;
    const recursos = valor(d, 'Resources') || heredado;
    if (/\/Type\s*\/Pages/.test(d) || (valor(d, 'Kids') && !/\/Type\s*\/Page\b/.test(d))) {
      for (const k of refsDe(valor(d, 'Kids'))) visita(k, recursos, prof + 1);
    } else salida.push({ n, d, recursos });
  };
  if (raiz != null) visita(raiz, null);
  if (!salida.length) for (const [n] of doc.objetos) { const d = doc.dic(n); if (d && /\/Type\s*\/Page\b/.test(d)) salida.push({ n, d, recursos: valor(d, 'Resources') }); }
  return salida;
}

/** Texto de un PDF, página a página, separadas por una línea en blanco.
    Devuelve '' si no hay texto que leer (escaneado, cifrado o raro). */
export async function pdfATexto(buffer) {
  try {
    const doc = await leerObjetos(new Uint8Array(buffer));
    if (doc.cifrado) return '';
    const paginas = [];
    for (const p of paginasEnOrden(doc)) {
      let recursos = p.recursos;
      const rr = refDe(recursos);
      if (rr != null) recursos = doc.dic(rr);
      const fuentes = await fuentesDe(doc, recursos);
      const cont = valor(p.d, 'Contents') || '';
      let s = '';
      for (const c of refsDe(cont)) { const d = await doc.flujo(c); if (d) s += latin1.decode(d) + '\n'; }
      paginas.push(textoDeContenido(s, fuentes).replace(/[ \t]+\n/g, '\n').trim());
    }
    return paginas.filter(Boolean).join('\n\n');
  } catch { return ''; }
}
