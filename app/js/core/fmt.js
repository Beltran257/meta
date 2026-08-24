/* ===========================================================================
   FORMATO — fechas locales (nunca UTC), notas y textos, todo en es-ES.
   =========================================================================== */

export const escapa = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Fecha local de hoy en YYYY-MM-DD, NUNCA toISOString (que es UTC). */
export function hoyLocal(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_C = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIAS_C = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

/** Parsea 'YYYY-MM-DD' como fecha LOCAL (new Date('YYYY-MM-DD') es UTC y
    puede caer un día antes según la zona horaria). */
export function aFecha(ymd) {
  const [a, m, d] = ymd.split('-').map(Number);
  return new Date(a, m - 1, d);
}

export function fechaLarga(ymd) {
  const d = aFecha(ymd);
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`;
}

export function fechaCorta(ymd) {
  const d = aFecha(ymd);
  return `${d.getDate()} ${MESES_C[d.getMonth()]}`;
}

export function diaSemana(ymd, corto = false) {
  const d = aFecha(ymd);
  return (corto ? DIAS_C : DIAS)[d.getDay()];
}

/** Días naturales entre hoy y una fecha YYYY-MM-DD (negativo si ya pasó). */
export function diasHasta(ymd) {
  const hoy = aFecha(hoyLocal());
  const obj = aFecha(ymd);
  return Math.round((obj - hoy) / 86400000);
}

export function textoCountdown(dias) {
  if (dias < 0) return 'ya pasó';
  if (dias === 0) return 'hoy';
  if (dias === 1) return 'mañana';
  return `en ${dias} días`;
}

/** Nota 0–10 con 2 decimales, coma española. '—' si no hay valor. */
export function nota(v) {
  if (v == null || !isFinite(v)) return '—';
  return v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Valor numérico de un campo admitiendo coma decimal. */
export function numeroDe(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  const v = parseFloat(String(el.value).replace(',', '.'));
  return isFinite(v) ? v : null;
}

export const claseNota = v => {
  if (v == null || !isFinite(v)) return 'neutro';
  return v >= 5 ? 'sube' : 'baja';
};

/** Inicial(es) de un nombre para un avatar/chip de asignatura. */
export function iniciales(nombre) {
  return String(nombre || '?').trim().slice(0, 2).toUpperCase();
}

/* --------------------------- horas y duraciones ---------------------------- */

/** 'HH:MM' -> minutos desde medianoche. Null si no es una hora válida. */
export function aMinutos(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** minutos desde medianoche -> 'HH:MM'. */
export function aHora(min) {
  const m = Math.max(0, Math.round(min));
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export const minutosAhora = (d = new Date()) => d.getHours() * 60 + d.getMinutes();

/** 95 -> "1 h 35 min". Para tiempos de estudio, que se leen mejor así. */
export function duracion(min) {
  const m = Math.max(0, Math.round(min || 0));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** "hace 3 min", "hace 2 h"… para marcas de tiempo de sincronización. */
export function desdeCuando(ts) {
  if (!ts) return 'nunca';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'hace un momento';
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'ayer' : `hace ${d} días`;
}

/** Sumar días a una fecha YYYY-MM-DD, siempre en local. */
export function sumaDias(ymd, n) {
  const d = aFecha(ymd);
  d.setDate(d.getDate() + n);
  return hoyLocal(d);
}

/** Lunes de la semana de una fecha (la semana escolar empieza en lunes). */
export function lunesDe(ymd) {
  const d = aFecha(ymd);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return hoyLocal(d);
}

/** Porcentaje entero y acotado, que es como se pinta en todas las barras. */
export const pct = (parte, total) =>
  !total ? 0 : Math.max(0, Math.min(100, Math.round((parte / total) * 100)));

/** Inicial(es) para el avatar de la cuenta. */
export function inicialesNombre(nombre) {
  const partes = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '·';
  return (partes[0][0] + (partes[1]?.[0] || '')).toUpperCase();
}

export { DIAS, DIAS_C, MESES, MESES_C };
