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
import { docxATexto, temasDeTexto, temasDeRespuestaIA } from './temario.js';

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
    enseñar tal cual si no se puede leer. */
export async function temasDeArchivo(archivo) {
  const tipo = tipoDeArchivo(archivo);
  if (!tipo) throw new Error('Formato no admitido: usa PDF, Word, foto o texto.');
  if (archivo.size > MAX_MB * 1024 * 1024) throw new Error(`Pesa más de ${MAX_MB} MB.`);

  let texto = '';
  if (tipo === 'docx') texto = await docxATexto(await archivo.arrayBuffer());
  else if (tipo === 'texto') texto = await archivo.text();
  else if (tipo === 'foto') {
    const reducida = await reducirFoto(archivo);
    texto = await leerRemoto(reducida, archivo.name, reducida.type || 'image/jpeg');
  } else texto = await leerRemoto(archivo, archivo.name, 'application/pdf');

  let { temas, modo } = temasDeTexto(texto);
  // Sin estructura clara y con texto de verdad: se le pregunta a la IA.
  if (temas.length < 3 && texto.trim().length > 200 && sesion.dentro()) {
    try {
      const r = await sesion.pedir('/api/temario/ia', { metodo: 'POST', datos: { texto }, silencioso: true });
      const deIa = temasDeRespuestaIA(r.texto);
      if (deIa.length > temas.length) { temas = deIa; modo = 'ia'; }
    } catch { /* la IA es el último recurso: si no contesta, se queda lo que haya */ }
  }
  return { temas, modo, texto };
}
