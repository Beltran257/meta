/* ===========================================================================
   ASIGNATURAS — cada una es un pequeño espacio de trabajo, no una fila de una
   lista de ajustes: temas, progreso, lo que tienes pendiente, horas metidas y
   dónde flojeas.
   =========================================================================== */

import { guardar, leer } from '../core/store.js';
import { hoja, cerrarHoja, aviso, confirmar, pintaEstilos, icono, barra, enfocar } from '../core/ui.js';
import { accion, on, emitir } from '../core/bus.js';
import { escapa, duracion, diasHasta, fechaCorta, nota as fnota, pct } from '../core/fmt.js';
import { PALETA, listaAsignaturas, asignaturaDe, siguienteColor, nuevoId } from '../core/asignaturas.js';
import { temasDe, crearTema, editarTema, borrarTema, dominioMedio } from '../core/temas.js';
import * as motor from '../core/motor.js';
import { abrirNotas, mediaGeneral, entradaDe } from './notas.js';

let raiz = null;
let seleccionada = null;

const claseDe = p => (p >= 75 ? 'bien' : p >= 45 ? 'ojo' : 'mal');

function guardarAsignaturas(l) {
  guardar('asignaturas', l);
  emitir('local-cambio');
  emitir('datos-cambio', ['asignaturas']);
}

/* ------------------------------ datos derivados ---------------------------- */

function resumen(a) {
  const temas = temasDe(a.id);
  const tareas = motor.pendientes().filter(t => t.asignaturaId === a.id && t.tipo !== 'examen');
  const examen = motor.examenesProximos(120).find(e => e.asignaturaId === a.id);
  const minutos = motor.listaSesiones().filter(s => s.asignaturaId === a.id)
    .reduce((s, x) => s + (x.minutos || 0), 0);
  return { temas, tareas, examen, minutos, dominio: dominioMedio(temas) };
}

/* --------------------------------- lista ----------------------------------- */

function vistaLista() {
  const l = listaAsignaturas();
  if (!l.length) {
    return `
      <div class="vacio">
        <h4>Aún no hay asignaturas</h4>
        <p>Son la base de META: el horario, las tareas, los exámenes y los apuntes cuelgan de ellas.</p>
        <button class="boton" data-accion="asig-nueva">Añadir la primera</button>
      </div>`;
  }

  return `
    <div class="rejilla-auto">
      ${l.map(a => {
        const r = resumen(a);
        return `
          <button class="tarjeta" data-accion="asig-abrir" data-id="${escapa(a.id)}">
            <div class="asig"><i data-bg="${escapa(a.color)}"></i><span>${escapa(a.nombre)}</span></div>
            <h3 data-mt>${escapa(a.nombre)}</h3>
            <div class="parrafo chico">
              ${r.temas.length ? `${r.temas.length} ${r.temas.length === 1 ? 'tema' : 'temas'}` : 'Sin temas'}
              ${r.tareas.length ? ` · ${r.tareas.length} pendiente${r.tareas.length === 1 ? '' : 's'}` : ''}
            </div>
            ${r.dominio != null ? `<div data-mt>${barra(r.dominio, claseDe(r.dominio))}</div>` : ''}
            ${r.examen ? `<div class="pil ${diasHasta(r.examen.fecha) <= 7 ? 'mal' : ''}" data-mt>Examen en ${Math.max(0, diasHasta(r.examen.fecha))} días</div>` : ''}
          </button>`;
      }).join('')}
    </div>
    <div class="acciones" data-mt-grande>
      <button class="boton fantasma" data-accion="asig-nueva">${icono('mas')} Nueva asignatura</button>
    </div>`;
}

/* -------------------------------- detalle ---------------------------------- */

function vistaDetalle(a) {
  const r = resumen(a);
  const notas = leer('notas', {})[a.id];
  const examenes = motor.examenesProximos(365).filter(e => e.asignaturaId === a.id);

  return `
    <div class="seccion-cab">
      <button class="btn-icono" data-accion="asig-volver" aria-label="Volver">${icono('atras')}</button>
      <h2>${escapa(a.nombre)}</h2>
      <button class="acc" data-accion="asig-editar" data-id="${escapa(a.id)}">Editar</button>
    </div>

    <div class="rejilla3" data-mt-grande>
      <div class="metrica">
        <div class="v">${r.dominio == null ? '—' : r.dominio + '%'}</div>
        <div class="e">Dominio medio</div>
      </div>
      <div class="metrica">
        <div class="v">${escapa(duracion(r.minutos))}</div>
        <div class="e">Estudiado</div>
      </div>
      <div class="metrica">
        <div class="v">${r.tareas.length}</div>
        <div class="e">Pendientes</div>
      </div>
    </div>

    <div class="tarjeta" data-mt-grande>
      <h3>Calificaciones</h3>
      ${notas?.objetivo != null ? `
        <div class="factor">
          <span class="n">Media actual</span>
          <span class="v">${escapa(fnota(mediaDe(notas)))} de ${escapa(fnota(notas.objetivo))}</span>
        </div>
        ${barra(pct(mediaDe(notas) || 0, notas.objetivo))}`
      : '<p class="parrafo chico">Apunta tus notas y ponte un objetivo: META calcula qué te hace falta en lo que queda.</p>'}
      <button class="boton fantasma ancho" data-accion="asig-notas" data-id="${escapa(a.id)}" data-mt>
        Ver notas y objetivo
      </button>
    </div>

    <div class="seccion" data-mt-grande>
      <div class="seccion-cab">
        <h2>Temas</h2>
        <span class="apag">${r.temas.length}</span>
      </div>
      ${r.temas.length ? `
        <div class="lista">
          ${r.temas.map(t => `
            <div class="tema-fila" data-accion="tema-abrir" data-id="${escapa(t.id)}">
              <span class="n">${escapa(t.nombre)}${t.proximoRepaso && diasHasta(t.proximoRepaso) <= 0 ? ' <span class="pil ojo">toca repasar</span>' : ''}</span>
              ${barra(t.dominio || 0, claseDe(t.dominio || 0))}
              <span class="pc">${t.dominio || 0}%</span>
            </div>`).join('')}
        </div>` : '<div class="vacio"><p>Sin temas. Son la unidad con la que META mide tu preparación.</p></div>'}
      <div class="campo" data-mt>
        <input id="asig-tema-nuevo" type="text" placeholder="Añadir tema y pulsar Intro" autocomplete="off">
      </div>
    </div>

    ${examenes.length ? `
      <div class="seccion">
        <div class="seccion-cab"><h2>Exámenes</h2></div>
        <div class="lista">
          ${examenes.map(e => `
            <button class="fila" data-accion="examen-abrir" data-id="${escapa(e.id)}">
              <span class="izq"><span class="t1">${escapa(e.titulo)}</span>
                <span class="t2">${escapa(fechaCorta(e.fecha))}</span></span>
              <span class="der"><span class="n1">${Math.max(0, diasHasta(e.fecha))} días</span></span>
            </button>`).join('')}
        </div>
      </div>` : ''}

    ${r.tareas.length ? `
      <div class="seccion">
        <div class="seccion-cab"><h2>Pendiente</h2></div>
        <div class="lista">
          ${r.tareas.map(t => `
            <button class="fila" data-accion="tarea-editar" data-id="${escapa(t.id)}">
              <span class="izq"><span class="t1">${escapa(t.titulo)}</span>
                <span class="t2">${escapa(motor.motivo(t))}</span></span>
              <span class="der"><span class="n1">${escapa(fechaCorta(t.fecha))}</span></span>
            </button>`).join('')}
        </div>
      </div>` : ''}

    <div class="acciones" data-mt-grande>
      <button class="boton" data-accion="asig-estudiar" data-id="${escapa(a.id)}">Estudiar esta asignatura</button>
      <button class="boton fantasma" data-accion="ir" data-id="apuntes">Ver sus apuntes</button>
    </div>`;
}

function mediaDe(entrada) {
  const todas = ['1', '2', '3'].flatMap(k => entrada.evaluaciones?.[k] || []);
  if (!todas.length) return null;
  const peso = todas.reduce((s, n) => s + (n.peso || 1), 0);
  return peso ? todas.reduce((s, n) => s + n.valor * (n.peso || 1), 0) / peso : null;
}

/* -------------------------------- acciones --------------------------------- */

accion('asig-abrir', d => { seleccionada = d.id; render(); });
accion('asig-notas', d => abrirNotas(d.id));
accion('asig-volver', () => { seleccionada = null; render(); });

accion('asig-estudiar', d => {
  const flojo = temasDe(d.id).slice().sort((a, b) => (a.dominio || 0) - (b.dominio || 0))[0];
  emitir('ir', { id: 'estudiar', asignaturaId: d.id, temaId: flojo?.id || null, arrancar: true });
});

function formAsignatura(a) {
  const color = a?.color || siguienteColor();
  hoja({
    titulo: a ? 'Editar asignatura' : 'Nueva asignatura',
    cuerpo: `
      <div class="campo">
        <label for="as-nombre">Nombre</label>
        <input id="as-nombre" type="text" value="${escapa(a?.nombre || '')}" placeholder="Matemáticas II" autocomplete="off">
      </div>
      <div class="campos-2">
        <div class="campo">
          <label for="as-profesor">Profesor (opcional)</label>
          <input id="as-profesor" type="text" value="${escapa(a?.profesor || '')}" autocomplete="off">
        </div>
        <div class="campo">
          <label for="as-aula">Aula (opcional)</label>
          <input id="as-aula" type="text" value="${escapa(a?.aula || '')}" autocomplete="off">
        </div>
      </div>
      <div class="campo">
        <label>Color</label>
        <div class="paleta" id="as-paleta">
          ${PALETA.map(c => `<button type="button" data-color="${c}" data-bg="${c}" aria-pressed="${c === color}" aria-label="Color"></button>`).join('')}
        </div>
      </div>`,
    pie: `
      ${a ? `<button class="boton sutil izquierda peligro" data-accion="asig-borrar" data-id="${escapa(a.id)}">Borrar</button>` : ''}
      <button class="boton fantasma" data-accion="cerrar-hoja">Cancelar</button>
      <button class="boton" data-accion="asig-guardar" data-id="${a ? escapa(a.id) : ''}">Guardar</button>`,
    alAbrir(v) {
      enfocar(v, '#as-nombre');
      v.querySelector('#as-paleta').addEventListener('click', ev => {
        const b = ev.target.closest('button[data-color]');
        if (!b) return;
        v.querySelectorAll('#as-paleta button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      });
    },
  });
}

accion('asig-nueva', () => formAsignatura(null));
on('nueva-asignatura', () => formAsignatura(null));
accion('asig-editar', d => {
  const a = asignaturaDe(d.id);
  if (a) formAsignatura(a);
});

accion('asig-guardar', (d, el) => {
  const v = el.closest('.hoja');
  const nombre = v.querySelector('#as-nombre').value.trim();
  const profesor = v.querySelector('#as-profesor').value.trim();
  const aula = v.querySelector('#as-aula').value.trim();
  const color = v.querySelector('#as-paleta button[aria-pressed="true"]')?.dataset.color || siguienteColor();
  if (!nombre) return aviso('Ponle un nombre', 'mal');

  const lista = listaAsignaturas();
  guardarAsignaturas(d.id
    ? lista.map(a => (a.id === d.id ? { ...a, nombre, profesor, aula, color } : a))
    : [...lista, { id: nuevoId(), nombre, profesor, aula, color }]);
  cerrarHoja();
  render();
  aviso('Guardado');
});

accion('asig-borrar', async d => {
  if (!await confirmar('Se borra la asignatura y sus temas. Las tareas, notas y apuntes que tuviera se quedan sin asignatura, no se borran.', 'Borrar')) return;
  guardarAsignaturas(listaAsignaturas().filter(a => a.id !== d.id));
  for (const t of temasDe(d.id)) borrarTema(t.id);
  cerrarHoja();
  seleccionada = null;
  render();
  aviso('Asignatura borrada');
});

/* ---------------------------------- temas ---------------------------------- */

accion('tema-abrir', d => {
  const t = temasDe(seleccionada).find(x => x.id === d.id);
  if (!t) return;
  hoja({
    titulo: t.nombre,
    cuerpo: `
      <div class="factor">
        <span class="n">Dominio estimado</span>
        <span class="v">${t.dominio || 0}%</span>
      </div>
      ${barra(t.dominio || 0, claseDe(t.dominio || 0))}
      <p class="pista">Sube y baja solo con tus repasos, tests y sesiones. También puedes
      ajustarlo a mano si crees que no refleja la realidad.</p>

      <div class="campo" data-mt-grande>
        <label for="tema-nombre">Nombre</label>
        <input id="tema-nombre" type="text" value="${escapa(t.nombre)}">
      </div>
      <div class="campo">
        <label for="tema-dominio">Dominio (0–100)</label>
        <input id="tema-dominio" type="number" min="0" max="100" value="${t.dominio || 0}">
      </div>

      <div class="parrafo chico">
        ${t.ultimoRepaso ? `Último repaso: ${escapa(t.ultimoRepaso)}.` : 'Nunca repasado.'}
        ${t.proximoRepaso ? ` Próximo: ${escapa(t.proximoRepaso)}.` : ''}
      </div>`,
    pie: `
      <button class="boton sutil izquierda peligro" data-accion="tema-borrar" data-id="${escapa(t.id)}">Borrar</button>
      <button class="boton fantasma" data-accion="tema-repasar" data-id="${escapa(t.id)}">Repasar ahora</button>
      <button class="boton" data-accion="tema-guardar" data-id="${escapa(t.id)}">Guardar</button>`,
  });
});

accion('tema-guardar', (d, el) => {
  const v = el.closest('.hoja');
  const nombre = v.querySelector('#tema-nombre').value.trim();
  const dominio = Math.max(0, Math.min(100, Number(v.querySelector('#tema-dominio').value) || 0));
  if (!nombre) return aviso('Ponle un nombre', 'mal');
  editarTema(d.id, { nombre, dominio });
  cerrarHoja();
  render();
});

accion('tema-borrar', async d => {
  if (!await confirmar('Se borra el tema. Los exámenes que lo tuvieran marcado dejarán de contarlo.', 'Borrar')) return;
  borrarTema(d.id);
  cerrarHoja();
  render();
});

accion('tema-repasar', d => {
  cerrarHoja();
  emitir('ir', { id: 'estudiar', temaId: d.id, tipo: 'repaso', arrancar: true });
});

/* --------------------------------- render ---------------------------------- */

function render() {
  if (!raiz) return;
  const a = seleccionada ? asignaturaDe(seleccionada) : null;
  if (seleccionada && !a) seleccionada = null;

  raiz.innerHTML = a ? vistaDetalle(a) : `
    <div class="seccion-cab"><h2>Asignaturas</h2></div>
    <div data-mt-grande>${vistaLista()}</div>`;

  pintaEstilos(raiz);

  const inp = raiz.querySelector('#asig-tema-nuevo');
  inp?.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    const nombre = inp.value.trim();
    if (!nombre) return;
    crearTema({ asignaturaId: seleccionada, nombre });
    render();
    setTimeout(() => raiz.querySelector('#asig-tema-nuevo')?.focus(), 30);
  });
}

export default {
  montar(el) {
    raiz = el;
    render();
    on('datos-cambio', render);
  },
  activar(extra) {
    if (extra?.asignaturaId) seleccionada = extra.asignaturaId;
    render();
  },
};
