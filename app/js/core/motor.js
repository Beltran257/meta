/* ===========================================================================
   MOTOR — lo que convierte los datos en decisiones.

   Aquí está TODO lo que META "sabe": el estado académico, el orden en que hay
   que hacer las cosas, los avisos de riesgo y el plan del día. Es algoritmo
   puro: sin red, sin IA y sin sorpresas. Dos razones, y las dos importan:

     1. Funciona sin conexión y responde al instante.
     2. Se puede EXPLICAR. Cada punto que resta el estado académico sale de una
        regla que se le enseña al usuario tal cual ("3 tareas atrasadas: -24").
        Una puntuación que no se puede explicar no sirve para decidir nada.

   META AI (core/ia.js) redacta por encima de estos números. Nunca los sustituye.
   =========================================================================== */

import { leer } from './store.js';
import { hoyLocal, diasHasta, aFecha, sumaDias, aMinutos, minutosAhora, pct } from './fmt.js';
import { listaTemas, temasDe, dominioMedio } from './temas.js';
import { listaAsignaturas, asignaturaDe } from './asignaturas.js';

/* ===========================================================================
   PERFIL Y DISPONIBILIDAD
   =========================================================================== */

const PERFIL_POR_DEFECTO = {
  nivel: '', curso: '',
  // Minutos de estudio que puede sacar cada día. El índice es el de
  // Date.getDay(): 0 domingo … 6 sábado.
  disponibilidad: { 0: 90, 1: 90, 2: 90, 3: 90, 4: 90, 5: 60, 6: 120 },
  onboarding: false,
};

export function perfil() {
  const p = leer('perfil', {});
  return { ...PERFIL_POR_DEFECTO, ...p, disponibilidad: { ...PERFIL_POR_DEFECTO.disponibilidad, ...(p.disponibilidad || {}) } };
}

export const disponibilidadDe = ymd => perfil().disponibilidad[aFecha(ymd).getDay()] ?? 90;

/* ===========================================================================
   HORARIO
   =========================================================================== */

export const DIAS_LECTIVOS = [
  { id: 'lunes', et: 'Lun', largo: 'Lunes', dow: 1 },
  { id: 'martes', et: 'Mar', largo: 'Martes', dow: 2 },
  { id: 'miercoles', et: 'Mié', largo: 'Miércoles', dow: 3 },
  { id: 'jueves', et: 'Jue', largo: 'Jueves', dow: 4 },
  { id: 'viernes', et: 'Vie', largo: 'Viernes', dow: 5 },
];

export const horarioDatos = () => {
  const h = leer('horario', {});
  return { franjas: h.franjas || [], dias: h.dias || {} };
};

export const diaLectivoDe = dow => DIAS_LECTIVOS.find(d => d.dow === dow) || null;

/** Clases de un día de la semana, ya resueltas a asignatura y con sus horas. */
export function clasesDe(dow) {
  const dia = diaLectivoDe(dow);
  if (!dia) return [];
  const h = horarioDatos();
  const fila = h.dias[dia.id] || [];
  return h.franjas
    .map((f, i) => ({ franja: f, indice: i, asignaturaId: fila[i] || null }))
    .filter(c => c.asignaturaId);
}

/** Qué hay AHORA y qué viene después, mirando el reloj de verdad. */
export function claseAhora(ahora = new Date()) {
  const min = minutosAhora(ahora);
  for (const c of clasesDe(ahora.getDay())) {
    const ini = aMinutos(c.franja.ini), fin = aMinutos(c.franja.fin);
    if (ini != null && fin != null && min >= ini && min < fin) return c;
  }
  return null;
}

export function proximaClase(ahora = new Date()) {
  const min = minutosAhora(ahora);
  return clasesDe(ahora.getDay()).find(c => (aMinutos(c.franja.ini) ?? -1) > min) || null;
}

/** Minutos de clase que quedan hoy: los descuenta el planificador del tiempo
    disponible, porque en clase no se puede estudiar otra cosa. */
export function minutosDeClaseRestantes(ahora = new Date()) {
  const min = minutosAhora(ahora);
  return clasesDe(ahora.getDay()).reduce((s, c) => {
    const ini = aMinutos(c.franja.ini), fin = aMinutos(c.franja.fin);
    if (ini == null || fin == null || fin <= min) return s;
    return s + (fin - Math.max(ini, min));
  }, 0);
}

/* ===========================================================================
   TAREAS Y EXÁMENES
   =========================================================================== */

export const listaTareas = () => leer('tareas', []);

export const soloTareas = () => listaTareas().filter(t => t.tipo !== 'examen');
export const soloExamenes = () => listaTareas().filter(t => t.tipo === 'examen');

export const estaHecha = t => t.estado === 'hecha' || t.hecho === true;

export const pendientes = () => listaTareas().filter(t => !estaHecha(t));

export function atrasadas() {
  const hoy = hoyLocal();
  return pendientes().filter(t => t.tipo !== 'examen' && t.fecha < hoy);
}

export function examenesProximos(dias = 60) {
  const hoy = hoyLocal();
  const tope = sumaDias(hoy, dias);
  return soloExamenes()
    .filter(e => e.fecha >= hoy && e.fecha <= tope)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

export const proximoExamen = () => examenesProximos()[0] || null;

/** Preparación de un examen, de 0 a 100. Sale del dominio de los temas que
    tenga marcados; si no tiene temario propio, del de toda la asignatura.
    Devuelve null cuando no hay ni un tema del que tirar: es honesto decir "no
    lo sé" en vez de enseñar un 0 % que parece una nota. */
export function preparacion(examen) {
  const temas = examen.temaIds?.length
    ? listaTemas().filter(t => examen.temaIds.includes(t.id))
    : temasDe(examen.asignaturaId);
  return dominioMedio(temas);
}

export function temarioDe(examen) {
  return examen.temaIds?.length
    ? listaTemas().filter(t => examen.temaIds.includes(t.id))
    : temasDe(examen.asignaturaId);
}

/* ------------------------------ priorización -------------------------------
   Cuatro cosas mandan, en este orden: cuánto queda para la fecha, si es un
   examen, lo difícil o larga que es, y si esa asignatura tiene un examen
   encima. El resultado es un número solo para poder ORDENAR; al usuario se le
   enseña el motivo en palabras, nunca la cifra. */

const PESO_PRIORIDAD = { alta: 14, normal: 0, baja: -12 };

export function urgenciaDe(fecha) {
  const d = diasHasta(fecha);
  if (d < 0) return 100;
  if (d === 0) return 92;
  if (d === 1) return 78;
  if (d === 2) return 66;
  if (d === 3) return 56;
  if (d <= 7) return 48 - (d - 3) * 3;
  if (d <= 21) return 30 - (d - 7);
  return 12;
}

export function puntuacion(t) {
  let p = urgenciaDe(t.fecha);
  if (t.tipo === 'examen') p += 16;
  p += PESO_PRIORIDAD[t.prioridad] ?? 0;
  p += ((t.dificultad || 2) - 2) * 5;
  if (t.estado === 'haciendo') p += 6;          // empezado: mejor terminarlo
  if ((t.duracion || 0) >= 90) p += 3;          // lo largo no se puede dejar para el final

  // Si esa asignatura tiene examen en menos de una semana, todo lo suyo sube.
  const hoy = hoyLocal();
  const examenCerca = soloExamenes().some(e =>
    e.asignaturaId === t.asignaturaId && e.fecha >= hoy && diasHasta(e.fecha) <= 7 && e.id !== t.id);
  if (examenCerca) p += 9;

  return Math.round(p);
}

/** Por qué esta tarea está donde está, en una línea. */
export function motivo(t) {
  const d = diasHasta(t.fecha);
  if (d < 0) return `Atrasada ${-d} ${-d === 1 ? 'día' : 'días'}`;
  if (d === 0) return 'Es para hoy';
  if (d === 1) return 'Es para mañana';
  if (t.tipo === 'examen') return `Examen en ${d} días`;
  const examenCerca = soloExamenes().find(e =>
    e.asignaturaId === t.asignaturaId && diasHasta(e.fecha) >= 0 && diasHasta(e.fecha) <= 7);
  if (examenCerca) return `Examen de esa asignatura en ${diasHasta(examenCerca.fecha)} días`;
  if (t.prioridad === 'alta') return 'La marcaste como prioritaria';
  return `Para dentro de ${d} días`;
}

export function priorizadas(limite = 0) {
  const l = pendientes().slice().sort((a, b) => puntuacion(b) - puntuacion(a) || a.fecha.localeCompare(b.fecha));
  return limite ? l.slice(0, limite) : l;
}

/* ===========================================================================
   SESIONES DE ESTUDIO
   =========================================================================== */

export const listaSesiones = () => leer('sesiones', []);

export const sesionesDe = ymd => listaSesiones().filter(s => s.fecha === ymd);

export const minutosDe = ymd => sesionesDe(ymd).reduce((s, x) => s + (x.minutos || 0), 0);

/** Días con al menos una sesión en los últimos N días. Es la "constancia":
    importa más estudiar 5 días que echar 4 horas un domingo. */
export function diasConEstudio(n = 7) {
  const hoy = hoyLocal();
  let dias = 0;
  for (let i = 0; i < n; i++) if (minutosDe(sumaDias(hoy, -i)) > 0) dias++;
  return dias;
}

export function minutosUltimos(n = 7) {
  const hoy = hoyLocal();
  let total = 0;
  for (let i = 0; i < n; i++) total += minutosDe(sumaDias(hoy, -i));
  return total;
}

/** Minutos que aún se pueden estudiar hoy: el rato que él mismo dijo que tiene
    ese día del que ya ha gastado. La disponibilidad ya se declara SIN contar
    las clases, así que aquí no se vuelven a descontar. */
export function minutosLibresHoy(ahora = new Date()) {
  const hoy = hoyLocal(ahora);
  return Math.max(0, disponibilidadDe(hoy) - minutosDe(hoy));
}

/* ===========================================================================
   ESTADO ACADÉMICO
   Empieza en 100 y cada problema real resta. Se enseñan los factores con su
   coste: si no se puede explicar por qué bajó, no vale para nada.
   =========================================================================== */

export function estadoAcademico() {
  const factores = [];
  let penal = 0;

  const apunta = (n, coste, d) => {
    if (coste <= 0) return;
    const c = Math.round(coste);
    penal += c;
    factores.push({ n, coste: c, d });
  };

  /* 1. Lo atrasado es lo que más pesa: ya ha fallado una fecha. */
  const atras = atrasadas();
  apunta('Tareas atrasadas', Math.min(30, atras.length * 9),
    atras.length ? `${atras.length} ${atras.length === 1 ? 'tarea ha pasado' : 'tareas han pasado'} su fecha sin estar hechas.` : '');

  /* 2. Acumulación: entregas apiñadas en los próximos 3 días. */
  const hoy = hoyLocal();
  const pronto = pendientes().filter(t => t.fecha >= hoy && diasHasta(t.fecha) <= 3);
  const minutosPronto = pronto.reduce((s, t) => s + (t.duracion || 45), 0);
  const minutosQueHay = [0, 1, 2, 3].reduce((s, i) => s + disponibilidadDe(sumaDias(hoy, i)), 0);
  const exceso = minutosPronto - minutosQueHay;
  apunta('Carga apiñada', exceso > 0 ? Math.min(15, exceso / 30) : 0,
    exceso > 0 ? `Lo que tienes para los próximos 3 días no cabe en el tiempo que sueles tener libre.` : '');

  /* 3. Exámenes cerca y flojos: cuanto más cerca, más pesa lo que falta. */
  let costeExamenes = 0;
  const detalleExamenes = [];
  for (const e of examenesProximos(21)) {
    const prep = preparacion(e);
    const dias = Math.max(0, diasHasta(e.fecha));
    const cercania = dias <= 3 ? 1 : dias <= 7 ? .7 : dias <= 14 ? .45 : .25;
    if (prep == null) {
      costeExamenes += 4 * cercania;
      detalleExamenes.push(`${e.titulo}: sin temario apuntado`);
    } else if (prep < 70) {
      costeExamenes += ((70 - prep) / 70) * 18 * cercania;
      detalleExamenes.push(`${e.titulo}: ${prep}% en ${dias} días`);
    }
  }
  apunta('Exámenes poco preparados', Math.min(25, costeExamenes), detalleExamenes.slice(0, 3).join(' · '));

  /* 4. Constancia: sin días de estudio, todo lo demás acaba llegando tarde. */
  const dias7 = diasConEstudio(7);
  apunta('Poca constancia', dias7 >= 4 ? 0 : (4 - dias7) * 4,
    dias7 >= 4 ? '' : `Solo has estudiado ${dias7} ${dias7 === 1 ? 'día' : 'días'} de los últimos 7.`);

  /* 5. Temas que llevan semanas sin tocarse y no están dominados. */
  const olvidados = listaTemas().filter(t => t.proximoRepaso && diasHasta(t.proximoRepaso) < -7);
  apunta('Repasos vencidos', Math.min(10, olvidados.length * 2.5),
    olvidados.length ? `${olvidados.length} temas llevan más de una semana pasados de repaso.` : '');

  /* 6. Asignaturas por debajo de su propio objetivo. */
  const notas = leer('notas', {});
  const flojas = listaAsignaturas().filter(a => {
    const e = notas[a.id];
    if (!e || e.objetivo == null) return false;
    const todas = ['1', '2', '3'].flatMap(k => e.evaluaciones?.[k] || []);
    if (!todas.length) return false;
    const media = todas.reduce((s, n) => s + n.valor * (n.peso || 1), 0) /
      todas.reduce((s, n) => s + (n.peso || 1), 0);
    return media < e.objetivo - 0.5;
  });
  apunta('Por debajo de tu objetivo', Math.min(8, flojas.length * 2.5),
    flojas.length ? flojas.map(a => a.nombre).join(', ') : '');

  const puntos = Math.max(0, Math.min(100, Math.round(100 - penal)));
  const etiqueta = puntos >= 80 ? 'Bajo riesgo'
    : puntos >= 60 ? 'Controlado'
    : puntos >= 40 ? 'Requiere atención'
    : 'Riesgo alto';

  return { puntos, etiqueta, factores };
}

/* ===========================================================================
   RIESGOS — avisos accionables, no adornos. Cada uno lleva una propuesta.
   =========================================================================== */

export function riesgos() {
  const salida = [];
  const hoy = hoyLocal();

  const atras = atrasadas();
  if (atras.length) {
    salida.push({
      nivel: 'alto',
      titulo: `${atras.length} ${atras.length === 1 ? 'tarea atrasada' : 'tareas atrasadas'}`,
      detalle: atras.slice(0, 3).map(t => t.titulo).join(' · '),
      accion: { texto: 'Ver y replanificar', ir: 'tareas', filtro: 'atrasadas' },
    });
  }

  // Varias entregas en pocos días
  const tresDias = pendientes().filter(t => t.fecha >= hoy && diasHasta(t.fecha) <= 3 && t.tipo !== 'examen');
  if (tresDias.length >= 3) {
    salida.push({
      nivel: 'medio',
      titulo: `${tresDias.length} entregas en 3 días`,
      detalle: 'No caben todas el mismo día: conviene adelantar alguna a hoy.',
      accion: { texto: 'Planificar mi día', plan: true },
    });
  }

  for (const e of examenesProximos(14)) {
    const prep = preparacion(e);
    const dias = Math.max(0, diasHasta(e.fecha));
    const a = asignaturaDe(e.asignaturaId);
    if (prep == null) {
      salida.push({
        nivel: 'medio',
        titulo: `${e.titulo} sin temario`,
        detalle: `Es en ${dias} ${dias === 1 ? 'día' : 'días'} y META no sabe qué entra, así que no puede medir cómo lo llevas.`,
        accion: { texto: 'Añadir temario', ir: 'examenes', examenId: e.id },
      });
    } else if (prep < 60 && dias <= 10) {
      salida.push({
        nivel: dias <= 4 ? 'alto' : 'medio',
        titulo: `${e.titulo} al ${prep}%`,
        detalle: `${a ? a.nombre + ' · ' : ''}quedan ${dias} ${dias === 1 ? 'día' : 'días'}. Los temas más flojos son los que más suben la nota.`,
        accion: { texto: 'Preparar este examen', ir: 'examenes', examenId: e.id },
      });
    } else if (dias <= 2) {
      // Va razonablemente preparado (por eso no cayó en el caso de arriba),
      // pero un examen a 1-2 días es un recordatorio en sí mismo, preparación
      // aparte — es la clase de aviso que un cron externo daría; aquí sale
      // solo con abrir la app.
      salida.push({
        nivel: dias === 0 ? 'alto' : 'medio',
        titulo: `${e.titulo} ${dias === 0 ? 'es hoy' : dias === 1 ? 'es mañana' : 'es en 2 días'}`,
        detalle: `${a ? a.nombre + ' · ' : ''}vas al ${prep}%.`,
        accion: { texto: 'Ver temario', ir: 'examenes', examenId: e.id },
      });
    }
  }

  const dias7 = diasConEstudio(7);
  if (dias7 <= 1 && listaTemas().length) {
    salida.push({
      nivel: 'medio',
      titulo: 'Llevas la semana sin sesiones',
      detalle: 'Media hora hoy vale más que tres horas el domingo.',
      accion: { texto: 'Empezar una sesión', ir: 'estudiar' },
    });
  }

  const vencidos = listaTemas().filter(t => t.proximoRepaso && diasHasta(t.proximoRepaso) < -7);
  if (vencidos.length >= 3) {
    salida.push({
      nivel: 'medio',
      titulo: `${vencidos.length} repasos vencidos`,
      detalle: vencidos.slice(0, 3).map(t => t.nombre).join(' · '),
      accion: { texto: 'Repasar ahora', ir: 'estudiar' },
    });
  }

  const orden = { alto: 0, medio: 1 };
  return salida.sort((a, b) => orden[a.nivel] - orden[b.nivel]);
}

/** Una frase para el resumen que se enseña al abrir la app (main.js), una vez
    al día. Null si no hay nada que merezca interrumpir: "sin noticias, buenas
    noticias" — no hace falta un aviso para decir que todo va bien. */
export function resumenDelDia() {
  const r = riesgos();
  if (!r.length) return null;
  const extra = r.length - 1;
  return `${r[0].titulo}${extra > 0 ? ` · ${extra} aviso${extra === 1 ? '' : 's'} más` : ''}`;
}

/* ===========================================================================
   PLANIFICADOR — reparte el tiempo libre en bloques de verdad.

   Reglas, en orden: primero lo que vence hoy o mañana, después los exámenes
   cercanos (empezando por los temas peor dominados, que es donde más sube la
   preparación por minuto invertido) y por último los repasos vencidos.
   Bloques de 25 a 50 minutos, nunca dos seguidos de la misma asignatura si
   hay alternativa, y nada de rellenar hasta el último minuto disponible.
   =========================================================================== */

const MIN_BLOQUE = 25;
const MAX_BLOQUE = 50;

function bloque(minutos, que, detalle, extra = {}) {
  return { minutos: Math.round(minutos), que, detalle, ...extra };
}

export function planDelDia({ minutos, fecha = hoyLocal() } = {}) {
  let libres = minutos != null ? minutos : minutosLibresHoy();
  const plan = [];
  if (libres < MIN_BLOQUE) return { plan, libres, motivo: 'sin-tiempo' };

  const candidatos = [];

  /* 1. Tareas que vencen ya. */
  for (const t of priorizadas()) {
    const d = diasHasta(t.fecha);
    if (t.tipo === 'examen' || d > 1) continue;
    const a = asignaturaDe(t.asignaturaId);
    candidatos.push({
      peso: 100 + urgenciaDe(t.fecha),
      minutos: Math.min(MAX_BLOQUE, Math.max(MIN_BLOQUE, t.duracion || 40)),
      que: t.titulo,
      detalle: `${a ? a.nombre + ' · ' : ''}${d < 0 ? 'atrasada' : d === 0 ? 'para hoy' : 'para mañana'}`,
      asignaturaId: t.asignaturaId,
      tipo: 'tarea', refId: t.id,
    });
  }

  /* 2. Exámenes cercanos, tema a tema y empezando por el más flojo. */
  for (const e of examenesProximos(21)) {
    const dias = Math.max(1, diasHasta(e.fecha));
    const temas = temarioDe(e).slice().sort((x, y) => (x.dominio || 0) - (y.dominio || 0));
    const a = asignaturaDe(e.asignaturaId);
    for (const t of temas.slice(0, 3)) {
      if ((t.dominio || 0) >= 85) continue;
      candidatos.push({
        peso: 90 - dias * 2 + (100 - (t.dominio || 0)) * .35,
        minutos: (t.dominio || 0) < 40 ? MAX_BLOQUE : 35,
        que: t.nombre,
        detalle: `${a ? a.nombre + ' · ' : ''}${e.titulo} en ${dias} ${dias === 1 ? 'día' : 'días'} · dominio ${t.dominio || 0}%`,
        asignaturaId: e.asignaturaId,
        tipo: 'tema', refId: t.id,
      });
    }
  }

  /* 3. Repasos que ya tocaban. */
  for (const t of listaTemas()) {
    if (!t.proximoRepaso || t.proximoRepaso > fecha) continue;
    const a = asignaturaDe(t.asignaturaId);
    candidatos.push({
      peso: 45 + Math.min(20, -diasHasta(t.proximoRepaso)),
      minutos: MIN_BLOQUE,
      que: `Repaso: ${t.nombre}`,
      detalle: `${a ? a.nombre + ' · ' : ''}tocaba el ${t.proximoRepaso}`,
      asignaturaId: t.asignaturaId,
      tipo: 'repaso', refId: t.id,
    });
  }

  candidatos.sort((x, y) => y.peso - x.peso);

  /* Reparto: se evita encadenar dos bloques de la misma asignatura si queda
     otra cosa por hacer — cambiar de asignatura cansa menos y cunde más. */
  let ultimaAsig = null;
  const usados = new Set();
  while (libres >= MIN_BLOQUE && plan.length < 6) {
    // Primero se busca algo de OTRA asignatura; si no queda, vale cualquiera.
    let i = candidatos.findIndex((c, idx) => !usados.has(idx) && c.asignaturaId !== ultimaAsig);
    if (i === -1) i = candidatos.findIndex((c, idx) => !usados.has(idx));
    if (i === -1) break;

    const c = candidatos[i];
    usados.add(i);
    const min = Math.min(c.minutos, libres);
    if (min < MIN_BLOQUE) break;
    plan.push(bloque(min, c.que, c.detalle, { tipo: c.tipo, refId: c.refId, asignaturaId: c.asignaturaId }));
    libres -= min;
    ultimaAsig = c.asignaturaId;
  }

  return { plan, libres: Math.max(0, libres), motivo: plan.length ? 'ok' : 'nada-que-hacer' };
}

/* ===========================================================================
   SEMANA — la carga real de varios días, para verla de un vistazo y mover
   trabajo de un día a otro si alguno está apretado.

   A propósito NO reutiliza planDelDia() para los días que no son hoy: fingir
   "qué recomendaría el algoritmo pasado mañana" obligaría a simular qué se
   habrá completado para entonces, y esa predicción sería más ruido que
   ayuda. En vez de eso, cada día enseña lo que YA está fechado ahí (tareas y
   exámenes) contra el tiempo que declaraste tener ese día — que es un dato
   real, no una suposición — y avisa si no cabe.
   =========================================================================== */

/** Los próximos `dias` días (por defecto 7) empezando en `desde`, cada uno
    con lo que vence ese día y si se sale del tiempo que sueles tener. */
export function semanaDesde(desde = hoyLocal(), dias = 7) {
  const salida = [];
  for (let i = 0; i < dias; i++) {
    const fecha = sumaDias(desde, i);
    const items = listaTareas().filter(t => t.fecha === fecha && !estaHecha(t));
    const tareasDia = items.filter(t => t.tipo !== 'examen');
    const examenesDia = items.filter(t => t.tipo === 'examen');
    const minutosCarga = tareasDia.reduce((s, t) => s + (t.duracion || 45), 0);
    const disponibles = disponibilidadDe(fecha);
    salida.push({
      fecha, tareas: tareasDia, examenes: examenesDia,
      minutosCarga, minutosDisponibles: disponibles,
      sobrecarga: minutosCarga > disponibles,
    });
  }
  return salida;
}

/** Reparte los temas más flojos de un examen en los días que quedan, más
    tiempo cuanto peor dominados y más cerca del examen. Es informativo (no
    escribe nada): una propuesta de "qué tocaría cada día" hasta el examen. */
export function planHastaExamen(examen) {
  const hoy = hoyLocal();
  const diasQueQuedan = Math.max(1, diasHasta(examen.fecha));
  const temas = temarioDe(examen).slice().sort((a, b) => (a.dominio || 0) - (b.dominio || 0));
  if (!temas.length) return [];

  // Los peor dominados se repiten más veces a lo largo de los días.
  const veces = t => (t.dominio || 0) < 40 ? 3 : (t.dominio || 0) < 70 ? 2 : 1;
  const cola = [];
  for (const t of temas) for (let n = 0; n < veces(t); n++) cola.push(t);

  const topeDias = Math.min(diasQueQuedan, 14); // más de dos semanas no cabe en una lista útil
  const porDia = Array.from({ length: topeDias }, () => []);
  cola.forEach((t, i) => porDia[i % topeDias].push(t));

  return porDia.map((temasDia, i) => {
    const fecha = sumaDias(hoy, i + 1);
    // Sin duplicar el mismo tema dos veces el mismo día.
    const unicos = [...new Map(temasDia.map(t => [t.id, t])).values()];
    return { fecha, temas: unicos, minutos: unicos.length * 30 };
  }).filter(d => d.temas.length);
}

/* ===========================================================================
   CONTEXTO PARA META AI — un resumen, no la base de datos entera.
   =========================================================================== */

export function contextoIA({ examen = null, texto = null } = {}) {
  const est = estadoAcademico();
  const nombre = id => asignaturaDe(id)?.nombre || 'Sin asignatura';

  const c = {
    hoy: hoyLocal(),
    estado: { puntos: est.puntos, etiqueta: est.etiqueta },
    disponible: minutosLibresHoy(),
    asignaturas: listaAsignaturas().map(a => a.nombre),
    examenes: examenesProximos(30).map(e => ({
      titulo: e.titulo, asignatura: nombre(e.asignaturaId), fecha: e.fecha,
      dias: Math.max(0, diasHasta(e.fecha)), preparacion: preparacion(e) ?? 0,
    })),
    tareas: priorizadas(12).filter(t => t.tipo !== 'examen').map(t => ({
      titulo: t.titulo, asignatura: nombre(t.asignaturaId), fecha: t.fecha,
      estado: diasHasta(t.fecha) < 0 ? 'atrasada' : 'pendiente',
    })),
    temasFlojos: listaTemas().slice().sort((a, b) => (a.dominio || 0) - (b.dominio || 0)).slice(0, 8)
      .map(t => ({ nombre: t.nombre, asignatura: nombre(t.asignaturaId), dominio: t.dominio || 0 })),
    riesgos: riesgos().map(r => `${r.titulo}: ${r.detalle}`),
    plan: planDelDia().plan.map(b => ({ minutos: b.minutos, que: `${b.que} (${b.detalle})` })),
  };

  if (examen) {
    c.examenes = [{
      titulo: examen.titulo, asignatura: nombre(examen.asignaturaId), fecha: examen.fecha,
      dias: Math.max(0, diasHasta(examen.fecha)), preparacion: preparacion(examen) ?? 0,
    }];
    c.temasFlojos = temarioDe(examen).map(t => ({
      nombre: t.nombre, asignatura: nombre(examen.asignaturaId), dominio: t.dominio || 0,
    }));
  }
  // El contenido de los apuntes solo viaja si él ha pedido que se le explique
  // ese texto concreto. Nunca se manda "por si acaso".
  if (texto) c.texto = texto;

  return c;
}

export { pct };
