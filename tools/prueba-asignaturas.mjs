/* ===========================================================================
   PRUEBA DE FUSIONAR ASIGNATURAS Y DEL TEMARIO — sin red y sin navegador.

   Borrar una asignatura pasando lo suyo a otra toca ocho secciones de datos a
   la vez (sesiones, tareas, apuntes, temas, notas, horario, decisiones del
   calendario, la propia lista). Si se queda una referencia colgando, no se
   rompe nada a la vista: simplemente faltan horas, casillas o apuntes.

   Uso:  node tools/prueba-asignaturas.mjs
   =========================================================================== */
const almacen = new Map();
globalThis.localStorage = {
  getItem: k => (almacen.has(k) ? almacen.get(k) : null),
  setItem: (k, v) => { almacen.set(k, String(v)); },
  removeItem: k => { almacen.delete(k); },
  clear: () => almacen.clear(),
};
const { guardar, leer } = await import('../app/js/core/store.js');
const { fusionarAsignatura, listaAsignaturas } = await import('../app/js/core/asignaturas.js');
const { crearTemas, temasDe } = await import('../app/js/core/temas.js');
const { asignaturaDeTitulo } = await import('../app/js/core/calendario.js');

let fallos = 0;
const mal = m => { console.log('❌ ' + m); fallos++; };
const bien = m => console.log('✅ ' + m);

const siembra = () => {
  almacen.clear();
  guardar('asignaturas', [
    { id: 'mat', nombre: 'Matemáticas CCSS II' }, { id: 'len', nombre: 'Lengua y Literatura' },
    { id: 'par', nombre: 'Matemáticas (particular)', tipo: 'particular' }, { id: 'rec', nombre: 'Recreo', tipo: 'bloque' },
  ]);
  guardar('sesiones', [{ id: 's1', asignaturaId: 'par', minutos: 75 }, { id: 's2', asignaturaId: 'mat', minutos: 60 }, { id: 's3', asignaturaId: 'len', minutos: 30 }]);
  guardar('tareas', [{ id: 't1', asignaturaId: 'par' }, { id: 't2', asignaturaId: 'len' }]);
  guardar('apuntesMeta', [{ id: 'a1', asignaturaId: 'par' }]);
  guardar('temas', [{ id: 'm1', asignaturaId: 'par', nombre: 'Matrices' }, { id: 'm2', asignaturaId: 'len', nombre: 'Sintaxis' }]);
  guardar('notas', { par: { objetivo: 7 }, len: { objetivo: 8 } });
  guardar('horario', { franjas: [], dias: { lunes: ['len', 'par', null, 'rec'], martes: ['mat', 'par'] } });
  guardar('calendario', { reglas: { 'ejercicios extra': 'par', planchar: 'no' }, decisiones: { b1: { asignaturaId: 'par' }, b2: { hecho: true } } });
};

siembra();
fusionarAsignatura('par', 'mat');
{
  const ids = k => leer(k, []).map(x => x.asignaturaId).join();
  ids('sesiones') === 'mat,mat,len' && ids('tareas') === 'mat,len' && ids('apuntesMeta') === 'mat'
    ? bien('sesiones, tareas y apuntes pasan a la asignatura de destino') : mal(`datos: ${ids('sesiones')} | ${ids('tareas')} | ${ids('apuntesMeta')}`);
  temasDe('mat').map(t => t.nombre).join() === 'Matrices' ? bien('los temas pasan con ella') : mal('temas mal movidos');
  const h = leer('horario', null).dias;
  h.lunes.join() === 'len,mat,,rec' && h.martes.join() === 'mat,mat'
    ? bien('las casillas del horario pasan al destino (y las vacías siguen vacías)') : mal(`horario: ${JSON.stringify(h)}`);
  const n = leer('notas', {});
  n.mat?.objetivo === 7 && !('par' in n) && n.len?.objetivo === 8 ? bien('las notas pasan si el destino no tenía') : mal(`notas: ${JSON.stringify(n)}`);
  const c = leer('calendario', {});
  c.reglas['ejercicios extra'] === 'mat' && c.reglas.planchar === 'no' && c.decisiones.b1.asignaturaId === 'mat' && c.decisiones.b2.hecho === true
    ? bien('lo decidido sobre el calendario sigue apuntando bien') : mal(`calendario: ${JSON.stringify(c)}`);
  listaAsignaturas().map(a => a.id).join() === 'mat,len,rec' ? bien('la asignatura origen desaparece') : mal('origen sigue en la lista');
}

siembra();
guardar('notas', { par: { objetivo: 7 }, mat: { objetivo: 9 } });
fusionarAsignatura('par', 'mat');
leer('notas', {}).mat.objetivo === 9 ? bien('si el destino ya tenía notas, mandan las suyas') : mal('notas del destino pisadas');

siembra();
fusionarAsignatura('par', null);
{
  const s = leer('sesiones', []).find(x => x.id === 's1');
  s && s.asignaturaId === null && !temasDe('par').length && !leer('temas', []).some(t => t.asignaturaId === 'par')
    && leer('horario', null).dias.lunes.join() === 'len,,,rec' && leer('calendario', {}).reglas['ejercicios extra'] === 'no'
    ? bien('sin destino: nada se pierde salvo los temas; casillas y reglas quedan sin asignatura') : mal('fusión sin destino incorrecta');
}

siembra();
const antes = JSON.stringify([...almacen.entries()]);
fusionarAsignatura('par', 'par'); fusionarAsignatura('', 'mat');
JSON.stringify([...almacen.entries()]) === antes ? bien('fusionar consigo misma o sin origen no toca nada') : mal('fusión degenerada modificó datos');

// La sugerencia de destino al borrar.
{
  const otras = [{ id: 'mat', nombre: 'Matemáticas CCSS II' }, { id: 'len', nombre: 'Lengua y Literatura' }, { id: 'fil', nombre: 'Historia de la Filosofía' }];
  asignaturaDeTitulo('Matemáticas (particular)', otras) === 'mat' && asignaturaDeTitulo('Recreo', otras) === null
    ? bien('al borrar se sugiere la asignatura del curso con ese nombre, y solo si hay una clara') : mal('sugerencia de destino incorrecta');
}

/* ------------------------------- temario ---------------------------------- */
{
  siembra();
  const c = crearTemas('len', ['Tema 1', '  Tema 2  ', '', 'tema 1', 'Sintaxis', 'Tema 2']);
  c.map(t => t.nombre).join() === 'Tema 1,Tema 2' && temasDe('len').length === 3
    ? bien('crearTemas salta vacíos y repetidos (sin mirar mayúsculas) y no duplica los que ya había')
    : mal(`crearTemas: ${c.map(t => t.nombre)} / ${temasDe('len').length}`);
  new Set(c.map(t => t.id)).size === c.length && c.every(t => t.dominio === 0 && t.asignaturaId === 'len')
    ? bien('cada tema nuevo tiene id propio y dominio 0') : mal('temas nuevos mal formados');
}

console.log(fallos ? `\n${fallos} fallo(s)` : '\ntodo bien');
process.exit(fallos ? 1 : 0);
