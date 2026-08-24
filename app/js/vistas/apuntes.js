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
import { listaAsignaturas, asignaturaDe } from '../core/asignaturas.js';
import { temasDe, temaDe } from '../core/temas.js';
import { guardarBlob, leerBlob, borrarBlob } from '../core/apuntesdb.js';
import { subirArchivo, borrarArchivoRemoto, bajarArchivoSiFalta } from '../core/archivos.js';

const nuevoId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* Espejo exacto de las carpetas del enlace (ver tools/enlace-carpeta.mjs):
   1ª/2ª/3ª Evaluación y PAU. Solo se usa en apuntes de foto/PDF — un texto no
   tiene un "archivo" que poner en una carpeta. */
const EVALUACIONES = [
  { id: '1', nombre: '1ª Evaluación' },
  { id: '2', nombre: '2ª Evaluación' },
  { id: '3', nombre: '3ª Evaluación' },
  { id: 'pau', nombre: 'PAU (EBAU)' },
];
const evalNombre = id => EVALUACIONES.find(e => e.id === id)?.nombre || '';

export const listaApuntes = () => leer('apuntesMeta', []);

function guardarLista(l) {
  guardar('apuntesMeta', l);
  emitir('local-cambio');
  emitir('datos-cambio', ['apuntesMeta']);
}

let raiz = null;
let asigSel = 'todas';
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

/* -------------------------------- tarjetas --------------------------------- */

async function tarjeta(a) {
  const asig = asignaturaDe(a.asignaturaId);
  const tema = a.temaId ? temaDe(a.temaId) : null;
  let medio = '';

  if (a.tipo === 'foto') {
    let src = '';
    try {
      let b = await leerBlob(a.id);
      if (!b?.blob && a.r2) {
        const blob = await bajarArchivoSiFalta(a);
        if (blob) { await guardarBlob(a.id, blob, a.tipo); b = { blob }; }
      }
      if (b?.blob) { src = URL.createObjectURL(b.blob); urlsVivas.push(src); }
    } catch { /* el archivo puede estar en otro aparato, y sin conexión no hay forma de traerlo */ }
    medio = `<span class="medio">${src ? `<img src="${src}" alt="">` : icono('foto')}</span>`;
  } else if (a.tipo === 'pdf') {
    medio = `<span class="medio">${icono('pdf')}</span>`;
  }

  return `
    <button class="apunte" data-accion="apunte-abrir" data-id="${escapa(a.id)}">
      ${medio}
      <span class="cuerpo">
        <span class="t1">${a.favorito ? '★ ' : ''}${escapa(a.titulo)}</span>
        ${a.tipo === 'texto' ? `<span class="prev">${escapa((a.texto || '').slice(0, 160))}</span>` : ''}
        <span class="t2">
          ${asig ? `<span class="asig"><i data-bg="${escapa(asig.color)}"></i><span>${escapa(asig.nombre)}</span></span>` : ''}
          ${tema ? `<span>${escapa(tema.nombre)}</span>` : ''}
          ${a.evaluacion ? `<span>${escapa(evalNombre(a.evaluacion))}</span>` : ''}
          <span>${escapa(fechaCorta(a.fecha))}</span>
        </span>
      </span>
    </button>`;
}

/* --------------------------------- render ---------------------------------- */

async function render() {
  if (!raiz) return;
  limpiarUrls();
  const asignaturas = listaAsignaturas();

  if (!asignaturas.length) {
    raiz.innerHTML = `
      <div class="vacio">
        <h4>Antes, tus asignaturas</h4>
        <p>Los apuntes se organizan por asignatura y tema.</p>
        <button class="boton" data-accion="ir" data-id="asignaturas">Añadir asignaturas</button>
      </div>`;
    return;
  }

  let l = listaApuntes();
  if (asigSel !== 'todas') l = l.filter(a => a.asignaturaId === asigSel);
  if (soloFavoritos) l = l.filter(a => a.favorito);
  if (busqueda) {
    const q = busqueda.toLowerCase();
    l = l.filter(a => (a.titulo || '').toLowerCase().includes(q) || (a.texto || '').toLowerCase().includes(q));
  }
  l = l.slice().sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

  const tarjetas = await Promise.all(l.map(tarjeta));

  raiz.innerHTML = `
    <div class="seccion-cab">
      <h2>Apuntes</h2>
      <button class="acc" data-accion="apunte-nuevo">+ Nuevo</button>
    </div>

    <div class="campo" data-mt>
      <input id="ap-buscar" type="search" placeholder="Buscar en tus apuntes" value="${escapa(busqueda)}" autocomplete="off">
    </div>

    <div class="chips">
      <button class="chip" data-accion="ap-asig" data-id="todas" aria-pressed="${asigSel === 'todas'}">Todas</button>
      <button class="chip" data-accion="ap-favoritos" aria-pressed="${soloFavoritos}">★ Favoritos</button>
      ${asignaturas.map(a => `
        <button class="chip" data-accion="ap-asig" data-id="${escapa(a.id)}" aria-pressed="${asigSel === a.id}">
          <i class="punto-color" data-bg="${escapa(a.color)}"></i>${escapa(a.nombre)}
        </button>`).join('')}
    </div>

    <div data-mt-grande>
      ${l.length
        ? `<div class="rejilla-auto">${tarjetas.join('')}</div>`
        : `<div class="vacio">
             <h4>${busqueda ? 'Nada coincide' : 'Sin apuntes aquí'}</h4>
             <p>${busqueda ? 'Prueba con otra palabra.' : 'Un texto, una foto de la pizarra o un PDF escaneado.'}</p>
             ${busqueda ? '' : '<button class="boton" data-accion="apunte-nuevo">Añadir apunte</button>'}
           </div>`}
    </div>

    ${bloqueRapidas()}`;

  pintaEstilos(raiz);

  const buscar = raiz.querySelector('#ap-buscar');
  buscar?.addEventListener('input', retardar(ev => { busqueda = ev.target.value.trim(); render(); }, 220));
}

accion('ap-asig', d => { asigSel = d.id; render(); });
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
  const asignaturas = listaAsignaturas();
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
  if (!titulo) return aviso('Ponle un título', 'mal');

  const lista = listaApuntes();
  guardarLista(d.id
    ? lista.map(a => (a.id === d.id ? { ...a, titulo, texto, asignaturaId, temaId } : a))
    : [...lista, { id: nuevoId(), tipo: 'texto', titulo, texto, asignaturaId, temaId, fecha: hoyLocal(), creado: Date.now() }]);
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
      <div class="campo">
        <label for="ap-eval">Evaluación</label>
        <select id="ap-eval">
          ${EVALUACIONES.map(e => `<option value="${e.id}">${escapa(e.nombre)}</option>`).join('')}
        </select>
      </div>
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

accion('apunte-archivo-guardar', async (d, el) => {
  const v = el.closest('.hoja');
  const titulo = v.querySelector('#ap-titulo-f').value.trim();
  const archivo = v.querySelector('#ap-archivo').files?.[0];
  if (!titulo) return aviso('Ponle un título', 'mal');
  if (!archivo) return aviso('Elige un archivo', 'mal');

  el.disabled = true;
  const id = nuevoId();
  try {
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

  hoja({
    titulo: a.titulo,
    ancha: true,
    cuerpo: url
      ? (a.tipo === 'foto'
          ? `<img class="img-completa" src="${url}" alt="">`
          : `<p class="parrafo">PDF guardado en este aparato. Descárgalo para abrirlo.</p>`)
      : `<p class="parrafo">${a.r2
          ? 'No se ha podido traer el archivo ahora mismo. Comprueba la conexión.'
          : 'Este archivo está en otro aparato y no tiene sesión con la que traerlo.'}</p>`,
    pie: `
      <button class="boton sutil izquierda peligro" data-accion="apunte-borrar" data-id="${escapa(a.id)}">Borrar</button>
      ${url ? `<a class="boton fantasma" href="${url}" download="${escapa(a.titulo)}">${icono('descarga')} Descargar</a>` : ''}`,
  });
});

function verTexto(a) {
  const asig = asignaturaDe(a.asignaturaId);
  const tema = a.temaId ? temaDe(a.temaId) : null;
  hoja({
    titulo: a.titulo,
    ancha: true,
    cuerpo: `
      <div class="t2 apag">${asig ? escapa(asig.nombre) : ''}${tema ? ' · ' + escapa(tema.nombre) : ''} · ${escapa(fechaCorta(a.fecha))}</div>
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
