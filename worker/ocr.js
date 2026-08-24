/* ===========================================================================
   OCR DE APUNTES — cuando sube una foto o un PDF, se intenta sacar el texto
   con Workers AI (env.IA.toMarkdown) para que el motor de estudio (flashcards
   y tests, ver estudiar.js) pueda leerlo. Antes de esto, una foto de apuntes
   era un archivo opaco: se guardaba, se veía en la app, pero la IA nunca la
   leía — la forma más natural de tomar apuntes en clase (una foto rápida)
   era justo la que el motor de estudio ignoraba, mientras que escribir el
   apunte a mano sí funcionaba.

   Se guarda en el MISMO campo `texto` que ya usan los apuntes escritos
   (apuntesMeta): así estudiar.js no necesita saber si el texto vino de
   teclearlo o de una foto, y no hace falta tocar el resto del motor.

   Nunca bloquea la subida: si Workers AI falla, tarda o no está enlazado,
   el apunte se guarda igual, solo sin texto — igual criterio que el resto
   de la IA en esta app (ver ia.js: "nunca se finge una respuesta de IA").
   =========================================================================== */

// Un tope generoso para una página de apuntes, pero sin dejar que un PDF de
// cien páginas se cuele entero en el buzón de sync (que tiene su propio
// límite de tamaño de texto, ver sync.js demasiadoGrande).
const MAX_TEXTO_OCR = 4000;

export async function extraerTexto(env, bytes, mime, nombre) {
  if (!env.IA) return null;
  try {
    const salida = await env.IA.toMarkdown(
      { name: nombre, blob: new Blob([bytes], { type: mime }) },
      { conversionOptions: { image: { descriptionLanguage: 'es' } } },
    );
    // La documentación de Cloudflare da a veces un objeto suelto y a veces
    // una lista de un elemento según la forma de la llamada — se aceptan
    // las dos en vez de asumir una.
    const doc = Array.isArray(salida) ? salida[0] : salida;
    const texto = String(doc?.data ?? '').trim();
    return texto ? texto.slice(0, MAX_TEXTO_OCR) : null;
  } catch {
    return null;
  }
}
