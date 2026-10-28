/* ===========================================================================
   ASIGNATURAS — cada una es un pequeño espacio de trabajo, no una fila de una
   lista de ajustes: temas, progreso, lo que tienes pendiente, horas metidas y
   dónde flojeas.
   =========================================================================== */

import { guardar, leer } from '../core/store.js';
import { hoja, cerrarHoja, aviso, confirmar, pintaEstilos, icono, barra, enfocar } from '../core/ui.js';
import { accion, on, emitir } from '../core/bus.js';
import { escapa, duracion, diasHasta, fechaCorta, nota as fnota, pct } from '../core/fmt.js';
import { PALETA, TIPOS_ASIGNATURA, listaAsignaturas, asignaturaDe, siguienteColor, nuevoId, tipoDe, fusionarAsignatura, contenido } from '../core/asignaturas.js';
import { asignaturaDeTitulo, norma } from '../core/calendario.js';
import { temasDeTitulos, unirNombres, ordenarNombres } from '../core/temario.js';
import { temasDeArchivo, tipoDeArchivo } from '../core/temario-lectura.js';
import { guardarArchivoApunte } from './apuntes.js';
import { temasDe, crearTema, crearTemas, editarTema, borrarTema, dominioMedio, enlazarApuntes } from '../core/temas.js';
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
            ${tipoDe(a) !== 'academica' ? `<span class="pil" data-mt>${escapa(TIPOS_ASIGNATURA.find(([v]) => v === tipoDe(a))?.[1] || '')}</span>` : ''}
            <div class="parrafo chico">
              ${r.temas.length ? `${r.temas.length} ${r.temas.length === 1 ? 'tema' : 'temas'}` : 'Sin temario: toca para ponerlo'}
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
  const apuntesPorTema = new Map();
  for (const x of leer('apuntesMeta', [])) if (x.temaId) apuntesPorTema.set(x.temaId, (apuntesPorTema.get(x.temaId) || 0) + 1);
  const porOrdenar = r.temas.length ? enlazarApuntes(a.id, { soloContar: true }) : 0;
  const notas = leer('notas', {})[a.id];
  const examenes = motor.examenesProximos(365).filter(e => e.asignaturaId === a.id);

  return `
    <div class="seccion-cab">
      <button class="btn-icono" data-accion="asig-volver" aria-label="Volver">${icono('atras')}</button>
      <h2>${escapa(a.nombre)}</h2>
      <button class="acc" data-accion="asig-editar" data-id="${escapa(a.id)}">Editar</button>
    </div>

    <div class="seccion" data-mt-grande>
      <div class="seccion-cab">
        <h2>Temario</h2>
        <span class="apag">${r.temas.length}</span>
        <button class="acc" data-accion="tema-lote" data-id="${escapa(a.id)}">+ Añadir varios</button>
      </div>
      ${r.temas.length ? `
        <div class="lista">
          ${r.temas.map(t => `
            <div class="tema-fila" data-accion="tema-abrir" data-id="${escapa(t.id)}">
              <span class="n">${escapa(t.nombre)}${apuntesPorTema.get(t.id) ? ` <span class="apag">· ${apuntesPorTema.get(t.id)} ${apuntesPorTema.get(t.id) === 1 ? 'apunte' : 'apuntes'}</span>` : ''}${t.proximoRepaso && diasHasta(t.proximoRepaso) <= 0 ? ' <span class="pil ojo">toca repasar</span>' : ''}</span>
              ${barra(t.dominio || 0, claseDe(t.dominio || 0))}
              <span class="pc">${t.dominio || 0}%</span>
            </div>`).join('')}
        </div>
        ${porOrdenar ? `
          <div class="cal-estado" data-mt>
            <p class="parrafo chico">${porOrdenar} ${porOrdenar === 1 ? 'apunte lleva' : 'apuntes llevan'} un número de tema en el título y no están colgados de su tema.</p>
            <button class="boton chico" data-accion="tema-ordenar-apuntes" data-id="${escapa(a.id)}">Ordenarlos por tema</button>
          </div>` : ''}` : `
        <div class="vacio">
          <p>Aún no hay temario. Cada tema es la unidad con la que META mide tu preparación para un examen.</p>
          <button class="boton" data-accion="tema-lote" data-id="${escapa(a.id)}">Poner el temario</button>
        </div>`}
      <div class="campo" data-mt>
        <input id="asig-tema-nuevo" type="text" placeholder="Añadir un tema y pulsar Intro" autocomplete="off">
      </div>
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
          <span class="v">${escapa(fnota(mediaGeneral(notas)))} de ${escapa(fnota(notas.objetivo))}</span>
        </div>
        ${barra(pct(mediaGeneral(notas) || 0, notas.objetivo))}`
      : '<p class="parrafo chico">Apunta tus notas y ponte un objetivo: META calcula qué te hace falta en lo que queda.</p>'}
      <button class="boton fantasma ancho" data-accion="asig-notas" data-id="${escapa(a.id)}" data-mt>
        Ver notas y objetivo
      </button>
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
      <div class="campo">
        <label>Tipo</label>
        <div class="chips" id="as-tipo">
          ${TIPOS_ASIGNATURA.map(([v, e]) => `<button type="button" class="chip" data-tipo-asig="${v}" aria-pressed="${tipoDe(a) === v}">${e}</button>`).join('')}
        </div>
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
      v.querySelector('#as-tipo').addEventListener('click', ev => {
        const b = ev.target.closest('button[data-tipo-asig]');
        if (!b) return;
        v.querySelectorAll('#as-tipo button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
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
  const tipo = v.querySelector('#as-tipo button[aria-pressed="true"]')?.dataset.tipoAsig || 'academica';
  if (!nombre) return aviso('Ponle un nombre', 'mal');

  const lista = listaAsignaturas();
  guardarAsignaturas(d.id
    ? lista.map(a => (a.id === d.id ? { ...a, nombre, profesor, aula, color, tipo } : a))
    : [...lista, { id: nuevoId(), nombre, profesor, aula, color, tipo }]);
  cerrarHoja();
  render();
  aviso('Guardado');
});

accion('asig-borrar', d => {
  const a = asignaturaDe(d.id);
  if (!a) return;
  const otras = contenido().filter(x => x.id !== a.id);
  // Lo normal es que la que se borra sea la misma de otra con otro nombre
  // ("Matemáticas (particular)" → "Matemáticas CCSS II"): se propone esa.
  const sugerida = asignaturaDeTitulo(a.nombre, otras) || '';
  hoja({
    titulo: `Borrar «${a.nombre}»`,
    cuerpo: `
      <p class="parrafo">Sus sesiones de estudio, tareas, apuntes, temas, notas y casillas del horario
      pueden pasar a otra asignatura en vez de quedarse sin ninguna.</p>
      <div class="campo" data-mt>
        <label for="as-destino">Pasar todo a</label>
        <select id="as-destino">
          ${otras.map(x => `<option value="${escapa(x.id)}" ${x.id === sugerida ? 'selected' : ''}>${escapa(x.nombre)}</option>`).join('')}
          <option value="" ${sugerida ? '' : 'selected'}>Ninguna (se quedan sin asignatura; los temas se borran)</option>
        </select>
      </div>`,
    pie: `<button class="boton fantasma" data-accion="cerrar-hoja">Cancelar</button>
          <button class="boton peligro" data-accion="asig-borrar-ya" data-id="${escapa(a.id)}">Borrar</button>`,
  });
});

accion('asig-borrar-ya', (d, el) => {
  const destino = el.closest('.hoja').querySelector('#as-destino').value || null;
  const nombreDestino = asignaturaDe(destino)?.nombre;
  fusionarAsignatura(d.id, destino);
  cerrarHoja();
  seleccionada = null;
  render();
  aviso(nombreDestino ? `Borrada: todo pasa a ${nombreDestino}` : 'Asignatura borrada');
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

/* ============================== TEMARIO EN LOTE ==============================
   Dos entradas para lo mismo: subir los archivos del temario (PDF, Word, foto,
   texto) o pegar/teclear la lista. En los dos casos acaba en el mismo cuadro,
   ya ORDENADO y sin repetidos, para revisarlo antes de guardar. Lo que sale de
   un archivo es una propuesta, nunca se guarda solo: un PDF mal leído no puede
   llenar el temario de basura sin que él lo vea.

   Cómo se lee cada cosa: core/temario-lectura.js. Cómo se sacan los temas del
   texto: core/temario.js (con pruebas en tools/prueba-temario.mjs). */

let archivosTemario = [];       // lo elegido en la hoja abierta, para poder guardarlo en Apuntes

const lineasDe = ta => ta.value.split('\n').map(l => l.trim()).filter(Boolean);
const ponLineas = (ta, l) => { ta.value = l.join('\n'); };

function filaArchivo(estado) {
  const icono_ = estado.ok === true ? '✓' : estado.ok === false ? '✕' : '…';
  return `
    <li class="fila ${estado.ok === false ? 'ap-error' : ''}">
      <span class="izq">
        <span class="t1">${escapa(estado.nombre)}</span>
        <span class="t2">${escapa(estado.texto)}</span>
      </span>
      <span class="der"><span class="pil ${estado.ok === true ? 'bien' : estado.ok === false ? 'mal' : ''}">${icono_}</span></span>
    </li>`;
}

accion('tema-lote', d => {
  const a = asignaturaDe(d.id);
  if (!a) return;
  archivosTemario = [];
  const ya = temasDe(a.id).map(t => t.nombre);
  const deApuntes = unirNombres([temasDeTitulos(leer('apuntesMeta', []).filter(x => x.asignaturaId === a.id).map(x => x.titulo))], ya);
  hoja({
    titulo: `Temario de ${a.nombre}`,
    ancha: true,
    cuerpo: `
      <div class="subir-temario">
        <label class="boton ancho" for="tema-archivos">${icono('descarga')} Subir el temario (PDF, Word, foto)</label>
        <input id="tema-archivos" class="oculto" type="file" multiple
               accept=".pdf,.docx,.txt,.md,image/*">
        <p class="pista">Puedes elegir varios a la vez: el índice del libro, la guía de la asignatura, una foto de la
        pizarra… META saca los temas y los deja ordenados; tú revisas antes de guardar.</p>
        <ul class="lista suelta" id="tema-archivos-estado"></ul>
        <label class="marca-guardar oculto" id="tema-guardar-caja">
          <input type="checkbox" id="tema-guardar-archivos" checked> Guardar también estos archivos en Apuntes de ${escapa(a.nombre)}
        </label>
      </div>
      <div class="campo" data-mt>
        <label for="tema-lote-texto">Temas (uno por línea)</label>
        <textarea id="tema-lote-texto" class="grande" placeholder="Tema 1. El nacimiento de la filosofía&#10;Tema 2. Platón&#10;Tema 3. Aristóteles">${escapa(deApuntes.join('\n'))}</textarea>
        <div class="pista" id="tema-lote-pista">${deApuntes.length
          ? `Ya he puesto los ${deApuntes.length} que salen de los títulos de tus apuntes: quita los que no sean un tema.`
          : 'También puedes pegar aquí el índice a mano.'}</div>
      </div>`,
    pie: `<button class="boton fantasma" data-accion="cerrar-hoja">Cancelar</button>
          <button class="boton sutil" data-accion="tema-lote-ordenar">Ordenar</button>
          <button class="boton" data-accion="tema-lote-guardar" data-id="${escapa(a.id)}">Añadir temas</button>`,
    alAbrir(v) {
      const ta = v.querySelector('#tema-lote-texto');
      const lista = v.querySelector('#tema-archivos-estado');
      v.querySelector('#tema-archivos').addEventListener('change', async ev => {
        const elegidos = [...ev.target.files];
        ev.target.value = '';
        const estados = elegidos.map(f => ({ nombre: f.name, ok: null, texto: 'Leyendo…' }));
        const pinta = () => { lista.innerHTML = estados.map(filaArchivo).join(''); };
        pinta();
        for (let i = 0; i < elegidos.length; i++) {
          const f = elegidos[i];
          try {
            const r = await temasDeArchivo(f);
            const nuevos = unirNombres([lineasDe(ta), r.temas], ya);
            ponLineas(ta, nuevos);
            estados[i] = { nombre: f.name, ok: r.temas.length > 0,
              texto: r.temas.length
                ? `${r.temas.length} ${r.temas.length === 1 ? 'tema' : 'temas'}${r.modo === 'ia' ? ' (con IA: revísalos)' : ''}`
                : 'Lo he leído pero no encuentro temas claros. Pega el índice a mano o prueba con otra página.' };
            if (['pdf', 'foto'].includes(tipoDeArchivo(f))) archivosTemario.push(f);
          } catch (e) {
            estados[i] = { nombre: f.name, ok: false, texto: e.message || 'No se pudo leer' };
          }
          pinta();
        }
        if (archivosTemario.length) v.querySelector('#tema-guardar-caja').classList.remove('oculto');
        v.querySelector('#tema-lote-pista').textContent = `Revisa la lista: ${lineasDe(ta).length} temas, ordenados. Quita los que sobren o corrige los títulos.`;
      });
    },
  });
});

accion('tema-lote-ordenar', (d, el) => {
  const ta = el.closest('.hoja').querySelector('#tema-lote-texto');
  ponLineas(ta, unirNombres([lineasDe(ta)]));
  aviso('Ordenados');
});

accion('tema-lote-guardar', async (d, el) => {
  const v = el.closest('.hoja');
  const nombres = lineasDe(v.querySelector('#tema-lote-texto'))
    .map(l => l.replace(/^\s*([-*•]|\d+[.)])\s+(?=\D)/, '').trim()).filter(Boolean);
  const guardarArchivos = v.querySelector('#tema-guardar-archivos')?.checked && archivosTemario.length;
  if (!nombres.length && !guardarArchivos) return aviso('Escribe al menos un tema', 'mal');
  el.disabled = true;

  const creados = crearTemas(d.id, nombres);
  let guardados = 0;
  if (guardarArchivos) {
    const existentes = new Set(leer('apuntesMeta', []).filter(x => x.asignaturaId === d.id).map(x => norma(x.titulo)));
    for (const f of archivosTemario) {
      const titulo = `Temario · ${f.name.replace(/\.[a-z0-9]+$/i, '')}`;
      if (existentes.has(norma(titulo))) continue;
      try {
        await guardarArchivoApunte({ archivo: f, tipo: tipoDeArchivo(f), titulo, asignaturaId: d.id });
        guardados++;
      } catch { /* un archivo que no se guarda no impide guardar los temas */ }
    }
  }
  // Los apuntes ya subidos cuyo título dice "Tema 3" se cuelgan del tema 3.
  const colgados = enlazarApuntes(d.id);
  cerrarHoja();
  render();
  const partes = [
    creados.length ? `${creados.length} ${creados.length === 1 ? 'tema añadido' : 'temas añadidos'}` : 'Esos temas ya estaban',
    guardados ? `${guardados} ${guardados === 1 ? 'archivo guardado' : 'archivos guardados'} en Apuntes` : '',
    colgados ? `${colgados} ${colgados === 1 ? 'apunte ordenado' : 'apuntes ordenados'} por tema` : '',
  ].filter(Boolean);
  aviso(partes.join(' · '));
});

accion('tema-ordenar-apuntes', d => {
  const n = enlazarApuntes(d.id);
  render();
  aviso(n ? `${n} ${n === 1 ? 'apunte colgado' : 'apuntes colgados'} de su tema` : 'No he encontrado apuntes que encajen');
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
