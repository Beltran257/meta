/* ===========================================================================
   EXÁMENES — cuánto falta y, sobre todo, cómo lo llevas.

   La preparación no es una barra decorativa: es la media de lo que él mismo
   estima que se sabe de cada tema que entra (el porcentaje de cada tema lo pone
   él). Si un examen no tiene temario apuntado, META lo dice en vez de enseñar
   un porcentaje inventado.
   =========================================================================== */

import { hoja, cerrarHoja, aviso, pintaEstilos, icono, barra } from '../core/ui.js';
import { accion, on, emitir } from '../core/bus.js';
import { escapa, fechaLarga, fechaCorta, diaSemana, diasHasta, duracion, hoyLocal, sumaDias } from '../core/fmt.js';
import { leer } from '../core/store.js';
import { asignaturaDe, contenido } from '../core/asignaturas.js';
import { temasDe, temaDe, crearTema, editarTema } from '../core/temas.js';
import * as motor from '../core/motor.js';
import * as sesion from '../core/sesion.js';
import { formTarea, guardarTareas } from './tareas.js';

let raiz = null;
let abrirAlEntrar = null;

const claseDe = p => (p >= 75 ? 'bien' : p >= 45 ? 'ojo' : 'mal');

/* -------------------------------- tarjeta ---------------------------------- */

function tarjetaExamen(e) {
  const a = asignaturaDe(e.asignaturaId);
  const dias = diasHasta(e.fecha);
  const prep = motor.preparacion(e);

  return `
    <div class="tarjeta" data-mt>
      <div class="examen-cab">
        <div class="info">
          <div class="asig">${a ? `<i data-bg="${escapa(a.color)}"></i><span>${escapa(a.nombre)}</span>` : '<span>Sin asignatura</span>'}</div>
          <h2 data-mt>${escapa(e.titulo)}</h2>
          <div class="parrafo chico">${escapa(fechaLarga(e.fecha))}</div>
        </div>
        <div class="cuenta">
          <div class="n">${dias < 0 ? '—' : dias}</div>
          <div class="u">${dias < 0 ? 'pasado' : dias === 1 ? 'día' : 'días'}</div>
        </div>
      </div>

      <div data-mt-grande>
        ${prep == null ? `
          <p class="parrafo chico">Sin temario apuntado: META no puede medir cómo lo llevas.</p>
        ` : `
          <div class="factor">
            <span class="n">Preparación</span>
            <span class="v">${prep}%</span>
          </div>
          ${barra(prep, claseDe(prep))}
        `}
      </div>

      <div class="acciones" data-mt-grande>
        <button class="boton chico" data-accion="examen-abrir" data-id="${escapa(e.id)}">Ver temario</button>
        <button class="boton chico fantasma" data-accion="examen-editar" data-id="${escapa(e.id)}">Editar</button>
      </div>
    </div>`;
}

/* ------------------------------ ficha del examen ---------------------------
   Es donde se prepara un examen: qué entra, cuánto sabes de cada tema (el
   porcentaje lo pones tú), cuánto le has dedicado y qué apuntes tienes de él.

   Los cambios se aplican EN SU SITIO, sin volver a pintar la hoja: con un
   temario de 50 temas, repintar al tocar un porcentaje te devolvía arriba del
   todo. Por eso las acciones tocan el DOM y recalculan el resumen. */

const examenDe = id => motor.listaTareas().find(x => x.id === id);
const horasTxt = min => (min >= 60 ? `${(Math.round(min / 6) / 10).toLocaleString('es-ES')} h` : `${min} min`);

function filaTema(t, entra, min, apuntes) {
  const d = t.dominio || 0;
  return `
    <div class="fx-tema ${entra ? '' : 'fuera'}" data-tema="${escapa(t.id)}">
      <button class="fx-entra" type="button" aria-pressed="${entra}" data-accion="fx-entra" data-id="${escapa(t.id)}"
              aria-label="Entra en el examen" title="Entra en el examen">${icono('check')}</button>
      <span class="fx-nombre">
        <span class="n">${escapa(t.nombre)}</span>
        <span class="fx-meta">
          ${min ? `<span>${escapa(horasTxt(min))} dedicadas</span>` : '<span class="apag">sin horas</span>'}
          ${apuntes.length ? `<button class="fx-ap" type="button" data-accion="fx-apuntes" data-id="${escapa(t.id)}">${apuntes.length} ${apuntes.length === 1 ? 'apunte' : 'apuntes'}</button>` : ''}
        </span>
      </span>
      <span class="fx-dom">
        <button type="button" data-accion="fx-dom" data-id="${escapa(t.id)}" data-d="-10" aria-label="Menos">−</button>
        <span class="pc">${d}%</span>
        <button type="button" data-accion="fx-dom" data-id="${escapa(t.id)}" data-d="10" aria-label="Más">+</button>
      </span>
      ${barra(d, claseDe(d))}
      ${apuntes.length ? `
        <div class="fx-aps oculto" id="fx-aps-${escapa(t.id)}">
          ${apuntes.map(a => `<button class="fila" type="button" data-accion="apunte-abrir" data-id="${escapa(a.id)}"><span class="izq"><span class="t1">${escapa(String(a.titulo || '').replace(/_+/g, ' '))}</span></span></button>`).join('')}
        </div>` : ''}
    </div>`;
}

/** Resumen de arriba, recalculado desde los datos actuales. */
function pintaResumen(v, examenId) {
  const e = examenDe(examenId);
  if (!e || !v) return;
  const temas = motor.temarioDe(e);
  const prep = motor.preparacion(e);
  const flojos = temas.filter(t => (t.dominio || 0) < 50).length;
  const $ = q => v.querySelector(q);
  if ($('#fx-prep')) $('#fx-prep').textContent = prep == null ? '—' : prep + '%';
  if ($('#fx-prep-barra')) { const i = $('#fx-prep-barra i'); i.style.width = (prep || 0) + '%'; i.className = claseDe(prep || 0); }
  if ($('#fx-flojos')) $('#fx-flojos').textContent = `${flojos} de ${temas.length}`;
  if ($('#fx-entran')) $('#fx-entran').textContent = e.temaIds?.length ? `Entran ${temas.length} temas (los que marcas)` : 'Entran todos los temas de la asignatura';
}

function detalle(e) {
  const a = asignaturaDe(e.asignaturaId);
  const dias = Math.max(0, diasHasta(e.fecha));
  const todos = temasDe(e.asignaturaId);
  const entran = new Set(motor.temarioDe(e).map(t => t.id));
  const hoy = hoyLocal(), desde = sumaDias(hoy, -14);

  const sesiones = motor.listaSesiones().filter(s => s.asignaturaId === e.asignaturaId);
  const min = sesiones.reduce((t, s) => t + (s.minutos || 0), 0);
  const min14 = sesiones.filter(s => s.fecha >= desde).reduce((t, s) => t + (s.minutos || 0), 0);
  const minTema = new Map();
  for (const s of sesiones) if (s.temaId) minTema.set(s.temaId, (minTema.get(s.temaId) || 0) + (s.minutos || 0));
  const apuntes = leer('apuntesMeta', []).filter(x => x.asignaturaId === e.asignaturaId);
  const apDeTema = id => apuntes.filter(x => x.temaId === id);
  const sueltos = apuntes.filter(x => !x.temaId);

  hoja({
    titulo: e.titulo,
    ancha: true,
    cuerpo: `
      <div class="fx" data-examen="${escapa(e.id)}">
        <div class="examen-cab">
          <div class="info">
            <div class="parrafo chico">${a ? escapa(a.nombre) + ' · ' : ''}${escapa(fechaLarga(e.fecha))}</div>
          </div>
          <div class="cuenta"><div class="n">${dias}</div><div class="u">${dias === 1 ? 'día' : 'días'}</div></div>
        </div>

        ${todos.length ? `
          <div class="rejilla3" data-mt-grande>
            <div class="metrica"><div class="v" id="fx-prep">—</div><div class="e">Preparación</div></div>
            <div class="metrica"><div class="v" id="fx-flojos">—</div><div class="e">Por debajo del 50 %</div></div>
            <div class="metrica"><div class="v">${escapa(horasTxt(min))}</div><div class="e">Dedicadas · ${escapa(horasTxt(min14))} en 14 días</div></div>
          </div>
          <div id="fx-prep-barra" data-mt>${barra(0)}</div>
          <div class="pista" id="fx-entran"></div>` : ''}

        <div class="seccion-cab" data-mt-grande>
          <h2>Temario</h2>
          <button class="acc" data-accion="tema-lote" data-id="${escapa(e.asignaturaId)}">+ Subir o pegar temario</button>
        </div>
        ${todos.length ? `
          <div class="pista">Marca los temas que entran en este examen y pon cuánto te sabes cada uno (±10 %).
          Lo que dejes sin marcar no cuenta en la preparación.</div>
          <div class="fx-lista" data-mt>${todos.map((t, i) => (t.padre && t.padre !== todos[i - 1]?.padre ? `<div class="pista"><b>${escapa(t.padre)}</b></div>` : '') + filaTema(t, entran.has(t.id), minTema.get(t.id) || 0, apDeTema(t.id))).join('')}</div>`
        : `
          <div class="vacio">
            <h4>Esta asignatura aún no tiene temario</h4>
            <p>Sube el índice o la guía (PDF, Word, foto) y META saca los temas y los ordena; o pégalos a mano.</p>
            <button class="boton" data-accion="tema-lote" data-id="${escapa(e.asignaturaId)}">Poner el temario</button>
          </div>`}

        <div class="campo" data-mt-grande>
          <label for="ex-tema-nuevo">Añadir un tema suelto</label>
          <input id="ex-tema-nuevo" type="text" placeholder="Derivadas" autocomplete="off">
          <div class="pista">Intro para añadirlo a ${escapa(a?.nombre || 'la asignatura')}.</div>
        </div>

        ${apuntes.length ? `
          <div class="seccion-cab" data-mt-grande><h2>Apuntes de ${escapa(a?.nombre || 'la asignatura')}</h2><span class="apag">${apuntes.length}</span></div>
          <div class="pista">${sueltos.length ? `${sueltos.length} ${sueltos.length === 1 ? 'no está' : 'no están'} colgados de ningún tema.` : 'Todos están colgados de un tema.'}</div>
          <div class="lista" data-mt>
            ${apuntes.slice(0, 14).map(x => `<button class="fila" type="button" data-accion="apunte-abrir" data-id="${escapa(x.id)}"><span class="izq"><span class="t1">${escapa(String(x.titulo || '').replace(/_+/g, ' '))}</span></span></button>`).join('')}
          </div>` : ''}

        ${todos.length ? `
          <button class="boton fantasma ancho" data-accion="examen-plan" data-id="${escapa(e.id)}" data-mt-grande>
            Repartir el temario hasta el examen
          </button>` : ''}
      </div>`,
    pie: `
      <button class="boton fantasma izquierda" data-accion="examen-ia" data-id="${escapa(e.id)}">${icono('chispa')} Plan con META AI</button>
      <button class="boton" data-accion="examen-estudiar" data-id="${escapa(e.id)}">Estudiar lo más flojo</button>`,
    alAbrir(v) {
      pintaStyles(v);
      pintaResumen(v, e.id);
      const inp = v.querySelector('#ex-tema-nuevo');
      inp?.addEventListener('keydown', ev => {
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        const nombre = inp.value.trim();
        if (!nombre) return;
        const t = crearTema({ asignaturaId: e.asignaturaId, nombre });
        // Si el examen ya tiene una selección propia, el tema nuevo entra en ella;
        // si no, ya entra solo (entran todos los de la asignatura).
        const actual = examenDe(e.id);
        if (actual?.temaIds?.length) {
          guardarTareas(motor.listaTareas().map(x => (x.id === e.id ? { ...x, temaIds: [...x.temaIds, t.id] } : x)));
        }
        const actualizado = examenDe(e.id);
        if (actualizado) detalle(actualizado);
      });
    },
  });
}

const pintaStyles = v => pintaEstilos(v);

/* Porcentaje de un tema: ±10, sin repintar la hoja. */
accion('fx-dom', (d, el) => {
  const t = temaDe(d.id);
  if (!t) return;
  const nuevo = Math.max(0, Math.min(100, (t.dominio || 0) + Number(d.d)));
  editarTema(d.id, { dominio: nuevo });
  const fila = el.closest('.fx-tema');
  fila.querySelector('.pc').textContent = nuevo + '%';
  const i = fila.querySelector('.progreso > i');
  i.style.width = nuevo + '%';
  i.className = claseDe(nuevo);
  const v = el.closest('.hoja');
  pintaResumen(v, v.querySelector('.fx')?.dataset.examen);
});

/* Entra / no entra en este examen. temaIds vacío = entran todos. */
accion('fx-entra', (d, el) => {
  const v = el.closest('.hoja');
  const e = examenDe(v.querySelector('.fx')?.dataset.examen);
  if (!e) return;
  const todos = temasDe(e.asignaturaId).map(t => t.id);
  const entran = new Set(motor.temarioDe(e).map(t => t.id));
  if (entran.has(d.id)) entran.delete(d.id); else entran.add(d.id);
  if (!entran.size) return aviso('Tiene que entrar al menos un tema', 'mal');
  guardarTareas(motor.listaTareas().map(x => (x.id === e.id ? { ...x, temaIds: entran.size === todos.length ? [] : [...entran] } : x)));
  const dentro = entran.has(d.id);
  el.setAttribute('aria-pressed', String(dentro));
  el.closest('.fx-tema').classList.toggle('fuera', !dentro);
  pintaResumen(v, e.id);
});

accion('fx-apuntes', (d, el) => {
  el.closest('.fx-tema').querySelector('.fx-aps')?.classList.toggle('oculto');
});

accion('examen-abrir', d => {
  const e = motor.listaTareas().find(x => x.id === d.id);
  if (e) detalle(e);
});

accion('examen-editar', d => {
  const e = motor.listaTareas().find(x => x.id === d.id);
  if (e) formTarea(e);
});

accion('examen-nuevo', () => formTarea(null, { tipo: 'examen' }));

accion('examen-estudiar', d => {
  const e = motor.listaTareas().find(x => x.id === d.id);
  if (!e) return;
  const flojo = motor.temarioDe(e).slice().sort((a, b) => (a.dominio || 0) - (b.dominio || 0))[0];
  cerrarHoja();
  emitir('ir', {
    id: 'estudiar', asignaturaId: e.asignaturaId, temaId: flojo?.id || null, minutos: 45, arrancar: true,
  });
});

/* ------------------------- repartir hasta el examen -------------------------
   Informativo, no persiste nada: reparte los temas peor dominados en los días
   que quedan, repitiendo más los más flojos. Sirve para responder "¿por dónde
   voy tema a tema hasta el examen?" sin tener que hacer la cuenta a mano. */
accion('examen-plan', d => {
  const e = motor.listaTareas().find(x => x.id === d.id);
  if (!e) return;
  const dias = motor.planHastaExamen(e);
  hoja({
    titulo: `Hasta "${e.titulo}"`,
    cuerpo: dias.length ? `
      <p class="parrafo">Reparto orientativo: los temas peor dominados aparecen más veces.
      No se guarda nada — es una propuesta para organizarte.</p>
      <div class="lista" data-mt-grande>
        ${dias.map(x => `
          <div class="fila vertical">
            <span class="t1">${escapa(diaSemana(x.fecha))} · ${escapa(fechaCorta(x.fecha))}
              <span class="apag"> · ${escapa(duracion(x.minutos))}</span></span>
            ${x.temas.map(t => `<span class="t2">${escapa(t.nombre)} · dominio ${t.dominio || 0}%</span>`).join('')}
          </div>`).join('')}
      </div>`
      : '<p class="parrafo">No queda tiempo suficiente para repartirlo en días — estúdialo ya, entero.</p>',
    pie: `<button class="boton" data-accion="cerrar-hoja">Cerrar</button>`,
  });
});

accion('examen-ia', d => {
  const e = motor.listaTareas().find(x => x.id === d.id);
  if (!e) return;
  cerrarHoja();
  emitir('abrir-ia', { accion: 'prepara-examen', examen: e });
});

/* ------------------- importar del calendario del instituto -----------------
   Lee el Outlook del centro (worker/microsoft.js, P5) y propone lo que parece
   un examen o una entrega. Nada se apunta solo: cada fila se importa con un
   botón. Lo importado lleva `origenMs` (el id del evento): así no se propone
   dos veces y META no lo escribe de vuelta en el calendario del instituto. */
let propuestos = [];
const norm = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function asignaturaProbable(titulo) {
  const t = norm(titulo);
  const a = contenido().find(x => norm(x.nombre).split(/\s+/).some(p => p.length >= 5 && t.includes(p)));
  return a ? a.id : '';
}

function yaApuntado(c) {
  return motor.listaTareas().some(t => t.origenMs === c.id || (t.fecha === c.fecha && norm(t.titulo) === norm(c.titulo)));
}

function pintarCentro() {
  const filas = propuestos.map((c, i) => {
    const hecho = yaApuntado(c);
    return `
      <div class="fila">
        <span class="izq">
          <span class="t1">${escapa(c.titulo)}</span>
          <span class="t2">${escapa(fechaLarga(c.fecha))} · ${c.tipo === 'examen' ? 'examen' : 'entrega'}</span>
        </span>
        <span class="der">${hecho ? '<span class="n2">Ya apuntado</span>'
          : `<button class="boton chico" data-accion="examen-importar" data-i="${i}">Importar</button>`}</span>
      </div>`;
  }).join('');
  hoja({
    titulo: 'Calendario del instituto',
    ancha: true,
    cuerpo: propuestos.length
      ? `<p class="parrafo chico">Eventos de los próximos seis meses que parecen un examen o una entrega. Elige cuáles apuntar.</p>
         <div class="lista">${filas}</div>`
      : '<p class="parrafo chico">No hay nada que parezca un examen o una entrega en los próximos seis meses.</p>',
  });
}

accion('examen-centro', async () => {
  try {
    aviso('Leyendo el calendario del instituto…');
    propuestos = (await sesion.pedir('/api/microsoft/eventos')).eventos || [];
    pintarCentro();
  } catch (e) {
    aviso(e.message || 'No se pudo leer el calendario del instituto', 'mal');
  }
});

accion('examen-importar', d => {
  const c = propuestos[Number(d.i)];
  if (!c || yaApuntado(c)) return;
  guardarTareas([...motor.listaTareas(), {
    id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    titulo: c.titulo, fecha: c.fecha, tipo: c.tipo === 'examen' ? 'examen' : 'tarea',
    asignaturaId: asignaturaProbable(c.titulo), notas: '', prioridad: 'normal', dificultad: 2,
    duracion: 45, temaIds: [], estado: 'pendiente', hecho: false, creado: Date.now(),
    origenMs: c.id,
  }]);
  pintarCentro();
  aviso('Apuntado');
});

/* --------------------------------- render ---------------------------------- */

function render() {
  if (!raiz) return;

  const proximos = motor.examenesProximos(365);
  const pasados = motor.soloExamenes()
    .filter(e => diasHasta(e.fecha) < 0)
    .sort((a, b) => b.fecha.localeCompare(a.fecha));

  if (!contenido().length) {
    raiz.innerHTML = `
      <div class="vacio">
        <h4>Antes, tus asignaturas</h4>
        <p>Un examen pertenece a una asignatura y a unos temas.</p>
        <button class="boton" data-accion="ir" data-id="asignaturas">Añadir asignaturas</button>
      </div>`;
    return;
  }

  raiz.innerHTML = `
    <div class="seccion-cab">
      <h2>Exámenes</h2>
      <span>
        <button class="acc" data-accion="examen-centro">Del instituto</button>
        <button class="acc" data-accion="examen-nuevo">+ Nuevo</button>
      </span>
    </div>

    ${proximos.length ? proximos.map(tarjetaExamen).join('') : `
      <div class="vacio">
        <h4>Ningún examen apuntado</h4>
        <p>Apunta uno y META empezará a contar los días y a medir tu preparación.</p>
        <button class="boton" data-accion="examen-nuevo">Añadir examen</button>
      </div>`}

    ${pasados.length ? `
      <div class="seccion" data-mt-grande>
        <div class="seccion-cab"><h2>Ya pasados</h2></div>
        <div class="lista">
          ${pasados.slice(0, 8).map(e => {
            const a = asignaturaDe(e.asignaturaId);
            return `
              <button class="fila" data-accion="examen-editar" data-id="${escapa(e.id)}">
                <span class="izq">
                  <span class="t1">${escapa(e.titulo)}</span>
                  <span class="t2">${a ? escapa(a.nombre) : ''}</span>
                </span>
                <span class="der"><span class="n1">${escapa(fechaLarga(e.fecha).split(' ').slice(1, 4).join(' '))}</span></span>
              </button>`;
          }).join('')}
        </div>
      </div>` : ''}`;

  pintaEstilos(raiz);

  if (abrirAlEntrar) {
    const e = motor.listaTareas().find(x => x.id === abrirAlEntrar);
    abrirAlEntrar = null;
    if (e) detalle(e);
  }
}

export default {
  montar(el) {
    raiz = el;
    render();
    on('datos-cambio', render);
  },
  activar(extra) {
    if (extra?.examenId) abrirAlEntrar = extra.examenId;
    render();
  },
};
