/* ===========================================================================
   APUNTES — biblioteca: buscar, filtrar por asignatura y tema, favoritos y
   recientes. Los de texto admiten estructura (títulos, listas, casillas) sin
   convertirse en un procesador de textos.

   Los textos viajan por el buzón de siempre. Las fotos y PDF pesan más: se
   guardan primero en IndexedDB de este aparato y, si hay sesión, también se
   suben a la cuenta (ver core/archivos.js) — así se ven en tus otros aparatos
   y llegan a tu carpeta enlazada si la tienes.
   =========================================================================== */

import { leer, guardar } from '../core/store.js';
import { hoja, cerrarHoja, aviso, confirmar, pintaEstilos, icono, enfocar } from '../core/ui.js';
import { accion, on, emitir, retardar } from '../core/bus.js';
import { escapa, hoyLocal, fechaCorta } from '../core/fmt.js';
import { asignaturaDe, contenido } from '../core/asignaturas.js';
import { temasDe, temaDe } from '../core/temas.js';
import { guardarBlob, leerBlob, borrarBlob } from '../core/apuntesdb.js';
import { subirArchivo, borrarArchivoRemoto, bajarArchivoSiFalta, reducirFoto } from '../core/archivos.js';

const nuevoId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* Espejo exacto de las carpetas del enlace (ver tools/enlace-carpeta.mjs):
   1ª/2ª/3ª Evaluación y PAU. En foto/PDF decide la carpeta del Mac; en un
   texto es opcional y solo sirve para ordenarlo junto a los demás. */
const EVALUACIONES = [
  { id: '1', nombre: '1ª Evaluación' },
  { id: '2', nombre: '2ª Evaluación' },
  { id: '3', nombre: '3ª Evaluación' },
  { id: 'pau', nombre: 'PAU (EBAU)' },
];
const evalNombre = id => EVALUACIONES.find(e => e.id === id)?.nombre || '';

function selectorEvaluacion(valor, { opcional = false } = {}) {
  return `
    <div class="campo">
      <label for="ap-eval">Evaluación${opcional ? ' (opcional)' : ''}</label>
      <select id="ap-eval">
        ${opcional ? `<option value="" ${!valor ? 'selected' : ''}>Sin evaluación</option>` : ''}
        ${EVALUACIONES.map(e => `<option value="${e.id}" ${valor === e.id ? 'selected' : ''}>${escapa(e.nombre)}</option>`).join('')}
      </select>
    </div>`;
}

export const listaApuntes = () => leer('apuntesMeta', []);

function guardarLista(l) {
  guardar('apuntesMeta', l);
  emitir('local-cambio');
  emitir('datos-cambio', ['apuntesMeta']);
}

let raiz = null;
let asigSel = 'todas';
let tipoSel = 'todos';
let busqueda = '';
let soloFavoritos = false;
let urlsVivas = [];

const limpiarUrls = () => { urlsVivas.forEach(u => URL.revokeObjectURL(u)); urlsVivas = []; };

/* ------------------------- texto con un poco de forma ----------------------
   Se escapa PRIMERO y se da formato después: así nada de lo que escriba el
   usuario puede convertirse en HTML. */
function aHtml(texto) {
  return escapa(texto || '').split('\n').map(linea => {
    if (/^###\s+/.test(linea)) return `<h4>${linea.replace(/^###\s+/, '')}</h4>`;
    if (/^##\s+/.test(linea)) return `<h3>${linea.replace(/^##\s+/, '')}</h3>`;
    if (/^#\s+/.test(linea)) return `<h2>${linea.replace(/^#\s+/, '')}</h2>`;
    if (/^\[\s?\]\s+/.test(linea)) return `<div class="ap-check">☐ ${linea.replace(/^\[\s?\]\s+/, '')}</div>`;
    if (/^\[x\]\s+/i.test(linea)) return `<div class="ap-check hecha">☑ ${linea.replace(/^\[x\]\s+/i, '')}</div>`;
    if (/^[-*]\s+/.test(linea)) return `<div class="ap-punto">${linea.replace(/^[-*]\s+/, '')}</div>`;
    if (!linea.trim()) return '<br>';
    return `<p>${linea}</p>`;
  }).join('');
}

/* --------------------------------- orden -----------------------------------
   Antes era una sola rejilla de tarjetas de todas las asignaturas mezcladas,
   ordenada por fecha: con lo que trae el enlace de carpeta (decenas de PDF
   con el mismo día) no había quien encontrara nada. Ahora se entra como en
   la carpeta del Mac: asignatura → evaluación → archivo, en filas compactas
   y con orden natural ("Tema 2" antes que "Tema 10"). */

const ORDEN_EVAL = [...EVALUACIONES.map(e => e.id), ''];
const ordenNatural = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
const porTitulo = (a, b) => ordenNatural.compare(a.titulo || '', b.titulo || '');
const recientes = (a, b) => (b.creado || 0) - (a.creado || 0) || (b.fecha || '').localeCompare(a.fecha || '');

/** Título para mostrar: los que llegan de un archivo traen el nombre tal
    cual ("TEMA_2_EL_PENSAMIENTO"); los guiones bajos fuera. Lo guardado no
    se toca: el enlace de carpeta lo usa como nombre de archivo. */
const tituloVisible = t => String(t || 'Sin título').replace(/_+/g, ' ').replace(/\s{2,}/g, ' ').trim();

/** Una línea de vista previa sin la marca de formato (#, -, [ ]). */
const previa = texto => String(texto || '')
  .split('\n').map(l => l.replace(/^(#{1,3}|[-*]|\[[ xX]?\])\s+/, '').trim()).filter(Boolean)
  .join(' · ').slice(0, 140);

const ETIQUETA_TIPO = { texto: 'Texto', foto: 'Foto', pdf: 'PDF' };

function fila(a, { conAsignatura = false } = {}) {
  const asig = asignaturaDe(a.asignaturaId);
  const tema = a.temaId ? temaDe(a.temaId) : null;
  const detalle = [
    conAsignatura && asig ? `<span class="asig"><i data-bg="${escapa(asig.color)}"></i><span>${escapa(asig.nombre)}</span></span>` : '',
    tema ? `<span class="ap-tema">${escapa(tema.nombre)}</span>` : '',
    a.tipo === 'texto' && a.texto ? `<span class="ap-prev">${escapa(previa(a.texto))}</span>` : '',
    `<span class="ap-fecha">${escapa(fechaCorta(a.fecha))}</span>`,
  ].filter(Boolean).join('');
  return `
    <button class="fila ap-fila" data-accion="apunte-abrir" data-id="${escapa(a.id)}">
      <span class="ap-ico ${escapa(a.tipo)}" data-miniatura="${a.tipo === 'foto' ? escapa(a.id) : ''}" aria-label="${ETIQUETA_TIPO[a.tipo] || ''}">
        ${icono(a.tipo === 'texto' ? 'lapiz' : a.tipo)}
      </span>
      <span class="izq">
        <span class="t1">${a.favorito ? '<span class="ap-fav">★</span> ' : ''}${escapa(tituloVisible(a.titulo))}</span>
        <span class="t2">${detalle}</span>
      </span>
    </button>`;
}

const lista = (l, opciones) => `<div class="lista">${l.map(a => fila(a, opciones)).join('')}</div>`;

/** Fotos: la miniatura llega DESPUÉS de pintar, sin frenar la lista. Antes se
    esperaba a leer (y a bajar de la cuenta) todas las fotos antes de enseñar
    nada. `turno` evita que una tanda vieja pinte sobre una lista nueva. */
let turno = 0;
async function ponerMiniaturas(cont) {
  const mio = ++turno;
  for (const el of cont.querySelectorAll('[data-miniatura]:not([data-miniatura=""])')) {
    const a = listaApuntes().find(x => x.id === el.dataset.miniatura);
    if (!a) continue;
    try {
      let b = await leerBlob(a.id);
      if (!b?.blob && a.r2) {
        const blob = await bajarArchivoSiFalta(a);
        if (blob) { await guardarBlob(a.id, blob, a.tipo); b = { blob }; }
      }
      if (mio !== turno || !b?.blob) continue;
      const src = URL.createObjectURL(b.blob);
      urlsVivas.push(src);
      el.innerHTML = `<img src="${src}" alt="">`;
    } catch { /* el archivo puede estar en otro aparato, y sin conexión no hay forma de traerlo */ }
  }
}

/* --------------------------------- render ---------------------------------- */

function filtrados() {
  let l = listaApuntes();
  if (asigSel !== 'todas') l = l.filter(a => a.asignaturaId === asigSel);
  if (tipoSel !== 'todos') l = l.filter(a => a.tipo === tipoSel);
  if (soloFavoritos) l = l.filter(a => a.favorito);
  if (busqueda) {
    const q = busqueda.toLowerCase();
    l = l.filter(a => tituloVisible(a.titulo).toLowerCase().includes(q) ||
      (a.titulo || '').toLowerCase().includes(q) || (a.texto || '').toLowerCase().includes(q));
  }
  return l;
}

const hayFiltro = () => !!busqueda || soloFavoritos || tipoSel !== 'todos';

/** Portada: una carpeta por asignatura y, debajo, lo último que ha entrado. */
function htmlCarpetas() {
  const todos = listaApuntes();
  const carpetas = contenido().map(a => {
    const suyos = todos.filter(x => x.asignaturaId === a.id);
    return `
      <button class="ap-carpeta" data-accion="ap-asig" data-id="${escapa(a.id)}">
        <i class="punto-color" data-bg="${escapa(a.color)}"></i>
        <span class="n">${escapa(a.nombre)}</span>
        <span class="c">${suyos.length ? `${suyos.length} ${suyos.length === 1 ? 'apunte' : 'apuntes'}` : 'Vacía'}</span>
      </button>`;
  }).join('');
  const ultimos = todos.slice().sort(recientes).slice(0, 6);
  return `
    <div class="ap-carpetas" data-mt-grande>${carpetas}</div>
    ${ultimos.length ? `
      <div class="seccion">
        <div class="seccion-cab"><h2>Lo último</h2></div>
        ${lista(ultimos, { conAsignatura: true })}
      </div>` : `
      <div class="vacio" data-mt-grande>
        <h4>Sin apuntes todavía</h4>
        <p>Un texto, una foto de la pizarra o un PDF escaneado.</p>
        <button class="boton" data-accion="apunte-nuevo">Añadir apunte</button>
      </div>`}`;
}

/** Dentro de una asignatura: un bloque por evaluación, como en la carpeta. */
function htmlPorEvaluacion(l) {
  const grupos = ORDEN_EVAL
    .map(id => ({ id, items: l.filter(a => (a.evaluacion || '') === id) }))
    .filter(g => g.items.length);
  return grupos.map(g => `
    <div class="seccion ap-grupo">
      <div class="seccion-cab"><h2>${escapa(g.id ? evalNombre(g.id) : 'Sin evaluación')}</h2><span class="apag">${g.items.length}</span></div>
      ${lista(g.items.sort(porTitulo))}
    </div>`).join('');
}

/** Buscando o filtrando desde "Todas": resultados agrupados por asignatura. */
function htmlPorAsignatura(l) {
  return contenido()
    .map(a => ({ a, items: l.filter(x => x.asignaturaId === a.id) }))
    .concat([{ a: null, items: l.filter(x => !asignaturaDe(x.asignaturaId)) }])
    .filter(g => g.items.length)
    .map(({ a, items }) => `
      <div class="seccion ap-grupo">
        <div class="seccion-cab"><h2>${a ? `<i class="punto-color" data-bg="${escapa(a.color)}"></i> ${escapa(a.nombre)}` : 'Sin asignatura'}</h2><span class="apag">${items.length}</span></div>
        ${lista(items.sort(porTitulo))}
      </div>`).join('');
}

function htmlResultados() {
  if (asigSel === 'todas' && !hayFiltro()) return htmlCarpetas();
  const l = filtrados();
  if (!l.length) {
    return `
      <div class="vacio" data-mt-grande>
        <h4>${hayFiltro() ? 'Nada coincide' : 'Carpeta vacía'}</h4>
        <p>${hayFiltro() ? 'Prueba con otra palabra o quita el filtro.' : 'Añade un texto, una foto o un PDF a esta asignatura.'}</p>
        ${hayFiltro() ? '' : '<button class="boton" data-accion="apunte-nuevo">Añadir apunte</button>'}
      </div>`;
  }
  return asigSel === 'todas' ? htmlPorAsignatura(l) : htmlPorEvaluacion(l);
}

/** Solo la parte de abajo: al escribir en el buscador no se repinta el propio
    buscador (antes sí, y se perdía el foco a mitad de palabra). */
function pintarResultados() {
  const cont = raiz?.querySelector('#ap-resultados');
  if (!cont) return;
  limpiarUrls();
  cont.innerHTML = htmlResultados();
  pintaEstilos(cont);
  ponerMiniaturas(cont);
}

function render() {
  if (!raiz) return;
  limpiarUrls();
  const asignaturas = contenido();

  if (!asignaturas.length) {
    raiz.innerHTML = `
      <div class="vacio">
        <h4>Antes, tus asignaturas</h4>
        <p>Los apuntes se organizan por asignatura y tema.</p>
        <button class="boton" data-accion="ir" data-id="asignaturas">Añadir asignaturas</button>
      </div>`;
    return;
  }

  const asig = asigSel !== 'todas' ? asignaturaDe(asigSel) : null;
  if (asigSel !== 'todas' && !asig) asigSel = 'todas';
  const cuantos = asig ? listaApuntes().filter(a => a.asignaturaId === asig.id).length : 0;

  raiz.innerHTML = `
    <div class="seccion-cab ${asig ? 'ap-cab' : ''}">
      ${asig
        ? `<button class="ap-volver" data-accion="ap-asig" data-id="todas" aria-label="Volver a todas las asignaturas">${icono('atras')}</button>
           <h2 class="ap-titulo"><i class="punto-color" data-bg="${escapa(asig.color)}"></i> ${escapa(asig.nombre)} <span class="apag">${cuantos}</span></h2>`
        : '<h2>Apuntes</h2>'}
      <button class="acc" data-accion="apunte-nuevo">+ Nuevo</button>
    </div>

    <div class="campo" data-mt>
      <input id="ap-buscar" type="search" placeholder="${asig ? `Buscar en ${escapa(asig.nombre)}` : 'Buscar en todos tus apuntes'}" value="${escapa(busqueda)}" autocomplete="off">
    </div>

    <div class="chips">
      ${[['todos', 'Todo'], ['texto', 'Textos'], ['foto', 'Fotos'], ['pdf', 'PDF']].map(([v, e]) =>
        `<button class="chip" data-accion="ap-tipo" data-tipo="${v}" aria-pressed="${tipoSel === v}">${e}</button>`).join('')}
      <button class="chip" data-accion="ap-favoritos" aria-pressed="${soloFavoritos}">★ Favoritos</button>
    </div>

    <div id="ap-resultados"></div>

    ${asig ? '' : bloqueRapidas()}`;

  pintaEstilos(raiz);
  pintarResultados();

  const buscar = raiz.querySelector('#ap-buscar');
  buscar?.addEventListener('input', retardar(ev => { busqueda = ev.target.value.trim(); pintarResultados(); }, 220));
}

accion('ap-asig', d => { asigSel = d.id; busqueda = ''; render(); document.getElementById('principal')?.scrollTo(0, 0); });
accion('ap-tipo', d => { tipoSel = d.tipo; render(); });
accion('ap-favoritos', () => { soloFavoritos = !soloFavoritos; render(); });

/* ------------------------------ notas rápidas ------------------------------
   Separadas de los apuntes a propósito: una nota rápida es captura al vuelo
   ("preguntar por el examen del jueves"), un apunte es conocimiento. */

const listaRapidas = () => leer('notasRapidas', []);

function guardarRapidas(l) {
  guardar('notasRapidas', l);
  emitir('local-cambio');
  emitir('datos-cambio', ['notasRapidas']);
}

function bloqueRapidas() {
  const l = listaRapidas().slice().sort((a, b) => (b.creado || 0) - (a.creado || 0));
  if (!l.length) return '';
  return `
    <div class="seccion" data-mt-grande>
      <div class="seccion-cab"><h2>Notas rápidas</h2><span class="apag">${l.length}</span></div>
      <div class="lista">
        ${l.slice(0, 10).map(n => `
          <div class="fila">
            <span class="izq"><span class="t1">${escapa(n.texto.slice(0, 90))}</span>
              <span class="t2">${escapa(fechaCorta(n.fecha))}</span></span>
            <button class="btn-icono" data-accion="rapida-borrar" data-id="${escapa(n.id)}" aria-label="Borrar">
              ${icono('papelera')}
            </button>
          </div>`).join('')}
      </div>
    </div>`;
}

export function nuevaRapida(texto) {
  guardarRapidas([...listaRapidas(), { id: nuevoId(), texto, fecha: hoyLocal(), creado: Date.now() }]);
}

accion('rapida-borrar', d => {
  guardarRapidas(listaRapidas().filter(n => n.id !== d.id));
  render();
});

/* ---------------------------------- alta ----------------------------------- */

function nuevoApunte() {
  hoja({
    titulo: 'Nuevo apunte',
    cuerpo: `
      <div class="captura">
        <button data-accion="apunte-tipo" data-tipo="texto">${icono('lapiz')} Escribir</button>
        <button data-accion="apunte-tipo" data-tipo="foto">${icono('foto')} Foto</button>
        <button data-accion="apunte-tipo" data-tipo="pdf">${icono('pdf')} PDF</button>
      </div>`,
  });
}

accion('apunte-nuevo', nuevoApunte);
on('nuevo-apunte', nuevoApunte);

accion('apunte-tipo', d => {
  cerrarHoja();
  setTimeout(() => (d.tipo === 'texto' ? formTexto(null) : formArchivo(d.tipo)), 180);
});

function selectorAsignaturaTema(a) {
  const asignaturas = contenido();
  const asigId = a?.asignaturaId || (asigSel !== 'todas' ? asigSel : asignaturas[0]?.id) || '';
  return `
    <div class="campos-2">
      <div class="campo">
        <label for="ap-asig">Asignatura</label>
        <select id="ap-asig">
          ${asignaturas.map(x => `<option value="${escapa(x.id)}" ${asigId === x.id ? 'selected' : ''}>${escapa(x.nombre)}</option>`).join('')}
        </select>
      </div>
      <div class="campo">
        <label for="ap-tema">Tema (opcional)</label>
        <select id="ap-tema"></select>
      </div>
    </div>`;
}

function rellenaTemas(v, temaId) {
  const asig = v.querySelector('#ap-asig');
  const sel = v.querySelector('#ap-tema');
  if (!asig || !sel) return;
  const pinta = () => {
    sel.innerHTML = '<option value="">Sin tema</option>' + temasDe(asig.value)
      .map(t => `<option value="${escapa(t.id)}" ${temaId === t.id ? 'selected' : ''}>${escapa(t.nombre)}</option>`).join('');
  };
  pinta();
  asig.addEventListener('change', pinta);
}

function formTexto(a) {
  hoja({
    titulo: a ? a.titulo : 'Nuevo apunte',
    ancha: true,
    cuerpo: `
      <div class="campo">
        <label for="ap-titulo">Título</label>
        <input id="ap-titulo" type="text" value="${escapa(a?.titulo || '')}" placeholder="Resumen del tema 4" autocomplete="off">
      </div>
      ${selectorAsignaturaTema(a)}
      ${selectorEvaluacion(a?.evaluacion || '', { opcional: true })}
      <div class="campo">
        <label for="ap-texto">Contenido</label>
        <div class="editor-barra">
          <button type="button" data-fmt="# ">Título</button>
          <button type="button" data-fmt="## ">Subtítulo</button>
          <button type="button" data-fmt="- ">Lista</button>
          <button type="button" data-fmt="[ ] ">Casilla</button>
        </div>
        <textarea id="ap-texto" class="grande" placeholder="# Título&#10;- Un punto&#10;[ ] Algo por hacer">${escapa(a?.texto || '')}</textarea>
      </div>`,
    pie: `
      ${a ? `<button class="boton sutil izquierda peligro" data-accion="apunte-borrar" data-id="${escapa(a.id)}">Borrar</button>` : ''}
      ${a ? `<button class="boton fantasma" data-accion="apunte-favorito" data-id="${escapa(a.id)}">${a.favorito ? 'Quitar de favoritos' : 'Favorito'}</button>` : ''}
      <button class="boton" data-accion="apunte-texto-guardar" data-id="${a ? escapa(a.id) : ''}">Guardar</button>`,
    alAbrir(v) {
      rellenaTemas(v, a?.temaId);
      enfocar(v, a ? '#ap-texto' : '#ap-titulo');
      const ta = v.querySelector('#ap-texto');
      v.querySelectorAll('[data-fmt]').forEach(b => b.addEventListener('click', () => {
        const ini = ta.selectionStart;
        const antes = ta.value.lastIndexOf('\n', ini - 1) + 1;
        ta.value = ta.value.slice(0, antes) + b.dataset.fmt + ta.value.slice(antes);
        ta.focus();
        ta.setSelectionRange(antes + b.dataset.fmt.length, antes + b.dataset.fmt.length);
      }));
    },
  });
}

accion('apunte-texto-guardar', (d, el) => {
  const v = el.closest('.hoja');
  const titulo = v.querySelector('#ap-titulo').value.trim();
  const texto = v.querySelector('#ap-texto').value;
  const asignaturaId = v.querySelector('#ap-asig').value;
  const temaId = v.querySelector('#ap-tema').value || null;
  const evaluacion = v.querySelector('#ap-eval').value || null;
  if (!titulo) return aviso('Ponle un título', 'mal');

  const lista = listaApuntes();
  guardarLista(d.id
    ? lista.map(a => (a.id === d.id ? { ...a, titulo, texto, asignaturaId, temaId, evaluacion } : a))
    : [...lista, { id: nuevoId(), tipo: 'texto', titulo, texto, asignaturaId, temaId, evaluacion, fecha: hoyLocal(), creado: Date.now() }]);
  cerrarHoja();
  render();
  aviso('Guardado');
});

function formArchivo(tipo) {
  hoja({
    titulo: tipo === 'foto' ? 'Nueva foto' : 'Nuevo PDF',
    cuerpo: `
      <div class="campo">
        <label for="ap-titulo-f">Título</label>
        <input id="ap-titulo-f" type="text" placeholder="${tipo === 'foto' ? 'Pizarra del jueves' : 'Apuntes escaneados'}" autocomplete="off">
      </div>
      ${selectorAsignaturaTema(null)}
      ${selectorEvaluacion(evaluacionHabitual())}
      <div class="campo">
        <label for="ap-archivo">${tipo === 'foto' ? 'Elige o haz una foto' : 'Elige el PDF'}</label>
        <input id="ap-archivo" type="file"
               accept="${tipo === 'foto' ? 'image/*' : 'application/pdf'}"
               ${tipo === 'foto' ? 'capture="environment"' : ''}>
      </div>
      <p class="pista">El archivo se guarda en este aparato. Con sesión iniciada, también se
      sube a tu cuenta: así lo ves en tus otros aparatos y llega a tu carpeta del Mac si la
      tienes enlazada.</p>`,
    pie: `<button class="boton fantasma" data-accion="cerrar-hoja">Cancelar</button>
          <button class="boton" data-accion="apunte-archivo-guardar" data-tipo="${tipo}">Guardar</button>`,
    alAbrir(v) { rellenaTemas(v, null); enfocar(v, '#ap-titulo-f'); },
  });
}

/** La evaluación del último archivo que entró: en mitad de la 2ª, casi todo
    lo nuevo es de la 2ª, y obligar a cambiarlo cada vez es como acaba todo
    archivado en la 1ª. */
function evaluacionHabitual() {
  const ultimo = listaApuntes().filter(a => a.tipo !== 'texto' && a.evaluacion).sort(recientes)[0];
  return ultimo?.evaluacion || '1';
}

accion('apunte-archivo-guardar', async (d, el) => {
  const v = el.closest('.hoja');
  const titulo = v.querySelector('#ap-titulo-f').value.trim();
  const elegido = v.querySelector('#ap-archivo').files?.[0];
  if (!titulo) return aviso('Ponle un título', 'mal');
  if (!elegido) return aviso('Elige un archivo', 'mal');

  el.disabled = true;
  const id = nuevoId();
  try {
    const archivo = d.tipo === 'foto' ? await reducirFoto(elegido) : elegido;
    await guardarBlob(id, archivo, d.tipo);
    const nuevo = {
      id, tipo: d.tipo, titulo,
      asignaturaId: v.querySelector('#ap-asig').value,
      temaId: v.querySelector('#ap-tema').value || null,
      evaluacion: v.querySelector('#ap-eval').value,
      fecha: hoyLocal(), creado: Date.now(),
    };
    guardarLista([...listaApuntes(), nuevo]);
    cerrarHoja();
    render();
    aviso('Guardado');
    // En segundo plano: si sube bien, marcará r2:true en el próximo sync (ver
    // worker/archivos.js) y no hace falta esperar aquí a que termine.
    subirArchivo(nuevo, archivo);
  } catch {
    aviso('No se pudo guardar el archivo', 'mal');
  } finally {
    el.disabled = false;
  }
});

/* ------------------------------- ver y borrar ------------------------------- */

accion('apunte-abrir', async d => {
  const a = listaApuntes().find(x => x.id === d.id);
  if (!a) return;
  if (a.tipo === 'texto') return verTexto(a);

  let url = '';
  try {
    let b = await leerBlob(a.id);
    if (!b?.blob && a.r2) {
      const blob = await bajarArchivoSiFalta(a);
      if (blob) { await guardarBlob(a.id, blob, a.tipo); b = { blob }; }
    }
    if (b?.blob) { url = URL.createObjectURL(b.blob); urlsVivas.push(url); }
  } catch { /* nada */ }

  const asig = asignaturaDe(a.asignaturaId);
  const tema = a.temaId ? temaDe(a.temaId) : null;
  hoja({
    titulo: tituloVisible(a.titulo),
    ancha: true,
    cuerpo: `<div class="t2 apag">${detalleApunte(a, asig, tema)}</div><div data-mt>` + (url
      ? (a.tipo === 'foto'
          ? `<img class="img-completa" src="${url}" alt="">`
          : `<p class="parrafo">PDF guardado en este aparato. Descárgalo para abrirlo.</p>`)
      : `<p class="parrafo">${a.r2
          ? 'No se ha podido traer el archivo ahora mismo. Comprueba la conexión.'
          : 'Este archivo está en otro aparato y no tiene sesión con la que traerlo.'}</p>`) + '</div>',
    pie: `
      <button class="boton sutil izquierda peligro" data-accion="apunte-borrar" data-id="${escapa(a.id)}">Borrar</button>
      <button class="boton sutil" data-accion="apunte-favorito" data-id="${escapa(a.id)}">${a.favorito ? '★ Quitar' : '☆ Favorito'}</button>
      <button class="boton fantasma" data-accion="apunte-archivo-editar" data-id="${escapa(a.id)}">Editar</button>
      ${url ? `<a class="boton" href="${url}" download="${escapa(tituloVisible(a.titulo))}">${icono('descarga')} Descargar</a>` : ''}`,
  });
});

function detalleApunte(a, asig, tema) {
  return [asig?.nombre, tema?.nombre, a.evaluacion ? evalNombre(a.evaluacion) : '', fechaCorta(a.fecha)]
    .filter(Boolean).map(escapa).join(' · ');
}

/* Editar una foto o un PDF: solo sus datos, el archivo es el mismo. Antes no
   se podía — lo que entraba mal clasificado (sobre todo desde el enlace de
   carpeta) se quedaba mal para siempre o había que borrarlo y subirlo otra
   vez. */
accion('apunte-archivo-editar', d => {
  const a = listaApuntes().find(x => x.id === d.id);
  if (!a) return;
  hoja({
    titulo: 'Editar apunte',
    cuerpo: `
      <div class="campo">
        <label for="ap-titulo-f">Título</label>
        <input id="ap-titulo-f" type="text" value="${escapa(tituloVisible(a.titulo))}" autocomplete="off">
      </div>
      ${selectorAsignaturaTema(a)}
      ${selectorEvaluacion(a.evaluacion || '1')}
      <p class="pista">Si tienes la carpeta del Mac enlazada, el archivo que ya está allí no se mueve:
      el enlace nunca mueve ni borra nada.</p>`,
    pie: `<button class="boton fantasma" data-accion="cerrar-hoja">Cancelar</button>
          <button class="boton" data-accion="apunte-archivo-actualizar" data-id="${escapa(a.id)}">Guardar</button>`,
    alAbrir(v) { rellenaTemas(v, a.temaId); },
  });
});

accion('apunte-archivo-actualizar', (d, el) => {
  const v = el.closest('.hoja');
  const titulo = v.querySelector('#ap-titulo-f').value.trim();
  if (!titulo) return aviso('Ponle un título', 'mal');
  guardarLista(listaApuntes().map(a => (a.id === d.id ? {
    ...a, titulo,
    asignaturaId: v.querySelector('#ap-asig').value,
    temaId: v.querySelector('#ap-tema').value || null,
    evaluacion: v.querySelector('#ap-eval').value,
  } : a)));
  cerrarHoja();
  render();
  aviso('Guardado');
});

function verTexto(a) {
  const asig = asignaturaDe(a.asignaturaId);
  const tema = a.temaId ? temaDe(a.temaId) : null;
  hoja({
    titulo: tituloVisible(a.titulo),
    ancha: true,
    cuerpo: `
      <div class="t2 apag">${detalleApunte(a, asig, tema)}</div>
      <div class="apunte-texto" data-mt-grande>${aHtml(a.texto)}</div>`,
    pie: `
      <button class="boton sutil izquierda" data-accion="apunte-favorito" data-id="${escapa(a.id)}">
        ${a.favorito ? '★ Quitar' : '☆ Favorito'}
      </button>
      ${tema ? `<button class="boton fantasma" data-accion="flash-generar" data-tema="${escapa(tema.id)}">${icono('chispa')} Flashcards</button>` : ''}
      <button class="boton" data-accion="apunte-editar" data-id="${escapa(a.id)}">Editar</button>`,
  });
}

accion('apunte-editar', d => {
  const a = listaApuntes().find(x => x.id === d.id);
  if (a) formTexto(a);
});

accion('apunte-favorito', d => {
  guardarLista(listaApuntes().map(a => (a.id === d.id ? { ...a, favorito: !a.favorito } : a)));
  cerrarHoja();
  render();
});

accion('apunte-borrar', async d => {
  if (!await confirmar('Se borra este apunte.', 'Borrar')) return;
  const a = listaApuntes().find(x => x.id === d.id);
  guardarLista(listaApuntes().filter(x => x.id !== d.id));
  if (a && a.tipo !== 'texto') {
    try { await borrarBlob(a.id); } catch { /* ya no estaba */ }
    borrarArchivoRemoto(a.id); // en segundo plano: si falla, queda huérfano en el servidor, no grave
  }
  cerrarHoja();
  render();
  aviso('Borrado');
});

export default {
  montar(el) {
    raiz = el;
    render();
    on('datos-cambio', render);
  },
  activar(extra) {
    if (extra?.asignaturaId) asigSel = extra.asignaturaId;
    render();
  },
  desactivar() { limpiarUrls(); },
};
