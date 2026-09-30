/* ===========================================================================
   PRUEBA DE LEER EL CALENDARIO DEL CENTRO (P5) — sin red, Microsoft simulado.
   Vigila: que solo se proponga lo que parece examen o entrega, que no salga
   nada más del calendario del instituto, que no se proponga lo que META mismo
   escribió (sería un bucle) y que lo importado no se reescriba en Outlook.

   Uso:  node tools/prueba-calendario-centro.mjs
   =========================================================================== */
import { candidatosDeEventos, eventosDelCentro, reconciliar } from '../worker/microsoft.js';

let fallos = 0;
const mal = m => { console.log('❌ ' + m); fallos++; };
const bien = m => console.log('✅ ' + m);
const ev = (id, subject, dia, extra = {}) => ({ id, subject, start: { dateTime: `${dia}T00:00:00.0000000` }, ...extra });

{
  const c = candidatosDeEventos([
    ev('1', 'Examen de Matemáticas II', '2026-10-20'),
    ev('2', 'Reunión de padres', '2026-10-21'),
    ev('3', 'Control de Historia — tema 3', '2026-10-15'),
    ev('4', 'Entrega del trabajo de Lengua', '2026-10-30'),
    ev('5', 'Examen: Física — Cinemática', '2026-11-02'),       // lo escribió META
    ev('6', 'Examen cancelado', '2026-11-03', { isCancelled: true }),
    ev('7', 'Excursión', '2026-11-04'),
    ev('8', 'Prueba de nivel', 'sin-fecha'),
  ], new Set(['9']));
  const ids = c.map(x => x.id).join(',');
  if (ids !== '3,1,4') mal(`los candidatos deberían ser 3,1,4 (por fecha) y son ${ids}`);
  else bien('solo se proponen exámenes y entregas, por fecha, sin ruido ni cancelados ni lo que escribió META');
  if (c.find(x => x.id === '1')?.fecha !== '2026-10-20' || c.find(x => x.id === '4')?.tipo !== 'entrega') mal('fecha o tipo mal calculados');
  else bien('la fecha es el día local y el tipo distingue examen de entrega');
  if (Object.keys(c[0]).sort().join() !== 'fecha,id,tipo,titulo') mal('salen campos de más del evento: ' + Object.keys(c[0]));
  else bien('de cada evento solo salen id, título, día y tipo');
  const propio = candidatosDeEventos([ev('9', 'Control de Química', '2026-10-10')], new Set(['9']));
  if (propio.length) mal('se propone un evento que META creó (está en msmap)');
  else bien('un evento de msmap no se propone aunque parezca un examen');
}

{
  const KV = new Map([
    ['ms:c1', JSON.stringify({ refresh_token: 'r', access_token: 'a', expira: Date.now() + 3600000 })],
    ['msmap:c1', JSON.stringify({ t1: 'propio-1' })],
  ]);
  const env = { META_DATOS: { get: async (k, t) => (KV.has(k) ? (t === 'json' ? JSON.parse(KV.get(k)) : KV.get(k)) : null), put: async (k, v) => KV.set(k, v), delete: async () => {} } };
  const llamadas = [];
  globalThis.fetch = async (url, init) => {
    llamadas.push([String(url), init?.method || 'GET']);
    return { ok: true, status: 200, json: async () => ({ value: [ev('x1', 'Examen de Latín', '2026-12-01'), ev('propio-1', 'Control de X', '2026-12-02')] }) };
  };
  const r = await eventosDelCentro(env, 'c1', new Date(2026, 9, 1));
  if (r.eventos?.length !== 1 || r.eventos[0].id !== 'x1') mal('eventosDelCentro no filtró lo propio: ' + JSON.stringify(r));
  else bien('eventosDelCentro descarta lo que está en msmap');
  const u = llamadas[0][0];
  if (!/calendarView/.test(u) || !u.includes('startDateTime=2026-10-01') || !u.includes('endDateTime=2027-03-30')) mal('la ventana pedida no es de hoy a 180 días: ' + u);
  else if (llamadas.some(([, m]) => m !== 'GET')) mal('leer el calendario hizo una escritura');
  else bien('pide de hoy a 180 días y solo lee (GET)');

  globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({}) });
  const denegado = await eventosDelCentro(env, 'c1', new Date(2026, 9, 1));
  if (denegado.status !== 409 || !/vuelve a conectar/.test(denegado.error)) mal('un 403 de Microsoft no da un mensaje útil');
  else bien('si Microsoft niega el permiso, el mensaje dice que hay que reconectar');

  const sin = await eventosDelCentro({ META_DATOS: { get: async () => null } }, 'nadie');
  if (sin.status !== 409) mal('sin conexión no devuelve 409'); else bien('sin Outlook conectado devuelve 409');
}

{
  const escrituras = [];
  const KV = new Map([['ms:c2', JSON.stringify({ refresh_token: 'r', access_token: 'a', expira: Date.now() + 3600000 })]]);
  const env = { META_DATOS: { get: async (k, t) => (KV.has(k) ? (t === 'json' ? JSON.parse(KV.get(k)) : KV.get(k)) : null), put: async (k, v) => KV.set(k, v) } };
  globalThis.fetch = async (url, init) => { escrituras.push(init?.method); return { ok: true, status: 200, json: async () => ({ id: 'nuevo' }) }; };
  await reconciliar(env, 'c2', { claves: { asignaturas: { datos: [] }, tareas: { datos: [
    { id: 'a', fecha: '2026-10-20', tipo: 'examen', titulo: 'Propio' },
    { id: 'b', fecha: '2026-10-21', tipo: 'examen', titulo: 'Importado', origenMs: 'x1' },
  ] } } });
  if (escrituras.filter(m => m === 'POST').length !== 1) mal(`debería crearse 1 evento (no el importado) y se crean ${escrituras.filter(m => m === 'POST').length}`);
  else bien('lo importado del calendario del centro no se reescribe en Outlook');
}

console.log(fallos ? `\n${fallos} fallo(s)` : '\ntodo bien');
process.exit(fallos ? 1 : 0);
