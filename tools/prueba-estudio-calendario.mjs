/* ===========================================================================
   PRUEBA DEL ESTUDIO DESDE EL CALENDARIO — sin red y sin navegador.

   Vigila lo que haría mentir a las horas de estudio sin que se note:
   · que un bloque cuente solo si su tarea está marcada como hecha;
   · que cada título caiga en su asignatura ("historia del arte" no es
     Historia de España) y que lo dudoso se pregunte en vez de adivinarse;
   · que la logística (imprimir, grapar…) no sume como estudio;
   · que bloques hechos que se pisan no cuenten el tiempo dos veces, pero que
     ninguno se quede a 0 min: el tiempo común se reparte por igual;
   · que lo que él corrige a mano (y las reglas por título) mande.

   Uso:  node tools/prueba-estudio-calendario.mjs
   =========================================================================== */

const almacen = new Map();
globalThis.localStorage = {
  getItem: k => (almacen.has(k) ? almacen.get(k) : null),
  setItem: (k, v) => { almacen.set(k, String(v)); },
  removeItem: k => { almacen.delete(k); },
  clear: () => almacen.clear(),
};

const { asignaturaDeTitulo, esLogistica, tipoDeTitulo, sesionesDeBloques, inicioCurso, temaDeTitulo, repartirMinutos } =
  await import('../app/js/core/calendario.js');
const { bloquesDeEstudio, clasesParticulares, procesarEnvio, fusionarBloques } = await import('../worker/estudio.js');
const { codigoScript, MANIFIESTO } = await import('../app/js/core/script-estudio.js');

let fallos = 0;
const mal = m => { console.log('❌ ' + m); fallos++; };
const bien = m => console.log('✅ ' + m);
const igual = (que, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? bien(que) : mal(`${que} — salió ${JSON.stringify(a)}, tocaba ${JSON.stringify(b)}`));

const ASIG = [
  ['mat', 'Matemáticas CCSS II'], ['len', 'Lengua y Literatura'], ['ing', 'Inglés'],
  ['his', 'Historia de España'], ['fil', 'Historia de la Filosofía'], ['art', 'Historia del Arte'],
  ['eco', 'Economía'], ['fag', 'FAG'],
].map(([id, nombre]) => ({ id, nombre }));
const nombre = id => ASIG.find(a => a.id === id)?.nombre ?? id;

/* ------------------------------ asignatura -------------------------------- */
{
  const casos = [
    ['Estudiar arte', 'art'], ['Repasar historia del arte', 'art'], ['Repasar historia', 'his'],
    ['HIstoria', 'his'], ['Historia texto', 'his'], ['Leer tema historia', 'his'],
    ['Filosofía', 'fil'], ['Coreccion filosofia, onenote', 'fil'], ['Repasar filosofía', 'fil'],
    ['Pág. 68 ejercicios lengua', 'len'], ['Tabla sintaxis', 'len'],
    ['Terminar comentario texto literatura', 'len'], ['Hacer tabla morfología verbos subrayar (pág. 50)', 'len'],
    ['Portfolio inglés', 'ing'], ['Inglés biblia', 'ing'], ['Ejercicios matemáticas', 'mat'],
    ['Cuaderno matemáticas + revisar otros', 'mat'], ['Economía buscar x', 'eco'], ['Cuaderno economía', 'eco'],
    ['Recoger la ropa', null], ['Preparar la universidad', null], ['Mandar ejercicios al profesor', null], ['', null],
  ];
  const errores = casos.filter(([t, id]) => asignaturaDeTitulo(t, ASIG) !== id)
    .map(([t, id]) => `"${t}" → ${nombre(asignaturaDeTitulo(t, ASIG))} (tocaba ${nombre(id)})`);
  errores.length ? errores.forEach(mal) : bien(`${casos.length} títulos reales caen en su asignatura, y lo que no dice ninguna no se adivina`);

  // Las particulares cuentan para la asignatura del curso, aunque exista una
  // asignatura de tipo particular con ese nombre (la del horario).
  const conParticular = [...ASIG, { id: 'pmat', nombre: 'Particulares matemáticas', tipo: 'particular' }];
  asignaturaDeTitulo('Ejercicios matemáticas', conParticular) === 'mat'
    && asignaturaDeTitulo('Particulares matemáticas', conParticular) === 'mat'
    && asignaturaDeTitulo('Particulares matemáticas', ASIG) === 'mat'
    ? bien('"Particulares matemáticas" son horas de Matemáticas') : mal('las particulares no caen en Matemáticas');
  asignaturaDeTitulo('Recreo', [...ASIG, { id: 'r', nombre: 'Recreo', tipo: 'bloque' }]) === null
    ? bien('los bloques del horario nunca reciben estudio') : mal('un bloque del horario ha recibido estudio');
}

/* ---------------------------- logística y tipo ---------------------------- */
{
  const log = ['Imprimir tema arte', 'Grapar temas filosofía', 'Escanear libro lengua y subrayar', 'Subir forms FAG'];
  const no = ['Estudiar arte', 'Hacer esquema arte', 'Repasar lengua'];
  log.every(esLogistica) && !no.some(esLogistica) ? bien('imprimir, grapar, escanear y subir no son estudio')
    : mal('la logística se confunde con estudio');
  const tipos = [['Repasar arte', 'repaso'], ['Ejercicios matemáticas', 'ejercicios'], ['Página 51 (1) lengua', 'ejercicios'], ['Estudiar arte', 'teoria'], ['Particulares matemáticas', 'ejercicios']];
  tipos.every(([t, ti]) => tipoDeTitulo(t) === ti) ? bien('el tipo de sesión sale del título') : mal('tipo de sesión mal deducido');
}

/* ---------------------- bloques + tareas (lado worker) -------------------- */
{
  const enlace = id => `Los cambios que se hagan… ve a https://tasks.google.com/task/${id}.`;
  const ev = (id, summary, ini, fin, tarea, extra = {}) => ({
    id, summary, description: tarea ? enlace(tarea) : '', status: 'confirmed',
    start: { dateTime: ini }, end: { dateTime: fin }, ...extra,
  });
  const eventos = [
    ev('e1', 'Estudiar arte', '2026-10-17T16:30:00+02:00', '2026-10-17T18:30:00+02:00', 'T1'),
    ev('e2', 'Repasar historia', '2026-10-17T13:00:00+02:00', '2026-10-17T13:45:00+02:00', 'T2'),
    ev('e3', 'Feria de Otoño', '2026-10-12T17:30:00+02:00', '2026-10-12T18:30:00+02:00', null),
    ev('e4', 'Examen', '2026-10-09', '2026-10-10', 'T4', { start: { date: '2026-10-09' }, end: { date: '2026-10-10' } }),
    ev('e5', 'Filosofía', '2026-10-30T17:00:00+01:00', '2026-10-30T18:00:00+01:00', 'T5'),
    ev('e6', 'Lengua', '2026-10-16T17:00:00+02:00', '2026-10-16T18:00:00+02:00', 'T6', { status: 'cancelled' }),
    ev('e7', 'Portfolio inglés', '2026-10-15T17:45:00+02:00', '2026-10-15T18:00:00+02:00', 'OTRO'),
  ];
  const tareas = [
    { id: 'api1', title: 'Estudiar arte', status: 'completed', webViewLink: 'https://tasks.google.com/task/T1?sa=6', lista: 'Arte' },
    { id: 'T2', title: 'Repasar historia', status: 'needsAction' },
    { id: 'api7', title: 'Portfolio inglés', status: 'completed', due: '2026-10-15T00:00:00.000Z' },
  ];
  const b = bloquesDeEstudio(eventos, tareas, Date.parse('2026-10-18T12:00:00+02:00'));
  const ver = Object.fromEntries(b.map(x => [x.id, x.estado]));
  JSON.stringify(ver) === JSON.stringify({ e7: 'hecha', e2: 'pendiente', e1: 'hecha' })
    ? bien('solo bloques de tareas ya terminados; la tarea se encuentra por enlace o por título y día')
    : mal(`bloques del worker: ${JSON.stringify(ver)}`);
  b.find(x => x.id === 'e1')?.lista === 'Arte' ? bien('cada bloque lleva la lista de Tasks de su tarea') : mal('falta la lista de Tasks');

  const p = clasesParticulares([
    ev('c1', 'Particulares matemáticas', '2026-10-14T16:30:00+02:00', '2026-10-14T17:45:00+02:00', null),
    ev('c2', 'Historia del arte', '2026-10-14T08:00:00+02:00', '2026-10-14T09:00:00+02:00', null),
    ev('c3', 'Particulares matemáticas', '2026-10-21T16:30:00+02:00', '2026-10-21T17:45:00+02:00', null),
    ev('c4', 'Particular de inglés', '2026-10-13T16:30:00+02:00', '2026-10-13T17:30:00+02:00', null, { status: 'cancelled' }),
  ], Date.parse('2026-10-18T12:00:00+02:00'));
  p.length === 1 && p[0].id === 'p-c1' && p[0].estado === 'hecha'
    ? bien('del calendario del horario solo entran las particulares ya pasadas, como hechas (las clases del instituto no)')
    : mal(`particulares: ${JSON.stringify(p.map(x => x.id))}`);
}

/* ------------------------ de bloques a sesiones --------------------------- */
{
  const ahora = Date.parse('2026-10-18T12:00:00+02:00');
  const B = (id, titulo, ini, fin, estado = 'hecha') => ({ id, titulo, inicio: `2026-10-${ini}:00+02:00`, fin: `2026-10-${fin}:00+02:00`, estado });
  const bloques = [
    B('a', 'Filosofía', '01T19:15', '01T20:15'),
    B('b', 'Coreccion filosofia, onenote', '01T19:30', '01T20:30'),   // se pisa con a
    B('c', 'Imprimir tema arte', '06T18:00', '06T18:15'),
    B('d', 'Estudiar historia', '14T17:45', '14T19:45', 'pendiente'),   // última semana sin marcar
    B('e', 'Leer tema historia', '02T17:30', '02T18:00', 'pendiente'),  // vieja sin marcar
    B('f', 'Recoger la ropa', '05T21:15', '05T22:15'),                          // hecha, sin asignatura
    B('g', 'Mandar ejercicios al profesor', '05T19:30', '05T20:30'),         // logística… salvo regla
    B('i', 'Preparar la universidad', '13T19:00', '13T20:00'),
    B('h', 'Estudiar arte', '17T16:30', '17T18:30'),
  ];
  let r = sesionesDeBloques(bloques, ASIG, {}, ahora);
  const min = Object.fromEntries(r.sesiones.map(s => [s.id, s.minutos]));
  JSON.stringify(min) === JSON.stringify({ 'cal-a': 38, 'cal-b': 37, 'cal-h': 120 })
    ? bien('cuentan solo las hechas, sin logística, y el solape se reparte por igual (38 + 37 = 75, no 60 + 60)')
    : mal(`minutos: ${JSON.stringify(min)}`);
  r.pendientes.map(p => p.id).join() === 'd' ? bien('"¿lo hiciste?" solo para lo de la última semana')
    : mal(`pendientes: ${r.pendientes.map(p => p.id)}`);
  r.dudosos.map(p => p.id).join() === 'f,i' ? bien('lo hecho sin asignatura clara se pregunta')
    : mal(`dudosos: ${r.dudosos.map(p => p.id)}`);
  const s = r.sesiones.find(x => x.id === 'cal-h');
  s && s.fecha === '2026-10-17' && s.asignaturaId === 'art' && s.origen === 'calendario' && s.tipo === 'teoria'
    ? bien('la sesión lleva día, asignatura, tipo y origen') : mal(`sesión mal formada: ${JSON.stringify(s)}`);

  r = sesionesDeBloques(bloques, ASIG, {
    decisiones: { d: { hecho: true }, f: { asignaturaId: 'no' }, i: { asignaturaId: 'no' }, h: { hecho: false }, a: { asignaturaId: 'his' } },
    reglas: { 'mandar ejercicios al profesor': 'mat' },
  }, ahora);
  const por = Object.fromEntries(r.sesiones.map(x => [x.id, `${x.asignaturaId}:${x.minutos}`]));
  JSON.stringify(por) === JSON.stringify({ 'cal-a': 'his:38', 'cal-b': 'fil:37', 'cal-g': 'mat:60', 'cal-d': 'his:120' })
    && !r.pendientes.length && !r.dudosos.length
    ? bien('lo que él corrige manda: "sí lo hice", "no lo hice", "no es estudio", otra asignatura y reglas por título')
    : mal(`con decisiones: ${JSON.stringify(por)} · pendientes ${r.pendientes.length} · dudosos ${r.dudosos.length}`);

  sesionesDeBloques(bloques, ASIG, { decisiones: { f: { asignaturaId: 'borrada' } } }, ahora).dudosos.some(x => x.id === 'f')
    ? bien('una decisión que apunta a una asignatura borrada vuelve a preguntarse') : mal('asignatura borrada aceptada');
}

/* ------------------------------ tema del bloque ---------------------------- */
{
  const TEM = [
    { id: 't1', asignaturaId: 'fil', nombre: 'Tema 1. El nacimiento de la filosofía' },
    { id: 't2', asignaturaId: 'fil', nombre: 'Tema 2. Platón' },
    { id: 't3', asignaturaId: 'fil', nombre: 'Tema 3. Aristóteles y el helenismo' },
    { id: 'h1', asignaturaId: 'his', nombre: 'A1. La importancia de la romanización en la configuración de la cultura española' },
    { id: 'h2', asignaturaId: 'his', nombre: 'B1. La unión dinástica de los RRCC y la formación del Estado Moderno' },
    { id: 'a1', asignaturaId: 'art', nombre: 'Bloque 2. Arte egipcio' },
    { id: 'a2', asignaturaId: 'art', nombre: 'Bloque 3. Arte griego' },
  ];
  const f = TEM.filter(t => t.asignaturaId === 'fil'), h = TEM.filter(t => t.asignaturaId === 'his'), a = TEM.filter(t => t.asignaturaId === 'art');
  igual('el tema sale del título cuando lo dice: número, apartado o palabra propia del tema',
    [temaDeTitulo('Repasar tema 2 filosofía', f, 'Historia de la Filosofía'), temaDeTitulo('Estudiar Platón', f, 'Historia de la Filosofía'), temaDeTitulo('Aristóteles', f, 'Historia de la Filosofía'),
      temaDeTitulo('Repasar A1 historia', h, 'Historia de España'), temaDeTitulo('Romanización', h, 'Historia de España'), temaDeTitulo('Arte bloque 3', a, 'Historia del Arte'), temaDeTitulo('Hacer esquema egipcio', a, 'Historia del Arte')],
    ['t2', 't2', 't3', 'h1', 'h1', 'a2', 'a1']);
  igual('y NO se adivina: títulos genéricos, números que no existen o que se repiten',
    [temaDeTitulo('Estudiar filosofía', f, 'Historia de la Filosofía'), temaDeTitulo('Repasar historia', h, 'Historia de España'), temaDeTitulo('Tema 9', f, 'Historia de la Filosofía'), temaDeTitulo('Estudiar arte', a, 'Historia del Arte'),
      temaDeTitulo('Tema 1', [...f, { id: 'x', asignaturaId: 'fil', nombre: 'Tema 1. Otro distinto' }], 'Historia de la Filosofía')],
    [null, null, null, null, null]);

  const ahora = Date.parse('2026-10-18T12:00:00+02:00');
  const B = (id, titulo, d) => ({ id, titulo, inicio: `2026-10-${d}T17:00:00+02:00`, fin: `2026-10-${d}T18:00:00+02:00`, estado: 'hecha' });
  const asig = [{ id: 'fil', nombre: 'Historia de la Filosofía' }, { id: 'art', nombre: 'Historia del Arte' }, { id: 'eco', nombre: 'Economía' }];
  const bl = [B('x1', 'Repasar Platón', '17'), B('x2', 'Estudiar filosofía', '16'), B('x3', 'Estudiar arte', '15'),
    B('x4', 'Estudiar economía', '14'), B('x5', 'Filosofía', '02'), { ...B('x6', 'Particulares matemáticas', '13'), fuente: 'particular' }];
  const r = sesionesDeBloques(bl, [...asig, { id: 'mat', nombre: 'Matemáticas CCSS II' }], {}, ahora, TEM);
  const tema = Object.fromEntries(r.sesiones.map(s => [s.id.slice(4), s.temaId]));
  igual('la sesión lleva el tema deducido del título (o ninguno)', [tema.x1, tema.x2, tema.x3], ['t2', null, null]);
  igual('se pregunta el tema SOLO de lo reciente, de asignaturas con temario, y no de particulares',
    r.temaPendientes.map(x => x.id).sort(), ['x2', 'x3']);
  const r2 = sesionesDeBloques(bl, asig, { decisiones: { x2: { temaId: 't1' }, x3: { temaId: 'ninguno' } } }, ahora, TEM);
  igual('lo que él contesta se guarda (un tema, o "varios") y no se vuelve a preguntar',
    [r2.sesiones.find(s => s.id === 'cal-x2').temaId, r2.sesiones.find(s => s.id === 'cal-x3').temaId, r2.temaPendientes.length], ['t1', null, 0]);
  const r3 = sesionesDeBloques(bl, asig, { decisiones: { x2: { temaId: 'tema-borrado' } } }, ahora, TEM);
  igual('un tema que ya no existe vuelve a preguntarse', r3.temaPendientes.some(x => x.id === 'x2'), true);
}

/* -------------------- particulares y lista de Tasks ----------------------- */
{
  const ahora = Date.parse('2026-10-18T12:00:00+02:00');
  const r = sesionesDeBloques([
    { id: 'p-c1', titulo: 'Particulares matemáticas', inicio: '2026-10-14T16:30:00+02:00', fin: '2026-10-14T17:45:00+02:00', estado: 'hecha', fuente: 'particular' },
    { id: 'x', titulo: 'Tema 4', inicio: '2026-10-15T17:00:00+02:00', fin: '2026-10-15T18:00:00+02:00', estado: 'hecha', lista: 'Historia del arte' },
    { id: 'y', titulo: 'Tema 4', inicio: '2026-10-16T17:00:00+02:00', fin: '2026-10-16T18:00:00+02:00', estado: 'hecha', lista: 'Mis tareas' },
  ], ASIG, {}, ahora);
  const s = Object.fromEntries(r.sesiones.map(x => [x.id, `${x.asignaturaId}:${x.tipo}:${x.minutos}`]));
  s['cal-p-c1'] === 'mat:ejercicios:75' ? bien('una particular de 1 h 15 suma 75 min de ejercicios de Matemáticas')
    : mal(`particular: ${s['cal-p-c1']}`);
  s['cal-x'] === 'art:teoria:60' && r.dudosos.map(x => x.id).join() === 'y'
    ? bien('si el título no dice la asignatura, la lista de Tasks sí; si tampoco, se pregunta')
    : mal(`lista de Tasks: ${JSON.stringify(s)} · dudosos ${r.dudosos.map(x => x.id)}`);
}

/* ------------- el historial no depende de que siga en el calendario -------- */
{
  const b = (id, estado, extra = {}) => ({ id, titulo: id, inicio: `2026-10-${id.padStart(2, '0')}T10:00:00+02:00`, fin: `2026-10-${id.padStart(2, '0')}T11:00:00+02:00`, estado, ...extra });
  const previos = [b('1', 'hecha'), b('2', 'hecha'), b('3', 'pendiente'), b('4', 'hecha', { fuente: 'particular' }), b('5', 'pendiente')];
  const nuevos = [b('2', 'pendiente'), b('6', 'hecha')];       // el calendario ya no trae 1, 3, 4 ni 5; y la 2 se desmarcó
  const r = fusionarBloques(previos, nuevos);
  igual('una tarea HECHA que desaparece del calendario se conserva (ya se estudió)', r.filter(x => x.id === '1').map(x => x.estado), ['hecha']);
  igual('lo que llega ahora manda: una tarea desmarcada deja de contar', r.find(x => x.id === '2').estado, 'pendiente');
  igual('una pendiente que desaparece se olvida, y una particular borrada deja de contar', r.map(x => x.id).sort(), ['1', '2', '6']);
  igual('un envío vacío (fallo del script) NO vacía el historial', fusionarBloques(previos, []).map(x => x.id), ['1', '2']);
  igual('el resultado sale ordenado por fecha', r.map(x => x.id), ['1', '2', '6']);
}

/* -------------------------- lo que manda el script ------------------------- */
{
  const ahora = Date.parse('2026-10-18T12:00:00+02:00');
  const r = procesarEnvio({
    eventos: [{ id: 'e1', summary: 'Estudiar arte', description: 'tasks.google.com/task/T1', status: 'confirmed',
      start: { dateTime: '2026-10-17T16:30:00+02:00' }, end: { dateTime: '2026-10-17T18:30:00+02:00' } }],
    tareas: [{ id: 'x', title: 'Estudiar arte', status: 'completed', webViewLink: 'https://tasks.google.com/task/T1', lista: 'Mis tareas' }],
    particulares: [{ id: 'c1', summary: 'Particulares matemáticas', status: 'confirmed',
      start: { dateTime: '2026-10-14T16:30:00+02:00' }, end: { dateTime: '2026-10-14T17:45:00+02:00' } }],
  }, ahora);
  r.bloques?.map(b => `${b.id}:${b.estado}`).join() === 'p-c1:hecha,e1:hecha'
    ? bien('lo que manda el script se convierte en bloques (tareas + particulares), por fecha')
    : mal(`envío del script: ${JSON.stringify(r)}`);
  procesarEnvio({ eventos: 'x' }).error && procesarEnvio(null).error
    ? bien('un envío sin la forma esperada se rechaza') : mal('envío mal formado aceptado');

  const codigo = codigoScript({ origen: 'https://meta.example', clave: 'a'.repeat(64), desde: '2026-09-01' });
  let compila = true;
  try { new Function(codigo); } catch { compila = false; }
  const m = JSON.parse(MANIFIESTO);
  compila && codigo.includes('"' + 'a'.repeat(64) + '"') && codigo.includes('/api/estudio/recibir')
    && m.oauthScopes.every(x => /readonly|external_request|scriptapp/.test(x))
    && m.dependencies.enabledAdvancedServices.length === 2
    ? bien('el script generado es JavaScript válido, lleva su clave y solo pide permisos de lectura')
    : mal('script generado incorrecto');
}

/* ------------------------------ historial: quitar y corregir --------------- */
{
  const b = { id: 'h1', titulo: 'Estudiar Matemáticas', inicio: '2026-10-05T16:00:00.000Z', fin: '2026-10-05T18:00:00.000Z', estado: 'hecha' };
  const r = ajustes => sesionesDeBloques([b], ASIG, ajustes, Date.parse('2026-10-06T10:00:00Z')).sesiones;
  igual('sin tocar cuenta lo planificado (120 min)', r({}).map(s => s.minutos), [120]);
  igual('"estudié 45 min" manda sobre lo planificado', r({ decisiones: { h1: { minutos: 45 } } }).map(s => s.minutos), [45]);
  igual('"no lo estudié" quita la sesión', r({ decisiones: { h1: { hecho: false } } }).length, 0);
  igual('devolverla la recupera con su tiempo corregido', r({ decisiones: { h1: { hecho: true, minutos: 30 } } }).map(s => s.minutos), [30]);
}

/* ------------------------ bloques que se pisan ----------------------------- */
{
  const M = m => Date.parse('2026-10-05T10:00:00Z') + m * 60000;
  const rep = (...iv) => repartirMinutos(iv.map(([a, z]) => ({ ini: M(a), fin: M(z) })));
  igual('sin solape cada uno cuenta lo suyo', rep([0, 60], [60, 90]), [60, 30]);
  igual('uno entero dentro de otro: ya no suma 0, se reparte (60 + 60 de 60 min → 30 + 30)', rep([0, 60], [0, 60]), [30, 30]);
  igual('uno corto dentro de uno largo: reparte solo lo común', rep([0, 180], [45, 120]), [180 - 75 + 38, 37]);
  igual('tres a la vez: un tercio cada uno', rep([0, 60], [0, 60], [0, 60]), [20, 20, 20]);
  igual('no depende del orden en que vengan', rep([45, 120], [0, 180]), [37, 180 - 75 + 38]);
  const iv = [[0, 100], [30, 70], [60, 150], [140, 200], [300, 330]];
  igual('el total es siempre el tiempo real (la unión), nunca más', rep(...iv).reduce((a, b) => a + b, 0), 200 + 30);

  // De punta a punta: el caso real de un bloque hecho que quedaba a 0 min.
  const B = (id, titulo, ini, fin, extra = {}) => ({ id, titulo, inicio: `2026-10-07T${ini}:00+02:00`, fin: `2026-10-07T${fin}:00+02:00`, estado: 'hecha', ...extra });
  const bl = [
    B('p', 'Particulares matemáticas', '16:30', '17:45', { fuente: 'particular' }),
    B('i', 'Inglés biblia', '16:30', '17:30'),                       // entera dentro de la clase
  ];
  const r = sesionesDeBloques(bl, ASIG, {}, Date.parse('2026-10-18T12:00:00+02:00')).sesiones;
  const por = Object.fromEntries(r.map(x => [x.asignaturaId, x.minutos]));
  igual('la tarea que caía entera dentro de otra ahora cuenta para su asignatura, y el total no se infla (75 min)',
    [por.ing > 0, por.mat > 0, r.reduce((a, x) => a + x.minutos, 0)], [true, true, 75]);
  // Lo que dijo que estudió de verdad manda, y el resto se reparte sobre eso.
  const r2 = sesionesDeBloques(bl, ASIG, { decisiones: { i: { minutos: 20 } } }, Date.parse('2026-10-18T12:00:00+02:00')).sesiones;
  igual('"estudié 20 min" acota su intervalo y la clase se queda con el resto',
    Object.fromEntries(r2.map(x => [x.asignaturaId, x.minutos])), { mat: 65, ing: 10 });
}

/* ------------------------------ inicio de curso --------------------------- */
inicioCurso(new Date(2026, 9, 18)) === '2026-09-01' && inicioCurso(new Date(2027, 2, 3)) === '2026-09-01'
  && inicioCurso(new Date(2027, 8, 2)) === '2027-09-01'
  ? bien('el curso empieza el 1 de septiembre del año académico') : mal('inicio de curso mal calculado');

console.log(fallos ? `\n${fallos} fallo(s)` : '\ntodo bien');
process.exit(fallos ? 1 : 0);
