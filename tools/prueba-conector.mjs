/* ===========================================================================
   PRUEBA DE LA PUERTA DEL CONECTOR — sin red. Un conector de lectura (el de
   Claude) llama a /api/conector/* por service binding, y esa puerta tiene que
   cerrarse en cada uno de sus tres pasos: origen interno, testigo de conector
   contra `cuentas` y permiso de la acción. Solo lectura, con el espacio de la
   cuenta del testigo y sin crearlo si no existe.

   Datos de ejemplo, de ninguna persona real.

   Uso:  node tools/prueba-conector.mjs
   =========================================================================== */
import { atiendeConector, espacioDe, MAX_FECHAS } from '../worker/conector.js';

let fallos = 0;
const mal = m => { console.log('❌ ' + m); fallos++; };
const bien = m => console.log('✅ ' + m);
const comprueba = (cond, m) => (cond ? bien(m) : mal(m));

const TESTIGO = 'cx_' + 'a'.repeat(64);
// Un miércoles: 2026-11-11. Se fija la hora para que la prueba no dependa del día en que corre.
const AHORA = Date.parse('2026-11-11T10:00:00Z');

const BUZON = {
  duenyo: 'u-1', codigoSecreto: 'NO-DEBE-SALIR',
  claves: {
    asignaturas: { datos: [{ id: 'a1', nombre: 'Asignatura Uno' }, { id: 'a2', nombre: 'Asignatura Dos' }] },
    horario: { datos: { franjas: [{ ini: '08:15', fin: '09:10' }, { ini: '09:10', fin: '10:05' }], dias: { miercoles: ['a1', 'a2'], jueves: [null, 'a1'] } } },
    tareas: { datos: [
      { id: 't1', tipo: 'examen', titulo: 'Examen de prueba', asignaturaId: 'a1', fecha: '2026-11-20', estado: 'pendiente' },
      { id: 't2', tipo: 'examen', titulo: 'Examen ya hecho', asignaturaId: 'a2', fecha: '2026-11-25', estado: 'hecha' },
      { id: 't3', tipo: 'tarea', titulo: 'Tarea atrasada', asignaturaId: 'a2', fecha: '2026-11-09', estado: 'pendiente' },
      { id: 't4', tipo: 'tarea', titulo: 'Tarea sin hacer', asignaturaId: 'a1', fecha: '2026-12-01', estado: 'pendiente' },
    ] },
    sesiones: { datos: [] },
  },
};

/** KV de mentira que cuenta las escrituras y anota qué se leyó. */
function kvFalso(datos = {}) {
  const m = new Map(Object.entries(datos).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  return {
    escrituras: 0, lecturas: [],
    async get(k, tipo) { this.lecturas.push(k); const v = m.get(k); if (v === undefined) return null; return tipo === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { this.escrituras++; m.set(k, String(v)); },
    async delete(k) { this.escrituras++; m.delete(k); },
  };
}

function cuentasFalso({ uid = 'u-1', email = 'persona@ejemplo.com', permisos = ['meta:hoy', 'meta:agenda', 'meta:dias'], estado = 200, cae = false } = {}) {
  const llamadas = [];
  return {
    llamadas,
    async fetch(url, init) {
      llamadas.push(url);
      if (cae) throw new Error('sin red');
      if (estado !== 200) return new Response('{}', { status: estado });
      const { testigo } = JSON.parse(init.body);
      if (testigo !== TESTIGO) return new Response('{}', { status: 401 });
      return Response.json({ usuario: { uid, email }, permisos });
    },
  };
}

const entorno = (cuentas, extra = {}) => ({
  CUENTAS: cuentas,
  META_DATOS: kvFalso({
    'usuario:u-1': { id: 'u-1', email: 'persona@ejemplo.com', espacio: 'ABCD2345' },
    'email:persona@ejemplo.com': 'u-1',
    'sync:ABCD2345': BUZON,
    ...extra,
  }),
});
const interna = (extra = {}) => ({ 'X-Conector': TESTIGO, ...extra });
async function llama(env, ruta, { cabeceras = {}, metodo = 'GET', cuerpo, alDia = null } = {}) {
  const url = new URL('https://meta.beltranfersan.workers.dev' + ruta);
  const body = cuerpo === undefined ? undefined : typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
  return await atiendeConector(new Request(url, { method: metodo, headers: cabeceras, body }), url, env, AHORA, alDia);
}

/* --- 1. origen ---------------------------------------------------------------------- */
{
  const c = cuentasFalso(); const env = entorno(c);
  const r = await llama(env, '/api/conector/hoy', { cabeceras: interna({ 'CF-Connecting-IP': '203.0.113.9' }) });
  comprueba(r.estado === 403 && c.llamadas.length === 0 && env.META_DATOS.lecturas.length === 0, 'Desde internet (CF-Connecting-IP): 403, sin preguntar a cuentas ni leer KV');
  const r2 = await llama(env, '/api/conector/hoy', { cabeceras: interna({ 'cf-ray': 'abc123' }) });
  comprueba(r2.estado === 403 && c.llamadas.length === 0, 'Con cf-ray (también viene de fuera): 403');
}

/* --- 2. testigo ------------------------------------------------------------------------- */
{
  const c = cuentasFalso(); const env = entorno(c);
  const sin = await llama(env, '/api/conector/hoy');
  comprueba(sin.estado === 401 && c.llamadas.length === 0, 'Sin testigo: 401 y sin preguntar a cuentas');
  const normal = await llama(env, '/api/conector/hoy', { cabeceras: { 'X-Conector': 'b'.repeat(64) } });
  comprueba(normal.estado === 401 && c.llamadas.length === 0, 'Un testigo de sesión normal no vale en la puerta (se rechaza por su forma)');
  const cookie = await llama(env, '/api/conector/hoy', { cabeceras: { Cookie: 'meta_ses=' + 'b'.repeat(64), Authorization: 'Bearer ' + 'b'.repeat(64) } });
  comprueba(cookie.estado === 401, 'Una cookie o un Bearer de sesión tampoco abren la puerta');
  const otro = await llama(env, '/api/conector/hoy', { cabeceras: { 'X-Conector': 'cx_' + 'c'.repeat(64) } });
  comprueba(otro.estado === 401, 'Un testigo que cuentas no reconoce: 401');
  const caida = await llama(entorno(cuentasFalso({ cae: true })), '/api/conector/hoy', { cabeceras: interna() });
  comprueba(caida.estado === 503, 'Si cuentas no contesta: 503, no un permiso concedido');
  const rota = await llama(entorno(cuentasFalso({ estado: 500 })), '/api/conector/hoy', { cabeceras: interna() });
  comprueba(rota.estado === 503, 'Si cuentas responde 500: 503');
}

/* --- 3. permiso ---------------------------------------------------------------------------- */
{
  const env = entorno(cuentasFalso({ permisos: ['meta:agenda', 'meta:dias'] }));
  const r = await llama(env, '/api/conector/hoy', { cabeceras: interna() });
  comprueba(r.estado === 403 && env.META_DATOS.lecturas.length === 0, 'Con meta:hoy apagado: 403, sin leer el buzón');
  const r2 = await llama(entorno(cuentasFalso({ permisos: ['meta:hoy'] })), '/api/conector/agenda', { cabeceras: interna() });
  comprueba(r2.estado === 403, 'Cada acción tiene el suyo: con solo meta:hoy, la agenda da 403');
  const r3 = await llama(entorno(cuentasFalso({ permisos: ['salud:resumen', 'bolsa:cartera'] })), '/api/conector/dias?fechas=2026-11-11', { cabeceras: interna() });
  comprueba(r3.estado === 403, 'El permiso de otra app no sirve');
}

/* --- 4. lo que lee --------------------------------------------------------------------------- */
{
  const c = cuentasFalso(); const env = entorno(c);
  const hoy = await llama(env, '/api/conector/hoy', { cabeceras: interna() });
  const h = hoy.cuerpo?.hoy;
  comprueba(hoy.estado === 200 && h.fecha === '2026-11-11' && h.horarioHoy.length === 2 && h.horarioHoy[0].asignatura === 'Asignatura Uno', 'meta:hoy — el horario del día, con el nombre de cada asignatura');
  comprueba(h.proximoExamen?.titulo === 'Examen de prueba' && h.proximoExamen.dias === 9, 'meta:hoy — el próximo examen (el ya hecho no cuenta) y a cuántos días está');
  comprueba(h.tareasProximas.length === 1 && h.tareasProximas[0].atrasada === true, 'meta:hoy — las tareas que vencen o van atrasadas');

  const ag = await llama(env, '/api/conector/agenda', { cabeceras: interna() });
  comprueba(ag.estado === 200 && ag.cuerpo.agenda.examenes.length === 1 && ag.cuerpo.agenda.tareas.length === 2, 'meta:agenda — un examen pendiente y las dos tareas sin hacer');
  comprueba(ag.cuerpo.agenda.tareas[0].titulo === 'Tarea atrasada' && ag.cuerpo.agenda.tareas[0].atrasada && !ag.cuerpo.agenda.tareas[1].atrasada, 'meta:agenda — ordenadas por fecha, con la atrasada marcada');

  const dias = await llama(env, '/api/conector/dias?fechas=2026-11-11,2026-11-12', { cabeceras: interna() });
  comprueba(dias.estado === 200 && Object.keys(dias.cuerpo.dias).join() === '2026-11-11,2026-11-12' && dias.cuerpo.dias['2026-11-12'].primera_clase === '09:10', 'meta:dias — datos por fecha (primera clase del jueves: 09:10)');

  comprueba(!JSON.stringify([hoy, ag, dias]).includes('NO-DEBE-SALIR'), 'Lo que no es de la agenda (códigos, dueño) no sale');
  comprueba(env.META_DATOS.escrituras === 0, 'La puerta no escribe nada en KV');
  comprueba(c.llamadas.every(u => u === 'https://cuentas.beltranfersan.workers.dev/api/identidad/conector/verificar'), 'A cuentas solo se le llama por conector/verificar');
}

/* --- 5. fechas ------------------------------------------------------------------------------------ */
{
  const env = entorno(cuentasFalso());
  for (const q of ['', '?fechas=', '?fechas=ayer', '?fechas=2026-11-11,mañana', '?fechas=2026-1-1']) {
    const r = await llama(env, `/api/conector/dias${q}`, { cabeceras: interna() });
    comprueba(r.estado === 400, `dias${q || ' sin fechas'}: 400`);
  }
  const muchas = Array.from({ length: MAX_FECHAS + 1 }, (_, i) => `2026-01-${String((i % 28) + 1).padStart(2, '0')}`).join(',');
  comprueba((await llama(env, `/api/conector/dias?fechas=${muchas}`, { cabeceras: interna() })).estado === 400, `Más de ${MAX_FECHAS} fechas: 400`);
  const tope = Array.from({ length: MAX_FECHAS }, (_, i) => `2026-01-${String((i % 28) + 1).padStart(2, '0')}`).join(',');
  comprueba((await llama(env, `/api/conector/dias?fechas=${tope}`, { cabeceras: interna() })).estado === 200, `${MAX_FECHAS} fechas (el tope) valen`);
}

/* --- 6. el espacio se busca sin crearlo ------------------------------------------------------------ */
{
  const env = entorno(cuentasFalso({ uid: 'u-nuevo', email: 'nueva@ejemplo.com' }));
  const r = await llama(env, '/api/conector/hoy', { cabeceras: interna() });
  comprueba(r.estado === 404 && env.META_DATOS.escrituras === 0, 'Una cuenta que nunca entró en meta: 404, sin crearle buzón ni usuario');
  comprueba(env.META_DATOS.lecturas.every(k => k !== 'sync:ABCD2345'), 'Y no abre el buzón de otra cuenta');
  // Reconciliado por correo, como la entrada normal: otro uid con el correo de la cuenta existente.
  const porCorreo = entorno(cuentasFalso({ uid: 'u-otro-id', email: 'Persona@Ejemplo.com' }));
  const r2 = await llama(porCorreo, '/api/conector/hoy', { cabeceras: interna() });
  comprueba(r2.estado === 200, 'Un uid distinto con el mismo correo (mayúsculas aparte) llega al mismo espacio, como en la entrada normal');
  comprueba(await espacioDe(porCorreo, { uid: 'u-1', email: '' }) === 'ABCD2345', 'espacioDe: por uid, si no hay correo');
  const conUrl = await llama(entorno(cuentasFalso({ uid: 'u-nuevo', email: 'nueva@ejemplo.com' }), { 'usuario:u-ajeno': { id: 'u-ajeno', espacio: 'ZZZZ9999' }, 'sync:ZZZZ9999': BUZON }),
    '/api/conector/hoy?uid=u-ajeno&espacio=ZZZZ9999&codigo=ZZZZ9999', { cabeceras: interna() });
  comprueba(conUrl.estado === 404, 'Un uid o un código en la URL no cambian de quién son los datos');
}

/* --- 7. métodos y rutas ------------------------------------------------------------------------------ */
{
  const env = entorno(cuentasFalso());
  comprueba((await llama(env, '/api/conector/hoy', { cabeceras: interna(), metodo: 'POST' })).estado === 405, 'POST: 405');
  comprueba((await llama(env, '/api/conector/borrar-todo', { cabeceras: interna(), metodo: 'POST' })).estado === 404, 'Una ruta que no existe: 404');
  comprueba((await llama(env, '/api/conector/borrar', { cabeceras: interna() })).estado === 405, 'Una escritura por GET: 405');
}

/* --- 8. escrituras (fase 4 de Centralita) -------------------------------------------------------- */
const ESCRITURAS = ['meta:apuntar', 'meta:marcar-hecha', 'meta:mover-fecha', 'meta:borrar', 'meta:deshacer'];
const todas = () => cuentasFalso({ permisos: ['meta:hoy', 'meta:agenda', 'meta:dias', ...ESCRITURAS] });
const escribe = (env, accion, cuerpo, extra = {}) => llama(env, `/api/conector/${accion}`, { cabeceras: interna(), metodo: 'POST', cuerpo, ...extra });
const tareasDe = async env => (await env.META_DATOS.get('sync:ABCD2345', 'json')).claves.tareas.datos;
const examen = { titulo: 'Examen de ejemplo', fecha: '2026-12-03', tipo: 'examen', asignatura: 'asignatura uno' };
{
  // Las escrituras nacen apagadas: con solo las lecturas, todas dan 403 sin tocar nada.
  const env = entorno(cuentasFalso());
  let ninguna = true;
  for (const a of ['apuntar', 'hecha', 'mover', 'borrar', 'restaurar']) ninguna = ninguna && (await escribe(env, a, { id: 't1' })).estado === 403;
  comprueba(ninguna && env.META_DATOS.escrituras === 0 && !env.META_DATOS.lecturas.includes('sync:ABCD2345'), 'Escrituras apagadas: 403 en las cinco, sin leer ni escribir el buzón');
  const fuera = await escribe(entorno(todas()), 'apuntar', examen, { cabeceras: interna({ 'CF-Connecting-IP': '203.0.113.9' }) });
  comprueba(fuera.estado === 403, 'Una escritura desde internet: 403');
  const otra = await escribe(entorno(cuentasFalso({ permisos: ['meta:apuntar'] })), 'borrar', { id: 't1' });
  comprueba(otra.estado === 403, 'Cada escritura tiene su permiso: con solo meta:apuntar, borrar da 403');
}
{
  const env = entorno(todas());
  const avisos = [];
  const r = await escribe(env, 'apuntar', examen, { alDia: (esp, b) => avisos.push([esp, b.claves.tareas.datos.length]) });
  const t = r.cuerpo?.despues;
  comprueba(r.estado === 200 && r.cuerpo.antes === null && t?.tipo === 'examen' && t.asignaturaId === 'a1' && t.origen === 'claude' && t.mod === AHORA, 'apuntar: examen nuevo, con su asignatura buscada por nombre (sin tildes ni mayúsculas) y su fecha');
  comprueba(env.META_DATOS.escrituras === 2 && (await env.META_DATOS.get('conector:bandeja:ABCD2345', 'json')).tareas[0].id === t.id, 'apuntar: dos escrituras de KV, la bandeja y el buzón');
  comprueba((await tareasDe(env)).length === 5 && (await tareasDe(env)).some(x => x.id === 't1'), 'apuntar: el buzón conserva las tareas que había');
  comprueba(avisos.length === 1 && avisos[0][0] === 'ABCD2345', 'apuntar: los calendarios se ponen al día con el espacio de la cuenta');
  const repe = await escribe(env, 'apuntar', examen);
  comprueba(repe.estado === 200 && repe.cuerpo.nota && env.META_DATOS.escrituras === 2, 'Lo mismo dos veces no se apunta dos veces (ni escribe)');

  const malas = [
    [{ ...examen, asignatura: 'Asignatura' }, /varias/], [{ ...examen, asignatura: 'Química' }, /Asignatura Uno, Asignatura Dos/],
    [{ ...examen, fecha: '2026-02-30' }, /fecha/], [{ ...examen, titulo: '   ' }, /título/],
  ];
  let bienRechazadas = true;
  for (const [c, re] of malas) { const x = await escribe(env, 'apuntar', c); bienRechazadas = bienRechazadas && x.estado === 400 && re.test(x.cuerpo.error); }
  comprueba(bienRechazadas && env.META_DATOS.escrituras === 2, 'apuntar: asignatura ambigua o inexistente, fecha imposible o sin título: 400 explicado y sin escribir');
  const largo = await escribe(env, 'apuntar', { titulo: 'x'.repeat(300), fecha: '2026-12-04' });
  const control = await escribe(env, 'apuntar', { titulo: '\u0007Leer\n\ncapítulo\u001b 3', fecha: '2026-12-04' });
  comprueba(largo.cuerpo.despues.titulo.length === 120 && control.cuerpo.despues.titulo === 'Leer capítulo 3' && largo.cuerpo.despues.tipo === 'tarea' && largo.cuerpo.despues.asignaturaId === '', 'apuntar: título recortado a 120 y sin caracteres de control; sin tipo es tarea; sin asignatura, ninguna');

  const h = await escribe(env, 'hecha', { id: 't1' });
  comprueba(h.estado === 200 && h.cuerpo.antes.estado === 'pendiente' && h.cuerpo.despues.estado === 'hecha' && h.cuerpo.despues.hecho === true, 'hecha: devuelve antes y después');
  const m = await escribe(env, 'mover', { id: 't4', fecha: '2026-12-05' });
  comprueba(m.cuerpo.antes.fecha === '2026-12-01' && (await tareasDe(env)).find(x => x.id === 't4').fecha === '2026-12-05', 'mover: la fecha cambia en el buzón');
  const b = await escribe(env, 'borrar', { id: 't3' });
  const ag = await llama(env, '/api/conector/agenda', { cabeceras: interna() });
  comprueba(b.cuerpo.despues === null && !(await tareasDe(env)).some(x => x.id === 't3') && !ag.cuerpo.agenda.tareas.some(x => x.id === 't3'), 'borrar: desaparece del buzón y de la agenda');
  comprueba((await env.META_DATOS.get('sync:ABCD2345', 'json')).claves.borrados.datos.t3 > 0, 'borrar: deja lápida (si no, un aparato la resucitaría)');
  const d = await escribe(env, 'restaurar', { tarea: b.cuerpo.antes });
  const ag2 = await llama(env, '/api/conector/agenda', { cabeceras: interna() });
  comprueba(d.estado === 200 && ag2.cuerpo.agenda.tareas.some(x => x.id === 't3' && x.titulo === 'Tarea atrasada'), 'restaurar: deshacer un borrado la devuelve tal cual');
  const d2 = await escribe(env, 'restaurar', { tarea: m.cuerpo.antes });
  comprueba((await tareasDe(env)).find(x => x.id === 't4').fecha === '2026-12-01', 'restaurar: deshacer un cambio vuelve al «antes»');
  comprueba(ag2.cuerpo.agenda.examenes.every(x => x.id) && ag2.cuerpo.agenda.tareas.every(x => x.id), 'meta:agenda da el id de cada tarea (lo necesita Claude para cambiarla)');

  comprueba((await escribe(env, 'hecha', { id: 'no-existe' })).estado === 404 && (await escribe(env, 'borrar', {})).estado === 400, 'Un id que no existe: 404; sin id: 400');
  comprueba((await escribe(env, 'restaurar', { tarea: { id: 'nunca', titulo: 'x', fecha: '2026-12-01' } })).estado === 404, 'restaurar no inventa tareas que nunca existieron');
  comprueba((await escribe(env, 'apuntar', 'esto no es json')).estado === 400 && (await escribe(env, 'apuntar', { titulo: 'x'.repeat(20000), fecha: '2026-12-01' })).estado === 413, 'Cuerpo que no es JSON: 400; demasiado grande: 413');
}
{
  // Lo que apuntó Claude está en la bandeja aunque un aparato lo haya pisado en el buzón: Claude lo sigue viendo.
  const pisada = { id: 'c9', tipo: 'tarea', titulo: 'Apuntada por Claude', fecha: '2026-11-30', estado: 'pendiente', mod: AHORA };
  const env = entorno(todas(), { 'conector:bandeja:ABCD2345': { tareas: [pisada], borrados: { t4: AHORA } } });
  const ag = (await llama(env, '/api/conector/agenda', { cabeceras: interna() })).cuerpo.agenda;
  comprueba(ag.tareas.some(x => x.id === 'c9') && !ag.tareas.some(x => x.id === 't4'), 'Las lecturas unen la bandeja: lo último de Claude se ve aunque el buzón se haya pisado');
}
{
  // Un uid o un espacio en el cuerpo no cambian dónde se escribe.
  const env = entorno(cuentasFalso({ uid: 'u-nuevo', email: 'nueva@ejemplo.com', permisos: ESCRITURAS }), { 'usuario:u-ajeno': { id: 'u-ajeno', espacio: 'ZZZZ9999' }, 'sync:ZZZZ9999': BUZON });
  const r = await escribe(env, 'apuntar', { ...examen, uid: 'u-ajeno', espacio: 'ZZZZ9999' });
  comprueba(r.estado === 404 && env.META_DATOS.escrituras === 0, 'Un uid o un espacio en el cuerpo no cambian de quién son los datos (cuenta sin meta: 404, sin escribir)');
}

console.log(`\n${fallos} fallos`);
if (fallos) process.exit(1);
