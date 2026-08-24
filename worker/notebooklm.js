/* ===========================================================================
   NOTEBOOKLM — mantiene en su Drive un Documento de Google por asignatura,
   para poder añadirlo como fuente a un cuaderno de NotebookLM (desde julio de
   2026, Gemini Notebook) y que el cuaderno se entere solo de lo que él va
   apuntando en META.

   POR QUÉ ASÍ Y NO CON UNA API DE NOTEBOOKLM: no existe. La API es solo de
   Gemini Notebook Enterprise (Google Cloud), no de la cuenta personal. Lo que
   circula por ahí son librerías que sacan las cookies de la sesión de Google
   del navegador: frágil, contra los términos, y el mismo patrón de "guardar
   su contraseña" que ya se descartó con Educamos.

   La vía buena es al revés: desde el 26 de mayo de 2026, NotebookLM mantiene
   al día SOLO las fuentes que son Documentos, Hojas o Presentaciones de
   Google. Todo lo demás (páginas web, PDF, archivos subidos, YouTube) se
   queda congelado al añadirlo. Así que se le da lo único que sí sigue: un
   documento de verdad, que META reescribe.

   SIEMPRE EL MISMO ARCHIVO. Es la regla que sostiene todo esto: si se creara
   un documento nuevo en cada actualización, la fuente que él añadió al
   cuaderno seguiría apuntando al viejo y dejaría de enterarse — con la
   trampa de que en NotebookLM parecería que funciona.
   =========================================================================== */

import { leerBuzon } from './sync.js';
import { dossieres } from './dossier.js';
import * as google from './google.js';

const clave = espacio => `nblm:${espacio}`;

/* Cada asignatura se reescribe como mucho una vez cada 10 minutos aunque él
   sincronice sin parar. Sin esto, escribir tres tareas seguidas desde el móvil
   dispararía tres subidas a Drive por asignatura tocada. La huella del
   contenido ya evita las reescrituras inútiles; esto evita las ráfagas. */
const ESPERA_MS = 10 * 60 * 1000;

async function estadoDe(env, espacio) {
  return (await env.META_DATOS.get(clave(espacio), 'json').catch(() => null)) || { docs: {} };
}

const guardarEstado = (env, espacio, estado) =>
  env.META_DATOS.put(clave(espacio), JSON.stringify(estado));

/** Lo que ve la app: por asignatura, si ya tiene documento, su enlace y
    cuándo se actualizó por última vez. */
export async function estado(env, espacio) {
  const conectado = !!(await google.estadoConexion(env, espacio)).conectado;
  const conDrive = conectado && (await google.tieneDrive(env, espacio));
  const guardado = await estadoDe(env, espacio);
  const buzon = await leerBuzon(env.META_DATOS, espacio);

  const asignaturas = dossieres(buzon).map(d => {
    const g = guardado.docs?.[d.asignaturaId];
    return {
      asignaturaId: d.asignaturaId,
      asignatura: d.asignatura,
      url: g?.url || null,
      ultima: g?.ultima || null,
      alDia: !!g && g.hash === d.hash,
    };
  });

  return {
    conectado,
    conDrive,
    // 'reconectar' es el caso de una conexión de Google anterior a agosto de
    // 2026: existe, pero sin el permiso de Drive.
    hayQueReconectar: conectado && !conDrive,
    ultimoFallo: guardado.ultimoFallo || null,
    asignaturas,
  };
}

/** Crea o actualiza los documentos. `forzar` reescribe aunque la huella no
    haya cambiado (el botón de la app), sin forzar solo toca lo que cambió
    (la sincronización automática). */
export async function sincronizar(env, espacio, { forzar = false } = {}) {
  if (!env.GOOGLE_CLIENT_ID) return { error: 'sin-google', detalle: 'Google no está configurado en este Worker.' };

  const conexion = await google.estadoConexion(env, espacio);
  if (!conexion.conectado) return { error: 'sin-conexion', detalle: 'Google no está conectado.' };
  if (!(await google.tieneDrive(env, espacio))) {
    return { error: 'reconectar', detalle: 'La conexión con Google es anterior al permiso de Drive: hay que volver a conectarla.' };
  }

  const guardado = await estadoDe(env, espacio);
  const ahora = Date.now();
  if (!forzar && guardado.ultima && ahora - guardado.ultima < ESPERA_MS) {
    return { omitido: 'espera', proxima: guardado.ultima + ESPERA_MS };
  }

  const buzon = await leerBuzon(env.META_DATOS, espacio);
  const lista = dossieres(buzon);
  const docs = { ...(guardado.docs || {}) };
  const hechos = [];
  let ultimoFallo = null;

  for (const d of lista) {
    const previo = docs[d.asignaturaId];
    if (!forzar && previo && previo.hash === d.hash) continue;   // nada que contar

    const r = await google.guardarDossier(env, espacio, {
      fileId: previo?.fileId || null, nombre: d.nombre, html: d.html,
    });
    if (r.error) {
      ultimoFallo = { ...r.error, cuando: ahora, asignatura: d.asignatura };
      // Un permiso mal o la API apagada fallarían igual en todas: no tiene
      // sentido insistir asignatura por asignatura.
      if (r.error.motivo !== 'fallo') break;
      continue;
    }
    docs[d.asignaturaId] = {
      fileId: r.fileId, url: r.url, nombre: d.nombre, hash: d.hash, ultima: ahora,
    };
    hechos.push({ asignatura: d.asignatura, url: r.url });
  }

  await guardarEstado(env, espacio, { docs, ultima: ahora, ultimoFallo });
  return ultimoFallo && !hechos.length
    ? { error: ultimoFallo.motivo, detalle: ultimoFallo.detalle }
    : { actualizados: hechos, ultimoFallo };
}

/** Se llama al desconectar Google y al borrar la cuenta: los documentos los
    creó META, así que se los lleva consigo en vez de dejarlos sueltos en su
    Drive. */
export async function retirar(env, espacio) {
  const guardado = await estadoDe(env, espacio);
  for (const d of Object.values(guardado.docs || {})) {
    await google.borrarDossier(env, espacio, d.fileId).catch(() => {});
  }
  await env.META_DATOS.delete(clave(espacio));
}
