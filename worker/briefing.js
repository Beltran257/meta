/* ===========================================================================
   RESUMEN PARA MORNING BRIEFING — horario de hoy, próximo examen y tareas que
   vencen pronto. Función PURA sobre el buzón (nunca sobre `leer()` del
   navegador, que es lo que usa core/motor.js): el Worker no tiene localStorage,
   así que aquí se relee horario/tareas/asignaturas directamente del buzón con
   el mismo criterio que motor.js — nunca se inventa un cálculo nuevo aparte.
   =========================================================================== */

const DIAS_LECTIVOS = [
  { id: 'lunes', dow: 1 }, { id: 'martes', dow: 2 }, { id: 'miercoles', dow: 3 },
  { id: 'jueves', dow: 4 }, { id: 'viernes', dow: 5 },
];

/** Fecha (YYYY-MM-DD) y día de la semana en hora de Madrid, no en UTC: de
    madrugada el día UTC todavía sería el de ayer. Mismo criterio que
    `hoyMadrid()` en bolsa/worker/informe.js. */
export function hoyMadrid(d = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(d);
  const val = t => partes.find(p => p.type === t)?.value;
  const MAPA_DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { fecha: `${val('year')}-${val('month')}-${val('day')}`, dow: MAPA_DOW[val('weekday')] ?? d.getDay() };
}

const aMinutos = hhmm => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  return +m[1] * 60 + +m[2];
};

const sumaDias = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const diasHasta = (hoy, ymd) => Math.round((new Date(`${ymd}T00:00:00Z`) - new Date(`${hoy}T00:00:00Z`)) / 86400000);

export function resumenBriefing(buzon, ahora = new Date()) {
  const { fecha: hoy, dow } = hoyMadrid(ahora);
  const asignaturas = buzon?.claves?.asignaturas?.datos || [];
  const horario = buzon?.claves?.horario?.datos || { franjas: [], dias: {} };
  const tareas = buzon?.claves?.tareas?.datos || [];

  const nombreDe = id => asignaturas.find(a => a.id === id)?.nombre || null;

  /* --------------------------- horario de hoy --------------------------- */
  const diaLectivo = DIAS_LECTIVOS.find(d => d.dow === dow);
  let horarioHoy = [];
  if (diaLectivo) {
    const fila = horario.dias?.[diaLectivo.id] || [];
    horarioHoy = (horario.franjas || [])
      .map((f, i) => ({ ini: f.ini, fin: f.fin, asignaturaId: fila[i] || null }))
      .filter(c => c.asignaturaId)
      .sort((a, b) => (aMinutos(a.ini) ?? 0) - (aMinutos(b.ini) ?? 0))
      .map(c => ({ ini: c.ini, fin: c.fin, asignatura: nombreDe(c.asignaturaId) || 'Sin asignatura' }));
  }

  /* ------------------------------ próximo examen ------------------------- */
  const estaHecha = t => t.estado === 'hecha' || t.hecho === true;
  const tope = sumaDias(hoy, 60);
  const examenes = tareas
    .filter(t => t.tipo === 'examen' && !estaHecha(t) && t.fecha >= hoy && t.fecha <= tope)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  const proximoExamen = examenes[0] ? {
    titulo: examenes[0].titulo,
    asignatura: nombreDe(examenes[0].asignaturaId),
    fecha: examenes[0].fecha,
    dias: diasHasta(hoy, examenes[0].fecha),
  } : null;

  /* ------------------------- tareas que vencen pronto --------------------- */
  const manana = sumaDias(hoy, 1);
  const tareasProximas = tareas
    .filter(t => t.tipo !== 'examen' && !estaHecha(t) && t.fecha && t.fecha <= manana)
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
    .map(t => ({
      titulo: t.titulo, asignatura: nombreDe(t.asignaturaId), fecha: t.fecha,
      atrasada: t.fecha < hoy,
    }));

  return { fecha: hoy, horarioHoy, proximoExamen, tareasProximas };
}
