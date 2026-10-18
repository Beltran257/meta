/* ===========================================================================
   PRUEBA DEL ESTUDIO DESDE EL CALENDARIO — sin red y sin navegador.

   Vigila lo que haría mentir a las horas de estudio sin que se note:
   · que un bloque cuente solo si su tarea está marcada como hecha;
   · que cada título caiga en su asignatura ("historia del arte" no es
     Historia de España) y que lo dudoso se pregunte en vez de adivinarse;
   · que la logística (imprimir, grapar…) no sume como estudio;
   · que dos bloques hechos que se pisan no cuenten el tiempo dos veces;
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

const { asignaturaDeTitulo, esLogistica, tipoDeTitulo, sesionesDeBloques, inicioCurso } =
  await import('../app/js/core/calendario.js');
const { bloquesDeEstudio } = await import('../worker/google.js');

let fallos = 0;
const mal = m => { console.log('❌ ' + m); fallos++; };
const bien = m => console.log('✅ ' + m);

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
    ['Planchar', null], ['Preparar ICADE', null], ['Mandar ejercicios Germán', null], ['', null],
  ];
  const errores = casos.filter(([t, id]) => asignaturaDeTitulo(t, ASIG) !== id)
    .map(([t, id]) => `"${t}" → ${nombre(asignaturaDeTitulo(t, ASIG))} (tocaba ${nombre(id)})`);
  errores.length ? errores.forEach(mal) : bien(`${casos.length} títulos reales caen en su asignatura, y lo que no dice ninguna no se adivina`);

  // Con una asignatura particular del mismo nombre, gana la del curso.
  const conParticular = [...ASIG, { id: 'pmat', nombre: 'Particulares matemáticas', tipo: 'particular' }];
  asignaturaDeTitulo('Ejercicios matemáticas', conParticular) === 'mat'
    && asignaturaDeTitulo('Particulares matemáticas', conParticular) === 'pmat'
    ? bien('la particular solo gana cuando se la nombra') : mal('empate con la particular mal resuelto');
  asignaturaDeTitulo('Recreo', [...ASIG, { id: 'r', nombre: 'Recreo', tipo: 'bloque' }]) === null
    ? bien('los bloques del horario nunca reciben estudio') : mal('un bloque del horario ha recibido estudio');
}

/* ---------------------------- logística y tipo ---------------------------- */
{
  const log = ['Imprimir tema arte', 'Grapar temas filosofía', 'Escanear libro lengua y subrayar', 'Subir forms FAG'];
  const no = ['Estudiar arte', 'Hacer esquema arte', 'Repasar lengua'];
  log.every(esLogistica) && !no.some(esLogistica) ? bien('imprimir, grapar, escanear y subir no son estudio')
    : mal('la logística se confunde con estudio');
  const tipos = [['Repasar arte', 'repaso'], ['Ejercicios matemáticas', 'ejercicios'], ['Página 51 (1) lengua', 'ejercicios'], ['Estudiar arte', 'teoria']];
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
    { id: 'api1', title: 'Estudiar arte', status: 'completed', webViewLink: 'https://tasks.google.com/task/T1?sa=6' },
    { id: 'T2', title: 'Repasar historia', status: 'needsAction' },
    { id: 'api7', title: 'Portfolio inglés', status: 'completed', due: '2026-10-15T00:00:00.000Z' },
  ];
  const b = bloquesDeEstudio(eventos, tareas, Date.parse('2026-10-18T12:00:00+02:00'));
  const ver = Object.fromEntries(b.map(x => [x.id, x.estado]));
  JSON.stringify(ver) === JSON.stringify({ e7: 'hecha', e2: 'pendiente', e1: 'hecha' })
    ? bien('solo bloques de tareas ya terminados; la tarea se encuentra por enlace o por título y día')
    : mal(`bloques del worker: ${JSON.stringify(ver)}`);
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
    B('f', 'Planchar', '05T21:15', '05T22:15'),                          // hecha, sin asignatura
    B('g', 'Mandar ejercicios Germán', '05T19:30', '05T20:30'),         // logística… salvo regla
    B('i', 'Preparar ICADE', '13T19:00', '13T20:00'),
    B('h', 'Estudiar arte', '17T16:30', '17T18:30'),
  ];
  let r = sesionesDeBloques(bloques, ASIG, {}, ahora);
  const min = Object.fromEntries(r.sesiones.map(s => [s.id, s.minutos]));
  JSON.stringify(min) === JSON.stringify({ 'cal-a': 60, 'cal-b': 15, 'cal-h': 120 })
    ? bien('cuentan solo las hechas, sin logística, y el solape suma una vez (60 + 15, no 60 + 60)')
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
    reglas: { 'mandar ejercicios german': 'mat' },
  }, ahora);
  const por = Object.fromEntries(r.sesiones.map(x => [x.id, `${x.asignaturaId}:${x.minutos}`]));
  JSON.stringify(por) === JSON.stringify({ 'cal-a': 'his:60', 'cal-b': 'fil:15', 'cal-g': 'mat:60', 'cal-d': 'his:120' })
    && !r.pendientes.length && !r.dudosos.length
    ? bien('lo que él corrige manda: "sí lo hice", "no lo hice", "no es estudio", otra asignatura y reglas por título')
    : mal(`con decisiones: ${JSON.stringify(por)} · pendientes ${r.pendientes.length} · dudosos ${r.dudosos.length}`);

  sesionesDeBloques(bloques, ASIG, { decisiones: { f: { asignaturaId: 'borrada' } } }, ahora).dudosos.some(x => x.id === 'f')
    ? bien('una decisión que apunta a una asignatura borrada vuelve a preguntarse') : mal('asignatura borrada aceptada');
}

/* ------------------------------ inicio de curso --------------------------- */
inicioCurso(new Date(2026, 9, 18)) === '2026-09-01' && inicioCurso(new Date(2027, 2, 3)) === '2026-09-01'
  && inicioCurso(new Date(2027, 8, 2)) === '2027-09-01'
  ? bien('el curso empieza el 1 de septiembre del año académico') : mal('inicio de curso mal calculado');

console.log(fallos ? `\n${fallos} fallo(s)` : '\ntodo bien');
process.exit(fallos ? 1 : 0);
