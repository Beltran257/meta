/* ===========================================================================
   PRUEBA DEL MOTOR — sin red y sin navegador.

   `app/js/core/motor.js` es el único sitio donde META decide algo: el estado
   académico, el orden de las tareas, el plan del día y el plan hasta un
   examen. Hasta ahora era también el único archivo importante SIN una sola
   prueba: `tools/audita.mjs` comprueba la estructura (CSP, acciones, claves,
   versiones) pero no ejecuta ni una línea de lógica, y los otros dos
   prueba-*.mjs cubren el feed ICS y los dossieres.

   Un error aquí no rompe nada visiblemente: da prioridades y planes falsos, y
   eso se cree. Por eso estas comprobaciones son de NÚMEROS Y FECHAS, no de
   HTML.

   El motor guarda en localStorage a través de core/store.js, así que aquí se
   le pone un localStorage de mentira antes de importarlo. Todas las fechas
   son relativas a hoy (sumaDias), para que la prueba valga cualquier día.

   Uso:  node tools/prueba-motor.mjs
   =========================================================================== */

/* --- localStorage de mentira, antes de importar nada del navegador -------- */
const almacen = new Map();
globalThis.localStorage = {
  getItem: k => (almacen.has(k) ? almacen.get(k) : null),
  setItem: (k, v) => { almacen.set(k, String(v)); },
  removeItem: k => { almacen.delete(k); },
  clear: () => almacen.clear(),
};

const motor = await import('../app/js/core/motor.js');
const { guardar, borrarTodo } = await import('../app/js/core/store.js');
const { hoyLocal, sumaDias } = await import('../app/js/core/fmt.js');

let bien = 0;
const fallos = [];
const comprueba = (que, ok, detalle = '') => {
  if (ok) bien++;
  else fallos.push(`${que}${detalle ? ` — ${detalle}` : ''}`);
};
const casi = (a, b) => a != null && Math.abs(a - b) < 1e-9;

const HOY = hoyLocal();
const dentroDe = n => sumaDias(HOY, n);

/** Deja el almacén como recién instalado y siembra solo lo que pida la prueba.
    `disponibilidad` igual los siete días: si no, el resultado dependería del
    día de la semana en que se ejecute. */
function siembra({ tareas = [], temas = [], asignaturas = [], notas = {}, sesiones = [], minutosDia = 120 } = {}) {
  borrarTodo();
  guardar('perfil', { disponibilidad: { 0: minutosDia, 1: minutosDia, 2: minutosDia, 3: minutosDia, 4: minutosDia, 5: minutosDia, 6: minutosDia } });
  guardar('asignaturas', asignaturas);
  guardar('tareas', tareas);
  guardar('temas', temas);
  guardar('notas', notas);
  guardar('sesiones', sesiones);
}

const factor = (est, nombre) => est.factores.find(f => f.n === nombre) || null;

/* ===========================================================================
   1. LA MEDIA DEL CURSO
   Vivía duplicada en tres sitios con DOS fórmulas distintas: la pantalla de
   Notas hacía la media de las evaluaciones y la de Asignaturas una sola bolsa
   ponderada con las tres juntas. La misma asignatura salía con dos notas.
   =========================================================================== */
const evalsDesiguales = { 1: [{ valor: 9 }], 2: [{ valor: 4 }, { valor: 4 }, { valor: 4 }, { valor: 4 }], 3: [] };

comprueba('la media del curso es la media de las evaluaciones, no una bolsa única',
  casi(motor.mediaDelCurso(evalsDesiguales), 6.5),
  `dio ${motor.mediaDelCurso(evalsDesiguales)} (la bolsa única daría 5)`);

comprueba('una evaluación sin notas no cuenta como un cero',
  casi(motor.mediaDelCurso({ 1: [{ valor: 8 }], 2: [], 3: [] }), 8));

comprueba('sin ninguna nota no se inventa un 0, se dice que no se sabe',
  motor.mediaDelCurso({ 1: [], 2: [], 3: [] }) === null);

comprueba('dentro de una evaluación sí manda el peso',
  casi(motor.mediaPonderada([{ valor: 10, peso: 3 }, { valor: 6, peso: 1 }]), 9));

comprueba('sin peso declarado, todas las notas pesan igual',
  casi(motor.mediaPonderada([{ valor: 4 }, { valor: 8 }]), 6));

comprueba('mediaDelCurso aguanta que no haya objeto de evaluaciones',
  motor.mediaDelCurso(undefined) === null);

/* --- y el estado académico usa ESA media, no otra ------------------------- */
siembra({
  asignaturas: [{ id: 'a1', nombre: 'Matemáticas' }],
  notas: { a1: { objetivo: 6, evaluaciones: evalsDesiguales } },
});
comprueba('con media 6,50 y objetivo 6 el estado NO penaliza',
  factor(motor.estadoAcademico(), 'Por debajo de tu objetivo') === null,
  'la fórmula vieja daba 5,00 y restaba puntos por una asignatura aprobada');

siembra({
  asignaturas: [{ id: 'a1', nombre: 'Matemáticas' }],
  notas: { a1: { objetivo: 8, evaluaciones: evalsDesiguales } },
});
comprueba('con media 6,50 y objetivo 8 el estado sí penaliza',
  factor(motor.estadoAcademico(), 'Por debajo de tu objetivo') != null);

/* ===========================================================================
   2. CARGA APIÑADA — son ENTREGAS, no exámenes
   Un examen no ocupa un hueco de la tarde. Colarlo aquí le daba los 45
   minutos por defecto de una tarea cualquiera e inventaba carga que no hay.
   =========================================================================== */
const soloExamenesApinados = [
  { id: 'e1', tipo: 'examen', titulo: 'Examen 1', fecha: dentroDe(1), asignaturaId: 'a1' },
  { id: 'e2', tipo: 'examen', titulo: 'Examen 2', fecha: dentroDe(2), asignaturaId: 'a1' },
  { id: 'e3', tipo: 'examen', titulo: 'Examen 3', fecha: dentroDe(3), asignaturaId: 'a1' },
];
siembra({ asignaturas: [{ id: 'a1', nombre: 'Historia' }], tareas: soloExamenesApinados, minutosDia: 10 });
comprueba('tres exámenes seguidos no cuentan como "carga apiñada"',
  factor(motor.estadoAcademico(), 'Carga apiñada') === null);

siembra({
  asignaturas: [{ id: 'a1', nombre: 'Historia' }],
  tareas: [
    { id: 't1', tipo: 'tarea', titulo: 'Comentario', fecha: dentroDe(1), asignaturaId: 'a1', duracion: 120 },
    { id: 't2', tipo: 'tarea', titulo: 'Ejercicios', fecha: dentroDe(2), asignaturaId: 'a1', duracion: 120 },
  ],
  minutosDia: 10,
});
comprueba('dos entregas largas que no caben sí cuentan como "carga apiñada"',
  factor(motor.estadoAcademico(), 'Carga apiñada') != null);

/* ===========================================================================
   3. PLAN HASTA EL EXAMEN — nunca el día del examen ni después
   El reparto iba de hoy+1 a hoy+diasQueQuedan, así que el último día caía
   SIEMPRE el día del examen. Y con un examen de hoy o ya pasado proponía
   estudiar mañana para algo que ya se hizo.
   =========================================================================== */
const temario = [
  { id: 'm1', asignaturaId: 'a1', nombre: 'Tema 1', dominio: 10 },
  { id: 'm2', asignaturaId: 'a1', nombre: 'Tema 2', dominio: 20 },
  { id: 'm3', asignaturaId: 'a1', nombre: 'Tema 3', dominio: 30 },
];
const examenA = dias => ({ id: 'e1', tipo: 'examen', titulo: 'Examen', fecha: dentroDe(dias), asignaturaId: 'a1', temaIds: ['m1', 'm2', 'm3'] });

for (const dias of [2, 3, 5, 10, 20]) {
  siembra({ asignaturas: [{ id: 'a1', nombre: 'Historia' }], temas: temario, tareas: [examenA(dias)] });
  const plan = motor.planHastaExamen(examenA(dias));
  const fechaExamen = dentroDe(dias);
  comprueba(`el plan de un examen a ${dias} días no toca el día del examen`,
    plan.every(d => d.fecha < fechaExamen),
    `el último día es ${plan.at(-1)?.fecha}, el examen es el ${fechaExamen}`);
  comprueba(`el plan de un examen a ${dias} días empieza mañana`,
    plan.length > 0 && plan[0].fecha === dentroDe(1));
}

siembra({ asignaturas: [{ id: 'a1', nombre: 'Historia' }], temas: temario, tareas: [examenA(0)] });
comprueba('un examen que es HOY no genera plan para mañana',
  motor.planHastaExamen(examenA(0)).length === 0);

siembra({ asignaturas: [{ id: 'a1', nombre: 'Historia' }], temas: temario, tareas: [examenA(-3)] });
comprueba('un examen ya pasado no genera plan',
  motor.planHastaExamen(examenA(-3)).length === 0);

siembra({ asignaturas: [{ id: 'a1', nombre: 'Historia' }], temas: temario, tareas: [examenA(1)] });
comprueba('un examen que es MAÑANA no deja días útiles',
  motor.planHastaExamen(examenA(1)).length === 0);

siembra({ asignaturas: [{ id: 'a1', nombre: 'Historia' }], temas: [], tareas: [examenA(7)] });
comprueba('un examen sin temario no genera plan',
  motor.planHastaExamen(examenA(7)).length === 0);

/* ===========================================================================
   4. PLAN DEL DÍA — un tema no puede salir dos veces
   El mismo tema podía entrar como "tema de examen cercano" y otra vez como
   "repaso vencido", y gastaba dos bloques del poco tiempo que hay.
   =========================================================================== */
siembra({
  asignaturas: [{ id: 'a1', nombre: 'Historia' }],
  temas: [{ id: 'm1', asignaturaId: 'a1', nombre: 'La Restauración', dominio: 20, proximoRepaso: dentroDe(-9) }],
  tareas: [{ id: 'e1', tipo: 'examen', titulo: 'Bloque 6', fecha: dentroDe(4), asignaturaId: 'a1', temaIds: ['m1'] }],
  minutosDia: 240,
});
const plan = motor.planDelDia().plan;
const refs = plan.map(b => b.refId);
comprueba('el plan del día no repite el mismo tema',
  new Set(refs).size === refs.length, `refIds: ${refs.join(', ')}`);
comprueba('pero el tema sí aparece una vez', refs.includes('m1'));

/* --- y sigue respetando el tiempo disponible ------------------------------ */
siembra({
  asignaturas: [{ id: 'a1', nombre: 'Historia' }, { id: 'a2', nombre: 'Lengua' }],
  temas: [
    { id: 'm1', asignaturaId: 'a1', nombre: 'Tema A', dominio: 10 },
    { id: 'm2', asignaturaId: 'a2', nombre: 'Tema B', dominio: 10 },
  ],
  tareas: [
    { id: 'e1', tipo: 'examen', titulo: 'Examen A', fecha: dentroDe(3), asignaturaId: 'a1', temaIds: ['m1'] },
    { id: 'e2', tipo: 'examen', titulo: 'Examen B', fecha: dentroDe(3), asignaturaId: 'a2', temaIds: ['m2'] },
  ],
  minutosDia: 60,
});
const corto = motor.planDelDia();
comprueba('el plan nunca reparte más minutos de los que hay',
  corto.plan.reduce((s, b) => s + b.minutos, 0) <= 60,
  `repartió ${corto.plan.reduce((s, b) => s + b.minutos, 0)} de 60`);

siembra({ minutosDia: 10 });
comprueba('sin tiempo suficiente para un bloque, no se propone nada',
  motor.planDelDia().motivo === 'sin-tiempo');

/* ===========================================================================
   4b. QUÉ HAGO HOY (reescrito nov 2026 con los datos reales)
   Antes miraba solo exámenes a ≤21 días, callaba si un examen no tenía
   temario y se cortaba a las 2 líneas por el tiempo libre de hoy. Estas
   pruebas fijan cada regla nueva.
   =========================================================================== */
const ASIG3 = [{ id: 'h', nombre: 'Historia' }, { id: 'f', nombre: 'Filosofía' }, { id: 'l', nombre: 'Lengua' }];
const ex = (id, a, dias, extra = {}) => ({ id, tipo: 'examen', titulo: 'Examen ' + id, fecha: dentroDe(dias), asignaturaId: a, ...extra });
const tm = (id, a, nombre, dominio) => ({ id, asignaturaId: a, nombre, dominio });
const sesionHace = (a, dias, minutos) => ({ id: 's' + a + dias, fecha: dentroDe(-dias), asignaturaId: a, minutos });

siembra({ asignaturas: ASIG3, temas: [tm('t1', 'h', 'Tema 1', 10)], tareas: [ex('e1', 'h', 22)], minutosDia: 120 });
comprueba('un examen a 22 días YA entra en el plan (el horizonte es de 45)',
  motor.planDelDia().plan.some(b => b.refId === 't1'));

siembra({ asignaturas: ASIG3, temas: [], tareas: [ex('e1', 'l', 17)], minutosDia: 120 });
{
  const r = motor.planDelDia();
  comprueba('un examen SIN temario genera "poner el temario", de 10 min, lo primero',
    r.plan[0]?.tipo === 'temario' && r.plan[0].minutos === 10 && r.plan[0].refId === 'l' && /sin temario/.test(r.plan[0].detalle),
    JSON.stringify(r.plan[0]));
}

siembra({ asignaturas: ASIG3, temas: [], tareas: [ex('e1', 'l', 17), ex('e2', 'l', 30)], minutosDia: 120 });
comprueba('dos exámenes de la misma asignatura sin temario dan UN solo aviso',
  motor.planDelDia().plan.filter(b => b.tipo === 'temario').length === 1);

/* El tiempo de hoy corta el plan, pero no lo que seguiría. */
siembra({
  asignaturas: ASIG3,
  temas: [tm('h1', 'h', 'H1', 0), tm('f1', 'f', 'F1', 0), tm('l1', 'l', 'L1', 0)],
  tareas: [ex('e1', 'h', 10), ex('e2', 'f', 10), ex('e3', 'l', 10)],
  minutosDia: 60,
});
{
  const r = motor.planDelDia();
  const minPlan = r.plan.reduce((t, b) => t + b.minutos, 0);
  comprueba('con 60 min el plan cabe en 60 y el resto va a "si te sobra tiempo"',
    minPlan <= 60 && r.plan.length >= 1 && r.extra.length >= 1 && r.plan.length + r.extra.length === 3,
    `plan ${r.plan.length} (${minPlan} min) + extra ${r.extra.length}`);
  comprueba('el extra sigue después del plan, en el mismo orden de prioridad',
    new Set([...r.plan, ...r.extra].map(b => b.refId)).size === 3);
}
siembra({ asignaturas: ASIG3, temas: [tm('h1', 'h', 'H1', 0)], tareas: [ex('e1', 'h', 10)], minutosDia: 5 });
{
  const r = motor.planDelDia();
  comprueba('sin tiempo hoy: motivo "sin-tiempo", plan vacío, pero se enseña lo que seguiría',
    r.motivo === 'sin-tiempo' && r.plan.length === 0 && r.extra.length === 1);
}

/* Una vuelta por todas las asignaturas antes de repetir. */
siembra({
  asignaturas: ASIG3,
  temas: [
    ...Array.from({ length: 30 }, (_, i) => tm('H' + i, 'h', `Tema ${i + 1}`, 0)),
    tm('f1', 'f', 'Platón', 60), tm('f2', 'f', 'Kant', 60),
  ],
  tareas: [ex('e1', 'h', 20), ex('e2', 'f', 20)],
  minutosDia: 300,
});
{
  const r = motor.planDelDia();
  const orden = [...r.plan, ...r.extra];
  comprueba('con 30 temas a 0 % en una asignatura y 2 al 60 % en otra, la otra NO queda fuera',
    orden.slice(0, 3).some(b => b.asignaturaId === 'f'), orden.slice(0, 3).map(b => b.asignaturaId).join());
  comprueba('nunca dos bloques seguidos de la misma asignatura si hay otra cosa',
    orden.slice(0, -1).every((b, i) => b.asignaturaId !== orden[i + 1].asignaturaId || orden.slice(i + 1).every(x => x.asignaturaId === b.asignaturaId)));
  comprueba('en la que tiene todo a 0 %, propone el SIGUIENTE tema en orden (Tema 1, luego Tema 2)',
    orden.filter(b => b.asignaturaId === 'h').slice(0, 2).map(b => b.que).join() === 'Tema 1,Tema 2',
    orden.filter(b => b.asignaturaId === 'h').slice(0, 2).map(b => b.que).join());
}

/* Lo que lleva sin tocar sube; lo que ya estudió hoy baja. */
const dosIguales = sesiones => siembra({
  asignaturas: ASIG3, sesiones, minutosDia: 200,
  temas: [tm('h1', 'h', 'H1', 30), tm('f1', 'f', 'F1', 30)],
  tareas: [ex('e1', 'h', 15), ex('e2', 'f', 15)],
});
dosIguales([sesionHace('h', 3, 120)]);
comprueba('con examen y dominio iguales, va primero la asignatura que lleva 14 días sin horas',
  motor.planDelDia().plan[0]?.asignaturaId === 'f');
comprueba('y el motivo lo dice ("0 h esta quincena")', /0 h esta quincena/.test(motor.planDelDia().plan[0]?.detalle || ''));
dosIguales([{ id: 'hoy', fecha: HOY, asignaturaId: 'f', minutos: 90 }, sesionHace('h', 3, 120)]);
comprueba('lo que ya ha estudiado HOY (90 min) baja frente a lo igual de urgente',
  motor.planDelDia({ minutos: 200 }).plan[0]?.asignaturaId === 'h');

/* Lo que vence ya sigue por delante de cualquier examen. */
siembra({
  asignaturas: ASIG3, temas: [tm('h1', 'h', 'H1', 0)], minutosDia: 200,
  tareas: [ex('e1', 'h', 2), { id: 't1', tipo: 'tarea', titulo: 'Entrega', fecha: dentroDe(0), asignaturaId: 'f' }],
});
comprueba('una entrega para HOY va antes que un examen en 2 días', motor.planDelDia().plan[0]?.tipo === 'tarea');

/* ===========================================================================
   5. PRIORIZACIÓN Y ATRASO — lo básico, que es lo que más se cree
   =========================================================================== */
siembra({
  asignaturas: [{ id: 'a1', nombre: 'Historia' }],
  tareas: [
    { id: 't1', tipo: 'tarea', titulo: 'Vieja', fecha: dentroDe(-4), asignaturaId: 'a1' },
    { id: 't2', tipo: 'tarea', titulo: 'Hecha y vieja', fecha: dentroDe(-4), asignaturaId: 'a1', estado: 'hecha' },
    { id: 't3', tipo: 'tarea', titulo: 'Para dentro de un mes', fecha: dentroDe(30), asignaturaId: 'a1' },
    { id: 'e1', tipo: 'examen', titulo: 'Examen pasado', fecha: dentroDe(-2), asignaturaId: 'a1' },
  ],
});
comprueba('atrasadas() ignora lo ya hecho y no cuenta exámenes',
  motor.atrasadas().map(t => t.id).join(',') === 't1');
const orden = motor.priorizadas().map(t => t.id);
comprueba('lo atrasado va por delante de lo lejano',
  orden.indexOf('t1') < orden.indexOf('t3'), `orden: ${orden.join(' > ')}`);
comprueba('lo ya hecho no entra en la lista de prioridades', !orden.includes('t2'));
comprueba('un examen ya pasado no sale en los próximos',
  motor.examenesProximos().every(e => e.id !== 'e1'));
comprueba('la urgencia baja de forma monótona según se aleja la fecha',
  [0, 1, 2, 3, 4, 7, 8, 14, 21, 40].every((d, i, l) =>
    i === 0 || motor.urgenciaDe(dentroDe(l[i - 1])) >= motor.urgenciaDe(dentroDe(d))));
comprueba('lo atrasado es lo más urgente de todo',
  motor.urgenciaDe(dentroDe(-1)) > motor.urgenciaDe(dentroDe(0)));

/* --- preparación: honesta cuando no hay de dónde tirar -------------------- */
siembra({ asignaturas: [{ id: 'a1', nombre: 'Historia' }], temas: [] });
comprueba('un examen sin temario da preparación null, no 0 %',
  motor.preparacion({ asignaturaId: 'a1', temaIds: [] }) === null);

siembra({
  asignaturas: [{ id: 'a1', nombre: 'Historia' }],
  temas: [{ id: 'm1', asignaturaId: 'a1', nombre: 'T', dominio: 80 }, { id: 'm2', asignaturaId: 'a1', nombre: 'U', dominio: 40 }],
});
comprueba('la preparación es el dominio medio del temario',
  motor.preparacion({ asignaturaId: 'a1', temaIds: [] }) === 60);

/* ===========================================================================
   6. FECHAS — el cambio de hora no puede mover un examen de día
   En Madrid el reloj cambia el último domingo de marzo y el de octubre. Si
   diasHasta() restara milisegundos sin redondear, un examen pasaría a estar
   "a 2 días" cuando está a 3, y todo lo de arriba se desplazaría.
   =========================================================================== */
for (const [desde, cuantos, esperado] of [
  ['2027-03-27', 1, '2027-03-28'],   // entra el horario de verano
  ['2027-03-27', 7, '2027-04-03'],
  ['2026-10-24', 1, '2026-10-25'],   // vuelve el horario de invierno
  ['2026-10-24', 7, '2026-10-31'],
  ['2027-02-28', 1, '2027-03-01'],   // 2027 no es bisiesto
  ['2028-02-28', 1, '2028-02-29'],   // 2028 sí
  ['2026-12-31', 1, '2027-01-01'],
]) {
  comprueba(`sumar ${cuantos} día(s) a ${desde} da ${esperado}`, sumaDias(desde, cuantos) === esperado,
    `dio ${sumaDias(desde, cuantos)}`);
}

/* ===========================================================================
   7. SEMANA — el reparto que se ve en Horario
   =========================================================================== */
siembra({
  asignaturas: [{ id: 'a1', nombre: 'Historia' }],
  tareas: [
    { id: 't1', tipo: 'tarea', titulo: 'Trabajo', fecha: dentroDe(2), asignaturaId: 'a1', duracion: 300 },
    { id: 'e1', tipo: 'examen', titulo: 'Examen', fecha: dentroDe(2), asignaturaId: 'a1' },
  ],
  minutosDia: 60,
});
const semana = motor.semanaDesde(HOY, 7);
comprueba('semanaDesde devuelve exactamente los días pedidos', semana.length === 7);
comprueba('el primer día de la semana es el de partida', semana[0].fecha === HOY);
const dia2 = semana[2];
comprueba('un día con 300 min de entregas y 60 disponibles está sobrecargado', dia2.sobrecarga === true);
comprueba('los exámenes del día se listan aparte de las tareas',
  dia2.examenes.length === 1 && dia2.tareas.length === 1);
comprueba('el examen no suma minutos de carga', dia2.minutosCarga === 300);

/* --------------------------------------------------------------------------- */
borrarTodo();
for (const f of fallos) console.log('❌ ' + f);
console.log(`${bien} correctas · ${fallos.length} fallidas`);
process.exit(fallos.length ? 1 : 0);
