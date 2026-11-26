/* ===========================================================================
   PRUEBA DE LA UNIÓN DE TAREAS POR ELEMENTO — sin red y sin navegador.

   Antes, `tareas` se pisaba entera: ganaba la sección más nueva. Si dos
   escribían a la vez (dos aparatos, o un aparato y el conector de Claude), lo
   del primero desaparecía sin aviso. Aquí se comprueba que ya no:
   1. la regla pura (core/union.js): por id gana la fecha más alta y las
      lápidas borran de verdad, también al deshacer;
   2. el aparato (core/store.js) pone fecha y lápida él solo al guardar;
   3. el servidor (worker/sync.js) une, y una app vieja no puede borrar;
   4. dos aparatos de verdad (cada uno con su almacenamiento) escribiendo a la
      vez, contra el servidor: al final los dos tienen lo de los dos;
   5. «no pisa datos»: lo que escribe Claude por la bandeja sobrevive aunque un
      aparato, leyendo una copia vieja de KV, pise el buzón.
   Datos de ejemplo, inventados: este repo es público.

   Uso:  node tools/prueba-union.mjs
   =========================================================================== */
import { unirTareas, unirLapidas, sellarTareas, sellarAntiguas, huella, VIDA_LAPIDA } from '../app/js/core/union.js';
import { fusionar, claveBandeja } from '../worker/sync.js';
import { escribir } from '../worker/escrituras.js';

let fallos = 0;
const mal = m => { console.log('❌ ' + m); fallos++; };
const bien = m => console.log('✅ ' + m);
const igual = (que, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? bien(que) : mal(`${que}\n     salió:  ${JSON.stringify(a)}\n     tocaba: ${JSON.stringify(b)}`));
const ids = l => (l || []).map(t => t.id).sort();
const de = (l, id) => (l || []).find(t => t.id === id);

/* ------------------------------ 1. la regla -------------------------------- */
{
  const vieja = { id: 'a', titulo: 'Ejercicios tema 2', mod: 100 };
  const nueva = { id: 'a', titulo: 'Ejercicios tema 2 y 3', mod: 200 };
  igual('por id gana la fecha más alta, venga en el orden que venga',
    [unirTareas([[vieja], [nueva]])[0].titulo, unirTareas([[nueva], [vieja]])[0].titulo], ['Ejercicios tema 2 y 3', 'Ejercicios tema 2 y 3']);
  igual('a igualdad de fecha (tareas antiguas, sin mod) gana la lista que va después',
    unirTareas([[{ id: 'a', titulo: 'uno' }], [{ id: 'a', titulo: 'dos' }]])[0].titulo, 'dos');
  igual('se unen las de las dos listas', ids(unirTareas([[{ id: 'a' }], [{ id: 'b' }]])), ['a', 'b']);
  igual('una lápida más nueva que la tarea la borra', unirTareas([[vieja]], { a: 150 }), []);
  igual('una tarea cambiada DESPUÉS de la lápida (deshacer) vuelve', ids(unirTareas([[nueva]], { a: 150 })), ['a']);
  igual('lápida y fecha iguales: borrada (borrar gana el empate)', unirTareas([[vieja]], { a: 100 }), []);
  igual('basura en las listas no rompe nada', ids(unirTareas([null, [null, 3, { sinId: 1 }, { id: 'x' }], 'no'])), ['x']);
  const ahora = 10 * VIDA_LAPIDA;
  igual('lápidas: por id la más alta, y las caducadas se van',
    unirLapidas([{ a: ahora - 5, b: 1 }, { a: ahora - 1, c: 'mal' }, null], ahora), { a: ahora - 1 });
  // Da igual el orden y repetir: es lo que permite que la bandeja se una una y otra vez.
  const A = [{ id: 'a', mod: 3 }, { id: 'b', mod: 1 }], B = [{ id: 'b', mod: 2 }, { id: 'c', mod: 1 }], L = { c: 5 };
  igual('unir es conmutativo e idempotente',
    [huella(unirTareas([A, B], L)), huella(unirTareas([B, A], L)), huella(unirTareas([unirTareas([A, B], L), B, A], L))],
    Array(3).fill(huella([{ id: 'a', mod: 3 }, { id: 'b', mod: 2 }])));
}

/* --------------------------- 2. sellar al guardar --------------------------- */
{
  const vieja = [{ id: 'a', titulo: 'Leer capítulo', mod: 50 }, { id: 'b', titulo: 'Resumen' }, { id: 'c', titulo: 'Esquema', mod: 70 }];
  const nueva = [{ id: 'a', titulo: 'Leer capítulo' }, { id: 'b', titulo: 'Resumen corto' }, { id: 'd', titulo: 'Nueva' }];
  const { lista, lapidas } = sellarTareas(vieja, nueva, 1000);
  igual('sin cambios conserva su fecha; cambiada o nueva lleva la de ahora',
    lista.map(t => [t.id, t.mod]), [['a', 50], ['b', 1000], ['d', 1000]]);
  igual('lo que desaparece deja lápida', lapidas, { c: 1000 });
  igual('con el reloj atrasado, la fecha nueva sigue por encima de la anterior',
    [sellarTareas([{ id: 'a', t: 1, mod: 5000 }], [{ id: 'a', t: 2 }], 1000).lista[0].mod,
      sellarTareas([{ id: 'a', mod: 5000 }], [], 1000).lapidas.a], [5001, 5001]);
  igual('app vieja: lo que cambia toma la fecha de su sección; lo igual, la suya',
    sellarAntiguas([{ id: 'a', x: 1, mod: 9 }, { id: 'b', x: 1, mod: 9 }], [{ id: 'a', x: 1 }, { id: 'b', x: 2 }], 500).map(t => t.mod), [9, 500]);
}

/* ------------------------------ 3. el servidor ------------------------------ */
function kvFalso() {
  const m = new Map();
  return {
    m,
    async get(k, tipo) { const v = m.get(k); return v == null ? null : tipo === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, String(v)); },
    async list({ prefix = '' } = {}) { return { keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }; },
  };
}
const paquete = (tareas, borrados, ts, formato = 2) => ({ formato, claves: { tareas: { ts, datos: tareas }, ...(borrados ? { borrados: { ts, datos: borrados } } : {}) } });

{
  const kv = kvFalso();
  const T = Date.now() - 1000;   // fechas de verdad: una lápida de 1970 ya habría caducado
  await fusionar(kv, 'ESP', paquete([{ id: 'a', mod: T + 10 }, { id: 'b', mod: T + 10 }], {}, T + 10));
  // Un aparato con la lista de antes y una tarea nueva, con su sección MÁS NUEVA:
  let b = await fusionar(kv, 'ESP', paquete([{ id: 'c', mod: T + 20 }], {}, T + 20));
  igual('el servidor une: una sección más nueva ya no se come lo que no trae', ids(b.claves.tareas.datos), ['a', 'b', 'c']);
  b.claves.tareas.ts > T + 20 ? bien('lo unido sube la fecha por encima de las dos (así lo adoptan todos)') : mal(`fecha ${b.claves.tareas.ts}`);
  b = await fusionar(kv, 'ESP', paquete(b.claves.tareas.datos, {}, b.claves.tareas.ts));
  igual('si el aparato ya lo tiene todo, la fecha no sube más', b.claves.tareas.ts, T + 21);
  b = await fusionar(kv, 'ESP', paquete([], { a: T + 30 }, T + 30));
  igual('una lápida borra en el servidor', ids(b.claves.tareas.datos), ['b', 'c']);
  b = await fusionar(kv, 'ESP', { claves: { tareas: { ts: T + 25, datos: [{ id: 'a', mod: T + 10 }, { id: 'b', mod: T + 10 }] } } });
  igual('una app vieja no resucita lo borrado después de su último cambio, ni puede borrar', ids(b.claves.tareas.datos), ['b', 'c']);
  b = await fusionar(kv, 'ESP', { claves: { tareas: { ts: T + 40, datos: [{ id: 'a', mod: T + 10, x: 1 }, { id: 'b', mod: T + 10 }] } } });
  igual('si la cambió después del borrado, vuelve con la fecha de su sección (lo que haría la regla vieja)',
    [ids(b.claves.tareas.datos), de(b.claves.tareas.datos, 'a').mod], [['a', 'b', 'c'], T + 40]);
  b = await fusionar(kv, 'ESP', { formato: 2, claves: { perfil: { ts: T + 50, datos: { curso: '2º' } } } });
  igual('las demás secciones siguen con «gana la más nueva» y las tareas no se tocan',
    [b.claves.perfil.datos.curso, ids(b.claves.tareas.datos)], ['2º', ['a', 'b', 'c']]);
  const vacio = await fusionar(kvFalso(), 'OTRO', { formato: 2, claves: { perfil: { ts: 1, datos: {} } } });
  igual('un buzón sin tareas no estrena secciones vacías', [vacio.claves.tareas, vacio.claves.borrados], [undefined, undefined]);
}

/* ------------------ 4. dos aparatos de verdad, a la vez --------------------- */
/* Cada aparato es una copia aparte de core/store.js con su propio
   almacenamiento: así se prueba el código del aparato tal cual, no una copia. */
const almacenes = {};
async function aparato(nombre) {
  const m = new Map();
  almacenes[nombre] = {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
  };
  globalThis.localStorage = almacenes[nombre];
  const store = await import(`../app/js/core/store.js?${nombre}`);
  // Todo lo que hace el aparato, con SU almacenamiento puesto.
  return new Proxy(store, { get: (s, f) => (typeof s[f] === 'function' ? (...a) => { globalThis.localStorage = almacenes[nombre]; return s[f](...a); } : s[f]) });
}
{
  const kv = kvFalso();
  const movil = await aparato('movil'), tablet = await aparato('tablet');
  const sincroniza = async ap => ap.adoptar(await fusionar(kv, 'ESP', ap.instantaneas()));

  movil.guardar('tareas', [{ id: 'm1', titulo: 'Tarea del móvil', fecha: '2026-12-01' }]);
  tablet.guardar('tareas', [{ id: 't1', titulo: 'Tarea de la tablet', fecha: '2026-12-02' }]);
  await sincroniza(movil); await sincroniza(tablet); await sincroniza(movil);
  igual('cada aparato apunta una tarea sin ver la del otro: al final los dos tienen las dos',
    [ids(movil.leer('tareas', [])), ids(tablet.leer('tareas', []))], [['m1', 't1'], ['m1', 't1']]);

  // El móvil borra m1 y la tablet, sin enterarse, marca hecha t1.
  movil.guardar('tareas', movil.leer('tareas', []).filter(t => t.id !== 'm1'));
  tablet.guardar('tareas', tablet.leer('tareas', []).map(t => (t.id === 't1' ? { ...t, estado: 'hecha', hecho: true } : t)));
  await sincroniza(tablet); await sincroniza(movil); await sincroniza(tablet);
  igual('borrar en uno y cambiar otra en el otro: se borra la una y se queda el cambio de la otra',
    [movil.leer('tareas', []).map(t => [t.id, t.estado]), tablet.leer('tareas', []).map(t => [t.id, t.estado])],
    [[['t1', 'hecha']], [['t1', 'hecha']]]);
  'm1' in (tablet.leer('borrados', {})) ? bien('la lápida viaja al otro aparato') : mal('la tablet no recibió la lápida');

  // Un cambio hecho MIENTRAS la sincronización iba y venía no se pierde.
  const enviado = tablet.instantaneas();
  tablet.guardar('tareas', [...tablet.leer('tareas', []), { id: 't2', titulo: 'Apuntada a medio camino' }]);
  tablet.adoptar(await fusionar(kv, 'ESP', enviado));
  igual('lo apuntado mientras se sincronizaba sigue ahí al volver la respuesta', ids(tablet.leer('tareas', [])), ['t1', 't2']);
  await sincroniza(tablet); await sincroniza(movil);
  igual('… y llega al otro aparato en la siguiente', ids(movil.leer('tareas', [])), ['t1', 't2']);
}

/* --------- 5. «no pisa datos»: Claude y un aparato escriben a la vez --------- */
/* KV en dos sitios: Claude escribe desde EE. UU. y el aparato sincroniza desde
   Madrid, donde KV le sirve una copia de hace un rato. Sin la bandeja, el
   aparato pisa el buzón y lo que apuntó Claude desaparece. */
function kvDosSitios() {
  const real = kvFalso();
  const cache = new Map();   // lo que Madrid tiene guardado de antes
  const madrid = {
    async get(k, tipo) { const v = cache.has(k) ? cache.get(k) : real.m.get(k); return v == null ? null : tipo === 'json' ? JSON.parse(v) : v; },
    put: (k, v) => { cache.delete(k); return real.put(k, v); },
    list: o => real.list(o),
    // Como KV de verdad, también recuerda «esta clave no existe».
    congela(claves) { for (const k of claves) cache.set(k, real.m.get(k) ?? null); },
    caduca() { cache.clear(); },
  };
  return { real, madrid };
}
{
  const { real, madrid } = kvDosSitios();
  const movil = await aparato('movil-5');
  const sincroniza = async ap => ap.adoptar(await fusionar(madrid, 'ESP', ap.instantaneas()));
  movil.guardar('tareas', [{ id: 'm1', titulo: 'Repasar tema 4', fecha: '2026-12-01' }]);
  await sincroniza(movil);
  madrid.congela(['sync:ESP', claveBandeja('ESP')]);   // Madrid se queda con esta copia

  // Claude apunta un examen por la escritura real de la puerta (desde EE. UU., KV al día).
  const r = await escribir({ META_DATOS: real }, 'ESP', 'apuntar', { titulo: 'Examen de ejemplo', tipo: 'examen', fecha: '2026-12-03' });
  const c1 = r.cuerpo?.despues?.id;
  r.estado === 200 && c1 ? bien('Claude apunta el examen por la puerta') : mal(`escribir: ${JSON.stringify(r)}`);

  // El móvil cambia algo y sincroniza leyendo la copia VIEJA de Madrid: pisa el buzón.
  movil.guardar('tareas', movil.leer('tareas', []).map(t => ({ ...t, fecha: '2026-12-02' })));
  await sincroniza(movil);
  const pisado = !ids((await real.get('sync:ESP', 'json')).claves.tareas.datos).includes(c1);
  pisado ? bien('(escenario real: el aparato con la copia vieja pisa el buzón)') : mal('el escenario no reproduce el pisotón: la prueba no prueba nada');

  madrid.caduca();    // pasa el minuto: Madrid ya ve lo de verdad
  await sincroniza(movil);
  const buzon = await real.get('sync:ESP', 'json');
  igual('al siguiente sincronizar, el examen de Claude vuelve al buzón y llega al móvil, con el cambio del móvil intacto',
    [ids(buzon.claves.tareas.datos), ids(movil.leer('tareas', [])), de(movil.leer('tareas', []), 'm1')?.fecha],
    [[c1, 'm1'].sort(), [c1, 'm1'].sort(), '2026-12-02']);
}

console.log(fallos ? `\n${fallos} fallos` : '\ntodo bien');
process.exit(fallos ? 1 : 0);
