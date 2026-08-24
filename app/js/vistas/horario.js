/* ===========================================================================
   HORARIO — día, semana y mes sobre los MISMOS datos.

   No es solo la rejilla de clases: encima se pintan las entregas, los exámenes
   y las sesiones de estudio, porque la pregunta real no es "¿qué clase tengo?"
   sino "¿cuánto tengo encima este día?".
   =========================================================================== */

import { leer, guardar } from '../core/store.js';
import { hoja, cerrarHoja, aviso, confirmar, pintaEstilos, icono } from '../core/ui.js';
import { accion, on, emitir } from '../core/bus.js';
import { escapa, hoyLocal, fechaLarga, aFecha, sumaDias, aMinutos, aHora, MESES, duracion } from '../core/fmt.js';
import { listaAsignaturas, asignaturaDe, colorDe } from '../core/asignaturas.js';
import * as motor from '../core/motor.js';
import { filaTarea, formTarea } from './tareas.js';

let raiz = null;
let modo = 'semana';           // dia | semana | mes
let mes = null;                // {a, m} para la vista de mes
let diaSel = null;             // YYYY-MM-DD para la vista de día

const horario = () => motor.horarioDatos();

function guardarHorario(h) {
  guardar('horario', h);
  emitir('local-cambio');
  emitir('datos-cambio', ['horario']);
  render();                    // la rejilla de fondo se actualiza aunque el
}                              // cambio venga de dentro de una hoja abierta

/* ================================ SEMANA =================================== */

function vistaSemana() {
  const h = horario();
  const hoyDow = new Date().getDay();

  if (!h.franjas.length) {
    return `
      <div class="vacio">
        <h4>Aún no hay horas de clase</h4>
        <p>Define primero las franjas del día (por ejemplo 08:30–09:25) y luego
        rellenas cada casilla con la asignatura que toca.</p>
        <button class="boton" data-accion="franjas-abrir">Definir las franjas</button>
      </div>`;
  }

  return `
    <div class="semana">
      <div class="semana-rejilla">
        <div></div>
        ${motor.DIAS_LECTIVOS.map(d => `<div class="cab ${d.dow === hoyDow ? 'hoy' : ''}">${d.et}</div>`).join('')}
        ${h.franjas.map((f, i) => `
          <div class="hora">${escapa(f.ini)}<br>${escapa(f.fin)}</div>
          ${motor.DIAS_LECTIVOS.map(d => {
            const asigId = h.dias[d.id]?.[i] || null;
            const a = asigId ? asignaturaDe(asigId) : null;
            return `
              <button class="casilla ${a ? '' : 'libre'}" data-accion="casilla" data-dia="${d.id}" data-i="${i}">
                ${a ? `<i class="barrita" data-bg="${escapa(a.color)}"></i>
                       <span class="nom">${escapa(a.nombre)}</span>
                       ${a.aula ? `<span class="aula">${escapa(a.aula)}</span>` : ''}` : '<span class="nom">+</span>'}
              </button>`;
          }).join('')}`).join('')}
      </div>
    </div>`;
}

accion('casilla', d => {
  const asignaturas = listaAsignaturas();
  if (!asignaturas.length) return aviso('Añade antes tus asignaturas', 'mal');
  hoja({
    titulo: 'Qué clase va aquí',
    cuerpo: `
      <div class="lista">
        ${asignaturas.map(a => `
          <button class="fila" data-accion="casilla-poner" data-dia="${d.dia}" data-i="${d.i}" data-asig="${escapa(a.id)}">
            <span class="punto-color" data-bg="${escapa(a.color)}"></span>
            <span class="izq"><span class="t1">${escapa(a.nombre)}</span></span>
          </button>`).join('')}
      </div>
      <button class="boton fantasma ancho" data-accion="casilla-poner" data-dia="${d.dia}" data-i="${d.i}" data-asig="" data-mt-grande>
        Dejar libre
      </button>`,
  });
});

accion('casilla-poner', d => {
  const h = horario();
  const dias = { ...h.dias };
  const fila = [...(dias[d.dia] || [])];
  while (fila.length <= Number(d.i)) fila.push(null);
  fila[Number(d.i)] = d.asig || null;
  dias[d.dia] = fila;
  cerrarHoja();
  guardarHorario({ ...h, dias });
});

/* ================================== DÍA ==================================== */

function vistaDia() {
  const ymd = diaSel || hoyLocal();
  const dow = aFecha(ymd).getDay();
  const clases = motor.clasesDe(dow);
  const items = motor.listaTareas().filter(t => t.fecha === ymd);
  const sesiones = motor.sesionesDe(ymd);
  const minutos = sesiones.reduce((s, x) => s + (x.minutos || 0), 0);

  return `
    <div class="mes-cab">
      <button class="btn-icono" data-accion="dia-mover" data-n="-1" aria-label="Día anterior">${icono('atras')}</button>
      <h2>${escapa(fechaLarga(ymd))}</h2>
      <button class="btn-icono" data-accion="dia-mover" data-n="1" aria-label="Día siguiente">${icono('flecha')}</button>
    </div>

    ${clases.length ? `
      <div class="seccion">
        <div class="seccion-cab"><h2>Clases</h2></div>
        <div class="tarjeta">
          <div class="linea-tiempo">
            ${clases.map(c => `
              <div class="tramo">
                <span class="h">${escapa(c.franja.ini)}</span>
                <span class="q">
                  <i class="punto-color" data-bg="${escapa(colorDe(c.asignaturaId))}"></i>
                  ${escapa(asignaturaDe(c.asignaturaId)?.nombre || '—')}
                  <span class="apag">${escapa(c.franja.fin)}</span>
                </span>
              </div>`).join('')}
          </div>
        </div>
      </div>` : ''}

    <div class="seccion">
      <div class="seccion-cab"><h2>Ese día</h2></div>
      ${items.length ? `<div class="lista">${items.map(t => filaTarea(t, { conMotivo: false })).join('')}</div>`
        : '<div class="vacio"><p>Nada apuntado para este día.</p></div>'}
      <div class="acciones" data-mt>
        <button class="boton fantasma chico" data-accion="dia-nueva-tarea" data-ymd="${ymd}">${icono('mas')} Añadir aquí</button>
      </div>
    </div>

    ${minutos ? `
      <div class="seccion">
        <div class="seccion-cab"><h2>Estudio</h2></div>
        <div class="tarjeta">
          <p class="parrafo">${escapa(duracion(minutos))} en ${sesiones.length}
          ${sesiones.length === 1 ? 'sesión' : 'sesiones'}.</p>
        </div>
      </div>` : ''}`;
}

accion('dia-mover', d => { diaSel = sumaDias(diaSel || hoyLocal(), Number(d.n)); render(); });
accion('dia-nueva-tarea', d => { cerrarHoja(); formTarea(null, { fecha: d.ymd }); });

/* ================================== MES ==================================== */

function vistaMes() {
  if (!mes) { const h = new Date(); mes = { a: h.getFullYear(), m: h.getMonth() }; }
  const { a, m } = mes;
  const primero = new Date(a, m, 1);
  const ultimo = new Date(a, m + 1, 0);
  const salto = (primero.getDay() + 6) % 7;         // lunes = 0
  const hoy = hoyLocal();

  const porDia = {};
  for (const t of motor.listaTareas()) {
    const [ta, tm] = String(t.fecha || '').split('-').map(Number);
    if (ta === a && tm === m + 1) (porDia[t.fecha] ||= []).push(t);
  }

  const celdas = [];
  for (let i = 0; i < salto; i++) celdas.push(null);
  for (let d = 1; d <= ultimo.getDate(); d++) {
    const ymd = `${a}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    celdas.push({ d, ymd, items: porDia[ymd] || [], finde: [0, 6].includes(new Date(a, m, d).getDay()) });
  }

  return `
    <div class="mes-cab">
      <button class="btn-icono" data-accion="mes-mover" data-n="-1" aria-label="Mes anterior">${icono('atras')}</button>
      <h2>${MESES[m]} ${a}</h2>
      <button class="btn-icono" data-accion="mes-mover" data-n="1" aria-label="Mes siguiente">${icono('flecha')}</button>
    </div>
    <div class="mes-rejilla">
      ${['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(d => `<div class="dsem">${d}</div>`).join('')}
      ${celdas.map(c => {
        if (!c) return '<div></div>';
        const colores = [...new Set(c.items.map(t => colorDe(t.asignaturaId)))].slice(0, 4);
        return `
          <button class="dia-mes ${c.ymd === hoy ? 'hoy' : ''} ${c.finde ? 'finde' : ''}"
                  data-accion="mes-dia" data-ymd="${c.ymd}">
            <span>${c.d}</span>
            <span class="puntos">${colores.map(col => `<i data-bg="${col}"></i>`).join('')}</span>
          </button>`;
      }).join('')}
    </div>`;
}

accion('mes-mover', d => {
  mes.m += Number(d.n);
  if (mes.m < 0) { mes.m = 11; mes.a--; }
  if (mes.m > 11) { mes.m = 0; mes.a++; }
  render();
});

accion('mes-dia', d => { diaSel = d.ymd; modo = 'dia'; render(); });

/* ============================== FRANJAS ==================================== */

function bloqueFranjas() {
  const h = horario();
  return `
    <div class="lista">
      ${h.franjas.length ? h.franjas.map((f, i) => `
        <div class="fila">
          <span class="izq">
            <span class="campos-2">
              <input type="time" value="${escapa(f.ini)}" data-franja="ini" data-i="${i}" aria-label="Hora de inicio">
              <input type="time" value="${escapa(f.fin)}" data-franja="fin" data-i="${i}" aria-label="Hora de fin">
            </span>
          </span>
          <button class="btn-icono" data-accion="franja-borrar" data-i="${i}" aria-label="Borrar franja">${icono('papelera')}</button>
        </div>`).join('')
      : '<div class="vacio"><p>Sin franjas todavía.</p></div>'}
    </div>
    <button class="boton fantasma ancho" data-accion="franja-anadir" data-mt>${icono('mas')} Añadir franja</button>`;
}

function repintarFranjas() {
  const el = document.querySelector('#caja-franjas');
  if (!el) return;
  el.innerHTML = bloqueFranjas();
  engancharFranjas(el);
  pintaEstilos(el);
}

function engancharFranjas(el) {
  el.querySelectorAll('[data-franja]').forEach(inp => {
    inp.addEventListener('change', () => {
      const i = Number(inp.dataset.i);
      const h = horario();
      const franjas = [...h.franjas];
      franjas[i] = { ...franjas[i], [inp.dataset.franja]: inp.value };
      guardarHorario({ ...h, franjas });
    });
  });
}

accion('franjas-abrir', () => {
  hoja({
    titulo: 'Franjas horarias',
    cuerpo: `<p class="parrafo">Las horas de clase de un día normal. Son las mismas
      para los cinco días; si un día tienes menos, deja las casillas libres.</p>
      <div id="caja-franjas" data-mt-grande>${bloqueFranjas()}</div>`,
    alAbrir(v) { engancharFranjas(v); },
  });
});

accion('franja-anadir', () => {
  const h = horario();
  const ultima = h.franjas[h.franjas.length - 1];
  const nueva = ultima
    ? { ini: ultima.fin, fin: aHora((aMinutos(ultima.fin) ?? 510) + 55) }
    : { ini: '08:30', fin: '09:25' };
  guardarHorario({ ...h, franjas: [...h.franjas, nueva] });
  repintarFranjas();
});

accion('franja-borrar', async d => {
  if (!await confirmar('Se borra esta franja en los cinco días.', 'Borrar')) return;
  const i = Number(d.i);
  const h = horario();
  const dias = {};
  for (const dia of Object.keys(h.dias)) dias[dia] = (h.dias[dia] || []).filter((_, j) => j !== i);
  guardarHorario({ franjas: h.franjas.filter((_, j) => j !== i), dias });
  repintarFranjas();
});

/* ================================= RENDER ================================== */

function render() {
  if (!raiz) return;

  if (!listaAsignaturas().length) {
    raiz.innerHTML = `
      <div class="vacio">
        <h4>Antes, tus asignaturas</h4>
        <p>El horario se rellena eligiendo qué asignatura va en cada casilla.</p>
        <button class="boton" data-accion="ir" data-id="asignaturas">Añadir asignaturas</button>
      </div>`;
    return;
  }

  raiz.innerHTML = `
    <div class="seccion-cab">
      <h2>Horario</h2>
      <div class="segmentos">
        ${[['dia', 'Día'], ['semana', 'Semana'], ['mes', 'Mes']].map(([v, e]) =>
          `<button data-accion="horario-modo" data-m="${v}" aria-pressed="${modo === v}">${e}</button>`).join('')}
      </div>
    </div>
    <div data-mt-grande>
      ${modo === 'dia' ? vistaDia() : modo === 'mes' ? vistaMes() : vistaSemana()}
    </div>
    ${modo === 'semana' ? `
      <div class="acciones" data-mt-grande>
        <button class="boton fantasma chico" data-accion="franjas-abrir">Editar franjas</button>
      </div>` : ''}`;

  pintaEstilos(raiz);
}

accion('horario-modo', d => { modo = d.m; render(); });

export default {
  montar(el) {
    raiz = el;
    render();
    on('datos-cambio', render);
  },
  activar() { render(); },
};
