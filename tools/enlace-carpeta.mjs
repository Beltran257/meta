#!/usr/bin/env node
/* ===========================================================================
   ENLACE DE CARPETA — sincroniza una carpeta local (por asignatura y
   evaluación) con los apuntes de foto/PDF de tu cuenta de Meta.

   No es un proceso que se queda corriendo: lo lanza un LaunchAgent (ver
   tools/instala-enlace.sh) al iniciar sesión y luego cada pocos minutos, y
   cada ejecución hace su trabajo y termina. Nunca borra nada en ningún lado:
   si borras un archivo en un sitio, el otro se queda tal cual — se prefiere
   un duplicado a una pérdida.

   Autenticación: un token de aparato (Perfil → Enlace de carpeta en la app),
   guardado en ~/Library/Application Support/Meta/token. Es una sesión más,
   solo que vive mucho y viaja en la cabecera Authorization en vez de en una
   cookie (ver worker/auth.js). Cambiar la contraseña la revoca.
   =========================================================================== */

import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const ORIGEN = process.env.META_ORIGEN || 'https://meta.beltranfersan.workers.dev';
const CARPETA = process.env.META_CARPETA || '/Users/Beltran/Desktop/ /2º BACHILLERATO';
const SOPORTE = path.join(os.homedir(), 'Library/Application Support/Meta');
const TOKEN_PATH = path.join(SOPORTE, 'token');
const MANIFEST_PATH = path.join(SOPORTE, 'enlace-carpeta.json');

// Espejo exacto de EVALUACIONES en app/js/vistas/apuntes.js.
const CARPETA_A_EVAL = { '1ª EVALUACION': '1', '2ª EVALUACION': '2', '3ª EVALUACION': '3', PAU: 'pau' };
const EVAL_A_CARPETA = { 1: '1ª EVALUACIÓN', 2: '2ª EVALUACIÓN', 3: '3ª EVALUACIÓN', pau: 'PAU' };
const EXT_TIPO = {
  '.jpg': 'foto', '.jpeg': 'foto', '.png': 'foto', '.heic': 'foto', '.heif': 'foto', '.webp': 'foto',
  '.pdf': 'pdf',
};

const normaliza = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
const sanea = s => (s.replace(/[/\\:*?"<>|]/g, '-').trim().slice(0, 120)) || 'apunte';
const nuevoId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const existe = p => stat(p).then(() => true, () => false);

/* ------------------------------ almacenamiento local ----------------------- */

async function leerToken() {
  try { return (await readFile(TOKEN_PATH, 'utf8')).trim(); }
  catch {
    console.error(`Sin clave en ${TOKEN_PATH}.`);
    console.error('Genérala en Meta → Perfil → "Enlace de carpeta" y ejecuta tools/instala-enlace.sh <clave>.');
    process.exit(1);
  }
}

const leerManifest = async () => {
  try { return JSON.parse(await readFile(MANIFEST_PATH, 'utf8')); } catch { return {}; }
};

const guardarManifest = async m => {
  await mkdir(SOPORTE, { recursive: true });
  await writeFile(MANIFEST_PATH, JSON.stringify(m, null, 1));
};

/* ---------------------------------- red ------------------------------------ */

async function pedir(token, ruta, opciones = {}) {
  const r = await fetch(`${ORIGEN}${ruta}`, {
    ...opciones,
    headers: { Authorization: `Bearer ${token}`, ...(opciones.headers || {}) },
  });
  if (!r.ok) throw new Error(`${ruta} → ${r.status}`);
  return r;
}

/* ------------------------------ carpetas <-> asignaturas -------------------- */

/** Empareja "ECONOMÍA" con la asignatura real "Economía" por nombre
    normalizado, tolerando que una sea prefijo de la otra — así "MATEMÁTICAS
    CCSS" (carpeta) encuentra "Matemáticas CCSS II" (asignatura). */
function empareja(nombre, asignaturas) {
  const n = normaliza(nombre);
  return asignaturas.find(a => {
    const na = normaliza(a.nombre);
    return na === n || na.startsWith(n) || n.startsWith(na);
  }) || null;
}

/** id de asignatura -> nombre real de su carpeta en disco. Una carpeta sin
    asignatura correspondiente (como OTROS) simplemente no entra aquí, y por
    tanto ni se sube desde ella ni se le baja nada. */
async function mapaCarpetas(asignaturas) {
  const entradas = await readdir(CARPETA, { withFileTypes: true }).catch(() => []);
  const porAsigId = new Map();
  for (const d of entradas) {
    if (!d.isDirectory() || d.name.startsWith('.')) continue;
    const asig = empareja(d.name, asignaturas);
    if (asig) porAsigId.set(asig.id, d.name);
  }
  return porAsigId;
}

async function archivosLocales(carpetasAsig) {
  const salida = [];
  for (const [asigId, nombreCarpeta] of carpetasAsig) {
    const rutaAsig = path.join(CARPETA, nombreCarpeta);
    const evals = await readdir(rutaAsig, { withFileTypes: true }).catch(() => []);
    for (const dEval of evals) {
      if (!dEval.isDirectory() || dEval.name.startsWith('.')) continue;
      const evaluacion = CARPETA_A_EVAL[normaliza(dEval.name)];
      if (!evaluacion) continue; // subcarpeta que no es 1ª/2ª/3ª/PAU: se ignora
      const rutaEval = path.join(rutaAsig, dEval.name);
      const archivos = await readdir(rutaEval, { withFileTypes: true }).catch(() => []);
      for (const f of archivos) {
        if (!f.isFile() || f.name.startsWith('.')) continue;
        salida.push({
          asigId, evaluacion, nombre: f.name,
          rutaAbs: path.join(rutaEval, f.name),
          relPath: path.join(nombreCarpeta, dEval.name, f.name),
        });
      }
    }
  }
  return salida;
}

/* ------------------------------- subir cambios ------------------------------ */

async function subirCambios(token, manifest, carpetasAsig) {
  let subidos = 0;
  for (const f of await archivosLocales(carpetasAsig)) {
    const ext = path.extname(f.nombre).toLowerCase();
    const tipo = EXT_TIPO[ext];
    if (!tipo) continue; // no es una foto ni un PDF reconocido: se ignora en silencio

    const st = await stat(f.rutaAbs);
    const prev = manifest[f.relPath];
    if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) continue; // sin cambios

    const id = prev?.id || nuevoId();
    const titulo = path.basename(f.nombre, ext);
    const mime = tipo === 'pdf' ? 'application/pdf' : `image/${ext === '.jpg' ? 'jpeg' : ext.slice(1)}`;

    try {
      await pedir(token, '/api/archivos/subir', {
        method: 'POST',
        headers: {
          'X-Meta': '1',
          'Content-Type': mime,
          'X-Meta-Id': id,
          'X-Meta-Titulo': encodeURIComponent(titulo),
          'X-Meta-Tipo': tipo,
          'X-Meta-Asignatura': f.asigId,
          'X-Meta-Evaluacion': f.evaluacion,
          'X-Meta-Fecha': new Date(st.mtimeMs).toISOString().slice(0, 10),
          'X-Meta-Mime': mime,
        },
        body: await readFile(f.rutaAbs),
      });
      manifest[f.relPath] = { id, mtimeMs: st.mtimeMs, size: st.size, origen: 'local' };
      subidos++;
    } catch (e) {
      console.error(`No se pudo subir "${f.relPath}": ${e.message}`);
    }
  }
  if (subidos) console.log(`enlace-carpeta: subidos ${subidos} archivo(s)`);
}

/* -------------------------------- bajar nuevos ------------------------------ */

async function nombreLibre(dir, nombre) {
  const ext = path.extname(nombre), base = path.basename(nombre, ext);
  let candidato = nombre, n = 1;
  while (await existe(path.join(dir, candidato))) candidato = `${base} (${++n})${ext}`;
  return candidato;
}

async function bajarNuevos(token, manifest, carpetasAsig) {
  const { apuntes } = await (await pedir(token, '/api/archivos/lista')).json();
  const idsConocidos = new Set(Object.values(manifest).map(m => m.id));
  let bajados = 0;

  for (const a of apuntes) {
    if (idsConocidos.has(a.id)) continue; // ya lo subimos nosotros o ya lo bajamos antes
    const nombreCarpeta = carpetasAsig.get(a.asignaturaId);
    if (!nombreCarpeta) continue; // asignatura sin carpeta correspondiente en disco
    const carpetaEval = EVAL_A_CARPETA[a.evaluacion] || EVAL_A_CARPETA[1];
    const dirDestino = path.join(CARPETA, nombreCarpeta, carpetaEval);

    let bytes;
    try {
      bytes = Buffer.from(await (await pedir(token, `/api/archivos/${encodeURIComponent(a.id)}`)).arrayBuffer());
    } catch (e) {
      console.error(`No se pudo bajar "${a.titulo}": ${e.message}`);
      continue;
    }

    await mkdir(dirDestino, { recursive: true });
    const ext = a.tipo === 'pdf' ? '.pdf' : '.jpg';
    const nombreArchivo = await nombreLibre(dirDestino, sanea(a.titulo) + ext);
    const destino = path.join(dirDestino, nombreArchivo);
    await writeFile(destino, bytes);
    const st = await stat(destino);
    manifest[path.relative(CARPETA, destino)] = { id: a.id, mtimeMs: st.mtimeMs, size: st.size, origen: 'remoto' };
    bajados++;
  }
  if (bajados) console.log(`enlace-carpeta: bajados ${bajados} archivo(s)`);
}

/* ---------------------------------- main ------------------------------------ */

async function main() {
  const token = await leerToken();
  const manifest = await leerManifest();

  let asignaturas;
  try {
    const buzon = await (await pedir(token, '/api/datos')).json();
    asignaturas = buzon.claves?.asignaturas?.datos || [];
  } catch (e) {
    console.error(`Sin conexión con Meta: ${e.message}`);
    return;
  }
  if (!asignaturas.length) { console.error('enlace-carpeta: la cuenta todavía no tiene asignaturas.'); return; }

  const carpetasAsig = await mapaCarpetas(asignaturas);
  if (!carpetasAsig.size) {
    console.error(`enlace-carpeta: ninguna carpeta de "${CARPETA}" coincide con una asignatura.`);
    return;
  }

  await subirCambios(token, manifest, carpetasAsig);
  await bajarNuevos(token, manifest, carpetasAsig);
  await guardarManifest(manifest);
}

main().catch(e => { console.error('enlace-carpeta:', e.message); process.exit(1); });
