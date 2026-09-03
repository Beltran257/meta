/* ===========================================================================
   HISTÓRICO PARA SALUD — por cada fecha pasada, cuatro señales SIEMPRE
   separadas (nunca una nota de "carga escolar" compuesta): días al próximo
   examen, tareas pendientes en las 48h siguientes, horas de clase ese día
   de la semana (según el horario semanal, no cambia entre semanas
   normales) y minutos de estudio registrados ese día. Función PURA sobre
   el buzón, mismo criterio que briefing.js — nunca sobre `leer()` del
   navegador.
   =========================================================================== */

const DIA_POR_DOW = { 1: 'lunes', 2: 'martes', 3: 'miercoles', 4: 'jueves', 5: 'viernes' };

const sumaDias = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const diasHasta = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
const dowDe = ymd => new Date(`${ymd}T00:00:00Z`).getUTCDay();
const minutosDeHora = hhmm => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  return m ? (+m[1]) * 60 + (+m[2]) : null;
};

/** @param fechas array de 'AAAA-MM-DD'. Ventana de proximidad de examen:
    14 días (más allá de eso no aporta nada al contraste con el sueño). */
export function historicoSalud(buzon, fechas) {
  const horario = buzon?.claves?.horario?.datos || { franjas: [], dias: {} };
  const tareas = buzon?.claves?.tareas?.datos || [];
  const sesiones = buzon?.claves?.sesiones?.datos || [];
  const estaHecha = t => t.estado === 'hecha' || t.hecho === true;

  const examenes = tareas
    .filter(t => t.tipo === 'examen' && t.fecha && !estaHecha(t))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  const horasPorDia = {};
  for (const [dia, franjasOcupadas] of Object.entries(horario.dias || {})) {
    horasPorDia[dia] = (horario.franjas || []).reduce((acc, f, i) => {
      if (!franjasOcupadas[i]) return acc;
      const ini = minutosDeHora(f.ini), fin = minutosDeHora(f.fin);
      return acc + (ini != null && fin != null && fin > ini ? (fin - ini) / 60 : 0);
    }, 0);
  }

  const resultado = {};
  for (const fecha of fechas) {
    const proximo = examenes.find(e => e.fecha >= fecha);
    const dias = proximo ? diasHasta(fecha, proximo.fecha) : null;
    const examen_dias = dias != null && dias <= 14 ? dias : null;

    const tope = sumaDias(fecha, 2);
    const tareas_pendientes = tareas.filter(t =>
      t.tipo !== 'examen' && !estaHecha(t) && t.fecha >= fecha && t.fecha <= tope).length;

    const diaSemana = DIA_POR_DOW[dowDe(fecha)];
    const horas_clase = diaSemana ? Math.round((horasPorDia[diaSemana] || 0) * 10) / 10 : 0;

    const minutos_estudio = sesiones.filter(s => s.fecha === fecha).reduce((a, s) => a + (s.minutos || 0), 0);

    resultado[fecha] = { examen_dias, tareas_pendientes, horas_clase, minutos_estudio };
  }
  return resultado;
}
