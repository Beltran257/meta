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
