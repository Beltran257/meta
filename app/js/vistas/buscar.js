/* ===========================================================================
   BÚSQUEDA GLOBAL — una sola caja para todo: tareas, exámenes, asignaturas,
   temas, apuntes y notas rápidas. Resultados agrupados por tipo, y cada uno
   lleva a su sitio.
   =========================================================================== */

import { leer } from '../core/store.js';
import { hoja, cerrarHoja, pintaEstilos, icono } from '../core/ui.js';
import { accion, on, emitir, retardar } from '../core/bus.js';
import { escapa, fechaCorta } from '../core/fmt.js';
import { listaAsignaturas, asignaturaDe } from '../core/asignaturas.js';
import { listaTemas } from '../core/temas.js';
import * as motor from '../core/motor.js';

// Sin acentos ni mayusculas: buscar "matematicas" tiene que encontrar "Matemáticas".
const SIN_TILDES = new RegExp('\\p{Diacritic}', 'gu');
const normaliza = s => String(s || '').toLowerCase().normalize('NFD').replace(SIN_TILDES, '');

function buscar(q) {
  const t = normaliza(q);
  if (t.length < 2) return [];
  const casa = texto => normaliza(texto).includes(t);
  const grupos = [];

  const tareas = motor.listaTareas().filter(x => casa(x.titulo) || casa(x.notas));
  const soloT = tareas.filter(x => x.tipo !== 'examen');
  const soloE = tareas.filter(x => x.tipo === 'examen');

  if (soloT.length) grupos.push({ et: 'Tareas', items: soloT.slice(0, 6).map(x => ({
    id: x.id, t1: x.titulo, t2: `${asignaturaDe(x.asignaturaId)?.nombre || ''} · ${fechaCorta(x.fecha)}`,
    ir: { id: 'tareas' }, abrir: ['abrir-tarea', x.id],
  })) });

  if (soloE.length) grupos.push({ et: 'Exámenes', items: soloE.slice(0, 6).map(x => ({
    id: x.id, t1: x.titulo, t2: `${asignaturaDe(x.asignaturaId)?.nombre || ''} · ${fechaCorta(x.fecha)}`,
    ir: { id: 'examenes', examenId: x.id },
  })) });

  const asigs = listaAsignaturas().filter(a => casa(a.nombre) || casa(a.profesor));
  if (asigs.length) grupos.push({ et: 'Asignaturas', items: asigs.slice(0, 6).map(a => ({
    id: a.id, t1: a.nombre, t2: a.profesor || '', ir: { id: 'asignaturas', asignaturaId: a.id },
  })) });

  const temas = listaTemas().filter(x => casa(x.nombre));
  if (temas.length) grupos.push({ et: 'Temas', items: temas.slice(0, 6).map(x => ({
    id: x.id, t1: x.nombre, t2: `${asignaturaDe(x.asignaturaId)?.nombre || ''} · dominio ${x.dominio || 0}%`,
    ir: { id: 'asignaturas', asignaturaId: x.asignaturaId },
  })) });

  const apuntes = leer('apuntesMeta', []).filter(x => casa(x.titulo) || casa(x.texto));
  if (apuntes.length) grupos.push({ et: 'Apuntes', items: apuntes.slice(0, 6).map(x => ({
    id: x.id, t1: x.titulo, t2: `${asignaturaDe(x.asignaturaId)?.nombre || ''} · ${fechaCorta(x.fecha)}`,
    ir: { id: 'apuntes' },
  })) });

  const rapidas = leer('notasRapidas', []).filter(x => casa(x.texto));
  if (rapidas.length) grupos.push({ et: 'Notas rápidas', items: rapidas.slice(0, 5).map(x => ({
    id: x.id, t1: x.texto.slice(0, 80), t2: fechaCorta(x.fecha), ir: { id: 'apuntes' },
  })) });

  return grupos;
}

let destinos = new Map();

function pintarResultados(q) {
  const caja = document.querySelector('#buscar-res');
  if (!caja) return;
  destinos = new Map();

  if (normaliza(q).length < 2) {
    caja.innerHTML = '<div class="buscar-grupo">Escribe al menos dos letras</div>';
    return;
  }
  const grupos = buscar(q);
  if (!grupos.length) {
    caja.innerHTML = `<div class="vacio"><p>Nada coincide con "${escapa(q)}".</p></div>`;
    return;
  }

  let n = 0;
  caja.innerHTML = grupos.map(g => `
    <div class="buscar-grupo">${escapa(g.et)}</div>
    ${g.items.map(it => {
      const clave = 'r' + (n++);
      destinos.set(clave, it);
      return `
        <button class="fila" data-accion="buscar-ir" data-k="${clave}">
          <span class="izq">
            <span class="t1">${escapa(it.t1)}</span>
            ${it.t2 ? `<span class="t2">${escapa(it.t2)}</span>` : ''}
          </span>
        </button>`;
    }).join('')}`).join('');
  pintaEstilos(caja);
}

export function abrirBuscador() {
  hoja({
    titulo: 'Buscar',
    clase: 'buscador',
    cuerpo: `
      <div class="buscar-caja">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
        </svg>
        <input id="buscar-input" type="search" placeholder="Tareas, exámenes, temas, apuntes…"
               autocomplete="off" spellcheck="false">
      </div>
      <div class="buscar-res" id="buscar-res">
        <div class="buscar-grupo">Escribe al menos dos letras</div>
      </div>`,
    alAbrir(v) {
      const inp = v.querySelector('#buscar-input');
      setTimeout(() => inp?.focus(), 120);
      inp?.addEventListener('input', retardar(ev => pintarResultados(ev.target.value), 160));
    },
  });
}

accion('buscar-abrir', abrirBuscador);
on('abrir-buscador', abrirBuscador);

accion('buscar-ir', d => {
  const it = destinos.get(d.k);
  if (!it) return;
  cerrarHoja();
  emitir('ir', it.ir);
  if (it.abrir) setTimeout(() => emitir(it.abrir[0], it.abrir[1]), 250);
});
