/* ===========================================================================
   ARCHIVOS (cliente) — empuja, borra y trae de vuelta el contenido real de un
   apunte de foto/PDF (ver worker/archivos.js). Todo esto es "además de", nunca
   "en vez de": la copia local en IndexedDB (apuntesdb.js) sigue siendo la que
   se usa primero y la que funciona sin conexión. Si algo de aquí falla —sin
   sesión, sin conexión, sesión caducada—, el apunte se queda exactamente como
   estaba: local, con su título sincronizado como siempre. Nunca es un error
   que deba interrumpir a quien está guardando un apunte.
   =========================================================================== */
import * as sesion from './sesion.js';

/* Una foto del iPhone pesa 3-5 MB y el espacio de archivos de la cuenta (KV,
   ver worker/archivos.js) ronda 1 GB: unas 330 fotos lo llenaban. Para leer
   unos apuntes o una pizarra sobran 2000 px en el lado largo, y en JPEG al
   85 % se quedan en unos cientos de KB. Se reduce antes de guardar, así que
   también ocupa menos en IndexedDB. Si algo falla —un HEIC que este
   navegador no sabe abrir, un lienzo sin memoria— se guarda la original:
   nunca se pierde una foto por esto. */
export const LADO_MAX = 2000;
const CALIDAD = 0.85;
// Por debajo de esto y sin pasarse de LADO_MAX no se recomprime: una captura
// de pantalla en PNG pierde nitidez en JPEG y no gana casi nada.
const PESO_SIN_TOCAR = 1024 * 1024;

export function medidaReducida(ancho, alto, max = LADO_MAX) {
  const lado = Math.max(ancho, alto);
  if (!(lado > max)) return { ancho, alto, reducir: false };
  const f = max / lado;
  return { ancho: Math.round(ancho * f), alto: Math.round(alto * f), reducir: true };
}

export async function reducirFoto(archivo) {
  let url;
  try {
    url = URL.createObjectURL(archivo);
    const img = new Image();
    img.src = url;
    await img.decode();
    // naturalWidth/Height ya vienen girados según el EXIF (image-orientation
    // from-image, lo normal en todos los navegadores desde 2020).
    const m = medidaReducida(img.naturalWidth, img.naturalHeight);
    if (!m.reducir && archivo.size <= PESO_SIN_TOCAR) return archivo;
    const lienzo = document.createElement('canvas');
    lienzo.width = m.ancho;
    lienzo.height = m.alto;
    lienzo.getContext('2d').drawImage(img, 0, 0, m.ancho, m.alto);
    const reducida = await new Promise(res => lienzo.toBlob(res, 'image/jpeg', CALIDAD));
    return reducida && reducida.size < archivo.size ? reducida : archivo;
  } catch {
    return archivo;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

/** Sube el archivo real al espacio de la cuenta. No usa sesion.pedir() porque
    ese fuerza JSON; aquí el cuerpo son los bytes del archivo tal cual. */
export async function subirArchivo(a, blob) {
  if (!sesion.dentro()) return false;
  try {
    const r = await fetch('/api/archivos/subir', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'X-Meta': '1',
        'Content-Type': blob.type || 'application/octet-stream',
        'X-Meta-Id': a.id,
        'X-Meta-Titulo': encodeURIComponent(a.titulo),
        'X-Meta-Tipo': a.tipo,
        'X-Meta-Asignatura': a.asignaturaId || '',
        'X-Meta-Evaluacion': a.evaluacion || '',
        'X-Meta-Fecha': a.fecha || '',
        'X-Meta-Mime': blob.type || '',
      },
      body: blob,
    });
    return r.ok;
  } catch { return false; }
}

export async function borrarArchivoRemoto(id) {
  if (!sesion.dentro()) return;
  try {
    await fetch('/api/archivos/borrar', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Meta': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
  } catch { /* queda un archivo huérfano en R2; no es grave y no hay más que perder */ }
}

/** Trae el archivo cuando este aparato no lo tiene en IndexedDB pero sí está
    marcado con r2 (subido desde otro sitio, o por el enlace de carpeta). */
export async function bajarArchivoSiFalta(a) {
  if (!a?.r2 || !sesion.dentro()) return null;
  try {
    const r = await fetch(`/api/archivos/${encodeURIComponent(a.id)}`, { credentials: 'same-origin' });
    return r.ok ? await r.blob() : null;
  } catch { return null; }
}
