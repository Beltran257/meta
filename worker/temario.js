/* ===========================================================================
   LEER UN ARCHIVO DE TEMARIO — del PDF o la foto al texto, sin guardar nada.

   El analizador que saca los temas del texto está en la app
   (app/js/core/temario.js): aquí solo se LEE. Se separa porque es lo que
   necesita red y la IA de Cloudflare; lo otro es lógica pura que se prueba
   sin nada (tools/prueba-temario.mjs).

   Dos vías, según el archivo:
   · PDF → env.IA.toMarkdown, que extrae el texto del propio PDF.
   · Foto → un modelo de VISIÓN al que se le pide TRANSCRIBIR. toMarkdown de
     una imagen no transcribe: genera una descripción ("una hoja con una
     lista"), que no sirve para sacar temas. Si ningún modelo de visión
     contesta, se cae a toMarkdown igualmente (a veces la descripción cita el
     texto) en vez de fallar.

   Un PDF escaneado no tiene texto que extraer: sale vacío y se dice, para que
   suba mejor las fotos de las páginas del índice.

   Nada de lo leído se guarda aquí: se devuelve y ya. Lo que se quede lo
   decide la app (el temario, y si quiere el archivo como apunte).
   =========================================================================== */

// Un libro entero no cabe en la respuesta ni hace falta: el índice está al principio.
const MAX_TEXTO = 80000;

const VISION = [
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/google/gemma-3-12b-it',
];

const PIDE_TRANSCRIPCION =
  'Transcribe TODO el texto que se ve en esta imagen, tal cual está escrito y en el mismo orden, ' +
  'una línea por línea de la imagen. Si es una lista o un índice, respeta su numeración. ' +
  'No resumas, no expliques y no añadas nada.';

const textoDe = r => {
  const t = typeof r === 'string' ? r
    : r?.response ?? r?.choices?.[0]?.message?.content ?? r?.result?.response;
  return typeof t === 'string' ? t.trim() : '';
};

function base64(bytes) {
  const u8 = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

async function transcribirFoto(env, bytes, mime) {
  const url = `data:${mime};base64,${base64(bytes)}`;
  for (const modelo of VISION) {
    try {
      const r = await env.IA.run(modelo, {
        messages: [{ role: 'user', content: [
          { type: 'text', text: PIDE_TRANSCRIPCION },
          { type: 'image_url', image_url: { url } },
        ] }],
        max_tokens: 2000,
      });
      const t = textoDe(r);
      if (t.length > 20) return t;
    } catch { /* se prueba el siguiente */ }
  }
  return '';
}

async function aMarkdown(env, bytes, mime, nombre) {
  const salida = await env.IA.toMarkdown(
    { name: nombre, blob: new Blob([bytes], { type: mime }) },
    { conversionOptions: { image: { descriptionLanguage: 'es' } } },
  );
  const doc = Array.isArray(salida) ? salida[0] : salida;
  return String(doc?.data ?? '').trim();
}

/** { texto, via } o { error, motivo, status }. */
export async function leerArchivo(env, bytes, mime, nombre) {
  if (!env.IA) return { error: 'La lectura de archivos no está disponible ahora mismo.', motivo: 'sin-ia', status: 503 };
  const esFoto = /^image\//.test(mime);
  const esPdf = mime === 'application/pdf';
  if (!esFoto && !esPdf) return { error: 'Solo se pueden leer PDF y fotos aquí (Word y texto se leen en tu aparato).', motivo: 'formato', status: 415 };
  try {
    let texto = '', via = '';
    if (esFoto) {
      texto = await transcribirFoto(env, bytes, mime);
      via = 'vision';
      if (!texto) { texto = await aMarkdown(env, bytes, mime, nombre); via = 'descripcion'; }
    } else {
      texto = await aMarkdown(env, bytes, mime, nombre);
      via = 'pdf';
    }
    if (texto.length < 15) {
      return { error: esPdf
        ? 'Ese PDF no trae texto (será un escaneado). Prueba a subir fotos de las páginas del índice.'
        : 'No he conseguido leer texto en esa imagen. Prueba con una foto más nítida y de frente.',
        motivo: 'vacio', status: 422 };
    }
    return { texto: texto.slice(0, MAX_TEXTO), via };
  } catch {
    return { error: 'No se pudo leer el archivo ahora mismo. Inténtalo otra vez.', motivo: 'ia', status: 502 };
  }
}
