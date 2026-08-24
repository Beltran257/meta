/* ===========================================================================
   ACCIONES GLOBALES — las tres cosas que tienen que estar a un toque desde
   CUALQUIER pantalla: crear algo (+), el menú "Más" del móvil y META AI.

   La captura rápida es la que más se usa y por eso es la más corta: elegir qué
   y escribir. Nada de abrir una pantalla, buscar un botón y rellenar seis
   campos para apuntar "mañana entrego lengua".
   =========================================================================== */

import { hoja, cerrarHoja, aviso, pintaEstilos, icono } from '../core/ui.js';
import { accion, on, emitir } from '../core/bus.js';
import { escapa, duracion } from '../core/fmt.js';
import { listaAsignaturas } from '../core/asignaturas.js';
import { formTarea } from './tareas.js';
import { nuevaRapida } from './apuntes.js';
import * as ia from '../core/ia.js';
import * as motor from '../core/motor.js';

/* ============================== CAPTURA (+) ================================ */

accion('captura-abrir', () => {
  hoja({
    titulo: 'Crear',
    cuerpo: `
      <div class="campo">
        <label for="cap-rapida">Nota rápida</label>
        <input id="cap-rapida" type="text" placeholder="Escríbelo y pulsa Intro" autocomplete="off">
        <div class="pista">Para lo que no quieres olvidar pero aún no es una tarea.</div>
      </div>
      <div class="captura" data-mt-grande>
        <button data-accion="cap-tarea">${icono('check')} Tarea</button>
        <button data-accion="cap-examen">${icono('nota')} Examen</button>
        <button data-accion="cap-apunte">${icono('libro')} Apunte</button>
        <button data-accion="cap-sesion">${icono('play')} Sesión de estudio</button>
        <button data-accion="cap-asignatura">${icono('mas')} Asignatura</button>
        <button data-accion="cap-ia">${icono('chispa')} Preguntar a META AI</button>
      </div>`,
    alAbrir(v) {
      const inp = v.querySelector('#cap-rapida');
      setTimeout(() => inp?.focus(), 160);
      inp?.addEventListener('keydown', ev => {
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        const texto = inp.value.trim();
        if (!texto) return;
        nuevaRapida(texto);
        cerrarHoja();
        aviso('Nota guardada');
      });
    },
  });
});

const conAsignaturas = fn => {
  if (!listaAsignaturas().length) {
    cerrarHoja();
    aviso('Añade antes tus asignaturas', 'mal');
    return emitir('ir', { id: 'asignaturas' });
  }
  fn();
};

accion('cap-tarea', () => { cerrarHoja(); setTimeout(() => conAsignaturas(() => formTarea(null, { tipo: 'tarea' })), 180); });
accion('cap-examen', () => { cerrarHoja(); setTimeout(() => conAsignaturas(() => formTarea(null, { tipo: 'examen' })), 180); });
accion('cap-apunte', () => { cerrarHoja(); emitir('ir', { id: 'apuntes' }); setTimeout(() => emitir('nuevo-apunte'), 250); });
accion('cap-sesion', () => { cerrarHoja(); emitir('ir', { id: 'estudiar' }); setTimeout(() => emitir('nueva-sesion'), 250); });
accion('cap-asignatura', () => { cerrarHoja(); emitir('ir', { id: 'asignaturas' }); setTimeout(() => emitir('nueva-asignatura'), 250); });
accion('cap-ia', () => { cerrarHoja(); setTimeout(() => abrirIA(), 180); });

/* ============================== MENÚ "MÁS" ================================= */

const MAS = [
  ['examenes', 'Exámenes', 'nota'],
  ['estudiar', 'Estudiar', 'reloj'],
  ['apuntes', 'Apuntes', 'libro'],
  ['asignaturas', 'Asignaturas', 'lapiz'],
  ['analisis', 'Análisis', 'analisis'],
  ['perfil', 'Perfil y ajustes', 'usuario'],
];

accion('mas-abrir', () => {
  hoja({
    titulo: 'Más',
    cuerpo: `
      <div class="lista">
        ${MAS.map(([id, et, ic]) => `
          <button class="fila" data-accion="mas-ir" data-id="${id}">
            <span class="btn-icono">${icono(ic)}</span>
            <span class="izq"><span class="t1">${et}</span></span>
          </button>`).join('')}
      </div>
      <div class="acciones" data-mt-grande>
        <button class="boton fantasma ancho" data-accion="buscar-abrir">${icono('lapiz')} Buscar</button>
      </div>`,
  });
});

accion('mas-ir', d => { cerrarHoja(); emitir('ir', { id: d.id }); });

/* ================================ META AI ================================== */

let ultimaRespuesta = null;

export function abrirIA(opciones = {}) {
  const examen = opciones.examen || null;
  hoja({
    titulo: 'META AI',
    ancha: true,
    cuerpo: `
      <p class="parrafo chico">Responde con TUS datos: exámenes, temas flojos, lo atrasado y
      el tiempo que tienes hoy. Los números (estado, plan, prioridades) los calcula META
      sola; la IA solo los explica y propone.</p>

      <div class="ia-sugerencias" data-mt-grande id="ia-sugerencias">
        ${(examen ? [{ id: 'prepara-examen', et: `Prepárame para "${examen.titulo}"` }] : [])
          .concat(ia.ACCIONES).map(a => `
            <button class="ia-sug" data-accion="ia-lanzar" data-a="${escapa(a.id)}">${escapa(a.et)}</button>`).join('')}
      </div>

      <div class="campo" data-mt-grande>
        <label for="ia-libre">O pregúntale lo que quieras</label>
        <input id="ia-libre" type="text" placeholder="¿Por dónde empiezo con Filosofía?" autocomplete="off">
      </div>

      <div id="ia-salida"></div>`,
    alAbrir(v) {
      v.dataset.examenId = examen?.id || '';
      const inp = v.querySelector('#ia-libre');
      inp?.addEventListener('keydown', ev => {
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        lanzar({ pregunta: inp.value.trim(), examen });
      });
      if (opciones.accion) lanzar({ accion: opciones.accion, examen });
    },
  });
}

async function lanzar({ accion: acc = null, pregunta = null, examen = null }) {
  const salida = document.querySelector('#ia-salida');
  if (!salida) return;
  if (!acc && !pregunta) return;

  salida.innerHTML = '<div class="cargando"><div class="giro"></div></div>';
  try {
    const r = await ia.preguntar({ accion: acc, pregunta, examen });
    ultimaRespuesta = r;
    salida.innerHTML = `
      <div class="ia-respuesta">${escapa(r.texto)}</div>
      <div class="ia-pie">Generado por META AI (${escapa(String(r.modelo || '').split('/').pop())}).
      Comprueba lo importante: un modelo puede equivocarse.</div>`;
  } catch (e) {
    salida.innerHTML = `<div class="error-caja">${escapa(e.message || 'La IA no ha podido responder ahora mismo.')}</div>
      <p class="parrafo chico">El plan y las prioridades siguen funcionando sin ella: están calculados en tu propio aparato.</p>`;
  }
}

accion('ia-abrir', () => abrirIA());
accion('ia-lanzar', (d, el) => {
  const v = el.closest('.hoja');
  const examenId = v?.dataset.examenId;
  const examen = examenId ? motor.listaTareas().find(x => x.id === examenId) : null;
  lanzar({ accion: d.a, examen });
});

accion('ia-plan', () => { cerrarHoja(); setTimeout(() => abrirIA({ accion: 'que-estudiar' }), 180); });

on('abrir-ia', opciones => abrirIA(opciones));

/* ------------------------------- atajos ------------------------------------ */

document.addEventListener('keydown', ev => {
  if (ev.target.matches('input, textarea, select')) return;
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') {
    ev.preventDefault();
    return emitir('abrir-buscador');
  }
  if (ev.key.toLowerCase() === 'n' && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
    ev.preventDefault();
    document.querySelector('[data-accion="captura-abrir"]')?.click();
  }
});
