/* ===========================================================================
   ESTUDIAR — sesiones, repaso, flashcards y tests.

   Todo lo que pasa aquí ALIMENTA al resto: cada sesión suma horas, cada
   repaso y cada test mueven el dominio del tema, y ese dominio es lo que hace
   subir o bajar la preparación de un examen y el estado académico. Si esto
   fuera un cronómetro suelto no serviría de nada.
   =========================================================================== */

import { leer, guardar } from '../core/store.js';
import { hoja, cerrarHoja, aviso, confirmar, pintaEstilos, icono, barra, enfocar } from '../core/ui.js';
import { accion, on, emitir } from '../core/bus.js';
import { escapa, hoyLocal, duracion, diasHasta, sumaDias } from '../core/fmt.js';
import { listaAsignaturas, asignaturaDe } from '../core/asignaturas.js';
import { listaTemas, temaDe, temasDe, registrarRepaso, ajustarDominio, tocaRepasar } from '../core/temas.js';
import * as motor from '../core/motor.js';
import * as ia from '../core/ia.js';

const nuevoId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const TIPOS = [
  ['teoria', 'Teoría'], ['ejercicios', 'Ejercicios'], ['repaso', 'Repaso'],
  ['flashcards', 'Flashcards'], ['test', 'Test'], ['simulacro', 'Simulacro'],
];

let raiz = null;
let sesion = null;      // {asignaturaId, temaId, tipo, objetivo, inicio, transcurrido, corriendo}
let reloj = null;

const claseDe = p => (p >= 75 ? 'bien' : p >= 45 ? 'ojo' : 'mal');

/* ============================== CRONÓMETRO ================================= */

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
    ${sesion.tipo === 'flashcards' && sesion.temaId ? `
      <div class="acciones" data-mt-grande>
        <button class="boton fantasma ancho" data-accion="flash-abrir" data-tema="${escapa(sesion.temaId)}">Abrir flashcards de este tema</button>
      </div>` : ''}
    ${(sesion.tipo === 'test' || sesion.tipo === 'simulacro') && sesion.temaId ? `
      <div class="acciones" data-mt-grande>
        <button class="boton fantasma ancho" data-accion="test-abrir" data-tema="${escapa(sesion.temaId)}">Hacer un test de este tema</button>
      </div>` : ''}`;
}

accion('sesion-pausa', () => {
  if (sesion.corriendo) {
    sesion.transcurrido = segundosSesion();
    sesion.corriendo = false;
    clearInterval(reloj);
  } else {
    sesion.desde = Date.now();
    sesion.corriendo = true;
    arrancarReloj();
  }
  render();
});

function empezar({ asignaturaId, temaId, tipo = 'teoria', minutos = null }) {
  sesion = {
    asignaturaId: asignaturaId || temaDe(temaId)?.asignaturaId || listaAsignaturas()[0]?.id || null,
    temaId: temaId || null,
    tipo,
    objetivo: minutos,
    transcurrido: 0,
    desde: Date.now(),
    corriendo: true,
  };
  arrancarReloj();
  render();
}

accion('sesion-terminar', () => {
  const segundos = segundosSesion();
  const minutos = Math.max(1, Math.round(segundos / 60));
  clearInterval(reloj);
  sesion.corriendo = false;

  const t = sesion.temaId ? temaDe(sesion.temaId) : null;
  hoja({
    titulo: 'Cerrar la sesión',
    cuerpo: `
      <div class="factor">
        <span class="n">Tiempo</span>
        <span class="v">${escapa(duracion(minutos))}</span>
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
      <button class="boton" data-accion="sesion-guardar" data-min="${minutos}">Guardar sesión</button>`,
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
  const minutos = Number(d.min);

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
  emitir('datos-cambio', ['sesiones']);
  sesion = null;
  clearInterval(reloj);
  cerrarHoja();
  render();
  aviso(`${duracion(minutos)} registrados`);
});

accion('sesion-tirar', async () => {
  if (!await confirmar('Se descarta esta sesión y no queda registrada.', 'Descartar')) return;
  sesion = null;
  clearInterval(reloj);
  cerrarHoja();
  render();
});

/* ============================ EMPEZAR UNA SESIÓN =========================== */

function nuevaSesion() {
  const asignaturas = listaAsignaturas();
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
      <p class="parrafo">Repásalo con tus apuntes o tus flashcards y luego dinos qué tal.
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

/* =============================== FLASHCARDS ================================ */

const listaFlash = () => leer('flashcards', []);

function guardarFlash(l) {
  guardar('flashcards', l);
  emitir('local-cambio');
  emitir('datos-cambio', ['flashcards']);
}

const flashDe = temaId => listaFlash().filter(f => f.temaId === temaId);

/** Tarjetas que tocan hoy (caja 1 = todos los días, caja 4 = cada 2 semanas). */
const DIAS_CAJA = [1, 2, 4, 8, 15];
const flashPendientes = temaId =>
  flashDe(temaId).filter(f => !f.proximo || f.proximo <= hoyLocal());

accion('flash-abrir', d => abrirFlash(d.tema));

let mazo = [], indice = 0, volteada = false;

function abrirFlash(temaId) {
  const t = temaDe(temaId);
  if (!t) return;
  mazo = flashPendientes(temaId);
  indice = 0; volteada = false;

  if (!mazo.length) {
    const total = flashDe(temaId).length;
    return hoja({
      titulo: `Flashcards · ${t.nombre}`,
      cuerpo: total
        ? `<p class="parrafo">Hoy no toca ninguna: las ${total} tarjetas de este tema
           están al día. Vuelve cuando toque, o crea más.</p>`
        : `<p class="parrafo">Este tema todavía no tiene tarjetas.</p>`,
      pie: `<button class="boton fantasma" data-accion="flash-nueva" data-tema="${escapa(temaId)}">Crear a mano</button>
            <button class="boton" data-accion="flash-generar" data-tema="${escapa(temaId)}">${icono('chispa')} Generar con META AI</button>`,
    });
  }
  pintarFlash(t);
}

function pintarFlash(t) {
  const f = mazo[indice];
  if (!f) {
    return hoja({
      titulo: 'Tanda terminada',
      cuerpo: `<p class="parrafo">Has repasado ${mazo.length} tarjetas de "${escapa(t.nombre)}".</p>`,
      pie: `<button class="boton" data-accion="cerrar-hoja">Cerrar</button>`,
    });
  }
  hoja({
    titulo: `${t.nombre} · ${indice + 1}/${mazo.length}`,
    cuerpo: `
      <button class="tarjeta-flash" data-accion="flash-voltear">
        <span class="lado">${volteada ? 'Respuesta' : 'Pregunta'}</span>
        <span class="cara">${escapa(volteada ? f.reverso : f.anverso)}</span>
        ${!volteada ? '<span class="pista" data-mt-grande>Toca para ver la respuesta</span>' : ''}
      </button>`,
    pie: volteada ? `
      <button class="boton fantasma" data-accion="flash-res" data-r="mal">Fallé</button>
      <button class="boton fantasma" data-accion="flash-res" data-r="regular">Dudé</button>
      <button class="boton" data-accion="flash-res" data-r="bien">La sabía</button>`
      : `<button class="boton ancho" data-accion="flash-voltear">Ver respuesta</button>`,
  });
}

accion('flash-voltear', () => {
  if (!mazo[indice]) return;
  volteada = !volteada;
  pintarFlash(temaDe(mazo[indice].temaId));
});

accion('flash-res', d => {
  const f = mazo[indice];
  if (!f) return;
  const caja = d.r === 'bien' ? Math.min(DIAS_CAJA.length - 1, (f.caja || 0) + 1)
    : d.r === 'regular' ? (f.caja || 0)
    : 0;
  guardarFlash(listaFlash().map(x => x.id === f.id
    ? { ...x, caja, proximo: sumaDias(hoyLocal(), DIAS_CAJA[caja]), visto: Date.now() } : x));

  indice++;
  volteada = false;
  const t = temaDe(f.temaId);
  // Una tanda completa de flashcards también mueve el dominio del tema.
  if (indice >= mazo.length && t) {
    const aciertos = 1;
    ajustarDominio(t.id, d.r === 'bien' ? 85 : d.r === 'regular' ? 60 : 35, 0.15 * aciertos);
  }
  pintarFlash(t);
});

accion('flash-nueva', d => {
  const t = temaDe(d.tema);
  hoja({
    titulo: 'Nueva tarjeta',
    cuerpo: `
      <div class="campo">
        <label for="fl-a">Pregunta</label>
        <textarea id="fl-a" placeholder="¿Qué es una derivada?"></textarea>
      </div>
      <div class="campo">
        <label for="fl-b">Respuesta</label>
        <textarea id="fl-b"></textarea>
      </div>
      <div class="pista">Tema: ${escapa(t?.nombre || '')}</div>`,
    pie: `<button class="boton fantasma" data-accion="cerrar-hoja">Cancelar</button>
          <button class="boton" data-accion="flash-guardar" data-tema="${escapa(d.tema)}">Guardar</button>`,
    alAbrir(v) { enfocar(v, '#fl-a'); },
  });
});

accion('flash-guardar', (d, el) => {
  const v = el.closest('.hoja');
  const anverso = v.querySelector('#fl-a').value.trim();
  const reverso = v.querySelector('#fl-b').value.trim();
  if (!anverso || !reverso) return aviso('Rellena las dos caras', 'mal');
  guardarFlash([...listaFlash(), {
    id: nuevoId('f'), temaId: d.tema, anverso, reverso, caja: 0, proximo: hoyLocal(), creado: Date.now(),
  }]);
  cerrarHoja();
  render();
  aviso('Tarjeta creada');
});

/* --------------------- generación con META AI (de verdad) ------------------
   Se le pide al modelo un formato de líneas, no JSON: los modelos abiertos
   devuelven JSON roto con facilidad, y una línea "P: … || R: …" se parsea sin
   ambigüedad. Si no sale nada aprovechable se dice, no se inventa. */

function parseaTarjetas(texto) {
  return String(texto || '').split('\n')
    .map(l => l.trim())
    .filter(l => /\|\|/.test(l))
    .map(l => {
      const [a, b] = l.split('||');
      return {
        anverso: a.replace(/^[-*\d.\s]*P\s*:?\s*/i, '').trim(),
        reverso: b.replace(/^\s*R\s*:?\s*/i, '').trim(),
      };
    })
    .filter(x => x.anverso.length > 3 && x.reverso.length > 1)
    .slice(0, 12);
}

accion('flash-generar', async (d, el) => {
  const t = temaDe(d.tema);
  if (!t) return;
  el.disabled = true;
  const a = asignaturaDe(t.asignaturaId);
  try {
    const r = await ia.preguntar({
      pregunta: `Crea 8 tarjetas de repaso sobre "${t.nombre}"${a ? ` de ${a.nombre}` : ''}, ` +
        `nivel Bachillerato. UNA POR LÍNEA y exactamente con este formato, sin nada más:\n` +
        `P: pregunta || R: respuesta breve`,
      texto: textoDeApuntes(t),
    });
    const tarjetas = parseaTarjetas(r.texto);
    if (!tarjetas.length) throw new Error('formato');
    guardarFlash([...listaFlash(), ...tarjetas.map(x => ({
      id: nuevoId('f'), temaId: t.id, ...x, caja: 0, proximo: hoyLocal(), creado: Date.now(), origen: 'ia',
    }))]);
    cerrarHoja();
    render();
    aviso(`${tarjetas.length} tarjetas creadas con META AI`);
  } catch (e) {
    aviso(e.message === 'formato'
      ? 'La IA no ha devuelto tarjetas usables. Prueba otra vez o créalas a mano.'
      : (e.message || 'La IA no ha podido responder'), 'mal');
  } finally {
    el.disabled = false;
  }
});

/** Texto de los apuntes de ese tema, si los hay: es lo que hace que la IA
    genere sobre TU temario y no sobre el tema en abstracto. */
function textoDeApuntes(tema) {
  const apuntes = leer('apuntesMeta', [])
    .filter(a => a.tipo === 'texto' && (a.temaId === tema.id ||
      (a.asignaturaId === tema.asignaturaId && a.titulo?.toLowerCase().includes(tema.nombre.toLowerCase()))))
    .map(a => a.texto || '')
    .join('\n\n');
  return apuntes.slice(0, 3500) || null;
}

/* ================================= TESTS =================================== */

const listaTests = () => leer('tests', []);

function parseaPreguntas(texto) {
  const bloques = String(texto || '').split('\n').map(l => l.trim()).filter(l => /\|\|/.test(l));
  return bloques.map(l => {
    const partes = l.split('||').map(x => x.trim());
    const enunciado = partes[0].replace(/^[-*\d.\s]*P\s*:?\s*/i, '').trim();
    const opciones = partes.slice(1, 5).map(x => x.replace(/^[A-D][).]\s*/i, '').trim());
    const okRaw = partes.find(x => /^OK\s*:/i.test(x));
    const letra = okRaw ? okRaw.split(':')[1].trim().toUpperCase()[0] : null;
    const correcta = letra ? 'ABCD'.indexOf(letra) : -1;
    return { enunciado, opciones: opciones.filter(o => o && !/^OK\s*:/i.test(o)), correcta };
  }).filter(p => p.enunciado.length > 5 && p.opciones.length >= 3 && p.correcta >= 0 && p.correcta < p.opciones.length)
    .slice(0, 10);
}

let test = null;   // {temaId, preguntas, respuestas, i}

accion('test-abrir', async (d, el) => {
  const t = temaDe(d.tema);
  if (!t) return;
  if (el) el.disabled = true;
  const a = asignaturaDe(t.asignaturaId);
  hoja({ titulo: 'Preparando el test', cuerpo: '<div class="cargando"><div class="giro"></div></div>' });
  try {
    const r = await ia.preguntar({
      pregunta: `Escribe 6 preguntas tipo test sobre "${t.nombre}"${a ? ` de ${a.nombre}` : ''}, ` +
        `nivel Bachillerato, con 4 opciones cada una. UNA POR LÍNEA y exactamente así, sin nada más:\n` +
        `P: enunciado || A) opción || B) opción || C) opción || D) opción || OK: B`,
      texto: textoDeApuntes(t),
    });
    const preguntas = parseaPreguntas(r.texto);
    if (!preguntas.length) throw new Error('formato');
    test = { temaId: t.id, preguntas, respuestas: [], i: 0 };
    pintarTest();
  } catch (e) {
    hoja({
      titulo: 'No ha salido',
      cuerpo: `<p class="parrafo">${escapa(e.message === 'formato'
        ? 'La IA no ha devuelto preguntas usables esta vez. Puedes volver a intentarlo.'
        : (e.message || 'La IA no ha podido responder ahora mismo.'))}</p>`,
      pie: `<button class="boton fantasma" data-accion="cerrar-hoja">Cerrar</button>
            <button class="boton" data-accion="test-abrir" data-tema="${escapa(d.tema)}">Reintentar</button>`,
    });
  } finally {
    if (el) el.disabled = false;
  }
});

function pintarTest() {
  const p = test.preguntas[test.i];
  if (!p) return cerrarTest();
  const respondida = test.respuestas[test.i] != null;
  hoja({
    titulo: `Test · ${test.i + 1}/${test.preguntas.length}`,
    cuerpo: `
      <p class="parrafo"><b>${escapa(p.enunciado)}</b></p>
      <div data-mt-grande>
        ${p.opciones.map((o, i) => {
          let clase = '';
          if (respondida) {
            if (i === p.correcta) clase = 'bien';
            else if (i === test.respuestas[test.i]) clase = 'mal';
          }
          return `<button class="opcion-test ${clase}" data-accion="test-responder" data-i="${i}">
            ${'ABCD'[i]}. ${escapa(o)}</button>`;
        }).join('')}
      </div>`,
    pie: respondida
      ? `<button class="boton ancho" data-accion="test-siguiente">${test.i + 1 < test.preguntas.length ? 'Siguiente' : 'Ver resultado'}</button>`
      : `<button class="boton fantasma" data-accion="cerrar-hoja">Dejarlo</button>`,
  });
}

accion('test-responder', d => {
  // Sin test en curso (la hoja de resultado ya cerró la sesión, o quedó un
  // clic en cola de un botón ya retirado del DOM): no hay nada que anotar.
  if (!test || test.respuestas[test.i] != null) return;
  test.respuestas[test.i] = Number(d.i);
  pintarTest();
});

accion('test-siguiente', () => { if (!test) return; test.i++; pintarTest(); });

function cerrarTest() {
  const aciertos = test.respuestas.filter((r, i) => r === test.preguntas[i].correcta).length;
  const total = test.preguntas.length;
  const porcentaje = Math.round((aciertos / total) * 100);

  guardar('tests', [...listaTests(), {
    id: nuevoId('q'), temaId: test.temaId, fecha: hoyLocal(),
    aciertos, total, creado: Date.now(),
  }]);
  // Un test es la señal más fiable de si te lo sabes: pesa más que una sesión.
  ajustarDominio(test.temaId, porcentaje, 0.5);
  emitir('local-cambio');
  emitir('datos-cambio', ['tests']);

  const t = temaDe(test.temaId);
  hoja({
    titulo: 'Resultado',
    cuerpo: `
      <div class="metrica">
        <div class="v">${aciertos} / ${total}</div>
        <div class="e">${porcentaje}% de aciertos</div>
      </div>
      <p class="parrafo" data-mt-grande>El dominio de "${escapa(t?.nombre || '')}" pasa a
      ${temaDe(test.temaId)?.dominio || 0}%.</p>`,
    pie: `<button class="boton" data-accion="cerrar-hoja">Hecho</button>`,
  });
  test = null;
  render();
}

/* ================================= RENDER ================================== */

function render() {
  if (!raiz) return;

  if (!listaAsignaturas().length) {
    raiz.innerHTML = `
      <div class="vacio">
        <h4>Antes, tus asignaturas</h4>
        <p>Una sesión de estudio se registra en una asignatura y, si quieres, en un tema.</p>
        <button class="boton" data-accion="ir" data-id="asignaturas">Añadir asignaturas</button>
      </div>`;
    return;
  }

  const hoy = hoyLocal();
  const minutosHoy = motor.minutosDe(hoy);
  const libres = motor.minutosLibresHoy();
  const racha = motor.diasConEstudio(7);

  raiz.innerHTML = `
    <div class="seccion-cab"><h2>Estudiar</h2></div>

    ${sesion ? bloqueSesion() : `
      <div class="rejilla3">
        <div class="metrica"><div class="v">${escapa(duracion(minutosHoy))}</div><div class="e">Hoy</div></div>
        <div class="metrica"><div class="v">${escapa(duracion(libres))}</div><div class="e">Te quedan</div></div>
        <div class="metrica"><div class="v">${racha}/7</div><div class="e">Días esta semana</div></div>
      </div>
      <div class="acciones" data-mt-grande>
        <button class="boton" data-accion="sesion-nueva">${icono('play')} Empezar una sesión</button>
      </div>`}

    ${bloqueRepasos()}

    ${bloqueTemasFlojos()}

    ${bloqueUltimas()}`;

  pintaEstilos(raiz);
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
                <button class="boton chico sutil" data-accion="flash-abrir" data-tema="${escapa(t.id)}">Flashcards</button>
                <button class="boton chico fantasma" data-accion="test-abrir" data-tema="${escapa(t.id)}">Test</button>
              </span>
            </div>`;
        }).join('')}
      </div>
    </div>`;
}

function bloqueUltimas() {
  const l = motor.listaSesiones().slice().sort((a, b) => (b.creado || 0) - (a.creado || 0)).slice(0, 6);
  if (!l.length) return '';
  return `
    <div class="seccion">
      <div class="seccion-cab"><h2>Últimas sesiones</h2></div>
      <div class="lista">
        ${l.map(s => {
          const a = asignaturaDe(s.asignaturaId);
          const t = s.temaId ? temaDe(s.temaId) : null;
          return `
            <div class="fila">
              <span class="izq">
                <span class="t1">${escapa(t?.nombre || a?.nombre || 'Sesión')}</span>
                <span class="t2">${escapa(TIPOS.find(x => x[0] === s.tipo)?.[1] || '')} · ${escapa(s.fecha)}</span>
              </span>
              <span class="der"><span class="n1">${escapa(duracion(s.minutos))}</span></span>
            </div>`;
        }).join('')}
      </div>
    </div>`;
}

export default {
  montar(el) {
    raiz = el;
    render();
    on('datos-cambio', render);
  },
  activar(extra) {
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
