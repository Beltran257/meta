/* ===========================================================================
   CALIFICACIONES — no es una pestaña: es el panel de notas de UNA asignatura,
   que se abre desde su espacio de trabajo y desde Análisis.

   Lo que de verdad usa: la media, el objetivo y "qué nota necesito en lo que
   queda". Eso último es la única cuenta que un estudiante hace de cabeza mal
   una y otra vez.
   =========================================================================== */

import { leer, guardar } from '../core/store.js';
import { hoja, cerrarHoja, aviso, confirmar, pintaEstilos, icono, barra, enfocar } from '../core/ui.js';
import { accion, emitir } from '../core/bus.js';
import { escapa, hoyLocal, fechaCorta, nota as fnota, numeroDe, pct } from '../core/fmt.js';
import { asignaturaDe } from '../core/asignaturas.js';
import { dibujarEvolucion } from '../core/grafico.js';

const EVALS = ['1', '2', '3'];
const nuevoId = () => 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export const todas = () => leer('notas', {});

export function entradaDe(asigId) {
  const t = todas()[asigId];
  return {
    objetivo: t?.objetivo ?? null,
    evaluaciones: { 1: t?.evaluaciones?.[1] || [], 2: t?.evaluaciones?.[2] || [], 3: t?.evaluaciones?.[3] || [] },
  };
}

function guardarEntrada(asigId, entrada) {
  guardar('notas', { ...todas(), [asigId]: entrada });
  emitir('local-cambio');
  emitir('datos-cambio', ['notas']);
}

export function mediaLista(lista) {
  if (!lista.length) return null;
  const peso = lista.reduce((s, n) => s + (n.peso || 1), 0);
  return peso ? lista.reduce((s, n) => s + n.valor * (n.peso || 1), 0) / peso : null;
}

export function mediaGeneral(entrada) {
  const medias = EVALS.map(e => mediaLista(entrada.evaluaciones[e])).filter(m => m != null);
  return medias.length ? medias.reduce((a, b) => a + b, 0) / medias.length : null;
}

/** Qué media hace falta en las evaluaciones QUE QUEDAN para llegar al
    objetivo, repartiendo el curso a partes iguales entre las tres. Null si ya
    están las tres puestas: ahí ya no queda nada que calcular. */
export function necesitas(entrada) {
  if (entrada.objetivo == null) return null;
  const conNotas = EVALS.filter(e => entrada.evaluaciones[e].length);
  const restantes = EVALS.length - conNotas.length;
  if (!restantes) return null;
  const logrado = conNotas.reduce((s, e) => s + mediaLista(entrada.evaluaciones[e]), 0);
  return (entrada.objetivo * EVALS.length - logrado) / restantes;
}

/* --------------------------------- panel ----------------------------------- */

let asigActual = null;
let evalSel = '1';

export function abrirNotas(asignaturaId) {
  asigActual = asignaturaId;
  pintar();
}

function pintar() {
  const a = asignaturaDe(asigActual);
  const entrada = entradaDe(asigActual);
  const media = mediaGeneral(entrada);
  const falta = necesitas(entrada);
  const lista = entrada.evaluaciones[evalSel];
  const mediaEval = mediaLista(lista);

  const puntos = EVALS.flatMap(e => entrada.evaluaciones[e])
    .filter(n => n.fecha)
    .sort((x, y) => x.fecha.localeCompare(y.fecha))
    .map(n => ({ fecha: n.fecha, valor: n.valor }));

  hoja({
    titulo: `Notas · ${a?.nombre || ''}`,
    ancha: true,
    cuerpo: `
      <div class="rejilla2">
        <div class="metrica">
          <div class="v">${escapa(fnota(media))}</div>
          <div class="e">Media general</div>
        </div>
        <div class="metrica">
          <div class="v">${entrada.objetivo == null ? '—' : escapa(fnota(entrada.objetivo))}</div>
          <div class="e">Tu objetivo</div>
        </div>
      </div>

      ${entrada.objetivo != null ? `
        <div data-mt-grande>
          ${barra(pct(media || 0, entrada.objetivo), media != null && media >= entrada.objetivo ? 'bien' : 'ojo')}
          ${falta != null ? `<p class="parrafo chico" data-mt>Para llegar necesitas una media de
            <b class="${falta > 10 ? 'mal' : 'bien'}">${escapa(fnota(falta))}</b> en lo que queda de curso.
            ${falta > 10 ? ' Ya no da, aunque saques un 10.' : ''}</p>` : ''}
        </div>` : '<p class="parrafo" data-mt-grande>Sin objetivo puesto: ponlo y META calcula qué te hace falta.</p>'}

      <button class="boton fantasma ancho" data-accion="objetivo-editar" data-mt>
        ${entrada.objetivo != null ? 'Cambiar objetivo' : 'Poner un objetivo'}
      </button>

      ${puntos.length > 1 ? `
        <div class="seccion-cab" data-mt-grande><h2>Evolución</h2></div>
        <canvas id="grafico-notas" class="grafico"></canvas>` : ''}

      <div class="segmentos" data-mt-grande>
        ${EVALS.map(e => `<button data-accion="eval-sel" data-e="${e}" aria-pressed="${e === evalSel}">${e}ª eval.</button>`).join('')}
      </div>

      <div class="seccion-cab" data-mt>
        <h2>${evalSel}ª evaluación${mediaEval != null ? ` · media ${escapa(fnota(mediaEval))}` : ''}</h2>
      </div>

      ${lista.length ? `
        <div class="lista">
          ${lista.map(n => `
            <button class="fila" data-accion="nota-editar" data-id="${escapa(n.id)}">
              <span class="izq">
                <span class="t1">${escapa(n.titulo)}</span>
                <span class="t2">${escapa(fechaCorta(n.fecha))}${n.peso && n.peso !== 1 ? ` · peso ${n.peso}` : ''}</span>
              </span>
              <span class="der"><span class="n1 ${n.valor >= 5 ? 'bien' : 'mal'}">${escapa(fnota(n.valor))}</span></span>
            </button>`).join('')}
        </div>` : '<div class="vacio"><p>Sin notas en esta evaluación.</p></div>'}`,
    pie: `<button class="boton ancho" data-accion="nota-nueva">${icono('mas')} Añadir nota</button>`,
    alAbrir(v) {
      pintaEstilos(v);
      if (puntos.length > 1) {
        const cv = v.querySelector('#grafico-notas');
        if (cv) requestAnimationFrame(() => dibujarEvolucion(cv, puntos, { objetivo: entrada.objetivo }));
      }
    },
  });
}

accion('eval-sel', d => { evalSel = d.e; pintar(); });

/* -------------------------------- objetivo --------------------------------- */

accion('objetivo-editar', () => {
  const entrada = entradaDe(asigActual);
  hoja({
    titulo: 'Objetivo de nota',
    cuerpo: `
      <div class="campo">
        <label for="obj-valor">Media que quieres sacar en el curso (0–10)</label>
        <input id="obj-valor" type="text" inputmode="decimal" value="${entrada.objetivo != null ? fnota(entrada.objetivo) : ''}" placeholder="7,00">
      </div>`,
    pie: `
      ${entrada.objetivo != null ? '<button class="boton sutil izquierda" data-accion="objetivo-quitar">Quitar</button>' : ''}
      <button class="boton fantasma" data-accion="cerrar-hoja">Cancelar</button>
      <button class="boton" data-accion="objetivo-guardar">Guardar</button>`,
    alAbrir(v) { enfocar(v, '#obj-valor'); },
  });
});

accion('objetivo-guardar', () => {
  const v = numeroDe('obj-valor');
  if (v == null || v < 0 || v > 10) return aviso('Pon un número entre 0 y 10', 'mal');
  guardarEntrada(asigActual, { ...entradaDe(asigActual), objetivo: v });
  pintar();
});

accion('objetivo-quitar', () => {
  guardarEntrada(asigActual, { ...entradaDe(asigActual), objetivo: null });
  pintar();
});

/* ---------------------------------- notas ---------------------------------- */

function formNota(n) {
  hoja({
    titulo: n ? 'Editar nota' : 'Nueva nota',
    cuerpo: `
      <div class="campo">
        <label for="n-titulo">Qué es</label>
        <input id="n-titulo" type="text" value="${escapa(n?.titulo || '')}" placeholder="Examen tema 2" autocomplete="off">
      </div>
      <div class="campos-3">
        <div class="campo">
          <label for="n-valor">Nota</label>
          <input id="n-valor" type="text" inputmode="decimal" value="${n ? fnota(n.valor) : ''}" placeholder="7,50">
        </div>
        <div class="campo">
          <label for="n-peso">Peso</label>
          <input id="n-peso" type="text" inputmode="decimal" value="${n?.peso ?? 1}">
        </div>
        <div class="campo">
          <label for="n-fecha">Fecha</label>
          <input id="n-fecha" type="date" value="${escapa(n?.fecha || hoyLocal())}">
        </div>
      </div>`,
    pie: `
      ${n ? `<button class="boton sutil izquierda peligro" data-accion="nota-borrar" data-id="${escapa(n.id)}">Borrar</button>` : ''}
      <button class="boton fantasma" data-accion="cerrar-hoja">Cancelar</button>
      <button class="boton" data-accion="nota-guardar" data-id="${n ? escapa(n.id) : ''}">Guardar</button>`,
    alAbrir(v) { enfocar(v, '#n-titulo'); },
  });
}

accion('nota-nueva', () => formNota(null));

accion('nota-editar', d => {
  const entrada = entradaDe(asigActual);
  const n = EVALS.flatMap(e => entrada.evaluaciones[e]).find(x => x.id === d.id);
  if (n) formNota(n);
});

accion('nota-guardar', (d, el) => {
  const v = el.closest('.hoja');
  const titulo = v.querySelector('#n-titulo').value.trim();
  const valor = numeroDe('n-valor');
  const peso = numeroDe('n-peso') ?? 1;
  const fecha = v.querySelector('#n-fecha').value;
  if (!titulo) return aviso('Ponle un nombre', 'mal');
  if (valor == null || valor < 0 || valor > 10) return aviso('La nota va de 0 a 10', 'mal');
  if (!fecha) return aviso('Ponle una fecha', 'mal');

  const entrada = entradaDe(asigActual);
  const evaluaciones = { ...entrada.evaluaciones };
  if (d.id) {
    for (const e of EVALS) evaluaciones[e] = evaluaciones[e].map(n => (n.id === d.id ? { ...n, titulo, valor, peso, fecha } : n));
  } else {
    evaluaciones[evalSel] = [...evaluaciones[evalSel], { id: nuevoId(), titulo, valor, peso, fecha }];
  }
  guardarEntrada(asigActual, { ...entrada, evaluaciones });
  pintar();
  aviso('Guardado');
});

accion('nota-borrar', async d => {
  if (!await confirmar('Se borra esta nota.', 'Borrar')) return;
  const entrada = entradaDe(asigActual);
  const evaluaciones = {};
  for (const e of EVALS) evaluaciones[e] = entrada.evaluaciones[e].filter(n => n.id !== d.id);
  guardarEntrada(asigActual, { ...entrada, evaluaciones });
  pintar();
});
