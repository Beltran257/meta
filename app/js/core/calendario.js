/* ===========================================================================
   ESTUDIO DESDE EL CALENDARIO — la entrada principal de las horas de estudio.

   Él planifica en Google Tasks con hora ("Estudiar arte", 16:30–18:30) y
   marca la tarea cuando la hace. META ya no le pide que apunte nada: un Apps
   Script en su cuenta de Google le manda esos bloques cada hora (ver
   worker/estudio.js y core/script-estudio.js), META decide de qué asignatura
   es cada uno y los convierte en sesiones de estudio normales, con origen
   'calendario'. Así cuentan en todo lo demás (Hoy, análisis, preparación de
   exámenes) sin que el motor sepa de dónde vienen.

   Qué cuenta:
   · Solo los bloques cuya tarea está MARCADA como hecha. Un bloque es un plan;
     la casilla es lo que dice que pasó. Los de la última semana sin marcar se
     preguntan ("¿lo hiciste?"); los más viejos se dan por no hechos.
   · Los minutos son los del bloque. Si dos o más bloques hechos se solapan, el
     tiempo común se cuenta UNA vez en total y se reparte por igual entre
     ellos (repartirMinutos): así todo lo que marcó como hecho cuenta para su
     asignatura y su tema, y las horas no se inflan. Antes el primero se
     quedaba con todo y uno que caía entero dentro de otro sumaba 0 min.
   · Lo que no se sabe de qué asignatura es se pregunta UNA vez y, si él
     quiere, se recuerda para ese título.
   · "Imprimir…", "Grapar…", "Subir…" son logística: no cuentan como estudio.

   Las funciones puras de arriba no tocan nada del navegador: las prueba
   tools/prueba-estudio-calendario.mjs sin red.
   =========================================================================== */

import { leer, guardar } from './store.js';
import { emitir, on } from './bus.js';
import * as sesion from './sesion.js';
import { unidadDe } from './temario.js';

export const norma = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ').replace(/\s+/g, ' ').trim();

const VACIAS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'a', 'en', 'i', 'ii', 'iii', '1', '2']);

/* Palabras con las que se nombra una asignatura en un título sin decir su
   nombre entero. Se aplican a la asignatura cuyo NOMBRE cumple el patrón, así
   valen con los nombres que tenga cada uno. `peso` bajo = pista débil: el
   "historia" suelto es Historia de España, pero "historia del arte" gana. */
const ALIAS = [
  { nombre: /matem/, palabras: ['mates', 'mate', 'matematicas', 'matrices', 'determinantes', 'derivadas', 'integrales', 'probabilidad', 'estadistica'] },
  { nombre: /lengua|literatura/, palabras: ['lengua', 'literatura', 'sintaxis', 'morfologia', 'ortografia', 'poesia', 'novela'] },
  { nombre: /ingl/, palabras: ['ingles', 'english', 'portfolio', 'writing', 'listening', 'reading'] },
  { nombre: /filosof/, palabras: ['filosofia', 'filo', 'platon', 'socrates', 'aristoteles', 'presocraticos', 'descartes', 'kant', 'nietzsche', 'marx'] },
  { nombre: /arte/, palabras: ['arte', 'ordenes arquitectonicos'] },
  { nombre: /espa/, palabras: ['historia'], peso: 0.5 },
  { nombre: /espa/, palabras: ['referentes'] },
  { nombre: /econom|empresa/, palabras: ['economia', 'empresa', 'eydmn'] },
  { nombre: /\bfag\b|fundamentos/, palabras: ['fag'] },
];

const RE_LOGISTICA = /^(imprimir|grapar|escanear|fotocopiar|mandar|enviar|subir|comprar|llevar|plastificar)\b/;

const contiene = (t, frase) => (' ' + t + ' ').includes(' ' + frase + ' ');

/** ¿De qué asignatura es este título? null si no se puede saber con
    seguridad (empate o ninguna pista). Las particulares pierden los empates
    frente a las del curso: "ejercicios matemáticas" es la del instituto.
    Una clase particular cuenta para la asignatura DEL CURSO que nombra
    ("Particulares matemáticas" son horas de Matemáticas): así lo quiere él,
    aunque tenga una asignatura de tipo particular para pintarla en el horario. */
export function asignaturaDeTitulo(titulo, asignaturas) {
  const t = norma(titulo);
  if (!t) return null;
  const particular = esParticular(titulo);
  const lista = (asignaturas || []).filter(a => a?.id && a.nombre && a.tipo !== 'bloque' &&
    !(particular && a.tipo === 'particular'));
  const tokens = new Map(lista.map(a => [a.id, norma(a.nombre).split(' ').filter(p => p && !VACIAS.has(p))]));
  const veces = new Map();
  for (const ts of tokens.values()) for (const p of new Set(ts)) veces.set(p, (veces.get(p) || 0) + 1);

  const puntos = lista.map(a => {
    const nombre = norma(a.nombre);
    let p = contiene(t, nombre) ? 6 : 0;
    for (const tok of new Set(tokens.get(a.id))) if (contiene(t, tok)) p += veces.get(tok) === 1 ? 3 : 1;
    for (const al of ALIAS) {
      if (!al.nombre.test(nombre)) continue;
      for (const w of al.palabras) if (contiene(t, w)) p += al.peso ?? 3;
    }
    return { a, p };
  }).filter(x => x.p >= 1)
    .sort((x, y) => y.p - x.p || (x.a.tipo === 'particular') - (y.a.tipo === 'particular'));

  if (!puntos.length) return null;
  const [primero, segundo] = puntos;
  if (segundo && segundo.p === primero.p && (segundo.a.tipo === 'particular') === (primero.a.tipo === 'particular')) return null;
  return primero.a.id;
}

/* ---------------------------- tema de cada bloque -------------------------
   Qué tema estudió se deduce del título cuando lo dice y, si no, se le
   pregunta (hojas "¿Qué tema era?" de Estudiar). Nunca se adivina con poca
   base: un título como "Estudiar historia" no dice el tema, y asignar uno al
   azar haría mentir a las horas por tema. */
const SIN_VALOR = new Set(['para', 'sobre', 'entre', 'desde', 'hasta', 'como', 'esto', 'estas', 'estos', 'tema', 'bloque',
  'unidad', 'repasar', 'estudiar', 'apuntes', 'hacer', 'cuaderno', 'resumen', 'esquema', 'ejercicios', 'texto', 'ficha', 'fichas']);

/** El tema (id) que nombra el título, o null si no lo dice con claridad:
    1. un número explícito ("tema 3", "bloque 2") que identifica UN tema;
    2. un apartado ("A3") cuando el temario va por apartados;
    3. una palabra distintiva de UN solo tema ("Platón", "romanización"). */
export function temaDeTitulo(titulo, temas, nombreAsignatura = '') {
  const lista = (temas || []).filter(t => t?.id && t.nombre);
  if (!lista.length) return null;
  const unico = c => (c.length === 1 ? c[0].id : null);
  const t = norma(titulo);

  const m = /\b(?:tema|bloque|unidad|ud|leccion|capitulo)\s*(\d{1,2})\b/.exec(t);
  if (m) {
    const id = unico(lista.filter(x => { const u = unidadDe(x.nombre); return u && !u.sec && u.num === +m[1]; }));
    if (id) return id;
  }
  const a = /\b([A-E])\s?(\d{1,2})\b/.exec(String(titulo || ''));
  if (a) {
    const id = unico(lista.filter(x => { const u = unidadDe(x.nombre); return u && u.sec === a[1] && u.num === +a[2]; }));
    if (id) return id;
  }
  const palabras = new Set(t.split(' '));
  // Las palabras del nombre de la propia asignatura ("filosofía" en Historia de
  // la Filosofía) están en todos los títulos y no distinguen un tema de otro.
  const deLaAsignatura = new Set(norma(nombreAsignatura).split(' '));
  const fichas = lista.map(x => ({
    id: x.id,
    claves: norma(String(x.nombre).replace(/^\s*(?:tema|bloque|unidad|ud|lecci[oó]n|cap[ií]tulo)\s*\d+[.:)]?\s*|^[A-Z]\d+[.:)]\s*/i, ''))
      .split(' ').filter(w => w.length >= 5 && !SIN_VALOR.has(w) && !deLaAsignatura.has(w)),
  }));
  const cuantos = new Map();
  for (const f of fichas) for (const w of new Set(f.claves)) cuantos.set(w, (cuantos.get(w) || 0) + 1);
  return unico(fichas.filter(f => f.claves.some(w => cuantos.get(w) === 1 && palabras.has(w))));
}

export const esLogistica = titulo => RE_LOGISTICA.test(norma(titulo));
export const esParticular = titulo => /\bparticular(es)?\b/.test(norma(titulo));

export function tipoDeTitulo(titulo) {
  const t = norma(titulo);
  if (/\brepas/.test(t)) return 'repaso';
  if (/\b(ejercicios?|problemas|actividades|pag|pagina)\b/.test(t)) return 'ejercicios';
  if (/\bparticular(es)?\b/.test(t)) return 'ejercicios';   // las particulares son de hacer ejercicios
  if (/\b(simulacro|examen)\b/.test(t)) return 'simulacro';
  if (/\bclase\b/.test(t)) return 'clase';
  return 'teoria';
}

/** Día local (YYYY-MM-DD) de una fecha ISO con zona. */
const diaDe = iso => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const DIAS_PREGUNTA = 7;

/** Minutos de cada intervalo {ini, fin} (ms) cuando el tiempo que varios se
    pisan se reparte POR IGUAL entre ellos. Es función del tiempo, no del orden:
    dos tareas a la misma hora suman lo mismo que una sola, a medias. El total
    es la unión de los intervalos. Enteros: el redondeo va acumulado por orden
    de inicio, para que la suma no gane ni pierda minutos sueltos. */
export function repartirMinutos(intervalos) {
  const cortes = [...new Set(intervalos.flatMap(i => [i.ini, i.fin]))].sort((a, b) => a - b);
  const ms = intervalos.map(() => 0);
  for (let k = 0; k < cortes.length - 1; k++) {
    const a = cortes[k], z = cortes[k + 1];
    const activos = [];
    intervalos.forEach((i, n) => { if (i.ini <= a && i.fin >= z) activos.push(n); });
    for (const n of activos) ms[n] += (z - a) / activos.length;
  }
  const salida = intervalos.map(() => 0);
  let acum = 0, previo = 0;
  intervalos.map((i, n) => n).sort((x, y) => intervalos[x].ini - intervalos[y].ini || x - y).forEach(n => {
    acum += ms[n] / 60000;
    const r = Math.round(acum + 1e-9);
    salida[n] = r - previo;
    previo = r;
  });
  return salida;
}

/** Función pura: bloques + lo que él ha decidido -> sesiones y preguntas.
    `ajustes` = { reglas: {tituloNormalizado: asignaturaId | 'no'},
                  decisiones: {idBloque: {hecho?: bool, asignaturaId?: id | 'no'}} } */
const DIAS_TEMA = 14;
const minutosReales = d => (Number.isFinite(d?.minutos) && d.minutos > 0 ? Math.round(d.minutos) : 0);

export function sesionesDeBloques(bloques, asignaturas, ajustes = {}, ahora = Date.now(), temas = []) {
  const reglas = ajustes.reglas || {};
  const decisiones = ajustes.decisiones || {};
  const existe = new Set((asignaturas || []).filter(a => a.tipo !== 'bloque').map(a => a.id));
  const resultado = { sesiones: [], pendientes: [], dudosos: [], temaPendientes: [] };
  const temasDe = id => (temas || []).filter(t => t.asignaturaId === id);
  const hechas = [];

  for (const b of bloques || []) {
    const d = decisiones[b.id] || {};
    const regla = reglas[norma(b.titulo)];
    const elegida = d.asignaturaId !== undefined ? d.asignaturaId : regla;
    let asignaturaId = null, clase;
    if (elegida === 'no') clase = 'fuera';
    else if (elegida && existe.has(elegida)) { asignaturaId = elegida; clase = 'estudio'; }
    else if (esLogistica(b.titulo)) clase = 'fuera';
    else {
      // Primero el título; si no la dice, la lista de Tasks donde está la
      // tarea (quien tiene una lista por asignatura no tiene que contestar nada).
      asignaturaId = asignaturaDeTitulo(b.titulo, asignaturas) || (b.lista ? asignaturaDeTitulo(b.lista, asignaturas) : null);
      clase = asignaturaId ? 'estudio' : 'dudoso';
    }
    const hecho = d.hecho ?? (b.estado === 'hecha');
    const reciente = ahora - Date.parse(b.fin) <= DIAS_PREGUNTA * 864e5;

    if (clase === 'estudio' && hecho) {
      // El tema: lo que él eligió ("ninguno" = varios / sin tema concreto, no se
      // vuelve a preguntar) o lo que dice el título. Las particulares son clases,
      // no se pregunta por su tema.
      const propios = temasDe(asignaturaId);
      let temaId = null, preguntar = false;
      if (d.temaId === 'ninguno') temaId = null;
      else if (d.temaId && propios.some(t => t.id === d.temaId)) temaId = d.temaId;
      else {
        temaId = temaDeTitulo(b.titulo, propios, (asignaturas || []).find(a => a.id === asignaturaId)?.nombre || '');
        preguntar = !temaId && propios.length > 0 && b.fuente !== 'particular' && ahora - Date.parse(b.fin) <= DIAS_TEMA * 864e5;
      }
      hechas.push({ b, asignaturaId, temaId });
      if (preguntar) resultado.temaPendientes.push({ ...b, asignaturaId });
    }
    else if (clase === 'estudio' && d.hecho === undefined && reciente) resultado.pendientes.push({ ...b, asignaturaId });
    else if (clase === 'dudoso' && hecho) resultado.dudosos.push(b);
  }

  // El tiempo que varios bloques hechos se pisan se cuenta una vez en total y se
  // reparte por igual entre ellos (repartirMinutos).
  hechas.sort((x, y) => x.b.inicio.localeCompare(y.b.inicio));
  const intervalos = hechas.map(({ b }) => {
    const ini = Date.parse(b.inicio), real = minutosReales(decisiones[b.id]);
    // Si dijo cuánto estudió de verdad (decisión `minutos`), manda sobre lo planificado.
    return { ini, fin: real ? ini + real * 60000 : Date.parse(b.fin) };
  });
  const reparto = repartirMinutos(intervalos);
  hechas.forEach(({ b, asignaturaId, temaId }, n) => {
    const minutos = reparto[n];
    if (minutos < 1) return;
    resultado.sesiones.push({
      id: 'cal-' + b.id,
      fecha: diaDe(b.inicio),
      asignaturaId,
      temaId,
      tipo: tipoDeTitulo(b.titulo),
      minutos,
      resultado: 'regular',
      notas: b.titulo,
      origen: 'calendario',
      creado: intervalos[n].ini,
    });
  });
  return resultado;
}

/** Primer día del curso: el 1 de septiembre del año académico de `hoy`. */
export function inicioCurso(hoy = new Date()) {
  const anio = hoy.getMonth() >= 8 ? hoy.getFullYear() : hoy.getFullYear() - 1;
  return `${anio}-09-01`;
}

/* ============================ con almacenamiento ========================== */

const ajustes = () => ({ reglas: {}, decisiones: {}, ...leer('calendario', {}) });
export const cache = () => ({ bloques: [], ultima: null, enviado: null, error: null, motivo: null, ...leer('calendarioBloques', {}) });

/** Lo que hay que enseñar ahora: preguntas pendientes y estado de la lectura. */
export function estado() {
  const c = cache();
  const r = sesionesDeBloques(c.bloques, leer('asignaturas', []), ajustes(), Date.now(), leer('temas', []));
  return { ...c, ...r, horas: r.sesiones.reduce((s, x) => s + x.minutos, 0) / 60 };
}

/** Rehace las sesiones de origen 'calendario' a partir de lo último leído. Si
    no cambia nada, no escribe: cada escritura de 'sesiones' viaja a los demás
    aparatos, y abrir la app no debería generar tráfico ni pisar nada. */
function aplicar() {
  const c = cache();
  if (!c.ultima) return false;
  const nuevas = sesionesDeBloques(c.bloques, leer('asignaturas', []), ajustes(), Date.now(), leer('temas', [])).sesiones;
  const todas = leer('sesiones', []);
  const viejas = todas.filter(s => s.origen === 'calendario');
  const firma = l => JSON.stringify(l.map(s => [s.id, s.fecha, s.asignaturaId, s.temaId || null, s.tipo, s.minutos]).sort());
  if (firma(viejas) === firma(nuevas)) return false;
  guardar('sesiones', [...todas.filter(s => s.origen !== 'calendario'), ...nuevas]);
  emitir('local-cambio');
  emitir('datos-cambio', ['sesiones']);
  return true;
}

let enCurso = null;
const CADA = 20 * 60 * 1000;

/** Lee el calendario y aplica. Sin forzar, no repite si leyó hace poco. */
export function importar({ forzar = false } = {}) {
  if (!sesion.dentro()) return Promise.resolve(null);
  if (enCurso) return enCurso;
  const c = cache();
  if (!forzar && c.ultima && Date.now() - c.ultima < CADA && !c.error) return Promise.resolve(null);

  enCurso = (async () => {
    try {
      const r = await sesion.pedir('/api/estudio', { silencioso: true });
      if (!r.instalado || !r.ultima) {
        guardar('calendarioBloques', { ...c, error: 'Falta instalar el enlace con tu calendario (Perfil → Estudio desde tu calendario).', motivo: 'sin-script' });
      } else {
        // `ultima` = cuándo leyó META; `enviado` = cuándo mandó el script lo
        // último. Si el script lleva horas sin mandar, se dice (ver estudiar.js).
        guardar('calendarioBloques', { bloques: r.bloques || [], ultima: Date.now(), enviado: r.ultima, error: null, motivo: null });
        aplicar();
      }
    } catch (e) {
      guardar('calendarioBloques', { ...c, error: e.message || 'No se pudo leer el calendario', motivo: 'red' });
    } finally {
      enCurso = null;
      emitir('calendario-cambio');
    }
  })();
  return enCurso;
}

function decidir(idBloque, cambio, regla) {
  const a = ajustes();
  a.decisiones = { ...a.decisiones, [idBloque]: { ...a.decisiones[idBloque], ...cambio } };
  if (regla) a.reglas = { ...a.reglas, [norma(regla.titulo)]: regla.valor };
  guardar('calendario', a);
  emitir('local-cambio');
  aplicar();
  emitir('calendario-cambio');
}

/** "¿Lo hiciste?" — para un bloque de la última semana sin marcar. */
export const responder = (idBloque, hecho) => decidir(idBloque, { hecho });

/** Historial: "esto no lo estudié" (se quita de las horas) y su vuelta atrás. */
export const quitarSesion = idBloque => decidir(idBloque, { hecho: false });
export const restaurarSesion = idBloque => decidir(idBloque, { hecho: true });
/** "Estudié X minutos, no lo planificado." */
export const ajustarMinutos = (idBloque, minutos) => decidir(idBloque, { minutos: Math.max(1, Math.min(600, Math.round(minutos))) });

/** Los bloques que él quitó del historial (para poder devolverlos). */
export function quitadas() {
  const dec = ajustes().decisiones;
  return cache().bloques.filter(b => dec[b.id]?.hecho === false && b.estado === 'hecha');
}

/** "¿De qué asignatura es?" — asignaturaId o 'no' (no es estudio). Con
    `recordar`, vale también para todos los bloques con ese mismo título. */
export function asignar(idBloque, asignaturaId, recordar) {
  const b = cache().bloques.find(x => x.id === idBloque);
  decidir(idBloque, { asignaturaId }, recordar && b ? { titulo: b.titulo, valor: asignaturaId } : null);
}

/** "¿Qué tema era?" — temaId, o 'ninguno' (varios / sin tema concreto). */
export const asignarTema = (idBloque, temaId) => decidir(idBloque, { temaId });

/* Si cambian los temas o las asignaturas (se sube un temario, se borra una
   asignatura…), lo que dicen los títulos de los bloques se vuelve a leer: un
   "Repasar Platón" empieza a colgar del tema Platón en cuanto existe. aplicar()
   solo escribe si algo cambia, así que no hay bucle con sus propios avisos. */
on('datos-cambio', cambiadas => {
  if (Array.isArray(cambiadas) && (cambiadas.includes('temas') || cambiadas.includes('asignaturas') || cambiadas.includes('todo'))) aplicar();
});
