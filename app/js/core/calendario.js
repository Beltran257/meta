/* ===========================================================================
   ESTUDIO DESDE EL CALENDARIO — la entrada principal de las horas de estudio.

   Él planifica en Google Tasks con hora ("Estudiar arte", 16:30–18:30) y
   marca la tarea cuando la hace. META ya no le pide que apunte nada: lee esos
   bloques (worker/google.js, estudioDelCalendario), decide de qué asignatura
   es cada uno y los convierte en sesiones de estudio normales, con origen
   'calendario'. Así cuentan en todo lo demás (Hoy, análisis, preparación de
   exámenes) sin que el motor sepa de dónde vienen.

   Qué cuenta:
   · Solo los bloques cuya tarea está MARCADA como hecha. Un bloque es un plan;
     la casilla es lo que dice que pasó. Los de la última semana sin marcar se
     preguntan ("¿lo hiciste?"); los más viejos se dan por no hechos.
   · Los minutos son los del bloque. Si dos bloques hechos se solapan, el
     tiempo común se cuenta una vez (el segundo suma solo lo que no pisa).
   · Lo que no se sabe de qué asignatura es se pregunta UNA vez y, si él
     quiere, se recuerda para ese título.
   · "Imprimir…", "Grapar…", "Subir…" son logística: no cuentan como estudio.

   Las funciones puras de arriba no tocan nada del navegador: las prueba
   tools/prueba-estudio-calendario.mjs sin red.
   =========================================================================== */

import { leer, guardar } from './store.js';
import { emitir } from './bus.js';
import * as sesion from './sesion.js';

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
    frente a las del curso: "ejercicios matemáticas" es la del instituto. */
export function asignaturaDeTitulo(titulo, asignaturas) {
  const t = norma(titulo);
  if (!t) return null;
  const lista = (asignaturas || []).filter(a => a?.id && a.nombre && a.tipo !== 'bloque');
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

export const esLogistica = titulo => RE_LOGISTICA.test(norma(titulo));

export function tipoDeTitulo(titulo) {
  const t = norma(titulo);
  if (/\brepas/.test(t)) return 'repaso';
  if (/\b(ejercicios?|problemas|actividades|pag|pagina)\b/.test(t)) return 'ejercicios';
  if (/\b(simulacro|examen)\b/.test(t)) return 'simulacro';
  if (/\b(clase|particulares?)\b/.test(t)) return 'clase';
  return 'teoria';
}

/** Día local (YYYY-MM-DD) de una fecha ISO con zona. */
const diaDe = iso => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const DIAS_PREGUNTA = 7;

/** Función pura: bloques + lo que él ha decidido -> sesiones y preguntas.
    `ajustes` = { reglas: {tituloNormalizado: asignaturaId | 'no'},
                  decisiones: {idBloque: {hecho?: bool, asignaturaId?: id | 'no'}} } */
export function sesionesDeBloques(bloques, asignaturas, ajustes = {}, ahora = Date.now()) {
  const reglas = ajustes.reglas || {};
  const decisiones = ajustes.decisiones || {};
  const existe = new Set((asignaturas || []).filter(a => a.tipo !== 'bloque').map(a => a.id));
  const resultado = { sesiones: [], pendientes: [], dudosos: [] };
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
      asignaturaId = asignaturaDeTitulo(b.titulo, asignaturas);
      clase = asignaturaId ? 'estudio' : 'dudoso';
    }
    const hecho = d.hecho ?? (b.estado === 'hecha');
    const reciente = ahora - Date.parse(b.fin) <= DIAS_PREGUNTA * 864e5;

    if (clase === 'estudio' && hecho) hechas.push({ b, asignaturaId });
    else if (clase === 'estudio' && d.hecho === undefined && reciente) resultado.pendientes.push({ ...b, asignaturaId });
    else if (clase === 'dudoso' && hecho) resultado.dudosos.push(b);
  }

  // El tiempo común de dos bloques hechos que se pisan se cuenta una vez.
  hechas.sort((x, y) => x.b.inicio.localeCompare(y.b.inicio));
  let cubierto = 0;
  for (const { b, asignaturaId } of hechas) {
    const ini = Date.parse(b.inicio), fin = Date.parse(b.fin);
    const minutos = Math.round((fin - Math.max(ini, cubierto)) / 60000);
    cubierto = Math.max(cubierto, fin);
    if (minutos < 1) continue;
    resultado.sesiones.push({
      id: 'cal-' + b.id,
      fecha: diaDe(b.inicio),
      asignaturaId,
      temaId: null,
      tipo: tipoDeTitulo(b.titulo),
      minutos,
      resultado: 'regular',
      notas: b.titulo,
      origen: 'calendario',
      creado: ini,
    });
  }
  return resultado;
}

/** Primer día del curso: el 1 de septiembre del año académico de `hoy`. */
export function inicioCurso(hoy = new Date()) {
  const anio = hoy.getMonth() >= 8 ? hoy.getFullYear() : hoy.getFullYear() - 1;
  return `${anio}-09-01`;
}

/* ============================ con almacenamiento ========================== */

const ajustes = () => ({ reglas: {}, decisiones: {}, ...leer('calendario', {}) });
export const cache = () => ({ bloques: [], ultima: null, error: null, motivo: null, ...leer('calendarioBloques', {}) });

/** Lo que hay que enseñar ahora: preguntas pendientes y estado de la lectura. */
export function estado() {
  const c = cache();
  const r = sesionesDeBloques(c.bloques, leer('asignaturas', []), ajustes());
  return { ...c, ...r, horas: r.sesiones.reduce((s, x) => s + x.minutos, 0) / 60 };
}

/** Rehace las sesiones de origen 'calendario' a partir de lo último leído. Si
    no cambia nada, no escribe: cada escritura de 'sesiones' viaja a los demás
    aparatos, y abrir la app no debería generar tráfico ni pisar nada. */
function aplicar() {
  const c = cache();
  if (!c.ultima) return false;
  const nuevas = sesionesDeBloques(c.bloques, leer('asignaturas', []), ajustes()).sesiones;
  const todas = leer('sesiones', []);
  const viejas = todas.filter(s => s.origen === 'calendario');
  const firma = l => JSON.stringify(l.map(s => [s.id, s.fecha, s.asignaturaId, s.tipo, s.minutos]).sort());
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
      const r = await sesion.pedir(`/api/google/estudio?desde=${inicioCurso()}`, { silencioso: true });
      guardar('calendarioBloques', { bloques: r.bloques || [], ultima: Date.now(), error: null, motivo: null });
      aplicar();
    } catch (e) {
      guardar('calendarioBloques', { ...c, error: e.message || 'No se pudo leer el calendario', motivo: e.status === 409 ? 'conexion' : 'red' });
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

/** "¿De qué asignatura es?" — asignaturaId o 'no' (no es estudio). Con
    `recordar`, vale también para todos los bloques con ese mismo título. */
export function asignar(idBloque, asignaturaId, recordar) {
  const b = cache().bloques.find(x => x.id === idBloque);
  decidir(idBloque, { asignaturaId }, recordar && b ? { titulo: b.titulo, valor: asignaturaId } : null);
}
