/* ===========================================================================
   PRUEBA DE LOS ARCHIVOS GRANDES (más de 20 MB) — sin red: KV se simula con un
   mapa que, como el real, RECHAZA valores de más de 25 MiB. Comprueba que un
   archivo de 45 MB se parte, se guarda en trozos, se descarga entero y
   idéntico, y se borra sin dejar trozos huérfanos. También las cabeceras.

   Uso:  node tools/prueba-archivos-grandes.mjs
   =========================================================================== */
import * as archivos from '../worker/archivos.js';
import { trocea, TROZO, UMBRAL_TROZOS, MAX_SUBIDA } from '../app/js/core/archivos.js';

let fallos = 0;
const mal = m => { console.log('❌ ' + m); fallos++; };
const bien = m => console.log('✅ ' + m);
const igual = (que, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? bien(que) : mal(`${que} — salió ${JSON.stringify(a)}, tocaba ${JSON.stringify(b)}`));
const prueba = (cond, m) => (cond ? bien(m) : mal(m));

const LIMITE_KV = 25 * 1024 * 1024;
function kvFalso() {
  const m = new Map();
  return {
    m,
    async put(k, v, op = {}) {
      const tam = typeof v === 'string' ? Buffer.byteLength(v) : v.byteLength;
      if (tam > LIMITE_KV) throw new Error('KV PUT failed: 413 Value too large');
      m.set(k, { v: typeof v === 'string' ? Buffer.from(v) : Buffer.from(v), metadata: op.metadata });
    },
    async get(k) { const e = m.get(k); return e ? e.v.buffer.slice(e.v.byteOffset, e.v.byteOffset + e.v.length) : null; },
    async getWithMetadata(k) { const e = m.get(k); return { value: e ? await this.get(k) : null, metadata: e?.metadata ?? null }; },
    async delete(k) { m.delete(k); },
    async list({ prefix }) { return { keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name, metadata: m.get(name).metadata })), list_complete: true }; },
  };
}
const leeTodo = async cuerpo => Buffer.from(cuerpo instanceof ArrayBuffer ? cuerpo : await new Response(cuerpo).arrayBuffer());

/* 1. El troceo del cliente. */
const MB = 1024 * 1024;
prueba(trocea(20 * MB).length === 1, 'hasta 20 MB va de una vez');
const t45 = trocea(45 * MB);
prueba(t45.length === 5 && t45[0].hasta - t45[0].desde === TROZO && t45.at(-1).hasta === 45 * MB, '45 MB → 5 trozos de 10 MB (el último, 5 MB)');
prueba(t45.every((t, i) => i === 0 || t.desde === t45[i - 1].hasta), 'los trozos no dejan huecos ni se solapan');
prueba(trocea(MAX_SUBIDA).length <= 12, 'el tope de 100 MB cabe en el máximo de trozos del servidor');
prueba(UMBRAL_TROZOS === 20 * MB, 'el umbral es 20 MB');

/* 2. Las cabeceras del servidor. */
const cab = o => new Headers(o);
prueba(!archivos.leerParte(cab({})).trozos, 'sin cabeceras de trozo: subida normal');
prueba(archivos.leerParte(cab({ 'X-Meta-Partes': '5', 'X-Meta-Parte': '2', 'X-Meta-Total': String(45 * MB) })).trozos === true, 'cabeceras de trozo válidas');
prueba(archivos.leerParte(cab({ 'X-Meta-Partes': '5', 'X-Meta-Parte': '5', 'X-Meta-Total': '1000' })).error === 'parte', 'un trozo fuera de rango se rechaza');
prueba(archivos.leerParte(cab({ 'X-Meta-Partes': '99', 'X-Meta-Parte': '0', 'X-Meta-Total': '1000' })).error === 'partes', 'demasiados trozos se rechazan');
prueba(archivos.leerParte(cab({ 'X-Meta-Partes': '5', 'X-Meta-Parte': '0', 'X-Meta-Total': String(101 * MB) })).demasiado === true, 'más de 100 MB se rechaza');

/* 3. Subir 45 MB en trozos, bajarlos enteros e idénticos. */
const env = { META_ARCHIVOS: kvFalso() };
const original = Buffer.alloc(45 * MB);
for (let i = 0; i < original.length; i += 4099) original[i] = (i / 4099) & 255;   // no todo ceros: se nota un trozo cambiado de sitio
for (let i = 0; i < t45.length; i++) await archivos.subirParte(env, 'esp', 'pabc', i, original.subarray(t45[i].desde, t45[i].hasta));
prueba(!(await archivos.abrir(env, 'esp', 'pabc')), 'antes del último trozo el archivo aún no existe (nunca uno a medias)');
await archivos.cerrarPartes(env, 'esp', 'pabc', t45.length, original.length, 'application/pdf');
const f = await archivos.abrir(env, 'esp', 'pabc');
prueba(f && f.tipo === 'application/pdf' && f.tam === original.length, 'se abre con su tipo y su tamaño');
const bajado = await leeTodo(f.cuerpo);
prueba(bajado.equals(original), '45 MB bajan idénticos, byte a byte');

/* 4. Un archivo pequeño sigue siendo un solo valor. */
await archivos.subir(env, 'esp', 'ppeq', new Uint8Array([1, 2, 3]).buffer, 'application/pdf');
const p = await archivos.abrir(env, 'esp', 'ppeq');
prueba(p && (await leeTodo(p.cuerpo)).equals(Buffer.from([1, 2, 3])), 'un archivo pequeño se guarda y se baja como siempre');
prueba(!(await archivos.abrir(env, 'esp', 'pnada')), 'uno que no existe da null');

/* 5. Si falta un trozo, no se entrega un archivo cortado. */
env.META_ARCHIVOS.m.delete('esp/pabc.p3');
let corto = false;
try { await leeTodo((await archivos.abrir(env, 'esp', 'pabc')).cuerpo); } catch { corto = true; }
prueba(corto, 'con un trozo perdido la descarga falla en vez de entregar un archivo incompleto');

/* 6. Borrar quita todo, y solo lo suyo (p1 no toca p10). */
await archivos.subir(env, 'esp', 'p10', new Uint8Array([9]).buffer, 'application/pdf');
await archivos.subir(env, 'esp', 'p1', new Uint8Array([7]).buffer, 'application/pdf');
await archivos.borrar(env, 'esp', 'pabc');
prueba(![...env.META_ARCHIVOS.m.keys()].some(k => k.startsWith('esp/pabc')), 'borrar quita la clave y todos los trozos');
await archivos.borrar(env, 'esp', 'p1');
prueba(env.META_ARCHIVOS.m.has('esp/p10') && !env.META_ARCHIVOS.m.has('esp/p1'), 'borrar p1 no toca p10');

/* 7. Rehacer un archivo con menos trozos limpia los sobrantes. */
for (let i = 0; i < 4; i++) await archivos.subirParte(env, 'esp', 'prh', i, new Uint8Array([i]));
await archivos.cerrarPartes(env, 'esp', 'prh', 4, 4, 'application/pdf');
await archivos.subirParte(env, 'esp', 'prh', 0, new Uint8Array([1]));
await archivos.subirParte(env, 'esp', 'prh', 1, new Uint8Array([2]));
await archivos.cerrarPartes(env, 'esp', 'prh', 2, 2, 'application/pdf');
prueba(![...env.META_ARCHIVOS.m.keys()].some(k => /prh\.p[23]$/.test(k)), 'al rehacer con menos trozos no quedan sobrantes');


/* 8. La versión nueva de un archivo sustituye a la anterior EN EL SERVIDOR: si solo
      se quitara en el aparato, la lista del servidor (más nueva) la devolvería. */
{
  const datos = new Map();
  const kv = {
    async get(k, tipo) { const v = datos.get(k); return v == null ? null : tipo === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { datos.set(k, String(v)); },
    async delete(k) { datos.delete(k); },
    async list() { return { keys: [], list_complete: true }; },
  };
  const env2 = { META_DATOS: kv, META_ARCHIVOS: kvFalso() };
  await archivos.subir(env2, 'ESP', 'pviejo', new Uint8Array([1]).buffer, 'application/pdf');
  await archivos.registrarApunte(env2, 'ESP', { id: 'pviejo', titulo: 'Bloque', r2: true });
  const espera = () => new Promise(r => setTimeout(r, 5));      // la fusión se queda con la fecha más nueva: en producción pasan milisegundos entre peticiones
  await espera();
  await archivos.registrarApunte(env2, 'ESP', { id: 'potro', titulo: 'Otro', r2: true });
  await espera();
  await archivos.subir(env2, 'ESP', 'pnuevo', new Uint8Array([2]).buffer, 'application/pdf');
  await archivos.registrarApunte(env2, 'ESP', { id: 'pnuevo', titulo: 'Bloque', r2: true }, 'pviejo');
  const lista = JSON.parse(datos.get('sync:ESP')).claves.apuntesMeta.datos.map(a => a.id).sort();
  igual('al reemplazar, la entrada vieja desaparece de la lista del servidor y la otra se queda', lista, ['pnuevo', 'potro']);
  igual('y su archivo se borra', await archivos.abrir(env2, 'ESP', 'pviejo'), null);
}

if (fallos) { console.log(`\n${fallos} fallo(s)`); process.exit(1); }
console.log('\nTodo bien.');
