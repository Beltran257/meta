/* ===========================================================================
   ANÁLISIS — pocas métricas y todas accionables.

   La regla al montar esta pantalla: si un número no cambia lo que vas a hacer
   esta semana, no está. Por eso no hay tarta de "distribución de tipos de
   sesión" ni contadores de rachas: hay horas, constancia, reparto por
   asignatura, progreso y la carga que viene.
   =========================================================================== */

import { pintaEstilos, barra, icono } from '../core/ui.js';
import { accion, on, emitir } from '../core/bus.js';
import { escapa, hoyLocal, sumaDias, lunesDe, duracion, diasHasta, aFecha, DIAS_C, pct, nota as fnota } from '../core/fmt.js';
import { listaAsignaturas, asignaturaDe } from '../core/asignaturas.js';
import { listaTemas, dominioMedio } from '../core/temas.js';
import * as motor from '../core/motor.js';
import { abrirNotas, entradaDe, mediaGeneral } from './notas.js';

let raiz = null;
let rango = 7;   // 7 | 30

/* ------------------------------- métricas ---------------------------------- */

function metricas() {
  const hoy = hoyLocal();
  const minutos = motor.minutosUltimos(rango);
  const dias = motor.diasConEstudio(Math.min(rango, 30));
  const tareas = motor.listaTareas().filter(t => t.tipo !== 'examen');
  const hechas = tareas.filter(t => motor.estaHecha(t) && t.completada &&
    t.completada >= Date.now() - rango * 86400000).length;
  const atrasadas = motor.atrasadas().length;
  return { minutos, dias, hechas, atrasadas, hoy };
}

/* ------------------------- horas por día (barras) --------------------------- */

function barrasHoras() {
  const hoy = hoyLocal();
  const n = rango === 7 ? 7 : 14;
  const datos = [];
  for (let i = n - 1; i >= 0; i--) {
    const ymd = sumaDias(hoy, -i);
    datos.push({ ymd, min: motor.minutosDe(ymd), et: DIAS_C[aFecha(ymd).getDay()] });
  }
  const tope = Math.max(60, ...datos.map(d => d.min));
  return `
    <div class="tarjeta">
      <h3>Minutos de estudio por día</h3>
      <div class="barras">
        ${datos.map(d => `<div class="b ${d.ymd === hoy ? 'on' : ''}" data-alto="${Math.round((d.min / tope) * 100)}"
          title="${escapa(d.ymd)}: ${escapa(duracion(d.min))}"></div>`).join('')}
      </div>
      <div class="barras-pie">${datos.map(d => `<span>${escapa(d.et[0].toUpperCase())}</span>`).join('')}</div>
    </div>`;
}

/* ------------------------- reparto por asignatura --------------------------- */

function repartoAsignaturas() {
  const desde = sumaDias(hoyLocal(), -rango);
  const porAsig = new Map();
  for (const s of motor.listaSesiones()) {
    if (s.fecha < desde) continue;
    porAsig.set(s.asignaturaId, (porAsig.get(s.asignaturaId) || 0) + (s.minutos || 0));
  }
  const total = [...porAsig.values()].reduce((a, b) => a + b, 0);
  if (!total) {
    return `
      <div class="tarjeta">
        <h3>Reparto por asignatura</h3>
        <p class="parrafo chico">Todavía no hay sesiones en este periodo. Cuando registres
        alguna, aquí se ve si estás dedicando el tiempo donde hace falta.</p>
      </div>`;
  }
  const filas = [...porAsig.entries()].sort((a, b) => b[1] - a[1]);
  return `
    <div class="tarjeta">
      <h3>Reparto por asignatura</h3>
      <div class="reparto">
        ${filas.map(([id, min]) => {
          const a = asignaturaDe(id);
          return `
            <div class="r">
              <span class="n">${escapa(a?.nombre || 'Sin asignatura')}</span>
              <span class="v">${escapa(duracion(min))}</span>
              ${barra(pct(min, total))}
            </div>`;
        }).join('')}
      </div>
    </div>`;
}

/* ------------------------------- progreso ---------------------------------- */

function progresoAsignaturas() {
  const l = listaAsignaturas();
  if (!l.length) return '';
  const filas = l.map(a => {
    const temas = listaTemas().filter(t => t.asignaturaId === a.id);
    const entrada = entradaDe(a.id);
    return { a, dominio: dominioMedio(temas), temas: temas.length, media: mediaGeneral(entrada), objetivo: entrada.objetivo };
  });

  return `
    <div class="tarjeta">
      <h3>Cómo vas por asignatura</h3>
      <div class="reparto">
        ${filas.map(f => `
          <div class="r" data-accion="analisis-notas" data-id="${escapa(f.a.id)}">
            <span class="n">${escapa(f.a.nombre)}</span>
            <span class="v">
              ${f.dominio != null ? `${f.dominio}% temario` : 'sin temas'}
              ${f.media != null ? ` · nota ${escapa(fnota(f.media))}` : ''}
            </span>
            ${barra(f.dominio ?? 0, (f.dominio ?? 0) >= 75 ? 'bien' : (f.dominio ?? 0) >= 45 ? 'ojo' : 'mal')}
          </div>`).join('')}
      </div>
      <p class="pista">Toca una asignatura para ver y apuntar sus notas.</p>
    </div>`;
}

accion('analisis-notas', d => abrirNotas(d.id));

/* ----------------------------- carga que viene ------------------------------ */

function cargaFutura() {
  const hoy = hoyLocal();
  const semanas = [];
  for (let s = 0; s < 4; s++) {
    const ini = sumaDias(lunesDe(hoy), s * 7);
    const fin = sumaDias(ini, 7);
    const items = motor.pendientes().filter(t => t.fecha >= ini && t.fecha < fin);
    semanas.push({
      ini,
      tareas: items.filter(t => t.tipo !== 'examen').length,
      examenes: items.filter(t => t.tipo === 'examen').length,
      minutos: items.reduce((a, t) => a + (t.duracion || 45), 0),
    });
  }
  const tope = Math.max(120, ...semanas.map(s => s.minutos));

  return `
    <div class="tarjeta">
      <h3>Lo que viene</h3>
      <div class="reparto">
        ${semanas.map((s, i) => `
          <div class="r">
            <span class="n">${i === 0 ? 'Esta semana' : i === 1 ? 'La que viene' : `Semana del ${escapa(s.ini.slice(8))}`}</span>
            <span class="v">${s.tareas} tarea${s.tareas === 1 ? '' : 's'}${s.examenes ? ` · ${s.examenes} examen${s.examenes === 1 ? '' : 'es'}` : ''}</span>
            ${barra(pct(s.minutos, tope), s.examenes ? 'ojo' : '')}
          </div>`).join('')}
      </div>
    </div>`;
}

/* -------------------------------- render ----------------------------------- */

function render() {
  if (!raiz) return;
  const m = metricas();
  const est = motor.estadoAcademico();

  raiz.innerHTML = `
    <div class="seccion-cab">
      <h2>Análisis</h2>
      <div class="segmentos">
        <button data-accion="analisis-rango" data-r="7" aria-pressed="${rango === 7}">7 días</button>
        <button data-accion="analisis-rango" data-r="30" aria-pressed="${rango === 30}">30 días</button>
      </div>
    </div>

    <div class="rejilla-auto" data-mt-grande>
      <div class="metrica">
        <div class="v">${escapa(duracion(m.minutos))}</div>
        <div class="e">Estudiado en ${rango} días</div>
      </div>
      <div class="metrica">
        <div class="v">${m.dias}<span class="apag"> / ${Math.min(rango, 30)}</span></div>
        <div class="e">Días con sesión</div>
      </div>
      <div class="metrica">
        <div class="v">${m.hechas}</div>
        <div class="e">Tareas completadas</div>
      </div>
      <div class="metrica">
        <div class="v ${m.atrasadas ? 'mal' : ''}">${m.atrasadas}</div>
        <div class="e">Atrasadas ahora</div>
      </div>
    </div>

    <div class="seccion" data-mt-grande>
      ${barrasHoras()}
      ${repartoAsignaturas()}
      ${progresoAsignaturas()}
      ${cargaFutura()}
    </div>

    <div class="tarjeta">
      <h3>Estado académico</h3>
      <div class="factor">
        <span class="n">${escapa(est.etiqueta)}</span>
        <span class="v">${est.puntos} / 100</span>
      </div>
      ${barra(est.puntos, est.puntos >= 80 ? 'bien' : est.puntos >= 40 ? 'ojo' : 'mal')}
      ${est.factores.length ? `
        <div class="factores" data-mt-grande>
          ${est.factores.map(f => `
            <div class="factor">
              <span class="n">${escapa(f.n)}</span>
              <span class="v mal">−${f.coste}</span>
              ${f.d ? `<span class="d">${escapa(f.d)}</span>` : ''}
            </div>`).join('')}
        </div>` : '<p class="parrafo chico" data-mt>Nada está restando puntos ahora mismo.</p>'}
    </div>`;

  pintaEstilos(raiz);
}

accion('analisis-rango', d => { rango = Number(d.r); render(); });

export default {
  montar(el) {
    raiz = el;
    render();
    on('datos-cambio', render);
  },
  activar() { render(); },
};
