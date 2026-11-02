#!/usr/bin/env node
/* ===========================================================================
   PAPELERA — devolver lo que la vigilancia vio desaparecer.

   Cuando una sección de datos (sesiones, apuntes…) encoge de golpe al
   sincronizar, worker/vigilancia.js guarda lo que había en `papelera:*` (30
   días) y /api/salud avisa. Esto lo recupera. No toca nada si no se lo pides.

     node tools/papelera.mjs lista
     node tools/papelera.mjs restaura <espacio> <seccion>      (p. ej. ABCD1234 sesiones)

   Restaurar NO borra lo que haya ahora: pone de nuevo la sección con lo de la
   papelera y fecha de "ahora", así los aparatos la adoptan en su próxima
   sincronización. Antes guarda lo actual en un archivo (backups/) por si la
   restauración fuera peor que el problema. Necesita `npx wrangler` con sesión.
   =========================================================================== */

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Función pura: el buzón con la sección devuelta desde la papelera. */
export function restauraEnBuzon(buzon, papelera, ahora = Date.now()) {
  if (!papelera?.clave || !Array.isArray(papelera.datos)) throw new Error('la papelera no tiene datos que restaurar');
  const base = buzon || { claves: {}, creado: ahora };
  return { ...base, claves: { ...base.claves, [papelera.clave]: { ts: ahora, datos: papelera.datos } }, actualizado: ahora };
}

const kv = (...a) => execFileSync('npx', ['wrangler', 'kv', 'key', ...a, '--binding', 'META_DATOS', '--remote'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
const json = t => JSON.parse(t.slice(t.search(/[[{]/)));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [orden, espacio, seccion] = process.argv.slice(2);
  if (orden === 'lista') {
    const claves = json(kv('list', '--prefix', 'papelera:')).map(k => k.name);
    if (!claves.length) console.log('La papelera está vacía.');
    for (const c of claves) {
      const p = json(kv('get', c, '--text'));
      console.log(`${c}  ·  ${p.n} elementos  ·  ${new Date(p.ts).toLocaleString('es-ES')}`);
    }
  } else if (orden === 'restaura' && espacio && seccion) {
    const papelera = json(kv('get', `papelera:${espacio}:${seccion}`, '--text'));
    const buzon = json(kv('get', `sync:${espacio}`, '--text'));
    mkdirSync('backups', { recursive: true });
    const copia = `backups/antes-de-restaurar-${espacio}-${seccion}-${Date.now()}.json`;
    writeFileSync(copia, JSON.stringify(buzon));
    console.log(`Copia de lo actual: ${copia}`);
    const nuevo = restauraEnBuzon(buzon, papelera);
    writeFileSync('/tmp/meta-restaura.json', JSON.stringify(nuevo));
    kv('put', `sync:${espacio}`, '--path', '/tmp/meta-restaura.json');
    console.log(`Restaurados ${papelera.n} elementos de «${seccion}». Los aparatos los verán al sincronizar.`);
  } else {
    console.log('Uso: node tools/papelera.mjs lista | restaura <espacio> <seccion>');
    process.exit(1);
  }
}
