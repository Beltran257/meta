/* ===========================================================================
   PRUEBA DEL ENLACE DEL CALENDARIO — sin red. El feed ICS era /ics/<código
   del espacio>.ics, y ese código no se puede cambiar: un enlace escapado no
   se podía cortar. Se recorre de verdad, por worker.fetch con KV falso:
   entrar, pedir el enlace, cambiarlo, y que lo viejo deje de servir.

   Uso:  node tools/prueba-feed.mjs
   =========================================================================== */
import worker from '../worker/index.js';

let fallos = 0;
const mal = m => { console.log('❌ ' + m); fallos++; };
const bien = m => console.log('✅ ' + m);

function kvFalso(){
  const m = new Map();
  return {
    async get(k, tipo){ const v = m.get(k); if (v === undefined) return null; return tipo === 'json' ? JSON.parse(v) : v; },
    async put(k, v){ m.set(k, String(v)); },
    async delete(k){ m.delete(k); },
    async list({ prefix = '' } = {}){ return { keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; },
  };
}

const env = {
  META_DATOS: kvFalso(),
  GOOGLE_CLIENT_ID: 'cliente', GOOGLE_CLIENT_SECRET: 'secreto',
  LIMITE: { limit: async () => ({ success: true }) },
};
const ctx = { waitUntil(){} };
const O = 'https://meta.beltranfersan.workers.dev';
globalThis.fetch = async url => {
  const u = String(url);
  if (u.startsWith('https://oauth2.googleapis.com/token')) return Response.json({ access_token: 'at' });
  if (u.startsWith('https://www.googleapis.com/oauth2/v2/userinfo')) return Response.json({ id: 'g-1', email: 'b@ejemplo.es', name: 'B', verified_email: true });
  throw new Error('red no permitida en la prueba: ' + u);
};
const pide = (ruta, opciones = {}) => worker.fetch(new Request(O + ruta, opciones), env, ctx);

// Entrar de verdad (Google simulado) para tener una sesión y un espacio.
const salida = await pide('/api/auth/google?recordar=1');
const state = new URL(salida.headers.get('Location')).searchParams.get('state');
const vuelta = await pide(`/api/oauth/google/callback?code=c&state=${encodeURIComponent(state)}`);
const cookie = (vuelta.headers.get('Set-Cookie') || '').split(';')[0];
const yo = await (await pide('/api/auth/yo', { headers: { Cookie: cookie } })).json();
const codigo = yo?.usuario?.espacio;
if (!cookie || !codigo) { console.log('❌ la preparación no consiguió sesión y espacio'); process.exit(1); }

const conSesion = (ruta, metodo = 'GET') => pide(ruta, { method: metodo, headers: { Cookie: cookie, 'X-Meta': '1', 'Content-Type': 'application/json' }, body: metodo === 'GET' ? undefined : '{}' });
const estado = async ruta => (await pide(ruta)).status;

/* --- 1. hasta que se cambie, el antiguo con el código sigue sirviendo ------ */
(await estado(`/ics/${codigo}.ics`)) === 200
  ? bien('el enlace antiguo (con el código) sigue funcionando hasta que se cambie')
  : mal('el enlace antiguo dejó de funcionar sin que nadie lo cambiara');

/* --- 2. el enlace propio: no es el código, sirve y es estable -------------- */
const a = await (await conSesion('/api/ics')).json();
const a2 = await (await conSesion('/api/ics')).json();
if (a?.ruta && !a.ruta.includes(codigo) && /^\/ics\/f[0-9a-f]{32}\.ics$/.test(a.ruta)) bien('el enlace nuevo no lleva el código del espacio');
else mal(`enlace nuevo: ${JSON.stringify(a)}`);
a2?.ruta === a?.ruta ? bien('pedirlo dos veces da el mismo enlace') : mal('cada vez sale un enlace distinto');
const r1 = await pide(a.ruta);
r1.status === 200 && /text\/calendar/.test(r1.headers.get('Content-Type') || '') && (await r1.text()).includes('BEGIN:VCALENDAR')
  ? bien('el enlace nuevo sirve el calendario') : mal(`el enlace nuevo responde ${r1.status}`);

/* --- 3. cambiarlo corta el anterior Y el antiguo --------------------------- */
const b = await (await conSesion('/api/ics/renovar', 'POST')).json();
if (b?.ruta && b.ruta !== a.ruta && b.antiguoCerrado === true) bien('cambiar da un enlace nuevo');
else mal(`renovar: ${JSON.stringify(b)}`);
(await estado(a.ruta)) === 404 ? bien('el enlace anterior deja de funcionar al momento') : mal('el enlace anterior sigue sirviendo');
(await estado(`/ics/${codigo}.ics`)) === 404 ? bien('y el antiguo con el código también') : mal('el antiguo con el código sigue sirviendo tras cambiarlo');
(await estado(b.ruta)) === 200 ? bien('el nuevo sí sirve') : mal('el enlace recién cambiado no sirve');

/* --- 4. puertas ------------------------------------------------------------ */
(await pide('/api/ics')).status === 401 ? bien('sin sesión no se puede pedir el enlace') : mal('/api/ics responde sin sesión');
(await pide('/api/ics/renovar', { method: 'POST', headers: { Cookie: cookie } })).status === 400
  ? bien('cambiarlo sin la cabecera X-Meta rebota (corta-CSRF)') : mal('renovar sin X-Meta no rebota');
(await estado('/ics/f' + '0'.repeat(32) + '.ics')) === 404 ? bien('un enlace inventado da 404') : mal('un enlace inventado no da 404');
(await estado('/ics/<script>.ics')) === 400 ? bien('algo que no es ni enlace ni código da 400') : mal('basura en /ics/ no da 400');

console.log(fallos ? `\n${fallos} fallo(s)` : '\ntodo bien');
process.exit(fallos ? 1 : 0);
