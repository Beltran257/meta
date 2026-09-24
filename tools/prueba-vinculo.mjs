/* ===========================================================================
   PRUEBA DEL VÍNCULO DEL STATE (entrar con Google) — sin red: Google se
   simula. Lo que importa comprobar, por este orden:

     1. Al salir hacia Google se pone la cookie meta_oauth con el MISMO state
        que va en la URL, y se guarda si venía de la app instalada.
     2. A la vuelta se anota si la cookie volvió y si coincide.
     3. Y sobre todo: SIN la cookie se sigue entrando igual. Esto está en
        observación (ver worker/vinculo.js); exigirla antes de saber qué hace
        el iPhone podía dejarle fuera.

   Uso:  node tools/prueba-vinculo.mjs
   =========================================================================== */
import worker from '../worker/index.js';
import { cookieVinculo, leeVinculo } from '../worker/vinculo.js';

let fallos = 0;
const mal = m => { console.log('❌ ' + m); fallos++; };
const bien = m => console.log('✅ ' + m);

function kvFalso(){
  const m = new Map();
  return {
    m,
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
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15';

// Google simulado: canje del code y perfil. Todo lo demás, sin red.
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.startsWith('https://oauth2.googleapis.com/token')) return Response.json({ access_token: 'at' });
  if (u.startsWith('https://www.googleapis.com/oauth2/v2/userinfo')) return Response.json({ id: 'g-123', email: 'b@ejemplo.es', name: 'B', verified_email: true });
  throw new Error('red no permitida en la prueba: ' + u);
};

async function salirHaciaGoogle(pwa){
  const r = await worker.fetch(new Request(`https://meta.beltranfersan.workers.dev/api/auth/google?recordar=1&pwa=${pwa}`,
    { headers: { 'User-Agent': IPHONE } }), env, ctx);
  const destino = new URL(r.headers.get('Location'));
  const state = destino.searchParams.get('state');
  return { r, state, nonce: state.slice(state.indexOf(':') + 1) };
}

async function volverDeGoogle(state, cookie){
  const cabeceras = { 'User-Agent': IPHONE };
  if (cookie) cabeceras.Cookie = cookie;
  return worker.fetch(new Request(`https://meta.beltranfersan.workers.dev/api/oauth/google/callback?code=c&state=${encodeURIComponent(state)}`,
    { headers: cabeceras }), env, ctx);
}

const ultima = async () => (await env.META_DATOS.get('oauth:vinculo', 'json') || []).at(-1);

/* --- 1. la salida pone la cookie con el mismo state ------------------------ */
{
  const { r, nonce } = await salirHaciaGoogle(1);
  const puesta = r.headers.get('Set-Cookie') || '';
  const valor = leeVinculo(new Request('https://x/', { headers: { Cookie: puesta.split(';')[0] } }));
  if (r.status === 302 && valor === nonce) bien('al salir hacia Google se pone meta_oauth con el mismo state de la URL');
  else mal(`salida: ${r.status}, cookie ${JSON.stringify(puesta)} frente a state ${nonce}`);
  if (/HttpOnly/.test(puesta) && /Secure/.test(puesta) && /SameSite=Lax/.test(puesta) && /Path=\/api\/oauth\/google/.test(puesta)) {
    bien('la cookie es HttpOnly, Secure, Lax y solo para la vuelta');
  } else mal(`atributos de la cookie: ${puesta}`);
}

/* --- 2. vuelta CON la cookie: entra y se anota que volvió ------------------- */
{
  const { state, nonce } = await salirHaciaGoogle(1);
  const r = await volverDeGoogle(state, `otra=1; ${cookieVinculo(nonce).split(';')[0]}`);
  const e = await ultima();
  if (r.headers.get('Location')?.endsWith('/?entrar=ok')) bien('con la cookie se entra');
  else mal(`con la cookie no entra: ${r.headers.get('Location')}`);
  if (e?.vuelve && e?.coincide && e?.pwa && e?.aparato === 'iOS') bien('se anota: iPhone, app instalada, la cookie volvió y coincide');
  else mal(`anotación con cookie: ${JSON.stringify(e)}`);
}

/* --- 3. vuelta SIN la cookie: entra igual (observación, no bloqueo) --------- */
{
  const { state } = await salirHaciaGoogle(1);
  const r = await volverDeGoogle(state, null);
  const e = await ultima();
  if (r.headers.get('Location')?.endsWith('/?entrar=ok')) bien('sin la cookie se sigue entrando: todavía no se exige');
  else mal(`sin la cookie ya no entra: ${r.headers.get('Location')}`);
  if (e && !e.vuelve && !e.coincide) bien('y queda anotado que la cookie no volvió');
  else mal(`anotación sin cookie: ${JSON.stringify(e)}`);
}

/* --- 4. lo que ya se exigía sigue exigiéndose ------------------------------ */
{
  const r = await volverDeGoogle('login1:' + 'a'.repeat(32), null);
  r.headers.get('Location')?.endsWith('/?entrar=error') ? bien('un state que la app no emitió sigue rechazándose')
    : mal(`state inventado: ${r.headers.get('Location')}`);
}

/* --- 5. solo se guardan las últimas 10 ------------------------------------- */
{
  for (let i = 0; i < 12; i++){ const { state } = await salirHaciaGoogle(0); await volverDeGoogle(state, null); }
  const lista = await env.META_DATOS.get('oauth:vinculo', 'json');
  lista.length === 10 ? bien('oauth:vinculo guarda solo las 10 últimas') : mal(`oauth:vinculo tiene ${lista.length}`);
}

console.log(fallos ? `\n${fallos} fallo(s)` : '\ntodo bien');
process.exit(fallos ? 1 : 0);
