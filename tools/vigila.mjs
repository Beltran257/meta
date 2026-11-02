#!/usr/bin/env node
/* ===========================================================================
   VIGILA — revisa PRODUCCIÓN, de fuera, sin una sola clave.

   tools/audita.mjs y las pruebas miran el CÓDIGO antes de publicar. Esto mira
   lo que está sirviendo meta AHORA, y es lo que corre solo cada pocas horas
   desde GitHub (.github/workflows/vigila.yml): si algo falla abre una incidencia
   y cuando se arregla la cierra. Existe porque entre una publicación y la
   siguiente pasan cosas que ningún test ve:

     · la conexión con Google caduca o se rompe
     · el Apps Script del calendario deja de mandar horas
     · una sección de datos encoge de golpe (se perdieron ~13 h sin que nadie lo notara)
     · un error de JavaScript le sale a tu iPad
     · un archivo del precaché deja de servirse, o la versión de la app, el service
       worker y el rescate no cuadran (el iPad se quedaría con la app vieja)
     · una ruta privada deja de pedir sesión (un fallo de seguridad que no se ve)

   Solo usa endpoints públicos. Nada de lo que lee identifica a nadie.

   Uso:  node tools/vigila.mjs [URL]        (por defecto, producción)
         → sale con código 1 si algo falla; escribe vigila-informe.md
   =========================================================================== */

import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const PRODUCCION = 'https://meta.beltranfersan.workers.dev';
const CABECERAS = ['content-security-policy', 'x-frame-options', 'strict-transport-security', 'cross-origin-opener-policy'];
/* Rutas que SIEMPRE piden sesión: si alguna contesta 200 sin ella, es un fallo grave. */
const PRIVADAS = [
  ['GET', '/api/datos'], ['GET', '/api/estudio'], ['GET', '/api/google/estado'],
  ['GET', '/api/archivos/p1'], ['GET', '/api/mi/briefing'], ['POST', '/api/estudio/clave'], ['POST', '/api/temario/ia'],
];
export const CAMPOS_SALUD = ['ok', 'servicio', 'limitador', 'cuentas', 'google', 'ia', 'datos', 'estudio', 'errores'];

const versionDe = (texto, re) => re.exec(texto || '')?.[1] || null;

/** Revisa producción. `pedir(ruta, opciones)` devuelve { status, headers, texto }
    (inyectable: las pruebas le pasan respuestas simuladas). `versionRepo` es la
    versión del código que se está mirando, o null si no se sabe. */
export async function vigila({ pedir, versionRepo = null }) {
  const fallos = [], avisos = [], bien = [];
  const f = m => fallos.push(m), a = m => avisos.push(m), ok = m => bien.push(m);
  const intenta = async (ruta, op) => { try { return await pedir(ruta, op); } catch (e) { return { status: 0, headers: {}, texto: '', error: String(e?.message || e) }; } };

  /* 1. La salud del servicio. */
  const t0 = Date.now();
  const rs = await intenta('/api/salud');
  const ms = Date.now() - t0;
  let salud = null;
  try { salud = JSON.parse(rs.texto); } catch { /* se avisa abajo */ }
  if (rs.status !== 200 || !salud) f(`/api/salud no responde bien (estado ${rs.status}${rs.error ? ', ' + rs.error : ''})`);
  else {
    const faltan = CAMPOS_SALUD.filter(k => !(k in salud));
    if (faltan.length) f(`/api/salud no trae: ${faltan.join(', ')} (¿se ha desplegado a medias?)`);
    if (salud.ok !== true) f('/api/salud dice ok:false');
    if (salud.limitador !== 'activo') f(`el limitador de peticiones no está activo (dice: ${salud.limitador})`);
    if (salud.cuentas !== 'listas') f(`la identidad compartida (cuentas) no responde (dice: ${salud.cuentas})`);
    if (salud.ia !== 'enlazada') f(`Workers AI no está enlazado (dice: ${salud.ia})`);
    if (/reconectar|error|roto|caduc/i.test(salud.google || '')) f(`Google Calendar: ${salud.google}`);
    if (String(salud.datos).startsWith('ALERTA')) f(`DATOS que encogen de golpe — ${salud.datos}. La sección anterior está en la papelera (KV papelera:*) durante 30 días.`);
    else if (String(salud.datos).startsWith('error')) a(`la sonda de datos falla: ${salud.datos}`);
    if (/ATRASADO/.test(salud.estudio || '')) f(`el script del estudio (Apps Script) no envía: ${salud.estudio}`);
    else if (/error/.test(salud.estudio || '')) a(`la sonda del estudio falla: ${salud.estudio}`);
    else if (/sin script/.test(salud.estudio || '')) a('no hay ningún script de estudio instalado: las horas no entran solas');
    if (salud.errores && !/^ninguno/.test(salud.errores)) f(`errores de JavaScript en los aparatos: ${salud.errores}`);
    if (ms > 5000) a(`/api/salud tardó ${ms} ms`);
    if (!fallos.length) ok(`/api/salud: todo en verde (${ms} ms)`);
  }

  /* 2. Versiones: la app, el service worker y el rescate tienen que decir lo mismo. */
  const rShell = await intenta('/shell.js?v=' + Date.now());
  const vProd = versionDe(rShell.texto, /APP_VERSION\s*=\s*'([^']+)'/);
  const rSw = await intenta('/sw.js?v=' + Date.now());
  const rArr = await intenta('/arranque.js?v=' + Date.now());
  const rIdx = await intenta('/index.html?v=' + Date.now());
  const vSw = versionDe(rSw.texto, /shell\.js\?v=([0-9.]+)/);
  const vArr = versionDe(rArr.texto, /VERSION\s*=\s*'([^']+)'/);
  const vIdx = versionDe(rIdx.texto, /arranque\.js\?v=([0-9.]+)/);
  if (!vProd) f('no se puede leer la versión de /shell.js');
  else {
    const mal = [['sw.js', vSw], ['arranque.js', vArr], ['index.html', vIdx]].filter(([, v]) => v !== vProd);
    if (mal.length) f(`las versiones no cuadran: shell.js dice ${vProd} y ${mal.map(([n, v]) => `${n} dice ${v}`).join(', ')} — el iPad podría quedarse con una mezcla de app vieja y nueva`);
    else ok(`versión ${vProd} coherente en shell, sw, arranque e index`);
    if (versionRepo && versionRepo !== vProd) a(`producción sirve ${vProd} y el código tiene ${versionRepo}: hay cambios sin publicar (tools/publica.sh)`);
  }

  /* 3. Todo lo que el precaché promete, se sirve. */
  const lista = [...(rShell.texto.match(/self\.SHELL\s*=\s*\[([\s\S]*?)\]/)?.[1] || '').matchAll(/'([^']+)'/g)].map(m => m[1]);
  if (!lista.length) f('no se puede leer la lista del precaché (SHELL) de /shell.js');
  else {
    const rotos = [];
    for (const ruta of lista) {
      if (ruta === './') continue;
      const r = await intenta('/' + ruta.replace(/^\.\//, ''));
      if (r.status !== 200 || !r.texto?.length) rotos.push(`${ruta} (${r.status})`);
    }
    if (rotos.length) f(`el precaché promete archivos que no se sirven: ${rotos.slice(0, 6).join(', ')}${rotos.length > 6 ? ` y ${rotos.length - 6} más` : ''} — el service worker fallaría al instalar y no habría actualización en los móviles`);
    else ok(`los ${lista.length} archivos del precaché se sirven`);
  }

  /* 4. Cabeceras de seguridad y páginas que Google exige. */
  const rRaiz = await intenta('/');
  const sin = CABECERAS.filter(h => !rRaiz.headers?.[h]);
  sin.length ? f(`faltan cabeceras de seguridad: ${sin.join(', ')}`) : ok('cabeceras de seguridad presentes');
  const rPriv = await intenta('/privacidad.html');
  rPriv.status === 200 && /privacidad|datos/i.test(rPriv.texto) ? ok('la página de privacidad se sirve') : f(`la página de privacidad no se sirve (estado ${rPriv.status})`);

  /* 5. Lo privado sigue pidiendo sesión. */
  const abiertas = [];
  for (const [metodo, ruta] of PRIVADAS) {
    const r = await intenta(ruta, { metodo, cuerpo: metodo === 'POST' ? '{}' : undefined });
    if (r.status === 200) abiertas.push(`${metodo} ${ruta}`);
  }
  abiertas.length ? f(`SEGURIDAD: estas rutas contestan 200 SIN sesión: ${abiertas.join(', ')}`) : ok(`${PRIVADAS.length} rutas privadas siguen pidiendo sesión`);
  const rBad = await intenta('/api/estudio/recibir', { metodo: 'POST', cuerpo: '{}', cabeceras: { Authorization: 'Bearer ' + 'a'.repeat(64), 'X-Meta': '1' } });
  rBad.status === 401 ? ok('la clave del script rechaza una clave falsa') : f(`SEGURIDAD: /api/estudio/recibir con una clave falsa contesta ${rBad.status} (debía ser 401)`);

  return { fallos, avisos, bien };
}

/** Texto en markdown para la incidencia y el resumen del workflow. */
export function informe({ fallos, avisos, bien }, base, cuando = new Date()) {
  const l = [];
  l.push(`# Vigilancia de meta · ${fallos.length ? '🔴 FALLA' : avisos.length ? '🟡 con avisos' : '🟢 todo bien'}`);
  l.push(`${base} · ${cuando.toISOString().replace('T', ' ').slice(0, 16)} UTC`, '');
  if (fallos.length) l.push('## Fallos', ...fallos.map(x => `- ❌ ${x}`), '');
  if (avisos.length) l.push('## Avisos', ...avisos.map(x => `- ⚠️ ${x}`), '');
  if (bien.length) l.push('## Bien', ...bien.map(x => `- ✅ ${x}`), '');
  return l.join('\n');
}

/* ------------------------------- ejecución -------------------------------- */
const esPrincipal = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (esPrincipal) {
  const base = (process.argv[2] || PRODUCCION).replace(/\/$/, '');
  const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
  let versionRepo = null;
  try { versionRepo = versionDe(readFileSync(join(raiz, 'app/shell.js'), 'utf8'), /APP_VERSION\s*=\s*'([^']+)'/); } catch { /* sin repo al lado */ }

  const pedir = async (ruta, { metodo = 'GET', cuerpo, cabeceras = {} } = {}) => {
    const r = await fetch(base + ruta, {
      method: metodo, body: cuerpo, redirect: 'manual', signal: AbortSignal.timeout(20000),
      headers: { ...(cuerpo ? { 'Content-Type': 'application/json', 'X-Meta': '1' } : {}), ...cabeceras },
    });
    return { status: r.status, headers: Object.fromEntries(r.headers), texto: await r.text() };
  };

  // Un fallo de red puntual no debe abrir una incidencia: se reintenta una vez.
  let res = await vigila({ pedir, versionRepo });
  if (res.fallos.length) { await new Promise(r => setTimeout(r, 15000)); res = await vigila({ pedir, versionRepo }); }

  const md = informe(res, base);
  console.log(md);
  writeFileSync('vigila-informe.md', md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  process.exit(res.fallos.length ? 1 : 0);
}
