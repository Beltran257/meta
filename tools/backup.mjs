/* Vuelca TODAS las claves de KV de meta a una copia con fecha, para tener un
   respaldo bajo demanda por si se borra o corrompe algo en producción. No
   toca nada, solo lee.
   - META_DATOS (texto/JSON: cuentas, buzones de sync...) -> backups/<fecha>.json
   - META_ARCHIVOS (binario: fotos/PDF de apuntes) -> backups/<fecha>/archivos/
     un fichero por clave, porque meterlo en JSON como texto corrompería los
     bytes (hoy está vacío, pero si algún día se llena esto ya está listo).
   Uso:  node tools/backup.mjs                                                */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const NAMESPACES = [
  { binding: 'META_DATOS', id: 'bbca17a4a1664cd3bd7204e9de2d7e6a', binario: false },
  { binding: 'META_ARCHIVOS', id: '2a2729a8e48b4618b9e698edce417304', binario: true },
];

function wrangler(args, opts = {}) {
  return execFileSync('npx', ['wrangler', ...args], {
    encoding: opts.buffer ? null : 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 1024 * 1024 * 256,
  });
}

function listarClaves(id) {
  return JSON.parse(wrangler(['kv', 'key', 'list', `--namespace-id=${id}`, '--remote'])).map(k => k.name);
}

function volcarTexto({ binding, id }, claves) {
  const valores = {};
  const TROZO = 500;
  for (let i = 0; i < claves.length; i += TROZO) {
    const trozo = claves.slice(i, i + TROZO);
    const tmp = `/tmp/backup-${binding}-${i}.json`;
    writeFileSync(tmp, JSON.stringify(trozo));
    console.log(`   pidiendo valores ${i + 1}-${i + trozo.length} de ${claves.length}...`);
    Object.assign(valores, JSON.parse(wrangler(['kv', 'bulk', 'get', tmp, `--namespace-id=${id}`, '--remote'])));
  }
  return valores;
}

function volcarBinario({ binding, id }, claves, carpeta) {
  mkdirSync(carpeta, { recursive: true });
  claves.forEach((clave, i) => {
    console.log(`   descargando archivo ${i + 1}/${claves.length}: ${clave}`);
    const bytes = wrangler(['kv', 'key', 'get', clave, `--namespace-id=${id}`, '--remote'], { buffer: true });
    writeFileSync(`${carpeta}/${clave.replace(/[/\\]/g, '_')}`, bytes);
  });
}

const fecha = new Date().toISOString().slice(0, 10);
const copia = { fecha, app: 'meta', namespaces: {} };
mkdirSync('backups', { recursive: true });

for (const ns of NAMESPACES) {
  console.log(`-> ${ns.binding}: listando claves...`);
  const claves = listarClaves(ns.id);
  console.log(`   ${claves.length} claves encontradas`);
  if (ns.binario) {
    if (claves.length > 0) volcarBinario(ns, claves, `backups/${fecha}/archivos`);
    copia.namespaces[ns.binding] = { tipo: 'binario', claves: claves.length, carpeta: claves.length ? `${fecha}/archivos` : null };
  } else {
    copia.namespaces[ns.binding] = claves.length ? volcarTexto(ns, claves) : {};
  }
}

const destino = `backups/${fecha}.json`;
writeFileSync(destino, JSON.stringify(copia, null, 2));

const total = Object.entries(copia.namespaces)
  .reduce((n, [, v]) => n + (v.tipo === 'binario' ? v.claves : Object.keys(v).length), 0);
console.log(`\nCopia guardada en ${destino} (${total} claves en total).`);
