/* ===========================================================================
   ESTUDIAR — lo que llega del calendario, la semana y el cronómetro.

   Desde octubre de 2026 las horas entran SOLAS desde el calendario (ver
   core/calendario.js): él planifica en Google Tasks y marca lo que hace. Por
   eso lo primero aquí es lo que llega del calendario y lo poco que hay que
   contestar ("¿lo hiciste?", "¿de qué asignatura es?"). El cronómetro, las
   cronómetro sigue, pero debajo: es lo secundario. Los tests y las flashcards
   se quitaron (noviembre 2026): se usan fuera, con NotebookLM.

   Todo lo que pasa aquí ALIMENTA al resto: cada sesión suma horas, cada
   repaso y cada test mueven el dominio del tema, y ese dominio es lo que hace
   subir o bajar la preparación de un examen y el estado académico. Si esto
   fuera un cronómetro suelto no serviría de nada.
   =========================================================================== */

import { leer, guardar } from '../core/store.js';
import { hoja, cerrarHoja, aviso, confirmar, pintaEstilos, icono, barra } from '../core/ui.js';
import { accion, on, emitir } from '../core/bus.js';
import { escapa, hoyLocal, duracion, diasHasta, lunesDe, desdeCuando, fechaCorta } from '../core/fmt.js';
import { asignaturaDe, contenido } from '../core/asignaturas.js';
import { listaTemas, temaDe, temasDe, registrarRepaso, ajustarDominio, tocaRepasar } from '../core/temas.js';
import * as motor from '../core/motor.js';
import * as calendario from '../core/calendario.js';

const nuevoId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const TIPOS = [
  ['teoria', 'Teoría'], ['ejercicios', 'Ejercicios'], ['repaso', 'Repaso'],
  ['simulacro', 'Simulacro'], ['clase', 'Clase particular'],
];

let raiz = null;
let sesion = null;      // {asignaturaId, temaId, tipo, objetivo, transcurrido, desde, corriendo}
let reloj = null;

const claseDe = p => (p >= 75 ? 'bien' : p >= 45 ? 'ojo' : 'mal');

/* ============================== CRONÓMETRO =================================
   La sesión en marcha se guarda en el aparato (clave 'cronometro') en cada
   cambio, y el tiempo se cuenta como "ahora menos cuándo arrancó", nunca
   sumando ticks. Así sobrevive a que iPadOS congele o cierre la app: al
   volver a abrirla se recupera y el reloj marca lo que de verdad ha pasado.
   Antes vivía solo en memoria y cerrar la app la tiraba entera. */

function persistir() {
  guardar('cronometro', sesion);
  marcarEnMarcha();
}

/** Punto en "Estudiar" de la barra lateral: se ve desde cualquier pantalla. */
function marcarEnMarcha() {
  document.querySelector('[data-globo="estudiar"]')?.classList.toggle('oculto', !sesion);
}

/** La guardada, si tiene forma de sesión; si no, ninguna. */
function recuperar() {
  const s = leer('cronometro', null);
  return s && typeof s.desde === 'number' && typeof s.transcurrido === 'number' ? s : null;
}

function segundosSesion() {
  if (!sesion) return 0;
  const extra = sesion.corriendo ? Math.floor((Date.now() - sesion.desde) / 1000) : 0;
  return sesion.transcurrido + extra;
}

function textoReloj(s) {
  const m = Math.floor(s / 60), seg = s % 60;
  return `${String(m).padStart(2, '0')}:${String(seg).padStart(2, '0')}`;
}

function pintarReloj() {
  const el = raiz?.querySelector('#crono-tiempo');
  if (!el) return;
  el.textContent = textoReloj(segundosSesion());
}

function arrancarReloj() {
  clearInterval(reloj);
  reloj = setInterval(pintarReloj, 1000);
}

function bloqueSesion() {
  const a = asignaturaDe(sesion.asignaturaId);
  const t = sesion.temaId ? temaDe(sesion.temaId) : null;
  const et = TIPOS.find(x => x[0] === sesion.tipo)?.[1] || 'Estudio';
  return `
    <div class="crono ${sesion.corriendo ? 'corriendo' : ''}">
      <div class="tiempo" id="crono-tiempo">${textoReloj(segundosSesion())}</div>
      <div class="que">${escapa(et)}${a ? ' · ' + escapa(a.nombre) : ''}${t ? ' · ' + escapa(t.nombre) : ''}</div>
      ${sesion.objetivo ? `<div class="pista">Objetivo: ${escapa(duracion(sesion.objetivo))}</div>` : ''}
      <div class="acciones">
        <button class="boton fantasma" data-accion="sesion-pausa">
          ${icono(sesion.corriendo ? 'pausa' : 'play')} ${sesion.corriendo ? 'Pausar' : 'Seguir'}
        </button>
        <button class="boton" data-accion="sesion-terminar">Terminar</button>
      </div>
    </div>
    `;
}

accion('ir-asignatura', d => emitir('ir', { id: 'asignaturas', asignaturaId: d.id }));

accion('sesion-pausa', () => {
  if (!sesion) return;
  if (sesion.corriendo) {
    sesion.transcurrido = segundosSesion();
    sesion.corriendo = false;
    clearInterval(reloj);
  } else {
    sesion.desde = Date.now();
    sesion.corriendo = true;
    arrancarReloj();
  }
  persistir();
  render();
});

function empezar({ asignaturaId, temaId, tipo = 'teoria', minutos = null }) {
  sesion = {
    asignaturaId: asignaturaId || temaDe(temaId)?.asignaturaId || contenido()[0]?.id || null,
    temaId: temaId || null,
    tipo,
    objetivo: minutos,
    transcurrido: 0,
    desde: Date.now(),
    corriendo: true,
  };
  persistir();
  arrancarReloj();
  render();
}

accion('sesion-terminar', () => {
  if (!sesion) return;
  const segundos = segundosSesion();
  const minutos = Math.max(1, Math.round(segundos / 60));
  clearInterval(reloj);
  // Se congela con el tiempo contado: si la hoja se cierra sin guardar (o se
  // cierra la app con ella abierta), la sesión queda en pausa con sus minutos.
  sesion.transcurrido = segundos;
  sesion.corriendo = false;
  persistir();
  render();

  const t = sesion.temaId ? temaDe(sesion.temaId) : null;
  hoja({
    titulo: 'Cerrar la sesión',
    cuerpo: `
      <div class="campo">
        <label for="ses-min">Minutos</label>
        <input id="ses-min" type="number" inputmode="numeric" min="1" max="600" value="${minutos}">
        ${minutos > 240 ? '<div class="pista">Son muchas horas seguidas: si el cronómetro se quedó en marcha sin querer, corrige los minutos aquí.</div>' : ''}
      </div>
      <div class="campo" data-mt-grande>
        <label>¿Cómo ha ido?</label>
        <div class="acciones">
          ${[['mal', 'Regular'], ['regular', 'Bien'], ['bien', 'Muy bien']].map(([v, e], i) =>
            `<button class="chip" type="button" data-res="${v}" aria-pressed="${i === 1}">${e}</button>`).join('')}
        </div>
        ${t ? `<div class="pista">Esto ajusta el dominio de "${escapa(t.nombre)}" (ahora ${t.dominio || 0}%).</div>` : ''}
      </div>
      <div class="campo">
        <label for="ses-notas">Notas (opcional)</label>
        <textarea id="ses-notas" placeholder="Qué te ha costado, qué falta…"></textarea>
      </div>`,
    pie: `
      <button class="boton sutil izquierda" data-accion="sesion-tirar">Descartar</button>
      <button class="boton" data-accion="sesion-guardar">Guardar sesión</button>`,
    alAbrir(v) {
      v.querySelectorAll('[data-res]').forEach(b => b.addEventListener('click', () => {
        v.querySelectorAll('[data-res]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      }));
    },
  });
});

accion('sesion-guardar', (d, el) => {
  const v = el.closest('.hoja');
  const resultado = v.querySelector('[data-res][aria-pressed="true"]')?.dataset.res || 'regular';
  const notas = v.querySelector('#ses-notas').value.trim();
  const minutos = Math.round(Number(v.querySelector('#ses-min').value));
  if (!sesion) return cerrarHoja();
  if (!(minutos >= 1 && minutos <= 600)) return aviso('Pon entre 1 y 600 minutos', 'mal');

  guardar('sesiones', [...motor.listaSesiones(), {
    id: nuevoId('s'),
    fecha: hoyLocal(),
    asignaturaId: sesion.asignaturaId,
    temaId: sesion.temaId,
    tipo: sesion.tipo,
    minutos, resultado, notas,
    creado: Date.now(),
  }]);

  // Una sesión mueve el dominio menos que un repaso formal: es tiempo
  // dedicado, no una comprobación de que te lo sabes.
  if (sesion.temaId) {
    const objetivo = resultado === 'bien' ? 90 : resultado === 'regular' ? 65 : 40;
    ajustarDominio(sesion.temaId, objetivo, 0.2);
  }

  emitir('local-cambio');
  sesion = null;
  persistir();
  clearInterval(reloj);
  emitir('datos-cambio', ['sesiones']);
  cerrarHoja();
  render();
  aviso(`${duracion(minutos)} registrados`);
});

accion('sesion-tirar', async () => {
  if (!await confirmar('Se descarta esta sesión y no queda registrada.', 'Descartar')) return;
  sesion = null;
  persistir();
  clearInterval(reloj);
  cerrarHoja();
  render();
});

/* ============================ EMPEZAR UNA SESIÓN =========================== */

function nuevaSesion() {
  const asignaturas = contenido();
  if (!asignaturas.length) return aviso('Añade antes tus asignaturas', 'mal');
  hoja({
    titulo: 'Nueva sesión de estudio',
    cuerpo: `
      <div class="campo">
        <label for="ns-asig">Asignatura</label>
        <select id="ns-asig">
          ${asignaturas.map(a => `<option value="${escapa(a.id)}">${escapa(a.nombre)}</option>`).join('')}
        </select>
      </div>
      <div class="campo">
        <label for="ns-tema">Tema</label>
        <select id="ns-tema"></select>
      </div>
      <div class="campo">
        <label>Tipo</label>
        <div class="chips envolver" id="ns-tipos">
          ${TIPOS.map(([v, e], i) => `<button type="button" class="chip" data-tipo="${v}" aria-pressed="${i === 0}">${e}</button>`).join('')}
        </div>
      </div>
      <div class="campo">
        <label for="ns-min">Duración objetivo</label>
        <select id="ns-min">
          ${[0, 15, 25, 30, 45, 60, 90].map(v => `<option value="${v}" ${v === 45 ? 'selected' : ''}>${v ? duracion(v) : 'Sin objetivo'}</option>`).join('')}
        </select>
      </div>`,
    pie: `<button class="boton fantasma" data-accion="cerrar-hoja">Cancelar</button>
          <button class="boton" data-accion="sesion-empezar">Empezar</button>`,
    alAbrir(v) {
      const asig = v.querySelector('#ns-asig');
      const rellena = () => {
        const temas = temasDe(asig.value);
        v.querySelector('#ns-tema').innerHTML =
          '<option value="">Sin tema concreto</option>' +
          temas.map(t => `<option value="${escapa(t.id)}">${escapa(t.nombre)} · ${t.dominio || 0}%</option>`).join('');
      };
      rellena();
      asig.addEventListener('change', rellena);
      v.querySelectorAll('[data-tipo]').forEach(b => b.addEventListener('click', () => {
        v.querySelectorAll('[data-tipo]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      }));
    },
  });
}

accion('sesion-nueva', nuevaSesion);
on('nueva-sesion', nuevaSesion);

accion('sesion-empezar', (d, el) => {
  const v = el.closest('.hoja');
  empezar({
    asignaturaId: v.querySelector('#ns-asig').value,
    temaId: v.querySelector('#ns-tema').value || null,
    tipo: v.querySelector('[data-tipo][aria-pressed="true"]')?.dataset.tipo || 'teoria',
    minutos: Number(v.querySelector('#ns-min').value) || null,
  });
  cerrarHoja();
});

/* ================================ REPASO =================================== */

function bloqueRepasos() {
  const l = tocaRepasar();
  if (!l.length) return '';
  return `
    <div class="seccion">
      <div class="seccion-cab"><h2>Toca repasar</h2><span class="apag">${l.length}</span></div>
      <div class="lista">
        ${l.slice(0, 8).map(t => {
          const a = asignaturaDe(t.asignaturaId);
          const retraso = -diasHasta(t.proximoRepaso);
          return `
            <div class="fila">
              <span class="izq">
                <span class="t1">${escapa(t.nombre)}</span>
                <span class="t2">
                  ${a ? `<span class="asig"><i data-bg="${escapa(a.color)}"></i><span>${escapa(a.nombre)}</span></span>` : ''}
                  <span>${t.dominio || 0}%</span>
                  ${retraso > 0 ? `<span class="pil ojo">${retraso} ${retraso === 1 ? 'día' : 'días'} de retraso</span>` : ''}
                </span>
              </span>
              <button class="boton chico fantasma" data-accion="repaso-hacer" data-id="${escapa(t.id)}">Repasar</button>
            </div>`;
        }).join('')}
      </div>
    </div>`;
}

accion('repaso-hacer', d => {
  const t = temaDe(d.id);
  if (!t) return;
  hoja({
    titulo: `Repaso: ${t.nombre}`,
    cuerpo: `
      <p class="parrafo">Repásalo con tus apuntes y luego dinos qué tal.
      Es lo que decide cuándo te lo volverá a poner META.</p>
      <div class="factor" data-mt-grande>
        <span class="n">Dominio ahora</span><span class="v">${t.dominio || 0}%</span>
      </div>
      ${barra(t.dominio || 0, claseDe(t.dominio || 0))}`,
    pie: `
      <button class="boton fantasma" data-accion="repaso-res" data-id="${escapa(t.id)}" data-r="mal">No me lo sabía</button>
      <button class="boton fantasma" data-accion="repaso-res" data-id="${escapa(t.id)}" data-r="regular">A medias</button>
      <button class="boton" data-accion="repaso-res" data-id="${escapa(t.id)}" data-r="bien">Me lo sé</button>`,
  });
});

accion('repaso-res', d => {
  const t = registrarRepaso(d.id, d.r);
  cerrarHoja();
  render();
  if (t) aviso(`Dominio ${t.dominio}% · siguiente repaso el ${t.proximoRepaso}`);
});

/* ========================== DESDE EL CALENDARIO =========================== */

const hora = iso => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const cuandoBloque = b => `${fechaCorta(b.inicio.slice(0, 10))} · ${hora(b.inicio)}–${hora(b.fin)}`;

function bloqueCalendario() {
  const e = calendario.estado();
  const desde = fechaCorta(calendario.inicioCurso());

  let cab;
  const horasSinEnviar = e.enviado ? (Date.now() - e.enviado) / 36e5 : 0;
  if (e.motivo === 'sin-script') {
    cab = `
      <div class="cal-estado mal">
        <p class="parrafo chico">${escapa(e.error)}</p>
        <button class="boton chico" data-accion="ir" data-id="perfil">Ir a Perfil</button>
      </div>`;
  } else if (!e.ultima) {
    cab = `
      <div class="cal-estado">
        <p class="parrafo chico">${e.error ? escapa(e.error) : 'Leyendo tu calendario…'}</p>
        <button class="boton chico fantasma" data-accion="cal-leer">Leer ahora</button>
      </div>`;
  } else {
    cab = `
      <div class="cal-estado">
        <p class="parrafo chico"><b>${escapa(duracion(Math.round(e.horas * 60)))}</b> de estudio marcado como hecho desde el ${escapa(desde)}
          · tu calendario se leyó ${escapa(desdeCuando(e.enviado || e.ultima))}${e.error ? ` · <span class="apag">${escapa(e.error)}</span>` : ''}</p>
        ${horasSinEnviar > 3 ? `<p class="parrafo chico mal">El script de tu cuenta de Google lleva más de ${Math.floor(horasSinEnviar)} h sin mandar nada.
          Ábrelo en script.google.com y mira "Ejecuciones", o vuelve a instalarlo desde Perfil.</p>` : ''}
        <button class="boton chico sutil" data-accion="cal-leer">Actualizar</button>
      </div>`;
  }

  const nombreAsig = id => asignaturaDe(id)?.nombre || '';
  const pendientes = e.pendientes.slice().reverse();
  const dudosos = e.dudosos.slice().reverse();
  const sinTema = e.temaPendientes.slice().reverse();
  return `
    <div class="tarjeta cal">
      <div class="seccion-cab"><h2>Desde tu calendario</h2></div>
      ${cab}
      ${pendientes.length ? `
        <h3 class="cal-sub">¿Lo hiciste? <span class="apag">No está marcado en Google Tasks</span></h3>
        <div class="lista">
          ${pendientes.map(b => `
            <div class="fila">
              <span class="izq">
                <span class="t1">${escapa(b.titulo)}</span>
                <span class="t2">${escapa(nombreAsig(b.asignaturaId))} · ${escapa(cuandoBloque(b))}</span>
              </span>
              <span class="der acciones">
                <button class="boton chico sutil" data-accion="cal-no" data-id="${escapa(b.id)}">No</button>
                <button class="boton chico" data-accion="cal-si" data-id="${escapa(b.id)}">Sí</button>
              </span>
            </div>`).join('')}
        </div>` : ''}
      ${sinTema.length ? `
        <h3 class="cal-sub">¿Qué tema era? <span class="apag">Para saber cuánto llevas de cada tema${sinTema.length > 6 ? ` · ${sinTema.length} sin contar, van los 6 últimos` : ''}</span></h3>
        <div class="lista">
          ${sinTema.slice(0, 6).map(b => `
            <div class="fila cal-dudoso">
              <span class="izq">
                <span class="t1">${escapa(b.titulo)}</span>
                <span class="t2">${escapa(nombreAsig(b.asignaturaId))} · ${escapa(cuandoBloque(b))}</span>
              </span>
              <span class="der">
                <select data-cal-tema="${escapa(b.id)}" aria-label="Tema de ${escapa(b.titulo)}">
                  <option value="">Elegir…</option>
                  ${temasDe(b.asignaturaId).map(t => `<option value="${escapa(t.id)}">${escapa(t.nombre)}</option>`).join('')}
                  <option value="ninguno">Varios / sin tema concreto</option>
                </select>
              </span>
            </div>`).join('')}
        </div>` : ''}
      ${dudosos.length ? `
        <h3 class="cal-sub">¿De qué asignatura es? <span class="apag">Se recuerda para ese título</span></h3>
        <div class="lista">
          ${dudosos.map(b => `
            <div class="fila cal-dudoso">
              <span class="izq">
                <span class="t1">${escapa(b.titulo)}</span>
                <span class="t2">${escapa(cuandoBloque(b))}</span>
              </span>
              <span class="der">
                <select data-cal-asignar="${escapa(b.id)}" aria-label="Asignatura de ${escapa(b.titulo)}">
                  <option value="">Elegir…</option>
                  ${contenido().map(a => `<option value="${escapa(a.id)}">${escapa(a.nombre)}</option>`).join('')}
                  <option value="no">No es estudio</option>
                </select>
              </span>
            </div>`).join('')}
        </div>` : ''}
    </div>`;
}

accion('cal-leer', async (d, el) => {
  el.disabled = true;
  await calendario.importar({ forzar: true });
  const e = calendario.estado();
  if (!e.error) aviso('Calendario al día');
});
accion('cal-si', d => { calendario.responder(d.id, true); aviso('Apuntado'); });
accion('cal-no', d => calendario.responder(d.id, false));

/** Esta semana, por asignatura: venga del calendario o del cronómetro. */
function bloqueSemana() {
  const hoy = hoyLocal();
  const lunes = lunesDe(hoy);
  const semana = motor.listaSesiones().filter(x => x.fecha >= lunes && x.fecha <= hoy);
  const total = semana.reduce((t, x) => t + (x.minutos || 0), 0);
  const porAsig = new Map();
  for (const x of semana) porAsig.set(x.asignaturaId, (porAsig.get(x.asignaturaId) || 0) + (x.minutos || 0));
  const filas = contenido()
    .map(a => ({ a, m: porAsig.get(a.id) || 0 }))
    .sort((x, y) => y.m - x.m);
  const max = Math.max(1, ...filas.map(f => f.m));
  return `
    <div class="seccion">
      <div class="seccion-cab"><h2>Esta semana</h2><span class="apag">${escapa(duracion(total))}</span></div>
      <div class="rejilla3">
        <div class="metrica"><span class="insignia">${icono('reloj')}</span><div class="v">${escapa(duracion(motor.minutosDe(hoy)))}</div><div class="e">Hoy</div></div>
        <div class="metrica"><span class="insignia">${icono('reloj')}</span><div class="v">${escapa(duracion(total))}</div><div class="e">Desde el lunes</div></div>
        <div class="metrica"><span class="insignia ${motor.diasConEstudio(7) ? 'bien' : ''}">${icono('fuego')}</span><div class="v">${motor.diasConEstudio(7)}/7</div><div class="e">Días con estudio</div></div>
      </div>
      <div class="lista" data-mt>
        ${filas.map(({ a, m }) => `
          <div class="fila semana-fila">
            <span class="izq">
              <span class="t1"><span class="asig"><i data-bg="${escapa(a.color)}"></i><span>${escapa(a.nombre)}</span></span></span>
              ${barra(Math.round((m / max) * 100), m ? 'bien' : '')}
            </span>
            <span class="der"><span class="n1 ${m ? '' : 'apag'}">${m ? escapa(duracion(m)) : '—'}</span></span>
          </div>`).join('')}
      </div>
    </div>`;
}

/* ================================= RENDER ================================== */

function render() {
  if (!raiz) return;

  if (!contenido().length) {
    raiz.innerHTML = `
      <div class="vacio">
        <h4>Antes, tus asignaturas</h4>
        <p>Una sesión de estudio se registra en una asignatura y, si quieres, en un tema.</p>
        <button class="boton" data-accion="ir" data-id="asignaturas">Añadir asignaturas</button>
      </div>`;
    return;
  }

  raiz.innerHTML = `
    <div class="seccion-cab"><h2>Estudiar</h2></div>

    ${sesion ? bloqueSesion() : ''}

    ${bloqueCalendario()}

    ${bloqueSemana()}

    ${sesion ? '' : `
      <div class="seccion">
        <div class="seccion-cab"><h2>Sin planificar</h2></div>
        <div class="cal-estado">
          <p class="parrafo chico">¿Te has puesto a estudiar sin tenerlo en el calendario? Cronométralo aquí.</p>
          <button class="boton chico fantasma" data-accion="sesion-nueva">${icono('play')} Cronómetro</button>
        </div>
      </div>`}

    ${bloqueRepasos()}

    ${bloqueTemasFlojos()}

    ${bloqueUltimas()}`;

  pintaEstilos(raiz);
  raiz.querySelectorAll('[data-cal-tema]').forEach(sel => sel.addEventListener('change', () => {
    if (!sel.value) return;
    calendario.asignarTema(sel.dataset.calTema, sel.value);
    aviso(sel.value === 'ninguno' ? 'Sin tema concreto' : 'Apuntado en su tema');
  }));
  raiz.querySelectorAll('[data-cal-asignar]').forEach(sel => sel.addEventListener('change', () => {
    if (!sel.value) return;
    calendario.asignar(sel.dataset.calAsignar, sel.value, true);
    aviso(sel.value === 'no' ? 'No contará como estudio' : 'Apuntado');
  }));
  if (sesion?.corriendo) arrancarReloj();
}

function bloqueTemasFlojos() {
  const l = listaTemas().slice().sort((a, b) => (a.dominio || 0) - (b.dominio || 0)).slice(0, 5);
  if (!l.length) return '';
  return `
    <div class="seccion">
      <div class="seccion-cab"><h2>Donde más flojeas</h2></div>
      <div class="lista">
        ${l.map(t => {
          const a = asignaturaDe(t.asignaturaId);
          return `
            <div class="fila">
              <span class="izq">
                <span class="t1">${escapa(t.nombre)}</span>
                <span class="t2">${a ? escapa(a.nombre) : ''}</span>
              </span>
              <span class="der acciones">
                <button class="boton chico fantasma" data-accion="ir-asignatura" data-id="${escapa(t.asignaturaId)}">Ver</button>
              </span>
            </div>`;
        }).join('')}
      </div>
    </div>`;
}

function bloqueUltimas() {
  const l = motor.listaSesiones().slice().sort((a, b) => (b.creado || 0) - (a.creado || 0)).slice(0, 8);
  if (!l.length) return '';
  return `
    <div class="seccion">
      <div class="seccion-cab"><h2>Últimas sesiones</h2><button class="boton fantasma chico" data-accion="hist-abrir" data-id="">Ver todo el historial</button></div>
      <div class="lista">
        ${l.map(s => {
          const a = asignaturaDe(s.asignaturaId);
          const t = s.temaId ? temaDe(s.temaId) : null;
          return `
            <div class="fila">
              <span class="izq">
                <span class="t1">${escapa(s.origen === 'calendario' ? s.notas : (t?.nombre || a?.nombre || 'Sesión'))}</span>
                <span class="t2">${a ? `<span class="asig"><i data-bg="${escapa(a.color)}"></i><span>${escapa(a.nombre)}</span></span> · ` : ''}${escapa(s.origen === 'calendario' ? 'Calendario' : (TIPOS.find(x => x[0] === s.tipo)?.[1] || ''))} · ${escapa(fechaCorta(s.fecha))}</span>
              </span>
              <span class="der"><span class="n1">${escapa(duracion(s.minutos))}</span></span>
            </div>`;
        }).join('')}
      </div>
    </div>`;
}

/* ============================== HISTORIAL ==================================
   Todas las horas estudiadas, por asignatura, con su tarea y su tema. Lo que no
   se estudió se quita (o se corrige su duración): las horas, el plan y el
   análisis se rehacen solos. Lo que viene del calendario se corrige como una
   decisión suya (sobrevive aunque Google Tasks borre la tarea); lo apuntado a
   mano se edita directamente. */
function abrirHistorial(filtro = '') {
  const todas = motor.listaSesiones().slice().sort((a, b) => (b.fecha + b.creado).toString().localeCompare((a.fecha + a.creado).toString()));
  const asigs = [...new Set(todas.map(s => s.asignaturaId))].map(asignaturaDe).filter(Boolean);
  const lista = filtro ? todas.filter(s => s.asignaturaId === filtro) : todas;
  const total = lista.reduce((t, s) => t + (s.minutos || 0), 0);
  const quitadas = calendario.quitadas();
  hoja({
    titulo: 'Historial de estudio',
    ancha: true,
    cuerpo: `
      <div class="campo">
        <label for="hist-asig">Asignatura</label>
        <select id="hist-asig">
          <option value="">Todas</option>
          ${asigs.map(a => `<option value="${escapa(a.id)}" ${a.id === filtro ? 'selected' : ''}>${escapa(a.nombre)}</option>`).join('')}
        </select>
      </div>
      <p class="pista">${lista.length} sesiones · ${escapa(duracion(total))}. Si algo no lo estudiaste, quítalo o cambia el tiempo.</p>
      <div class="lista">
        ${lista.length ? lista.map(s => {
          const a = asignaturaDe(s.asignaturaId), t = s.temaId ? temaDe(s.temaId) : null;
          const cal = s.origen === 'calendario';
          return `
            <div class="fila">
              <span class="izq">
                <span class="t1">${escapa(cal ? s.notas : (t?.nombre || a?.nombre || 'Sesión'))}</span>
                <span class="t2">${a ? `<span class="asig"><i data-bg="${escapa(a.color)}"></i><span>${escapa(a.nombre)}</span></span> · ` : ''}${t ? escapa(t.nombre) + ' · ' : ''}${escapa(fechaCorta(s.fecha))}</span>
              </span>
              <span class="der">
                <span class="n1">${escapa(duracion(s.minutos))}</span>
                <button class="boton fantasma chico" data-accion="hist-minutos" data-id="${escapa(s.id)}" data-filtro="${escapa(filtro)}">Tiempo</button>
                <button class="boton fantasma chico" data-accion="hist-quitar" data-id="${escapa(s.id)}" data-filtro="${escapa(filtro)}">Quitar</button>
              </span>
            </div>`;
        }).join('') : '<div class="vacio"><p>Sin sesiones.</p></div>'}
      </div>
      ${quitadas.length ? `
        <div class="seccion-cab"><h2>Quitadas</h2><span class="apag">${quitadas.length}</span></div>
        <div class="lista">
          ${quitadas.map(b => `
            <div class="fila">
              <span class="izq"><span class="t1">${escapa(b.titulo)}</span><span class="t2">${escapa(fechaCorta(b.inicio.slice(0, 10)))}</span></span>
              <span class="der"><button class="boton fantasma chico" data-accion="hist-volver" data-id="${escapa(b.id)}" data-filtro="${escapa(filtro)}">Devolver</button></span>
            </div>`).join('')}
        </div>` : ''}`,
    pie: '<button class="boton fantasma" data-accion="cerrar-hoja">Cerrar</button>',
    alAbrir(v) {
      v.querySelector('#hist-asig').addEventListener('change', e => { cerrarHoja(); abrirHistorial(e.target.value); });
    },
  });
}
accion('hist-abrir', d => abrirHistorial(d.id || ''));
const reabre = d => { cerrarHoja(); abrirHistorial(d.filtro || ''); };

accion('hist-quitar', async (d) => {
  const s = motor.listaSesiones().find(x => x.id === d.id);
  if (!s) return;
  if (!await confirmar('No cuenta como estudiado: se quitan esas horas. Puedes devolverlo después.', 'Quitar')) return;
  if (s.origen === 'calendario') calendario.quitarSesion(s.id.replace(/^cal-/, ''));
  else { guardar('sesiones', motor.listaSesiones().filter(x => x.id !== s.id)); emitir('local-cambio'); emitir('datos-cambio', ['sesiones']); }
  reabre(d);
});
accion('hist-volver', d => { calendario.restaurarSesion(d.id); reabre(d); });
accion('hist-minutos', d => {
  const s = motor.listaSesiones().find(x => x.id === d.id);
  if (!s) return;
  cerrarHoja();
  hoja({
    titulo: 'Cuánto estudiaste de verdad',
    cuerpo: `
      <div class="campo">
        <label for="hist-min">Minutos (ahora ${s.minutos})</label>
        <input id="hist-min" type="number" inputmode="numeric" min="1" max="600" value="${s.minutos}">
      </div>`,
    pie: `<button class="boton fantasma" data-accion="hist-cancelar" data-filtro="${escapa(d.filtro || '')}">Cancelar</button>
          <button class="boton" data-accion="hist-minutos-ok" data-id="${escapa(d.id)}" data-filtro="${escapa(d.filtro || '')}">Guardar</button>`,
  });
});
accion('hist-cancelar', reabre);
accion('hist-minutos-ok', (d, el) => {
  const m = Number(el.closest('.hoja').querySelector('#hist-min').value);
  if (!(m >= 1)) return aviso('Pon los minutos', 'mal');
  const s = motor.listaSesiones().find(x => x.id === d.id);
  if (s?.origen === 'calendario') calendario.ajustarMinutos(s.id.replace(/^cal-/, ''), m);
  else if (s) { guardar('sesiones', motor.listaSesiones().map(x => (x.id === s.id ? { ...x, minutos: Math.round(m) } : x))); emitir('local-cambio'); emitir('datos-cambio', ['sesiones']); }
  reabre(d);
});

export default {
  montar(el) {
    raiz = el;
    on('datos-cambio', render);
    on('calendario-cambio', render);
    // Al volver de segundo plano el intervalo pudo estar dormido: se repinta
    // ya con la hora real en vez de esperar al siguiente tic.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') pintarReloj();
    });
  },
  activar(extra) {
    // Lo guardado manda: es lo que hay tras reabrir la app, y tras cambiar de
    // cuenta (store.limpiarDatos lo borra) no queda la sesión de la anterior.
    sesion = recuperar();
    if (!sesion) clearInterval(reloj);
    marcarEnMarcha();
    if (extra?.arrancar && !sesion) {
      empezar({
        asignaturaId: extra.asignaturaId,
        temaId: extra.temaId,
        tipo: extra.tipo || 'teoria',
        minutos: extra.minutos || null,
      });
      return;
    }
    render();
  },
  desactivar() { /* el cronómetro sigue: salir de la pestaña no para la sesión */ },
};
