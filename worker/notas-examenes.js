/* ===========================================================================
   NOTAS DE EXÁMENES, VISTAS DESDE EL BUZÓN — para Salud y Morning Briefing.

   Función PURA sobre el buzón, con el mismo criterio que core/motor.js
   (notaDeExamen / examenesSinPuntuar): la nota de un examen es una entrada de
   `notas[asignatura].evaluaciones[1|2|3]` con `examenId`. El Worker no tiene
   localStorage, así que aquí se relee del buzón; si cambia el modelo allí,
   cámbiese aquí (lo comprueba tools/prueba-notas-examenes.mjs).
   =========================================================================== */

/** Map examenId -> { valor, aprox } con las notas que tienen examen. */
export function notasPorExamen(buzon) {
  const mapa = new Map();
  const todas = buzon?.claves?.notas?.datos || {};
  for (const entrada of Object.values(todas)) {
    for (const lista of Object.values(entrada?.evaluaciones || {})) {
      for (const n of lista || []) {
        if (n?.examenId && typeof n.valor === 'number') mapa.set(n.examenId, { valor: n.valor, aprox: !!n.aprox });
      }
    }
  }
  return mapa;
}

const sumaDias = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Exámenes pasados (de ayer hacia atrás, hasta `dias` días) sin nota puesta,
    del más reciente al más antiguo: [{ titulo, asignatura, fecha }]. */
export function examenesSinPuntuar(buzon, hoy, dias = 14, max = 3) {
  const tareas = buzon?.claves?.tareas?.datos || [];
  const asignaturas = buzon?.claves?.asignaturas?.datos || [];
  const notas = notasPorExamen(buzon);
  const desde = sumaDias(hoy, -dias);
  return tareas
    .filter(t => t.tipo === 'examen' && t.fecha && t.fecha < hoy && t.fecha >= desde && !notas.has(t.id))
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
    .slice(0, max)
    .map(t => ({ titulo: t.titulo, asignatura: asignaturas.find(a => a.id === t.asignaturaId)?.nombre || null, fecha: t.fecha }));
}
