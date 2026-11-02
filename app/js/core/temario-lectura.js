/* ===========================================================================
   LEER UN ARCHIVO DE TEMARIO (cliente) — del archivo a la lista de temas.

   Según el archivo:
   · Word (.docx)      → se abre aquí mismo (temario.js: docxATexto)
   · texto (.txt, .md) → tal cual
   · foto              → se reduce y la lee el servidor con visión
   · PDF               → lo lee el servidor

   Luego, el analizador de temario.js. Solo si no saca una estructura clara se
   le pregunta a la IA (y lo que conteste vuelve a pasar por el analizador, que
   es el que lo deja limpio y ordenado). Nada se guarda aquí: devuelve una
   propuesta que se revisa en la hoja.
   =========================================================================== */

import * as sesion from './sesion.js';
import { reducirFoto } from './archivos.js';
import { docxATexto, temasDeTexto, temasDeRespuestaIA, temaDeNombreArchivo } from './temario.js';

const MAX_MB = 20;
const ext = nombre => (/\.([a-z0-9]+)$/i.exec(nombre || '')?.[1] || '').toLowerCase();

export function tipoDeArchivo(archivo) {
  const e = ext(archivo.name), t = archivo.type || '';
  if (e === 'docx') return 'docx';
  if (e === 'txt' || e === 'md' || /^text\//.test(t)) return 'texto';
  if (/^image\//.test(t) || ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif', 'bmp'].includes(e)) return 'foto';
  if (t === 'application/pdf' || e === 'pdf') return 'pdf';
  return null;
}

async function leerRemoto(blob, nombre, mime) {
  let r;
  try {
    r = await fetch('/api/temario/leer', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Meta': '1', 'Content-Type': mime, 'X-Meta-Nombre': encodeURIComponent(nombre) },
      body: blob,
    });
  } catch { throw new Error('Sin conexión: no se puede leer el archivo ahora.'); }
  let cuerpo = null;
  try { cuerpo = await r.json(); } catch { /* sin JSON */ }
  if (!r.ok) throw new Error(cuerpo?.error || `No se pudo leer el archivo (${r.status}).`);
  return cuerpo.texto || '';
}

/** { temas, modo, texto } de un archivo. Lanza Error con una frase para
    enseñar tal cual si no se puede leer.

    EL NOMBRE MANDA. Un temario suele llegar como un archivo por tema
    ("TEMA_1_REALISMO_Y_NATURALISMO_LIBRO.pdf"): el nombre ya dice cuál es. No se
    lee nada, así que da igual que pese 40 MB, que sea un escaneado sin texto o
    que sea un capítulo de libro sin índice (los tres casos que fallaban). Solo si
    el nombre trae el número pero no el título ("Tema 3.pdf") se intenta mejorar
    con lo que diga el contenido; y si el contenido no se puede leer, se queda el
    número en vez de dar error. */
export async function temasDeArchivo(archivo) {
  const tipo = tipoDeArchivo(archivo);
  if (!tipo) throw new Error('Formato no admitido: usa PDF, Word, foto o texto.');
  const delNombre = temaDeNombreArchivo(archivo.name);
  if (delNombre?.completo) return { temas: [delNombre.nombre], modo: 'nombre', texto: '' };

  const sinContenido = motivo => {
    if (delNombre) return { temas: [delNombre.nombre], modo: 'nombre', texto: '' };
    throw new Error(motivo);
  };
  if (archivo.size > MAX_MB * 1024 * 1024) return sinContenido(`Pesa más de ${MAX_MB} MB y su nombre no dice qué tema es. Ponle "Tema N …" al nombre o pega el índice.`);

  let texto = '';
  try {
    if (tipo === 'docx') texto = await docxATexto(await archivo.arrayBuffer());
    else if (tipo === 'texto') texto = await archivo.text();
    else if (tipo === 'foto') {
      const reducida = await reducirFoto(archivo);
      texto = await leerRemoto(reducida, archivo.name, reducida.type || 'image/jpeg');
    } else texto = await leerRemoto(archivo, archivo.name, 'application/pdf');
  } catch (e) {
    return sinContenido(e.message);
  }

  let { temas, modo } = temasDeTexto(texto);
  // El nombre dice "Tema 3" y el contenido trae su título: se queda el del contenido.
  if (delNombre && temas.length) {
    const num = /\d+/.exec(delNombre.nombre)?.[0];
    const mejor = temas.find(t => new RegExp(`^(?:[A-Za-z]+\\s+)?${num}\\.`).test(t) && t.length > delNombre.nombre.length);
    return { temas: [mejor || delNombre.nombre], modo: mejor ? modo : 'nombre', texto };
  }
  // Sin estructura clara y con texto de verdad: se le pregunta a la IA.
  if (temas.length < 3 && texto.trim().length > 200 && sesion.dentro() && !delNombre) {
    try {
      const r = await sesion.pedir('/api/temario/ia', { metodo: 'POST', datos: { texto }, silencioso: true });
      const deIa = temasDeRespuestaIA(r.texto);
      if (deIa.length > temas.length) { temas = deIa; modo = 'ia'; }
    } catch { /* la IA es el último recurso: si no contesta, se queda lo que haya */ }
  }
  if (!temas.length && delNombre) return { temas: [delNombre.nombre], modo: 'nombre', texto };
  return { temas, modo, texto };
}
