/* ===========================================================================
   PRUEBA DEL LECTOR DE PDF Y DEL ESQUEMA DE UN ARCHIVO-TEMA — sin red.

   El servidor no sacaba nada de PDF con texto de verdad (Word → impresora PDF) y
   la app se quedaba solo con el nombre del archivo: ningún apartado. Aquí se
   fabrican PDF pequeños como los de Word (flujo Flate, objetos en flujo de
   objetos, fuente con ToUnicode de 2 bytes, cada palabra en su trozo) y se
   comprueba que el texto sale entero, en orden y por líneas.

   Uso:  node tools/prueba-pdf-texto.mjs
   =========================================================================== */
import { deflateSync } from 'node:zlib';
import { pdfATexto, leerCMap, valor } from '../app/js/core/pdf-texto.js';
import { esquemaDeTexto, enFrase } from '../app/js/core/temario.js';

let fallos = 0;
const mal = m => { console.log('❌ ' + m); fallos++; };
const bien = m => console.log('✅ ' + m);
const igual = (que, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? bien(que) : mal(`${que} — salió ${JSON.stringify(a)}, tocaba ${JSON.stringify(b)}`));

/** Un PDF mínimo: `paginas` = contenidos de cada página; `conCMap` usa una fuente de 2 bytes con ToUnicode. */
function fabricaPdf(paginas, { conCMap = false, enObjStm = false } = {}) {
  const objs = [];                                    // [numero, cuerpo(string|Buffer)]
  const nuevo = (cuerpo) => { objs.push(cuerpo); return objs.length; };
  const fuenteNum = conCMap ? 3 : 3;
  const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap
1 begincodespacerange <0000> <FFFF> endcodespacerange
3 beginbfchar <0001> <0048> <0002> <0069> <0003> <00E1> endbfchar
1 beginbfrange <0010> <0012> <0041> endbfrange endcmap`;
  const flujo = (dic, datos) => Buffer.concat([Buffer.from(`<< ${dic} /Filter /FlateDecode /Length ${deflateSync(datos).length} >>\nstream\n`), deflateSync(datos), Buffer.from('\nendstream')]);
  // 1 catálogo, 2 árbol de páginas, 3 fuente, 4 ToUnicode, luego páginas y contenidos
  const n = paginas.length;
  const pagIds = paginas.map((_, i) => 5 + i * 2);
  objs[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[1] = `<< /Type /Pages /Kids [ ${pagIds.map(x => `${x} 0 R`).join(' ')} ] /Count ${n} >>`;
  objs[2] = conCMap ? '<< /Type /Font /Subtype /Type0 /BaseFont /X /ToUnicode 4 0 R >>' : '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objs[3] = flujo('', Buffer.from(cmap));
  paginas.forEach((c, i) => {
    objs[4 + i * 2] = `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 3 0 R >> >> /Contents ${6 + i * 2} 0 R >>`;
    objs[5 + i * 2] = flujo('', Buffer.from(c, 'latin1'));
  });
  void fuenteNum; void nuevo;
  const partes = [Buffer.from('%PDF-1.5\n')];
  const cuerpoObjs = [];
  if (enObjStm) {
    // Los objetos de diccionario (no flujos) van dentro de un ObjStm.
    const dentro = [];
    objs.forEach((o, i) => { if (typeof o === 'string') dentro.push([i + 1, o]); });
    let cab = '', cuerpo = '';
    for (const [num, o] of dentro) { cab += `${num} ${cuerpo.length} `; cuerpo += o + '\n'; }
    const datos = Buffer.from(cab + cuerpo, 'latin1');
    objs.forEach((o, i) => { if (typeof o !== 'string') partes.push(Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from('\nendobj\n')); });
    partes.push(Buffer.from(`${objs.length + 1} 0 obj\n`), flujo(`/Type /ObjStm /N ${dentro.length} /First ${cab.length}`, datos), Buffer.from('\nendobj\n'));
  } else {
    objs.forEach((o, i) => partes.push(Buffer.from(`${i + 1} 0 obj\n`), Buffer.isBuffer(o) ? o : Buffer.from(o), Buffer.from('\nendobj\n')));
  }
  void cuerpoObjs;
  partes.push(Buffer.from('trailer\n<< /Root 1 0 R >>\n%%EOF'));
  const b = Buffer.concat(partes);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
}

/* 1. Una fuente sencilla, cada palabra en su trozo (como Word) y dos líneas. */
{
  const c = `BT /F1 12 Tf 1 0 0 1 72 700 Tm (BLOQUE) Tj 1 0 0 1 120 700 Tm ( 1.) Tj ET
BT /F1 12 Tf 1 0 0 1 72 680 Tm [(Econom) 10 (\\355a) -300 (y sociedad)] TJ ET`;
  igual('texto por líneas, con acentos (Windows-1252) y los huecos grandes como espacio',
    await pdfATexto(fabricaPdf([c])), 'BLOQUE 1.\nEconomía y sociedad');
}
/* 2. Varias páginas, en orden. */
igual('las páginas salen en orden y separadas', await pdfATexto(fabricaPdf(['BT /F1 12 Tf 72 700 Td (Uno) Tj ET', 'BT /F1 12 Tf 72 700 Td (Dos) Tj ET'])), 'Uno\n\nDos');
/* 3. Fuente de 2 bytes con ToUnicode (lo normal en Word). */
igual('fuente de 2 bytes con ToUnicode', await pdfATexto(fabricaPdf(['BT /F1 12 Tf 72 700 Td <00010002> Tj <0010 0011> Tj ET'], { conCMap: true })), 'HiAB');
/* 4. PDF 1.5 con objetos dentro de un flujo de objetos. */
igual('objetos dentro de un flujo de objetos (PDF 1.5)', await pdfATexto(fabricaPdf(['BT /F1 12 Tf 72 700 Td (Hola) Tj ET'], { enObjStm: true })), 'Hola');
/* 5. Lo que no se puede leer devuelve '' sin romper. */
igual('un archivo que no es PDF devuelve vacío', await pdfATexto(new TextEncoder().encode('esto no es un pdf').buffer), '');
igual('un PDF sin texto (solo una imagen) devuelve vacío', await pdfATexto(fabricaPdf(['q 100 0 0 100 0 0 cm /Im1 Do Q'])), '');
/* 6. Piezas. */
igual('valor de una clave con diccionarios anidados', valor('<< /A 1 /Font << /F1 5 0 R /X << /y 2 >> >> /B 3 >>', 'Font'), '<< /F1 5 0 R /X << /y 2 >> >>');
const cm = leerCMap('1 begincodespacerange <00> <FF> endcodespacerange 1 beginbfchar <41> <0058> endbfchar 1 beginbfrange <61> <63> <0061> endbfrange');
igual('CMap: rango y caracteres', [...cm.mapa.entries()].sort((a, b) => a[0] - b[0]), [[65, 'X'], [97, 'a'], [98, 'b'], [99, 'c']]);

/* 7. El esquema de un archivo que ES un tema: secciones, apartados y listas. */
{
  const texto = `BLOQUE 1. LA EDAD MEDIA.
1.2. LA EDAD MEDIA: TRES CULTURAS.
1. AL-ANDALUS (S. VIII AL XIII).
1.1. LA CONQUISTA Y LAS CAUSAS DE LA INVASIÓN MUSULMANA.
Texto del apartado con una lista:
1.2. EVOLUCIÓN POLÍTICA. Referente 3.
1. El Emirato dependiente del Califato de Damasco (711-756).
2. El Emirato independiente del Califato de Bagdad (756-929).
1.3. ORGANIZACIÓN ECONÓMICA, POLÍTICA Y SOCIAL
2. LOS REINOS CRISTIANOS (S. VIII AL XV).
2.1. EL ORIGEN DE LOS PRIMEROS REINOS (SIGLOS VIII-XI).
1. EL REINO DE ASTURIAS Y EL REINO DE LEÓN.
2. LA RESISTENCIA CRISTIANA EN LOS PIRINEOS.
2.4. LOS MODELOS DE REPOBLACIÓN. Referente 5.
1. REPOBLACIÓN LIBRE O POR PRESURA: s. X.
2. REPOBLACIÓN CONCEJIL: s. XI.
3. REPOBLACIÓN MEDIANTE REPARTIMIENTOS: s. XIII.
2.6. ORIGEN Y CARACTERÍSTICAS DEL RÉGIMEN SEÑORIAL Y LA SOCIEDAD ESTAMENTAL EN EL
ÁMBITO CRISTIANO. Referente 6.
3. LA BAJA EDAD MEDIA.
3.1. ORGANIZACIÓN POLÍTICA.
711. Inicio de la invasión musulmana y derrota.`;
  const e = esquemaDeTexto(texto);
  igual('esquema: códigos y niveles', e.map(a => `${a.n}:${a.c}`),
    ['1:1', '2:1.1', '2:1.2', '3:1.2.1', '3:1.2.2', '2:1.3', '1:2', '2:2.1', '3:2.1.1', '3:2.1.2', '2:2.4', '3:2.4.1', '3:2.4.2', '3:2.4.3', '2:2.6', '1:3', '2:3.1']);
  igual('esquema: el encabezado del propio archivo no cuenta (1.2 antes de la sección 1)', e.some(a => a.t.startsWith('La Edad Media')), false);
  igual('esquema: "3. REPOBLACIÓN…" es de la lista del 2.4, no una sección nueva', e.filter(a => a.n === 1).map(a => a.c), ['1', '2', '3']);
  igual('esquema: un título que ocupa dos líneas se junta y se limpia',
    e.find(a => a.c === '2.6').t, 'Origen y Características del Régimen Señorial y la Sociedad Estamental en el Ámbito Cristiano');
  igual('esquema: los siglos en romanos y "Referente N" fuera', [e.find(a => a.c === '1').t, e.find(a => a.c === '1.2').t], ['Al-Andalus (s. VIII al XIII)', 'Evolución Política']);
  igual('esquema: un año con punto ("711. …") no es un punto de lista', e.some(a => a.t.startsWith('Inicio')), false);
}
igual('título en mayúsculas → con minúsculas y nombres propios', enFrase('LA CONQUISTA DE HISPANIA'), 'La Conquista de Hispania');
igual('un título que ya tiene minúsculas no se toca', enFrase('El Emirato dependiente'), 'El Emirato dependiente');

console.log(fallos ? `\n${fallos} fallo(s)` : '\ntodo bien');
process.exit(fallos ? 1 : 0);
