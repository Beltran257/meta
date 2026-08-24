/* ===========================================================================
   TAREAS — la lista, pero ordenada por lo que de verdad toca hacer antes.

   El orden por defecto NO es la fecha: es la prioridad calculada en
   core/motor.js (fecha + examen cercano + dificultad + lo que marcaste).
   Cada fila enseña EN PALABRAS por qué está donde está — un orden que no se
   puede explicar se siente arbitrario y se deja de usar.
   =========================================================================== */

import { guardar } from '../core/store.js';
import { hoja, cerrarHoja, aviso, confirmar, pintaEstilos, icono, enfocar, marcarCheck, flipLista } from '../core/ui.js';
import { accion, on, emitir } from '../core/bus.js';
import { escapa, hoyLocal, fechaLarga, fechaCorta, diasHasta, textoCountdown, duracion, sumaDias } from '../core/fmt.js';
import { listaAsignaturas, asignaturaDe } from '../core/asignaturas.js';
import { temasDe } from '../core/temas.js';
import * as motor from '../core/motor.js';

const nuevoId = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

let raiz = null;
let filtro = 'abiertas';
let orden = 'prioridad';

export function guardarTareas(lista) {
  guardar('tareas', lista);
  emitir('local-cambio');
  emitir('datos-cambio', ['tareas']);
}

/* -------------------------------- filtros ---------------------------------- */

const FILTROS = [
  { id: 'abiertas', et: 'Abiertas' },
  { id: 'hoy', et: 'Hoy' },
  { id: 'proximas', et: 'Próximas' },
  { id: 'atrasadas', et: 'Atrasadas' },
  { id: 'hechas', et: 'Completadas' },
];

function filtradas() {
  const hoy = hoyLocal();
  const todas = motor.listaTareas().filter(t => t.tipo !== 'examen');
  let l;
  switch (filtro) {
    case 'hoy': l = todas.filter(t => !motor.estaHecha(t) && t.fecha <= hoy); break;
    case 'proximas': l = todas.filter(t => !motor.estaHecha(t) && t.fecha > hoy); break;
    case 'atrasadas': l = todas.filter(t => !motor.estaHecha(t) && t.fecha < hoy); break;
    case 'hechas': l = todas.filter(t => motor.estaHecha(t)); break;
    default: l = todas.filter(t => !motor.estaHecha(t));
  }
  return orden === 'fecha'
    ? l.sort((a, b) => a.fecha.localeCompare(b.fecha))
    : l.sort((a, b) => motor.puntuacion(b) - motor.puntuacion(a) || a.fecha.localeCompare(b.fecha));
}

/* --------------------------------- filas ----------------------------------- */

export function filaTarea(t, { conMotivo = true } = {}) {
  const a = asignaturaDe(t.asignaturaId);
  const dias = diasHasta(t.fecha);
  const hecha = motor.estaHecha(t);
  const urgente = !hecha && dias <= 1;
  return `
    <div class="fila ${hecha ? 'hecha' : ''}" data-flip="${escapa(t.id)}">
      <button class="marca-check ${hecha ? 'on' : ''}" data-accion="tarea-check" data-id="${escapa(t.id)}"
              aria-label="${hecha ? 'Desmarcar' : 'Marcar hecha'}">${icono('check')}</button>
      <span class="izq" data-accion="tarea-editar" data-id="${escapa(t.id)}">
        <span class="t1">${escapa(t.titulo)}</span>
        <span class="t2">
          ${a ? `<span class="asig"><i data-bg="${escapa(a.color)}"></i><span>${escapa(a.nombre)}</span></span>` : ''}
          ${t.estado === 'haciendo' ? '<span class="pil acc">En marcha</span>' : ''}
          ${t.duracion ? `<span>${escapa(duracion(t.duracion))}</span>` : ''}
          ${conMotivo && !hecha ? `<span class="${urgente ? 'mal' : ''}">${escapa(motor.motivo(t))}</span>` : ''}
        </span>
      </span>
      <span class="der">
        <span class="n1 ${urgente && !hecha ? 'mal' : ''}">${escapa(fechaCorta(t.fecha))}</span>
        ${!hecha ? `<span class="n2">${escapa(textoCountdown(dias))}</span>` : ''}
      </span>
    </div>`;
}

/* --------------------------------- render ---------------------------------- */

function render() {
  if (!raiz) return;

  if (!listaAsignaturas().length) {
    raiz.innerHTML = `
      <div class="vacio">
        <h4>Antes, tus asignaturas</h4>
        <p>Una tarea sin asignatura no se puede priorizar ni relacionar con un examen.</p>
        <button class="boton" data-accion="ir" data-id="asignaturas">Añadir asignaturas</button>
      </div>`;
    return;
  }

  const l = filtradas();
  const cuentas = contar();

  raiz.innerHTML = `
    <div class="seccion-cab">
      <h2>Tareas</h2>
      <div class="segmentos">
        <button data-accion="tareas-orden" data-o="prioridad" aria-pressed="${orden === 'prioridad'}">Prioridad</button>
        <button data-accion="tareas-orden" data-o="fecha" aria-pressed="${orden === 'fecha'}">Fecha</button>
      </div>
    </div>

    <div class="chips" data-mt>
      ${FILTROS.map(f => `
        <button class="chip" data-accion="tareas-filtro" data-f="${f.id}" aria-pressed="${filtro === f.id}">
          ${f.et}${cuentas[f.id] ? ` <span class="apag">${cuentas[f.id]}</span>` : ''}
        </button>`).join('')}
    </div>

    <div data-mt-grande>
      ${l.length ? `<div class="lista">${l.map(t => filaTarea(t)).join('')}</div>` : `
        <div class="vacio">
          <h4>${filtro === 'atrasadas' ? 'Nada atrasado' : filtro === 'hechas' ? 'Aún no has completado nada' : 'Nada por aquí'}</h4>
          <p>${filtro === 'atrasadas' ? 'Vas al día.' : 'Con el botón + de arriba apuntas una tarea en dos toques.'}</p>
        </div>`}
    </div>

    <div class="acciones" data-mt-grande>
      <button class="boton fantasma" data-accion="tarea-nueva">${icono('mas')} Nueva tarea</button>
      ${filtro === 'atrasadas' && l.length ? '<button class="boton fantasma" data-accion="tareas-replanificar">Mover todo a hoy</button>' : ''}
    </div>`;

  pintaEstilos(raiz);
}

function contar() {
  const hoy = hoyLocal();
  const todas = motor.listaTareas().filter(t => t.tipo !== 'examen');
  return {
    abiertas: todas.filter(t => !motor.estaHecha(t)).length,
    hoy: todas.filter(t => !motor.estaHecha(t) && t.fecha <= hoy).length,
    proximas: todas.filter(t => !motor.estaHecha(t) && t.fecha > hoy).length,
    atrasadas: todas.filter(t => !motor.estaHecha(t) && t.fecha < hoy).length,
    hechas: 0,
  };
}

accion('tareas-filtro', d => { filtro = d.f; render(); });
accion('tareas-orden', d => { orden = d.o; render(); });

accion('tarea-check', (d, el) => {
  const lista = motor.listaTareas();
  const t = lista.find(x => x.id === d.id);
  if (!t) return;
  const hecha = motor.estaHecha(t);

  const aplicar = () => flipLista(raiz, () => {
    guardarTareas(lista.map(x => x.id === d.id
      ? { ...x, estado: hecha ? 'pendiente' : 'hecha', hecho: !hecha, completada: hecha ? null : Date.now() }
      : x));
    render();
  });

  // Marcar como hecha da tiempo a ver el check dibujarse antes de que la fila
  // se vaya del filtro activo; desmarcar es una corrección, va al instante.
  if (hecha) { aplicar(); return; }
  marcarCheck(el.closest('.marca-check'));
  setTimeout(aplicar, 240);
});

accion('tareas-replanificar', async () => {
  const atras = motor.atrasadas();
  if (!atras.length) return;
  if (!await confirmar(`Se mueven a hoy ${atras.length} tareas atrasadas. Así dejan de contar como retraso, pero el trabajo sigue estando.`, 'Mover a hoy', false)) return;
  const ids = new Set(atras.map(t => t.id));
  guardarTareas(motor.listaTareas().map(t => ids.has(t.id) ? { ...t, fecha: hoyLocal() } : t));
  render();
  aviso(`${atras.length} tareas movidas a hoy`);
});

/* ------------------------------- formulario -------------------------------- */

const PRIORIDADES = [['baja', 'Baja'], ['normal', 'Normal'], ['alta', 'Alta']];
const DIFICULTADES = [[1, 'Fácil'], [2, 'Normal'], [3, 'Difícil']];
const DURACIONES = [15, 30, 45, 60, 90, 120];

/** Un solo formulario para tareas y exámenes: cambia el título, el campo de
    temario y poco más. Dos formularios distintos era pedir que se separaran
    con el tiempo. */
export function formTarea(t, { tipo = 'tarea', fecha = null, asignaturaId = null } = {}) {
  const asignaturas = listaAsignaturas();
  const esExamen = (t?.tipo || tipo) === 'examen';
  const asigActual = t?.asignaturaId || asignaturaId || asignaturas[0]?.id || '';

  hoja({
    titulo: t ? (esExamen ? 'Editar examen' : 'Editar tarea') : (esExamen ? 'Nuevo examen' : 'Nueva tarea'),
    cuerpo: `
      <div class="campo">
        <label for="t-titulo">${esExamen ? 'Nombre del examen' : 'Qué hay que hacer'}</label>
        <input id="t-titulo" type="text" value="${escapa(t?.titulo || '')}"
               placeholder="${esExamen ? 'Examen tema 1-3' : 'Ejercicios del tema 3'}" autocomplete="off">
      </div>

      <div class="campos-2">
        <div class="campo">
          <label for="t-asig">Asignatura</label>
          <select id="t-asig">
            ${asignaturas.map(a => `<option value="${escapa(a.id)}" ${asigActual === a.id ? 'selected' : ''}>${escapa(a.nombre)}</option>`).join('')}
          </select>
        </div>
        <div class="campo">
          <label for="t-fecha">${esExamen ? 'Día del examen' : 'Fecha límite'}</label>
          <input id="t-fecha" type="date" value="${escapa(t?.fecha || fecha || hoyLocal())}">
        </div>
      </div>

      <div class="campos-3">
        <div class="campo">
          <label for="t-prioridad">Prioridad</label>
          <select id="t-prioridad">
            ${PRIORIDADES.map(([v, e]) => `<option value="${v}" ${(t?.prioridad || 'normal') === v ? 'selected' : ''}>${e}</option>`).join('')}
          </select>
        </div>
        <div class="campo">
          <label for="t-dificultad">Dificultad</label>
          <select id="t-dificultad">
            ${DIFICULTADES.map(([v, e]) => `<option value="${v}" ${Number(t?.dificultad || 2) === v ? 'selected' : ''}>${e}</option>`).join('')}
          </select>
        </div>
        <div class="campo">
          <label for="t-duracion">Te llevará</label>
          <select id="t-duracion">
            ${DURACIONES.map(v => `<option value="${v}" ${Number(t?.duracion || 45) === v ? 'selected' : ''}>${duracion(v)}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="campo" id="t-temario-caja">${bloqueTemario(esExamen, asigActual, t)}</div>

      <div class="campo">
        <label for="t-notas">Notas (opcional)</label>
        <textarea id="t-notas" placeholder="Qué entra, qué material hace falta…">${escapa(t?.notas || '')}</textarea>
      </div>`,
    pie: `
      ${t ? `<button class="boton sutil izquierda peligro" data-accion="tarea-borrar" data-id="${escapa(t.id)}">Borrar</button>` : ''}
      <button class="boton fantasma" data-accion="cerrar-hoja">Cancelar</button>
      <button class="boton" data-accion="tarea-guardar" data-id="${t ? escapa(t.id) : ''}" data-tipo="${esExamen ? 'examen' : 'tarea'}">Guardar</button>`,
    alAbrir(v) {
      enfocar(v, '#t-titulo');
      // Cambiar de asignatura repinta el temario: los temas son de una
      // asignatura concreta, no de todas.
      v.querySelector('#t-asig')?.addEventListener('change', ev => {
        const caja = v.querySelector('#t-temario-caja');
        if (caja) { caja.innerHTML = bloqueTemario(esExamen, ev.target.value, t); pintaEstilos(caja); }
      });
    },
  });
}

function bloqueTemario(esExamen, asigId, t) {
  if (!esExamen) return '';
  const temas = temasDe(asigId);
  if (!temas.length) {
    return `<label>Temario</label>
      <p class="pista">Esta asignatura aún no tiene temas. Créalos en Asignaturas y podrás
      marcar aquí cuáles entran — es lo que permite medir la preparación.</p>`;
  }
  const marcados = new Set(t?.temaIds || []);
  return `
    <label>Qué entra</label>
    <div class="chips envolver" id="t-temas">
      ${temas.map(m => `
        <button type="button" class="chip" data-tema="${escapa(m.id)}" aria-pressed="${marcados.has(m.id)}">
          ${escapa(m.nombre)}
        </button>`).join('')}
    </div>
    <div class="pista">Sin temas marcados, se usa el temario entero de la asignatura.</div>`;
}

accion('tarea-nueva', () => formTarea(null, { tipo: 'tarea' }));

accion('tarea-editar', d => {
  const t = motor.listaTareas().find(x => x.id === d.id);
  if (t) formTarea(t);
});

on('abrir-tarea', id => {
  const t = motor.listaTareas().find(x => x.id === id);
  if (t) formTarea(t);
});

accion('tarea-guardar', (d, el) => {
  const v = el.closest('.hoja');
  const titulo = v.querySelector('#t-titulo').value.trim();
  const asignaturaId = v.querySelector('#t-asig').value;
  const fecha = v.querySelector('#t-fecha').value;
  const notas = v.querySelector('#t-notas').value.trim();
  const prioridad = v.querySelector('#t-prioridad').value;
  const dificultad = Number(v.querySelector('#t-dificultad').value);
  const duracionMin = Number(v.querySelector('#t-duracion').value);
  const temaIds = [...v.querySelectorAll('#t-temas [data-tema][aria-pressed="true"]')].map(b => b.dataset.tema);

  if (!titulo) return aviso('Ponle un título', 'mal');
  if (!fecha) return aviso('Ponle una fecha', 'mal');

  const lista = motor.listaTareas();
  const campos = { titulo, asignaturaId, fecha, notas, prioridad, dificultad, duracion: duracionMin, temaIds, tipo: d.tipo };

  if (d.id) {
    guardarTareas(lista.map(t => (t.id === d.id ? { ...t, ...campos } : t)));
  } else {
    guardarTareas([...lista, {
      id: nuevoId(), ...campos, estado: 'pendiente', hecho: false, creado: Date.now(),
    }]);
  }
  cerrarHoja();
  render();
  aviso(d.tipo === 'examen' ? 'Examen guardado' : 'Tarea guardada');
});

accion('tarea-borrar', async d => {
  if (!await confirmar('Se borra del todo. También desaparecerá de tu calendario si lo tienes conectado.', 'Borrar')) return;
  guardarTareas(motor.listaTareas().filter(t => t.id !== d.id));
  cerrarHoja();
  render();
  aviso('Borrado');
});

/* Marcar los chips del temario: no puede ser un listener por chip porque el
   bloque se repinta al cambiar de asignatura. */
document.addEventListener('click', ev => {
  const b = ev.target.closest('#t-temas [data-tema]');
  if (!b) return;
  b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
});

/* ---------------------------------- vista ----------------------------------- */

export default {
  montar(el) {
    raiz = el;
    render();
    on('datos-cambio', render);
  },
  activar(extra) {
    if (extra?.filtro) filtro = extra.filtro;
    render();
  },
};
