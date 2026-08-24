/* ===========================================================================
   EXÁMENES — cuánto falta y, sobre todo, cómo lo llevas.

   La preparación no es una barra decorativa: es la media del dominio de los
   temas que entran, y el dominio se mueve solo con los repasos, los tests y
   las sesiones. Si un examen no tiene temario apuntado, META lo dice en vez de
   enseñar un porcentaje inventado.
   =========================================================================== */

import { hoja, cerrarHoja, aviso, pintaEstilos, icono, barra } from '../core/ui.js';
import { accion, on, emitir } from '../core/bus.js';
import { escapa, fechaLarga, fechaCorta, diaSemana, diasHasta, textoCountdown, duracion } from '../core/fmt.js';
import { listaAsignaturas, asignaturaDe } from '../core/asignaturas.js';
import { temasDe, crearTema } from '../core/temas.js';
import * as motor from '../core/motor.js';
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

/* --------------------------------- detalle --------------------------------- */

function detalle(e) {
  const temas = motor.temarioDe(e);
  const prep = motor.preparacion(e);
  const dias = Math.max(0, diasHasta(e.fecha));
  const a = asignaturaDe(e.asignaturaId);
  const propio = !!e.temaIds?.length;

  hoja({
    titulo: e.titulo,
    ancha: true,
    cuerpo: `
      <div class="examen-cab">
        <div class="info">
          <div class="parrafo chico">${a ? escapa(a.nombre) + ' · ' : ''}${escapa(fechaLarga(e.fecha))}</div>
        </div>
        <div class="cuenta"><div class="n">${dias}</div><div class="u">${dias === 1 ? 'día' : 'días'}</div></div>
      </div>

      ${prep != null ? `
        <div data-mt-grande>
          <div class="factor"><span class="n">Preparación</span><span class="v">${prep}%</span></div>
          ${barra(prep, claseDe(prep))}
          <div class="pista">${propio ? 'De los temas que marcaste que entran.' : 'De todos los temas de la asignatura (este examen no tiene temario propio).'}</div>
        </div>` : ''}

      <div class="seccion-cab" data-mt-grande><h2>Temario</h2></div>
      ${temas.length ? `
        <div class="lista">
          ${temas.slice().sort((x, y) => (x.dominio || 0) - (y.dominio || 0)).map(t => `
            <div class="tema-fila">
              <span class="n">${escapa(t.nombre)}</span>
              ${barra(t.dominio || 0, claseDe(t.dominio || 0))}
              <span class="pc">${t.dominio || 0}%</span>
            </div>`).join('')}
        </div>
        <div class="pista">Ordenados de peor a mejor: los de arriba son donde más sube la nota por hora invertida.</div>
      ` : `
        <div class="vacio">
          <h4>Sin temas todavía</h4>
          <p>Apunta lo que entra y META podrá decirte por dónde empezar y cuánto llevas.</p>
        </div>`}

      <div class="campo" data-mt-grande>
        <label for="ex-tema-nuevo">Añadir un tema al temario</label>
        <input id="ex-tema-nuevo" type="text" placeholder="Derivadas" autocomplete="off">
        <div class="pista">Intro para añadirlo. Se crea en ${escapa(a?.nombre || 'la asignatura')} y queda marcado en este examen.</div>
      </div>

      ${temas.length ? `
        <button class="boton fantasma ancho" data-accion="examen-plan" data-id="${escapa(e.id)}" data-mt-grande>
          Repartir el temario hasta el examen
        </button>` : ''}`,
    pie: `
      <button class="boton fantasma izquierda" data-accion="examen-ia" data-id="${escapa(e.id)}">${icono('chispa')} Plan con META AI</button>
      <button class="boton" data-accion="examen-estudiar" data-id="${escapa(e.id)}">Estudiar lo más flojo</button>`,
    alAbrir(v) {
      const inp = v.querySelector('#ex-tema-nuevo');
      inp?.addEventListener('keydown', ev => {
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        const nombre = inp.value.trim();
        if (!nombre) return;
        const t = crearTema({ asignaturaId: e.asignaturaId, nombre });
        // Se marca en ESTE examen: si no, el tema quedaría suelto y la
        // preparación seguiría midiendo la asignatura entera.
        guardarTareas(motor.listaTareas().map(x => x.id === e.id
          ? { ...x, temaIds: [...(x.temaIds || []), t.id] } : x));
        inp.value = '';
        const actualizado = motor.listaTareas().find(x => x.id === e.id);
        if (actualizado) detalle(actualizado);
      });
    },
  });
}

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

/* --------------------------------- render ---------------------------------- */

function render() {
  if (!raiz) return;

  const proximos = motor.examenesProximos(365);
  const pasados = motor.soloExamenes()
    .filter(e => diasHasta(e.fecha) < 0)
    .sort((a, b) => b.fecha.localeCompare(a.fecha));

  if (!listaAsignaturas().length) {
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
      <button class="acc" data-accion="examen-nuevo">+ Nuevo</button>
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
