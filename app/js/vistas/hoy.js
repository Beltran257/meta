/* ===========================================================================
   HOY — la pantalla que contesta, en menos de cinco segundos: qué tengo, qué
   pasa ahora, qué viene, qué es urgente y qué debería hacer.

   El orden NO es decorativo: primero lo que ya está fallando (riesgos), luego
   lo que ocurre en este momento, luego lo que META propone y por último el
   detalle del día. Lo que no ayuda a decidir nada, no está.
   =========================================================================== */

import { leer, guardar } from '../core/store.js';
import { hoja, pintaEstilos, icono, aviso, marcarCheck, flipLista } from '../core/ui.js';
import { accion, on, emitir } from '../core/bus.js';
import { escapa, hoyLocal, fechaLarga, fechaCorta, diaSemana, diasHasta, textoCountdown, duracion, aMinutos, minutosAhora } from '../core/fmt.js';
import { listaAsignaturas, asignaturaDe, colorDe } from '../core/asignaturas.js';
import * as motor from '../core/motor.js';
import * as sesion from '../core/sesion.js';
import { guardarTareas } from './tareas.js';
import { abrirTemarioLote } from './asignaturas.js';

let raiz = null;
let latido = null;

/* ------------------------------- saludo ------------------------------------ */
function saludo() {
  const h = new Date().getHours();
  const momento = h < 6 ? 'Buenas noches' : h < 13 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches';
  const nombre = (sesion.usuario()?.nombre || '').split(' ')[0];
  return `
    <div class="saludo">
      <div class="fecha">${escapa(fechaLarga(hoyLocal()))}</div>
      <h1>${escapa(momento)}${nombre ? ', ' + escapa(nombre) : ''}</h1>
    </div>`;
}

/* --------------------------- estado académico ------------------------------ */
function bloqueEstado() {
  const e = motor.estadoAcademico();
  const color = e.puntos >= 80 ? 'var(--bien)' : e.puntos >= 60 ? 'var(--acento)' : e.puntos >= 40 ? 'var(--ojo)' : 'var(--mal)';
  const resumen = e.factores.length
    ? e.factores.slice(0, 2).map(f => f.n.toLowerCase()).join(' · ')
    : 'Nada pendiente que te esté perjudicando';

  return `
    <button class="estado" data-accion="estado-detalle">
      <span class="aro">
        <svg viewBox="0 0 62 62" aria-hidden="true">
          <circle cx="31" cy="31" r="27" fill="none" stroke="var(--sup3)" stroke-width="5"/>
          <circle cx="31" cy="31" r="27" fill="none" stroke-width="5" stroke-linecap="round"
                  data-color-trazo="${color}" data-aro="${e.puntos}"/>
        </svg>
        <span class="val">${e.puntos}</span>
      </span>
      <span class="txt">
        <h3>${escapa(e.etiqueta)}</h3>
        <p>${escapa(resumen)}</p>
      </span>
      <span class="ver">${icono('flecha')}</span>
    </button>`;
}

accion('estado-detalle', () => {
  const e = motor.estadoAcademico();
  hoja({
    titulo: 'Estado académico',
    cuerpo: `
      <p class="parrafo">Empieza en 100 y baja por cosas concretas. No es una nota:
      mide cuánto control tienes sobre el curso ahora mismo.</p>
      <div class="factores" data-mt-grande>
        ${e.factores.length ? e.factores.map(f => `
          <div class="factor">
            <span class="n">${escapa(f.n)}</span>
            <span class="v mal">−${f.coste}</span>
            ${f.d ? `<span class="d">${escapa(f.d)}</span>` : ''}
          </div>`).join('')
        : '<p class="parrafo">Ahora mismo no hay nada restando puntos.</p>'}
      </div>
      <hr class="raya">
      <div class="factor">
        <span class="n"><b>Total</b></span>
        <span class="v"><b>${e.puntos} / 100</b></span>
        <span class="d">${escapa(e.etiqueta)}</span>
      </div>`,
  });
});

/* ------------------------------- riesgos ----------------------------------- */
function bloqueRiesgos() {
  const l = motor.riesgos();
  if (!l.length) return '';
  return `
    <div class="seccion">
      <div class="seccion-cab"><h2>Atención</h2></div>
      <div class="lista">
        ${l.slice(0, 3).map((r, i) => `
          <div class="riesgo ${r.nivel}">
            <span class="ico">${icono('aviso')}</span>
            <span class="cuerpo">
              <span class="t1">${escapa(r.titulo)}</span>
              <span class="t2">${escapa(r.detalle)}</span>
              ${r.accion ? `<button class="boton chico fantasma" data-accion="riesgo-accion" data-i="${i}">${escapa(r.accion.texto)}</button>` : ''}
            </span>
          </div>`).join('')}
      </div>
    </div>`;
}

accion('riesgo-accion', d => {
  const r = motor.riesgos()[Number(d.i)];
  if (!r?.accion) return;
  if (r.accion.plan) return abrirPlan();
  emitir('ir', { id: r.accion.ir, examenId: r.accion.examenId, filtro: r.accion.filtro });
});

/* -------------------------- ahora y lo siguiente --------------------------- */
function bloqueAhora() {
  const ahora = new Date();
  const clase = motor.claseAhora(ahora);
  const sig = motor.proximaClase(ahora);

  if (clase) {
    const a = asignaturaDe(clase.asignaturaId);
    return `
      <div class="ahora">
        <div class="et">Ahora</div>
        <h3>${escapa(a?.nombre || 'Clase')}</h3>
        <div class="cuando">${escapa(clase.franja.ini)} – ${escapa(clase.franja.fin)}${a?.aula ? ' · ' + escapa(a.aula) : ''}</div>
        <div class="acciones">
          <button class="boton chico" data-accion="sesion-desde-clase" data-asig="${escapa(clase.asignaturaId)}">Empezar sesión</button>
        </div>
      </div>`;
  }
  if (sig) {
    const a = asignaturaDe(sig.asignaturaId);
    const faltan = (aMinutos(sig.franja.ini) ?? 0) - minutosAhora(ahora);
    return `
      <div class="ahora">
        <div class="et">Siguiente</div>
        <h3>${escapa(a?.nombre || 'Clase')}</h3>
        <div class="cuando">${escapa(sig.franja.ini)} · en ${escapa(duracion(faltan))}</div>
      </div>`;
  }
  return '';
}

accion('sesion-desde-clase', d => emitir('ir', { id: 'estudiar', asignaturaId: d.asig, arrancar: true }));

/* ------------------------------ recomendación ------------------------------
   "Qué hago hoy": lo que cabe en el tiempo que dijiste tener y, debajo, lo que
   seguiría si das más. Cada fila lleva a algo útil: la ficha del examen (para
   ver el tema y cambiar tu porcentaje al terminar), o a poner el temario de un
   examen que no lo tiene. Ver motor.planDelDia. */
const todosLosBloques = () => { const r = motor.planDelDia(); return [...r.plan, ...r.extra]; };

function filaPlan(b, i, suave = false) {
  return `
    <div class="recomendacion ${suave ? 'suave' : ''}" data-accion="plan-abrir" data-i="${i}" role="button" tabindex="0">
      <span class="min">${b.minutos} min</span>
      <span class="q">
        <span class="t1">${escapa(b.que)}</span>
        <span class="t2">${escapa(b.detalle)}</span>
      </span>
      <span class="boton chico fantasma">${b.tipo === 'temario' ? 'Poner' : 'Abrir'}</span>
    </div>`;
}

function bloquePlan() {
  const { plan, extra, libres, motivo } = motor.planDelDia();
  const total = plan.reduce((s, b) => s + b.minutos, 0);

  if (!plan.length && !extra.length) {
    if (!listaAsignaturas().length) return '';
    return `
      <div class="seccion">
        <div class="seccion-cab"><h2>Qué hago hoy</h2></div>
        <div class="vacio">
          <h4>Nada urgente ahora mismo</h4>
          <p>Apunta tus exámenes y sube el temario de cada asignatura: con eso aquí aparece qué estudiar y cuánto.</p>
        </div>
      </div>`;
  }

  const visibles = plan.slice(0, 5);
  const siguientes = (plan.length > 5 ? plan.slice(5) : []).concat(extra).slice(0, plan.length ? 3 : 4);
  return `
    <div class="seccion">
      <div class="seccion-cab">
        <h2>Qué hago hoy</h2>
        <span class="apag">${plan.length ? `${escapa(duracion(total))}${libres >= 25 ? ` · te sobran ${escapa(duracion(libres))}` : ''}` : ''}</span>
      </div>
      ${plan.length ? `<div class="lista">${visibles.map((b, i) => filaPlan(b, i)).join('')}</div>` : `
        <p class="pista">${motivo === 'sin-tiempo' ? 'Hoy ya no te queda tiempo de estudio según lo que has dicho. Esto sería lo siguiente:' : 'Esto sería lo siguiente:'}</p>`}
      ${siguientes.length ? `
        <h3 class="cal-sub" data-mt-grande>${plan.length ? 'Si te sobra tiempo' : 'Por orden'}</h3>
        <div class="lista">${siguientes.map((b, i) => filaPlan(b, (plan.length > 5 ? 5 : plan.length) + i, true)).join('')}</div>` : ''}
      <div class="acciones" data-mt>
        <button class="boton fantasma chico" data-accion="plan-detalle">Ver el plan completo</button>
      </div>
    </div>`;
}

let modoPlan = 'hoy'; // hoy | semana

function cuerpoPlanHoy() {
  const { plan, extra, libres, motivo } = motor.planDelDia();
  const filas = [...plan, ...extra];
  if (!filas.length) return '<p class="parrafo">Hoy no hay nada que planificar: ni entregas cerca, ni exámenes, ni repasos vencidos.</p>';
  return `
      <p class="parrafo">Ordenado por lo que más te conviene hacer: cuánto falta para cada examen, lo que tú mismo
      dices que llevas de cada tema y lo que llevas sin tocar esa asignatura. Si un examen no tiene temario,
      lo primero es ponerlo.</p>
      ${plan.length ? `
        <h3 class="cal-sub" data-mt-grande>Cabe hoy <span class="apag">${escapa(duracion(plan.reduce((s, b) => s + b.minutos, 0)))} de ${escapa(duracion(motor.minutosLibresHoy()))}</span></h3>
        <div class="lista">${plan.map((b, i) => filaPlan(b, i)).join('')}</div>` : `
        <p class="pista" data-mt-grande>${motivo === 'sin-tiempo' ? 'Hoy ya no te queda tiempo de estudio según lo que has dicho.' : ''}</p>`}
      ${extra.length ? `
        <h3 class="cal-sub" data-mt-grande>${plan.length ? 'Si te sobra tiempo' : 'Por orden'}</h3>
        <div class="lista">${extra.map((b, i) => filaPlan(b, plan.length + i, true)).join('')}</div>` : ''}
      ${libres >= 25 && plan.length ? `<p class="pista">Te quedarían ${escapa(duracion(libres))} libres.</p>` : ''}
      <button class="boton fantasma ancho" data-accion="plan-copiar" data-mt-grande>Copiar el plan (para pegarlo en tus tareas)</button>`;
}

/* La semana no repite el algoritmo de "hoy" para los días futuros (fingir qué
   recomendaría el motor pasado mañana obligaría a adivinar qué se habrá hecho
   para entonces): enseña lo que YA está fechado cada día contra el tiempo que
   sueles tener, y deja mover una tarea si un día no le cabe todo. */
function cuerpoPlanSemana() {
  const dias = motor.semanaDesde(hoyLocal(), 7);
  const hoy = hoyLocal();
  return `
    <div class="lista" data-mt-grande>
      ${dias.map(d => {
        const items = [...d.examenes.map(e => ({ ...e, esExamen: true })), ...d.tareas];
        return `
          <div class="fila vertical">
            <div class="fila">
              <span class="izq">
                <span class="t1">${d.fecha === hoy ? 'Hoy' : escapa(diaSemana(d.fecha, true))} · ${escapa(fechaCorta(d.fecha))}</span>
                <span class="t2">${escapa(duracion(d.minutosCarga))} de ${escapa(duracion(d.minutosDisponibles))}</span>
              </span>
              ${d.sobrecarga ? '<span class="pil mal">no te cabe</span>' : items.length ? '<span class="pil bien">te cabe</span>' : ''}
            </div>
            ${items.length ? items.map(t => `
              <div class="fila">
                <span class="izq">
                  <span class="t1">${t.esExamen ? 'Examen: ' : ''}${escapa(t.titulo)}</span>
                  <span class="t2">${escapa(asignaturaDe(t.asignaturaId)?.nombre || '')}</span>
                </span>
                ${!t.esExamen ? `<button class="boton chico sutil" data-accion="mover-abrir" data-id="${escapa(t.id)}">Mover</button>` : ''}
              </div>`).join('') : '<p class="parrafo chico">Nada fechado este día.</p>'}
          </div>`;
      }).join('')}
    </div>`;
}

function abrirPlan() {
  hoja({
    titulo: 'Tu plan',
    ancha: modoPlan === 'semana',
    cuerpo: `
      <div class="segmentos">
        <button data-accion="plan-modo" data-m="hoy" aria-pressed="${modoPlan === 'hoy'}">Hoy</button>
        <button data-accion="plan-modo" data-m="semana" aria-pressed="${modoPlan === 'semana'}">Semana</button>
      </div>
      <div data-mt-grande>${modoPlan === 'hoy' ? cuerpoPlanHoy() : cuerpoPlanSemana()}</div>`,
    pie: `<button class="boton fantasma" data-accion="cerrar-hoja">Cerrar</button>
          <button class="boton" data-accion="ia-plan">Pedir opinión a META AI</button>`,
  });
}

accion('plan-detalle', () => { modoPlan = 'hoy'; abrirPlan(); });
accion('plan-modo', d => { modoPlan = d.m; abrirPlan(); });

/* ------------------------------- mover tarea -------------------------------- */

accion('mover-abrir', d => {
  const t = motor.listaTareas().find(x => x.id === d.id);
  if (!t) return;
  const opciones = motor.semanaDesde(hoyLocal(), 10).map(x => x.fecha);
  hoja({
    titulo: 'Mover a otro día',
    cuerpo: `
      <p class="parrafo">${escapa(t.titulo)}</p>
      <div class="lista" data-mt-grande>
        ${opciones.filter(f => f !== t.fecha).map(f => `
          <button class="fila" data-accion="mover-a" data-id="${escapa(t.id)}" data-fecha="${f}">
            <span class="izq"><span class="t1">${escapa(diaSemana(f))} · ${escapa(fechaCorta(f))}</span></span>
          </button>`).join('')}
      </div>`,
    pie: `<button class="boton fantasma" data-accion="cerrar-hoja">Cancelar</button>`,
  });
});

accion('mover-a', d => {
  guardarTareas(motor.listaTareas().map(t => (t.id === d.id ? { ...t, fecha: d.fecha } : t)));
  aviso('Movida');
  abrirPlan();
});

accion('plan-abrir', d => {
  const b = todosLosBloques()[Number(d.i)];
  if (!b) return;
  if (b.tipo === 'temario') return abrirTemarioLote(b.refId);
  if (b.tipo === 'tarea') return emitir('abrir-tarea', b.refId);
  if (b.tipo === 'tema' && b.examenId) return emitir('ir', { id: 'examenes', examenId: b.examenId });
  emitir('ir', { id: 'asignaturas', asignaturaId: b.asignaturaId });
});

accion('plan-copiar', async () => {
  const hoy = hoyLocal();
  const texto = `Plan de estudio · ${fechaLarga(hoy)}\n` + todosLosBloques()
    .map(b => `- ${b.minutos} min · ${b.que} (${b.detalle})`).join('\n');
  try { await navigator.clipboard.writeText(texto); aviso('Plan copiado'); }
  catch { aviso('No se pudo copiar', 'mal'); }
});

/* -------------------------------- para hoy --------------------------------- */
function bloqueTareas() {
  const hoy = hoyLocal();
  const l = motor.priorizadas().filter(t => t.tipo !== 'examen' && t.fecha <= hoy);
  if (!l.length) return '';
  return `
    <div class="seccion">
      <div class="seccion-cab">
        <h2>Para hoy</h2>
        <button class="acc" data-accion="ir" data-id="tareas">Ver todas</button>
      </div>
      <div class="lista">
        ${l.slice(0, 6).map(t => {
          const a = asignaturaDe(t.asignaturaId);
          const atrasada = t.fecha < hoy;
          return `
            <div class="fila" data-flip="${escapa(t.id)}">
              <button class="marca-check" data-accion="hoy-check" data-id="${escapa(t.id)}" aria-label="Marcar hecha">
                ${icono('check')}
              </button>
              <span class="izq" data-accion="hoy-abrir" data-id="${escapa(t.id)}">
                <span class="t1">${escapa(t.titulo)}</span>
                <span class="t2">
                  ${a ? `<span class="asig"><i data-bg="${escapa(a.color)}"></i><span>${escapa(a.nombre)}</span></span>` : ''}
                  ${atrasada ? `<span class="pil mal">${escapa(motor.motivo(t))}</span>` : ''}
                </span>
              </span>
            </div>`;
        }).join('')}
      </div>
    </div>`;
}

/* ------------------------------ clases de hoy ------------------------------ */
function bloqueClases() {
  const ahora = new Date();
  const clases = motor.clasesDe(ahora.getDay());
  if (!clases.length) return '';
  const min = minutosAhora(ahora);
  return `
    <div class="seccion">
      <div class="seccion-cab">
        <h2>Tus clases</h2>
        <button class="acc" data-accion="ir" data-id="horario">Ver horario</button>
      </div>
      <div class="tarjeta">
        <div class="linea-tiempo">
          ${clases.map(c => {
            const a = asignaturaDe(c.asignaturaId);
            const ini = aMinutos(c.franja.ini) ?? 0, fin = aMinutos(c.franja.fin) ?? 0;
            const estado = min >= fin ? 'pasado' : (min >= ini ? 'ahora' : '');
            return `
              <div class="tramo ${estado}">
                <span class="h">${escapa(c.franja.ini)}</span>
                <span class="q">
                  <i class="punto-color" data-bg="${escapa(colorDe(c.asignaturaId))}"></i>
                  ${escapa(a?.nombre || '—')}
                </span>
              </div>`;
          }).join('')}
        </div>
      </div>
    </div>`;
}

/* --------------------------- resumen del domingo ---------------------------
   Se enseña una vez por domingo. La marca de "visto" se pone DESPUÉS de haber
   pintado bien: si el render fallara, no se perdería el aviso para siempre. */
function bloqueDomingo() {
  if (new Date().getDay() !== 0) return '';
  const ymd = hoyLocal();
  if (leer('prefs', {}).domingoVisto === ymd) return '';

  const semana = motor.priorizadas().filter(t => diasHasta(t.fecha) >= 0 && diasHasta(t.fecha) <= 7);
  if (!semana.length) return '';

  return `
    <div class="seccion">
      <div class="seccion-cab"><h2>La semana que entra</h2></div>
      <div class="lista">
        ${semana.slice(0, 7).map(t => {
          const a = asignaturaDe(t.asignaturaId);
          return `
            <div class="fila">
              <span class="izq">
                <span class="t1">${t.tipo === 'examen' ? 'Examen: ' : ''}${escapa(t.titulo)}</span>
                <span class="t2">${a ? escapa(a.nombre) : ''}</span>
              </span>
              <span class="der"><span class="n1">${escapa(textoCountdown(diasHasta(t.fecha)))}</span></span>
            </div>`;
        }).join('')}
      </div>
    </div>`;
}

/* --------------------------------- render ---------------------------------- */

function render() {
  if (!raiz) return;

  if (!listaAsignaturas().length) {
    raiz.innerHTML = `
      ${saludo()}
      <div class="vacio">
        <h4>Empieza por tus asignaturas</h4>
        <p>Son la base de todo lo demás: el horario, las tareas, los exámenes y los apuntes
        cuelgan de ellas. Se tarda un minuto.</p>
        <button class="boton" data-accion="ir" data-id="asignaturas">Añadir asignaturas</button>
      </div>`;
    return;
  }

  const domingo = bloqueDomingo();

  raiz.innerHTML = `
    ${saludo()}
    ${bloqueEstado()}
    <div data-mt-grande>${bloqueAhora()}</div>
    ${bloqueRiesgos()}
    ${bloquePlan()}
    ${bloqueTareas()}
    ${domingo}
    ${bloqueClases()}`;

  pintaEstilos(raiz);
  // El trazo del aro no cabe en pintaEstilos genérico: es stroke, no fondo.
  raiz.querySelectorAll('[data-color-trazo]').forEach(el => { el.style.stroke = el.dataset.colorTrazo; });

  if (domingo) {
    const prefs = leer('prefs', {});
    guardar('prefs', { ...prefs, domingoVisto: hoyLocal() });
  }
}

accion('hoy-check', (d, el) => {
  const lista = motor.listaTareas();
  const t = lista.find(x => x.id === d.id);
  if (!t) return;
  const hecha = motor.estaHecha(t);

  const aplicar = () => flipLista(raiz, () => {
    guardar('tareas', lista.map(x => x.id === d.id
      ? { ...x, estado: hecha ? 'pendiente' : 'hecha', hecho: !hecha }
      : x));
    emitir('local-cambio');
    emitir('datos-cambio', ['tareas']);
  });

  if (hecha) { aplicar(); return; }
  marcarCheck(el.closest('.marca-check'));
  aviso('Hecho');
  setTimeout(aplicar, 240);
});

accion('hoy-abrir', d => emitir('abrir-tarea', d.id));

export default {
  montar(el) {
    raiz = el;
    render();
    on('datos-cambio', render);
  },
  activar() {
    render();
    // El bloque "ahora" depende del reloj: se refresca solo mientras la
    // pantalla esté a la vista, y se para al salir para no gastar batería.
    clearInterval(latido);
    latido = setInterval(() => { if (!document.hidden) render(); }, 60_000);
  },
  desactivar() { clearInterval(latido); latido = null; },
};
