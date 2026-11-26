/* PRUEBA DE LAS NOTAS DE LOS EXÁMENES — sin red y sin navegador.
   La nota de un examen vive en `notas` con `examenId` (ver core/motor.js).
   Comprueba: a qué evaluación cae una fecha, qué exámenes faltan por puntuar,
   la nota aproximada que cuenta en la media y se cambia por la oficial (con lo
   que se desvía al estimar), y lo que ven Salud y el briefing por el buzón.
   Uso:  node tools/prueba-notas-examenes.mjs */

const almacen = new Map();
globalThis.localStorage = {
  getItem: k => (almacen.has(k) ? almacen.get(k) : null),
  setItem: (k, v) => { almacen.set(k, String(v)); },
  removeItem: k => { almacen.delete(k); },
  clear: () => almacen.clear(),
};

const motor = await import('../app/js/core/motor.js');
const { guardar } = await import('../app/js/core/store.js');
const { hoyLocal, sumaDias } = await import('../app/js/core/fmt.js');
const { historicoSalud } = await import('../worker/historico.js');
const { resumenBriefing } = await import('../worker/briefing.js');
const { examenesSinPuntuar, notasPorExamen } = await import('../worker/notas-examenes.js');

let fallos = 0;
const comprueba = (que, ok, detalle = '') => { if (ok) console.log('✅ ' + que); else { console.log(`❌ ${que}${detalle ? ' — ' + detalle : ''}`); fallos++; } };
const casi = (a, b) => Math.abs(a - b) < 1e-9;

/* evaluación por fecha */
comprueba('septiembre a 22 dic es la 1ª', motor.evaluacionDeFecha('2026-09-15') === '1' && motor.evaluacionDeFecha('2026-12-22') === '1');
comprueba('23 dic a 22 mar es la 2ª', motor.evaluacionDeFecha('2026-12-23') === '2' && motor.evaluacionDeFecha('2027-03-22') === '2');
comprueba('desde el 23 mar es la 3ª', motor.evaluacionDeFecha('2027-03-23') === '3' && motor.evaluacionDeFecha('2027-06-10') === '3');

/* datos: dos exámenes pasados (uno con nota), uno futuro */
const hoy = hoyLocal();
const f = n => sumaDias(hoy, n);
guardar('asignaturas', [{ id: 'a1', nombre: 'Historia', color: '#888' }]);
guardar('tareas', [
  { id: 'e1', tipo: 'examen', titulo: 'Tema 1', fecha: f(-10), asignaturaId: 'a1', estado: 'pendiente' },
  { id: 'e2', tipo: 'examen', titulo: 'Tema 2', fecha: f(-3), asignaturaId: 'a1', estado: 'pendiente' },
  { id: 'e3', tipo: 'examen', titulo: 'Tema 3', fecha: f(5), asignaturaId: 'a1', estado: 'pendiente' },
  { id: 'e0', tipo: 'examen', titulo: 'Antiguo', fecha: f(-200), asignaturaId: 'a1', estado: 'pendiente' },
]);
guardar('notas', {});

comprueba('sin notas: faltan e2 y e1 (más reciente primero); el de hace 200 días no se reclama',
  motor.examenesSinPuntuar().map(e => e.id).join() === 'e2,e1');
comprueba('el aviso de Hoy sale y lleva a puntuar', motor.riesgos().some(r => r.accion?.puntuar && r.accion.examenId === 'e2'));
comprueba('sin ninguna nota, no hay resumen', motor.resumenExamenes() === null);

/* nota aproximada de e1, que cuenta en la media */
const nota = (id, extra) => ({ id, titulo: 'Tema 1', valor: 6, peso: 1, fecha: f(-10), examenId: 'e1', ...extra });
guardar('notas', { a1: { objetivo: null, evaluaciones: { 1: [nota('n1', { aprox: true })], 2: [], 3: [] } } });
comprueba('e1 ya no falta, e2 sí', motor.examenesSinPuntuar().map(e => e.id).join() === 'e2');
comprueba('notaDeExamen encuentra la nota y dónde está', motor.notaDeExamen('e1')?.nota.valor === 6 && motor.notaDeExamen('e1').evaluacion === '1');
comprueba('la aproximada cuenta en la media del curso', casi(motor.mediaDelCurso({ 1: [nota('n1')] }), 6));
let r = motor.resumenExamenes();
comprueba('resumen: 1 examen, 1 aproximada, sin desviación todavía', r.n === 1 && r.aprox === 1 && r.sesgo === null);

/* llega la oficial: 7,5 sobre una aproximada de 6 -> se desvía +1,5 */
guardar('notas', { a1: { objetivo: null, evaluaciones: { 1: [nota('n1', { valor: 7.5, aproxPrevia: 6 })], 2: [], 3: [] } } });
r = motor.resumenExamenes();
comprueba('con la oficial ya no es aproximada y se ve la desviación (+1,5)', r.aprox === 0 && r.sesgo.n === 1 && casi(r.sesgo.media, 1.5));

/* horas y nota: con 4 exámenes puntuados se compara */
guardar('tareas', ['a', 'b', 'c', 'd'].map((x, i) => ({ id: 'x' + x, tipo: 'examen', titulo: x, fecha: f(-20 - i * 20), asignaturaId: 'a1', estado: 'pendiente' })));
guardar('sesiones', [
  { id: 's1', fecha: f(-25), asignaturaId: 'a1', minutos: 300 },   // antes de xa (hace 20)
  { id: 's2', fecha: f(-45), asignaturaId: 'a1', minutos: 240 },   // antes de xb (hace 40)
  { id: 's3', fecha: f(-70), asignaturaId: 'a1', minutos: 20 },    // antes de xc (hace 60)
  { id: 's4', fecha: f(-90), asignaturaId: 'a1', minutos: 10 },    // antes de xd (hace 80)
]);
const n2 = (id, ex, valor) => ({ id, titulo: ex, valor, peso: 1, fecha: '2026-01-01', examenId: ex });
guardar('notas', { a1: { objetivo: null, evaluaciones: { 1: [n2('p1', 'xa', 9), n2('p2', 'xb', 8), n2('p3', 'xc', 5), n2('p4', 'xd', 4)], 2: [], 3: [] } } });
r = motor.resumenExamenes();
comprueba('con 4 exámenes se compara estudiar más con estudiar menos', r.horas && r.horas.n === 4 && casi(r.horas.masHoras, 8.5) && casi(r.horas.menosHoras, 4.5), JSON.stringify(r.horas));
guardar('notas', { a1: { objetivo: null, evaluaciones: { 1: [n2('p1', 'xa', 9), n2('p2', 'xb', 8)], 2: [], 3: [] } } });
comprueba('con menos de 4 no se saca ninguna conclusión de las horas', motor.resumenExamenes().horas === null);

/* subidas de nota: repetir un examen, cuenta la mayor */
const base1 = { id: 'n1', titulo: 'Tema 1', valor: 6, peso: 1, fecha: f(-10), examenId: 'e1' };
const sub = (id, valor, extra) => ({ id, valor, fecha: f(-2), ...extra });
let c = motor.conSubidas(base1, [sub('s1', 8)]);
comprueba('subida mayor: valor pasa a ser la subida y se guarda el primer intento', c.valor === 8 && c.valorInicial === 6 && c.subidas.length === 1);
c = motor.conSubidas(base1, [sub('s1', 4)]);
comprueba('subida menor: se guarda pero no cuenta', c.valor === 6 && c.valorInicial === 6 && c.subidas.length === 1);
c = motor.conSubidas(base1, [sub('s1', 7), sub('s2', 9), sub('s3', 5)]);
comprueba('varias subidas: cuenta la mayor', c.valor === 9);
c = motor.conSubidas(base1, []);
comprueba('sin subidas la entrada queda limpia (borrar la subida devuelve la inicial)', c.valor === 6 && !('subidas' in c) && !('valorInicial' in c));
c = motor.conSubidas(motor.intentoInicial(motor.conSubidas(base1, [sub('s1', 8)])), []);
comprueba('quitar la última subida deja la nota como antes de apuntarla', c.valor === 6 && !('subidas' in c));
const aproxIni = { ...base1, aprox: true };
c = motor.conSubidas(aproxIni, [sub('s1', 8)]);
comprueba('subida oficial sobre inicial aproximada: la que cuenta ya no es aproximada', c.valor === 8 && !c.aprox && c.aproxInicial === true);
c = motor.conSubidas(base1, [sub('s1', 8, { aprox: true })]);
comprueba('subida aproximada que gana: la nota cuenta como aproximada', c.valor === 8 && c.aprox === true && !c.aproxInicial);
c = motor.conSubidas(base1, [sub('s1', 6, { aprox: true })]);
comprueba('empate con la subida aproximada: gana la oficial', c.valor === 6 && !c.aprox);
comprueba('intentoInicial deshace conSubidas', (() => { const i = motor.intentoInicial(motor.conSubidas(aproxIni, [sub('s1', 8)])); return i.valor === 6 && i.aprox === true && !('subidas' in i); })());
comprueba('intentoInicial no toca una nota sin subidas', motor.intentoInicial(base1) === base1);

guardar('tareas', [{ id: 'e1', tipo: 'examen', titulo: 'Tema 1', fecha: f(-10), asignaturaId: 'a1', estado: 'pendiente' }]);
/* la media usa la que cuenta; el resumen separa media (final) de horas/aproximada (primer intento) */
guardar('notas', { a1: { objetivo: null, evaluaciones: { 1: [motor.conSubidas(base1, [sub('s1', 8)])], 2: [], 3: [] } } });
comprueba('la media del curso usa la nota que cuenta (8)', casi(motor.mediaDelCurso(motor.notaDeExamen('e1') && { 1: [motor.notaDeExamen('e1').nota] }), 8));
comprueba('el examen con subida ya no se reclama como sin puntuar', !motor.examenesSinPuntuar().some(e => e.id === 'e1'));
r = motor.resumenExamenes();
comprueba('resumen: media con la subida y 1 examen repetido que subió 2', casi(r.media, 8) && r.subidas.n === 1 && casi(r.subidas.media, 2), JSON.stringify(r.subidas));
guardar('notas', { a1: { objetivo: null, evaluaciones: { 1: [motor.conSubidas(base1, [sub('s1', 4)])], 2: [], 3: [] } } });
r = motor.resumenExamenes();
comprueba('resumen: una subida que no supera cuenta como subida de 0', r.subidas.n === 1 && casi(r.subidas.media, 0) && casi(r.media, 6));
guardar('notas', { a1: { objetivo: null, evaluaciones: { 1: [nota('n1', { valor: 6 })], 2: [], 3: [] } } });
comprueba('sin ninguna subida, el resumen no trae el bloque', motor.resumenExamenes().subidas === null);

/* la desviación de la aproximada se mide contra el primer intento, no contra la subida */
guardar('notas', { a1: { objetivo: null, evaluaciones: { 1: [motor.conSubidas({ ...base1, valor: 7.5, aproxPrevia: 6 }, [sub('s1', 9)])], 2: [], 3: [] } } });
r = motor.resumenExamenes();
comprueba('desviación de la estimación: 7,5 oficial frente a 6 aproximada (+1,5), no 9', r.sesgo && casi(r.sesgo.media, 1.5), JSON.stringify(r.sesgo));

/* las horas estudiadas se comparan con el primer intento: la subida se prepara otro día */
guardar('tareas', ['a', 'b', 'c', 'd'].map((x, i) => ({ id: 'x' + x, tipo: 'examen', titulo: x, fecha: f(-20 - i * 20), asignaturaId: 'a1', estado: 'pendiente' })));
guardar('sesiones', [
  { id: 's1', fecha: f(-25), asignaturaId: 'a1', minutos: 300 },
  { id: 's2', fecha: f(-45), asignaturaId: 'a1', minutos: 240 },
  { id: 's3', fecha: f(-70), asignaturaId: 'a1', minutos: 20 },
  { id: 's4', fecha: f(-90), asignaturaId: 'a1', minutos: 10 },
]);
const ex = (id, examenId, valor, subidas) => motor.conSubidas({ id, titulo: examenId, valor, peso: 1, fecha: '2026-01-01', examenId }, subidas);
guardar('notas', { a1: { objetivo: null, evaluaciones: { 1: [ex('p1', 'xa', 9), ex('p2', 'xb', 8), ex('p3', 'xc', 5, [sub('q1', 10)]), ex('p4', 'xd', 4, [sub('q2', 10)])], 2: [], 3: [] } } });
r = motor.resumenExamenes();
comprueba('con subidas a 10 en los de poco estudio, las horas siguen comparando el primer intento (8,5 vs 4,5)', r.horas && casi(r.horas.masHoras, 8.5) && casi(r.horas.menosHoras, 4.5), JSON.stringify(r.horas));
comprueba('...y la media sí usa lo que cuenta (9, 8, 10, 10)', casi(r.media, 9.25));

/* el buzón: lo que leen Salud y el briefing */
const buzon = {
  claves: {
    asignaturas: { datos: [{ id: 'a1', nombre: 'Historia' }] },
    tareas: { datos: [
      { id: 'e1', tipo: 'examen', titulo: 'Tema 1', fecha: f(-10), asignaturaId: 'a1', estado: 'pendiente' },
      { id: 'e2', tipo: 'examen', titulo: 'Tema 2', fecha: f(-3), asignaturaId: 'a1', estado: 'pendiente' },
    ] },
    notas: { datos: { a1: { evaluaciones: { 1: [{ id: 'n1', valor: 7.5, examenId: 'e1' }], 2: [], 3: [{ id: 'n3', valor: 3, aprox: true, examenId: 'otro' }] } } } },
  },
};
const mapa = notasPorExamen(buzon);
comprueba('el buzón da la nota de cada examen y si es aproximada', mapa.get('e1').valor === 7.5 && mapa.get('e1').aprox === false && mapa.get('otro').aprox === true);
const falta = examenesSinPuntuar(buzon, hoy);
comprueba('briefing: solo falta e2 (sin nota, últimos 14 días)', falta.length === 1 && falta[0].titulo === 'Tema 2' && falta[0].asignatura === 'Historia');
comprueba('briefing: un examen de hace más de 14 días no se reclama', examenesSinPuntuar(buzon, sumaDias(hoy, 30)).length === 0);
comprueba('resumenBriefing trae examenesSinPuntuar sin romper lo de siempre',
  Array.isArray(resumenBriefing(buzon).examenesSinPuntuar) && 'proximoExamen' in resumenBriefing(buzon) && 'horarioHoy' in resumenBriefing(buzon));
const notaSub = motor.conSubidas({ id: 'n1', valor: 6, examenId: 'e1' }, [sub('s1', 9)]);
const buzonSub = { claves: { ...buzon.claves, notas: { datos: { a1: { evaluaciones: { 1: [notaSub], 2: [], 3: [] } } } } } };
const mapaSub = notasPorExamen(buzonSub);
comprueba('Worker: con subida, el buzón da el primer intento (6), no la subida', mapaSub.get('e1').valor === 6 && mapaSub.get('e1').aprox === false);
comprueba('Worker: un examen con subida no se reclama como sin puntuar', !examenesSinPuntuar(buzonSub, hoy).some(x => x.titulo === 'Tema 1'));
const h = historicoSalud(buzon, [f(-10), f(-3), f(-1)]);
comprueba('Salud: el día del examen trae la nota y no es aproximada', h[f(-10)].examen_nota === 7.5 && h[f(-10)].examen_nota_aprox === false);
comprueba('Salud: un día sin nota sale null (no 0)', h[f(-3)].examen_nota === null && h[f(-1)].examen_nota === null && h[f(-1)].examen_nota_aprox === null);
comprueba('Salud: sigue viendo el examen aunque tenga nota (no se marca hecho)', h[f(-11)] === undefined && historicoSalud(buzon, [f(-12)])[f(-12)].examen_dias === 2);

console.log(fallos ? `\n${fallos} fallos` : '\n0 fallos');
process.exit(fallos ? 1 : 0);
