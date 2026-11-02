/* ===========================================================================
   PRUEBA DE LA VIGILANCIA — sin red.

   Una alarma que no suena cuando debe es peor que no tener alarma (da
   tranquilidad falsa), y una que suena sin motivo se acaba ignorando. Aquí se
   comprueba las dos cosas: que cada sonda DETECTA el fallo para el que existe
   y que NO salta con lo normal.

   Uso:  node tools/prueba-vigilancia.mjs
   =========================================================================== */
import { detectaPerdida, anotaPerdida, textoAlertas, textoEstudio, limpiaError, registraError, sondaErrores, sondaDatos, sondaEstudio } from '../worker/vigilancia.js';
import { fusionar } from '../worker/sync.js';
import { vigila, informe } from './vigila.mjs';
import { restauraEnBuzon } from './papelera.mjs';

let fallos = 0;
const mal = m => { console.log('❌ ' + m); fallos++; };
const bien = m => console.log('✅ ' + m);
const igual = (que, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? bien(que) : mal(`${que}\n     salió:  ${JSON.stringify(a)}\n     tocaba: ${JSON.stringify(b)}`));

/** Un KV de mentira con lo justo (get, put, list con prefijo). */
function kvFalso() {
  const m = new Map();
  return {
    m,
    async get(k, tipo) { const v = m.get(k); return v == null ? null : tipo === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, String(v)); },
    async list({ prefix = '' } = {}) { return { keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }; },
  };
}
const lista = n => Array.from({ length: n }, (_, i) => ({ id: i }));

/* ------------------------ 1. pérdida de datos ------------------------------ */
igual('70 → 31 elementos se detecta (es justo lo que pasó con las horas)', detectaPerdida(lista(70), lista(31)), { de: 70, a: 31 });
igual('quedarse a 0 también (una sección vaciada)', [detectaPerdida(lista(20), []), detectaPerdida(lista(20), null)], [{ de: 20, a: 0 }, { de: 20, a: 0 }]);
igual('crecer, o bajar poco, NO es alerta', [detectaPerdida(lista(70), lista(80)), detectaPerdida(lista(70), lista(60)), detectaPerdida(lista(70), lista(43))], [null, null, null]);
igual('una lista pequeña (<10) no se vigila: borrar 3 de 5 es normal', detectaPerdida(lista(5), lista(1)), null);
igual('lo que no es una lista (perfil, horario…) no se vigila', [detectaPerdida({ a: 1 }, {}), detectaPerdida(undefined, lista(3)), detectaPerdida(null, null)], [null, null, null]);

{
  const kv = kvFalso();
  const p = await anotaPerdida(kv, 'ESP1', 'sesiones', lista(70), lista(31));
  const alerta = await kv.get('alerta:ESP1:sesiones', 'json');
  const papelera = await kv.get('papelera:ESP1:sesiones', 'json');
  p && alerta?.de === 70 && alerta.a === 31 && papelera?.datos?.length === 70
    ? bien('anotar una pérdida guarda la alerta Y lo que había (para poder devolverlo)') : mal('anotaPerdida no guardó alerta o papelera');
  igual('una caída normal no escribe nada', [await anotaPerdida(kv, 'ESP1', 'tareas', lista(70), lista(65)), [...kv.m.keys()].filter(k => k.includes('tareas')).length], [null, 0]);

  const resumen = await sondaDatos(kv);
  /ALERTA: sesiones 70→31/.test(resumen) && !/ESP1/.test(resumen) ? bien('/api/salud lo cuenta SIN el código del espacio (no identifica a nadie)') : mal(`resumen: ${resumen}`);
  igual('sin alertas dice "ok"', await sondaDatos(kvFalso()), 'ok');
  igual('el texto junta varias, la más reciente primero', textoAlertas([{ clave: 'a', de: 20, a: 1, ts: 1000 }, { clave: 'b', de: 30, a: 2, ts: 2000 }]).startsWith('ALERTA: b 30→2'), true);
}

/* Integración con la sincronización real: lo que hace fusionar() al recibir. */
{
  const kv = kvFalso();
  const ahora = Date.now();
  await kv.put('sync:CODIGO01', JSON.stringify({ claves: { sesiones: { ts: ahora - 5000, datos: lista(70) } }, creado: ahora }));
  await fusionar(kv, 'CODIGO01', { claves: { sesiones: { ts: ahora, datos: lista(31) } } });
  const dentro = JSON.parse(kv.m.get('sync:CODIGO01'));
  dentro.claves.sesiones.datos.length === 31 ? bien('fusionar NO bloquea el cambio (borrar mucho a propósito es legítimo)') : mal('fusionar bloqueó el cambio');
  (await kv.get('alerta:CODIGO01:sesiones', 'json'))?.de === 70 && (await kv.get('papelera:CODIGO01:sesiones', 'json'))?.datos.length === 70
    ? bien('…pero la pérdida queda anotada y lo anterior guardado en la papelera') : mal('fusionar no anotó la pérdida');
  // Un dato más viejo no pisa y no alerta.
  const kv2 = kvFalso();
  await kv2.put('sync:CODIGO02', JSON.stringify({ claves: { sesiones: { ts: ahora, datos: lista(70) } } }));
  await fusionar(kv2, 'CODIGO02', { claves: { sesiones: { ts: ahora - 9999, datos: lista(2) } } });
  igual('un dato más VIEJO no pisa lo nuevo ni da falsa alarma', [JSON.parse(kv2.m.get('sync:CODIGO02')).claves.sesiones.datos.length, [...kv2.m.keys()].some(k => k.startsWith('alerta:'))], [70, false]);
  // Un fallo de la vigilancia no rompe sincronizar.
  const kv3 = kvFalso(); const put = kv3.put.bind(kv3);
  await kv3.put('sync:CODIGO03', JSON.stringify({ claves: { sesiones: { ts: 1, datos: lista(50) } } }));
  kv3.put = async (k, v) => { if (k.startsWith('alerta:')) throw new Error('KV caído'); return put(k, v); };
  let lanzo = false;
  try { await fusionar(kv3, 'CODIGO03', { claves: { sesiones: { ts: 2, datos: lista(5) } } }); } catch { lanzo = true; }
  !lanzo && JSON.parse(kv3.m.get('sync:CODIGO03')).claves.sesiones.datos.length === 5
    ? bien('si la vigilancia falla (KV caído), sincronizar sigue funcionando') : mal('un fallo de la vigilancia rompió fusionar');
}

/* La recuperación: devolver una sección desde la papelera. */
{
  const buzon = { claves: { sesiones: { ts: 100, datos: lista(31) }, tareas: { ts: 50, datos: [1, 2] } }, duenyo: 'u1', creado: 1 };
  const r = restauraEnBuzon(buzon, { clave: 'sesiones', n: 70, datos: lista(70) }, 5000);
  igual('restaurar pone la sección de la papelera con fecha de ahora (los aparatos la adoptan)', [r.claves.sesiones.datos.length, r.claves.sesiones.ts], [70, 5000]);
  igual('…sin tocar el resto del buzón (otras secciones, dueño)', [r.claves.tareas.datos, r.duenyo, r.creado], [[1, 2], 'u1', 1]);
  let lanzo = false;
  try { restauraEnBuzon(buzon, { clave: 'x', datos: null }); } catch { lanzo = true; }
  lanzo ? bien('una papelera sin datos no restaura nada (error claro)') : mal('restauró una papelera vacía');
}

/* ------------------------ 2. el script del estudio ------------------------- */
const H = 36e5;
igual('sin ningún script: "sin script instalado"', textoEstudio([]), 'sin script instalado');
igual('envió hace 40 min: ok', textoEstudio([40 * 60000]), 'ok (último envío hace 40 min)');
igual('lleva 7 h sin enviar: ATRASADO', /^ATRASADO: sin enviar desde hace 7 h/.test(textoEstudio([7 * H])), true);
igual('con dos espacios, manda el peor', /ATRASADO/.test(textoEstudio([5 * 60000, 9 * H])), true);
{
  const kv = kvFalso(); const ahora = Date.now();
  await kv.put('estudio:ESP1', JSON.stringify({ bloques: [], ultima: ahora - 2 * H }));
  await kv.put('estudioclave:abc', '{}'); await kv.put('estudioclavede:ESP1', 'abc');   // no deben contarse
  igual('la sonda mira solo los envíos (no las claves) y no identifica a nadie', await sondaEstudio(kv, ahora), 'ok (último envío hace 120 min)');
}

/* ------------------------- 3. errores del aparato -------------------------- */
igual('un error de verdad se anota, con solo el archivo (sin origen ni query)',
  limpiaError({ msg: "Cannot read properties of null (reading 'value')", src: 'https://meta.beltranfersan.workers.dev/js/vistas/estudiar.js?v=2.0.37&token=SECRETO', linea: 120, version: '2.0.37', vista: 'estudiar' }),
  { msg: "Cannot read properties of null (reading 'value')", src: '/js/vistas/estudiar.js', linea: 120, version: '2.0.37', vista: 'estudiar' });
igual('lo normal NO se anota: sin conexión, ResizeObserver, "Script error.", service worker',
  ['Load failed', 'TypeError: Failed to fetch', 'ResizeObserver loop completed with undelivered notifications.', 'Script error.', 'Failed to register a ServiceWorker', ''].map(msg => limpiaError({ msg })),
  [null, null, null, null, null, null]);
igual('se recorta y se limpia lo que llega (versión y vista solo con caracteres válidos)',
  limpiaError({ msg: 'x'.repeat(500), version: '2.0.37<script>', vista: 'Hoy!!' }).version + '|' + limpiaError({ msg: 'x', vista: 'Hoy!!' }).vista, '2.0.37|oy');
{
  const kv = kvFalso(); const ahora = Date.now();
  for (let i = 0; i < 50; i++) await registraError(kv, { msg: 'Boom', src: '/js/a.js', linea: 3, version: '2.0.37' }, ahora);
  await registraError(kv, { msg: 'Otro', src: '/js/b.js', linea: 9, version: '2.0.37' }, ahora);
  igual('50 errores iguales ocupan UNA entrada con contador (no llenan el KV)', [...kv.m.keys()].filter(k => k.startsWith('errcli:')).length, 2);
  const t = await sondaErrores(kv, ahora);
  /2 distintos \(51 veces en 24 h\)/.test(t) && /Boom/.test(t) ? bien('/api/salud los resume: cuántos, cuántas veces y el más repetido') : mal(`sondaErrores: ${t}`);
  igual('sin errores: "ninguno en 24 h"', await sondaErrores(kvFalso()), 'ninguno en 24 h');
  igual('un error de hace 3 días ya no cuenta', await sondaErrores(kv, ahora + 3 * 864e5), 'ninguno en 24 h');
}

/* ------------------------ 4. vigila.mjs con producción simulada ------------- */
const SHELL = `self.APP_VERSION = '2.0.40';\nself.SHELL = [\n  './',\n  './index.html',\n  './js/main.js',\n];`;
const SANA = {
  '/api/salud': { status: 200, texto: JSON.stringify({ ok: true, servicio: 'meta', limitador: 'activo', cuentas: 'listas', google: 'conectado', ia: 'enlazada', datos: 'ok', estudio: 'ok (último envío hace 20 min)', errores: 'ninguno en 24 h' }) },
  '/shell.js': { status: 200, texto: SHELL },
  '/sw.js': { status: 200, texto: "importScripts('./shell.js?v=2.0.40');" },
  '/arranque.js': { status: 200, texto: "var VERSION = '2.0.40';" },
  '/index.html': { status: 200, texto: '<script src="./arranque.js?v=2.0.40"></script>' },
  '/js/main.js': { status: 200, texto: 'export {}' },
  '/': { status: 200, texto: '<html>', headers: { 'content-security-policy': 'x', 'x-frame-options': 'DENY', 'strict-transport-security': 'x', 'cross-origin-opener-policy': 'x' } },
  '/privacidad.html': { status: 200, texto: '<h1>Privacidad</h1> datos' },
  '/api/estudio/recibir': { status: 401, texto: '{}' },
};
const PRIVADAS_401 = ['/api/datos', '/api/estudio', '/api/google/estado', '/api/archivos/p1', '/api/mi/briefing', '/api/estudio/clave', '/api/temario/ia'];
function simula(cambios = {}) {
  const t = { ...SANA, ...cambios };
  return async (ruta) => {
    const limpia = ruta.split('?')[0];
    if (PRIVADAS_401.includes(limpia) && !(limpia in cambios)) return { status: 401, headers: {}, texto: '{}' };
    const r = t[limpia];
    if (r === 'caido') throw new Error('ECONNRESET');
    return r ? { headers: {}, ...r } : { status: 404, headers: {}, texto: '' };
  };
}
const salud = campos => ({ '/api/salud': { status: 200, texto: JSON.stringify({ ...JSON.parse(SANA['/api/salud'].texto), ...campos }) } });
const corre = async (cambios, versionRepo = '2.0.40') => vigila({ pedir: simula(cambios), versionRepo });

{
  const r = await corre({});
  r.fallos.length === 0 && r.avisos.length === 0 && r.bien.length >= 6 ? bien('producción sana: ni fallos ni avisos (no hay falsas alarmas)') : mal(`sana: ${JSON.stringify(r)}`);
}
const casos = [
  ['Google roto', salud({ google: 'HAY QUE RECONECTAR: abc (1 de 1)' }), /Google Calendar/],
  ['datos que encogen', salud({ datos: 'ALERTA: sesiones 70→31 (2 nov)' }), /DATOS que encogen.*papelera/],
  ['script del estudio atrasado', salud({ estudio: 'ATRASADO: sin enviar desde hace 9 h' }), /script del estudio/],
  ['errores de JavaScript', salud({ errores: "1 distintos (3 veces en 24 h) · el más repetido: Boom" }), /errores de JavaScript/],
  ['limitador caído', salud({ limitador: 'ausente' }), /limitador/],
  ['cuentas caído', salud({ cuentas: 'error 500' }), /cuentas/],
  ['IA sin enlazar', salud({ ia: 'ausente' }), /Workers AI/],
  ['salud sin campos nuevos (despliegue a medias)', { '/api/salud': { status: 200, texto: JSON.stringify({ ok: true, servicio: 'meta', limitador: 'activo', cuentas: 'listas', google: 'conectado', ia: 'enlazada' }) } }, /no trae: datos, estudio, errores/],
  ['salud caída', { '/api/salud': { status: 500, texto: '' } }, /\/api\/salud no responde/],
  ['red caída', { '/api/salud': 'caido' }, /ECONNRESET/],
  ['sw.js con otra versión', { '/sw.js': { status: 200, texto: "importScripts('./shell.js?v=2.0.39');" } }, /versiones no cuadran.*sw\.js dice 2\.0\.39/],
  ['arranque.js con otra versión', { '/arranque.js': { status: 200, texto: "var VERSION = '2.0.38';" } }, /arranque\.js dice 2\.0\.38/],
  ['archivo del precaché que no se sirve', { '/js/main.js': { status: 404, texto: '' } }, /precaché promete archivos.*js\/main\.js \(404\)/],
  ['sin cabeceras de seguridad', { '/': { status: 200, texto: '<html>', headers: {} } }, /faltan cabeceras.*content-security-policy/],
  ['ruta privada abierta', { '/api/datos': { status: 200, texto: '{"claves":{}}' } }, /SEGURIDAD.*GET \/api\/datos/],
  ['clave falsa del script aceptada', { '/api/estudio/recibir': { status: 200, texto: '{}' } }, /SEGURIDAD.*clave falsa/],
  ['privacidad sin servir', { '/privacidad.html': { status: 404, texto: '' } }, /privacidad no se sirve/],
];
for (const [nombre, cambios, patron] of casos) {
  const r = await corre(cambios);
  r.fallos.some(x => patron.test(x)) ? bien(`DETECTA: ${nombre}`) : mal(`NO detecta: ${nombre} — fallos: ${JSON.stringify(r.fallos)}`);
}
{
  const r = await corre({}, '2.0.41');
  r.fallos.length === 0 && r.avisos.some(x => /sin publicar/.test(x)) ? bien('código más nuevo que producción: aviso (no fallo) de "hay cambios sin publicar"') : mal(`versionRepo: ${JSON.stringify(r)}`);
  const s = await corre(salud({ estudio: 'sin script instalado' }));
  s.fallos.length === 0 && s.avisos.some(x => /ningún script/.test(x)) ? bien('sin script instalado: aviso, no fallo') : mal('sin script debía ser aviso');
}
{
  const md = informe({ fallos: ['algo falla'], avisos: ['ojo'], bien: ['esto va'] }, 'https://x', new Date('2026-11-05T10:00:00Z'));
  /🔴 FALLA/.test(md) && /❌ algo falla/.test(md) && /⚠️ ojo/.test(md) && /2026-11-05 10:00 UTC/.test(md) ? bien('el informe es legible: estado, fallos, avisos y hora') : mal('informe mal formado');
}

console.log(fallos ? `\n${fallos} fallo(s)` : '\ntodo bien');
process.exit(fallos ? 1 : 0);
