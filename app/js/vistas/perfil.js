/* ===========================================================================
   PERFIL — cuatro bloques bien separados, porque mezclarlos es lo que hace que
   nadie encuentre nada: PERFIL (quién eres y cómo estudias), CUENTA (acceso),
   CONEXIONES (calendarios y Notion) y DATOS (exportar, importar, borrar).
   =========================================================================== */

import { leer, guardar, exportar, importar, borrarTodo, estadoSync } from '../core/store.js';
import { hoja, cerrarHoja, aviso, confirmar, pintaEstilos, icono, enfocar } from '../core/ui.js';
import { accion, on, emitir } from '../core/bus.js';
import { escapa, hoyLocal, desdeCuando, duracion, inicialesNombre } from '../core/fmt.js';
import * as sesion from '../core/sesion.js';
import * as sync from '../core/sync.js';
import * as motor from '../core/motor.js';

let raiz = null;

const DIAS = [[1, 'Lunes'], [2, 'Martes'], [3, 'Miércoles'], [4, 'Jueves'], [5, 'Viernes'], [6, 'Sábado'], [0, 'Domingo']];
const TEMAS = [['auto', 'Como el sistema'], ['claro', 'Claro'], ['oscuro', 'Oscuro']];

/* --------------------------------- render ---------------------------------- */

function render() {
  if (!raiz) return;
  const u = sesion.usuario();
  const p = motor.perfil();
  const prefs = leer('prefs', {});

  raiz.innerHTML = `
    <div class="seccion-cab"><h2>Perfil</h2></div>

    <div class="tarjeta">
      <div class="fila" >
        <span class="avatar grande">${escapa(inicialesNombre(u?.nombre || u?.email))}</span>
        <span class="izq">
          <span class="t1">${escapa(u?.nombre || '—')}</span>
          <span class="t2">${escapa(u?.email || '')}</span>
        </span>
        <button class="boton chico fantasma" data-accion="perfil-editar">Editar</button>
      </div>
      <div class="parrafo chico" data-mt>
        ${escapa([p.nivel, p.curso].filter(Boolean).join(' · ') || 'Sin curso indicado')}
      </div>
    </div>

    <div class="seccion" data-mt-grande>
      <div class="seccion-cab"><h2>Cómo estudias</h2></div>
      <div class="lista">
        ${DIAS.map(([n, et]) => `
          <div class="fila">
            <span class="izq"><span class="t1">${et}</span></span>
            <span class="der">
              <select data-disp="${n}" aria-label="Minutos disponibles el ${et}">
                ${[0, 30, 60, 90, 120, 150, 180, 240].map(v =>
                  `<option value="${v}" ${Number(p.disponibilidad[n]) === v ? 'selected' : ''}>${v ? duracion(v) : 'Nada'}</option>`).join('')}
              </select>
            </span>
          </div>`).join('')}
      </div>
      <p class="pista">Fuera de clase. Es lo que META reparte al planificar tu día.</p>
    </div>

    <div class="seccion">
      <div class="seccion-cab"><h2>Aspecto</h2></div>
      <div class="segmentos">
        ${TEMAS.map(([v, e]) => `<button data-accion="tema-poner" data-t="${v}" aria-pressed="${(prefs.tema || 'auto') === v}">${e}</button>`).join('')}
      </div>
    </div>

    <div class="seccion">
      <div class="seccion-cab"><h2>Cuenta</h2></div>
      <div class="lista">
        <button class="fila" data-accion="clave-cambiar">
          <span class="izq"><span class="t1">${u?.tieneClave ? 'Cambiar la contraseña' : 'Poner una contraseña'}</span>
            <span class="t2">${u?.tieneClave ? 'Cerrará la sesión en los demás aparatos' : 'Ahora entras solo con Google'}</span></span>
        </button>
        <button class="fila" data-accion="codigo-nuevo">
          <span class="izq"><span class="t1">Nuevo código de recuperación</span>
            <span class="t2">El anterior dejará de valer</span></span>
        </button>
        <button class="fila" data-accion="cerrar-sesion">
          <span class="izq"><span class="t1">Cerrar sesión</span>
            <span class="t2">En este aparato</span></span>
        </button>
      </div>
    </div>

    <div class="seccion">
      <div class="seccion-cab"><h2>Sincronización</h2></div>
      <div class="tarjeta">
        <p class="parrafo chico">Tus datos están en tu cuenta: entra con ella en el móvil o
        en otro ordenador y aparecen ahí solos. Las fotos y PDF de apuntes también, en
        cuanto tengas sesión iniciada en los dos sitios.</p>
        <div class="factor" data-mt>
          <span class="n">Última sincronización</span>
          <span class="v">${escapa(desdeCuando(sync.ultimaVez()))}</span>
        </div>
        <button class="boton fantasma ancho" data-accion="sync-ahora" data-mt>Sincronizar ahora</button>
      </div>
    </div>

    <div class="seccion">
      <div class="seccion-cab"><h2>Conexiones</h2></div>
      <div class="tarjeta"><h3>Google Calendar</h3><div id="bloque-google">${cargandoChico()}</div></div>
      <div class="tarjeta"><h3>Outlook del instituto</h3><div id="bloque-microsoft">${cargandoChico()}</div></div>
      <div class="tarjeta"><h3>Notion</h3><div id="bloque-notion">${cargandoChico()}</div></div>
      <div class="tarjeta"><h3>NotebookLM</h3><div id="bloque-nblm">${cargandoChico()}</div></div>
      <div class="tarjeta">
        <h3>Enlace de calendario</h3>
        <p class="parrafo chico">Suscríbelo en Calendario de Apple, Google Calendar u Outlook a la vez.
        Este enlace es privado: quien lo tenga verá tus tareas y exámenes.</p>
        <div class="campo" data-mt>
          <input type="text" readonly value="${escapa(sync.urlIcs() || '')}" id="ics-url" data-accion="ics-sel">
        </div>
        <button class="boton fantasma ancho" data-accion="ics-copiar">Copiar enlace</button>
      </div>
      <div class="tarjeta">
        <h3>Enlace de carpeta</h3>
        <p class="parrafo chico">Enlaza una carpeta de tu ordenador (por asignatura y
        evaluación) con tus apuntes: lo que pongas en un lado aparece en el otro, solo o casi.</p>
        <button class="boton ancho" data-accion="enlace-carpeta-generar">Generar clave para enlazar</button>
      </div>
    </div>

    <div class="seccion">
      <div class="seccion-cab"><h2>Tus datos</h2></div>
      <div class="lista">
        <button class="fila" data-accion="datos-exportar">
          <span class="izq"><span class="t1">Descargar todo</span>
            <span class="t2">Un archivo con todo lo que tienes en META</span></span>
        </button>
        <button class="fila" data-accion="datos-importar">
          <span class="izq"><span class="t1">Restaurar desde un archivo</span>
            <span class="t2">Sobrescribe lo que haya ahora</span></span>
        </button>
        <button class="fila" data-accion="datos-borrar">
          <span class="izq"><span class="t1 mal">Borrar todos mis datos</span>
            <span class="t2">La cuenta se queda, los datos no</span></span>
        </button>
        <button class="fila" data-accion="cuenta-borrar">
          <span class="izq"><span class="t1 mal">Eliminar la cuenta</span>
            <span class="t2">Cuenta, datos y conexiones. No se puede deshacer</span></span>
        </button>
      </div>
    </div>

    <p class="pista" data-mt-grande>META ${escapa(leer('prefs', {}).version || '')}</p>`;

  pintaEstilos(raiz);

  raiz.querySelectorAll('[data-disp]').forEach(sel => {
    sel.addEventListener('change', () => {
      const p2 = leer('perfil', {});
      const disponibilidad = { ...(p2.disponibilidad || {}), [sel.dataset.disp]: Number(sel.value) };
      guardar('perfil', { ...p2, disponibilidad });
      emitir('local-cambio');
      emitir('datos-cambio', ['perfil']);
      aviso('Disponibilidad guardada');
    });
  });

  cargarGoogle(); cargarMicrosoft(); cargarNotion(); cargarNotebookLM();
}

const cargandoChico = () => '<p class="parrafo chico">Comprobando…</p>';

/* -------------------------------- perfil ----------------------------------- */

accion('perfil-editar', () => {
  const u = sesion.usuario();
  const p = motor.perfil();
  hoja({
    titulo: 'Editar perfil',
    cuerpo: `
      <div class="campo">
        <label for="pf-nombre">Nombre</label>
        <input id="pf-nombre" type="text" value="${escapa(u?.nombre || '')}">
      </div>
      <div class="campos-2">
        <div class="campo">
          <label for="pf-nivel">Nivel</label>
          <select id="pf-nivel">
            ${['2º Bachillerato', '1º Bachillerato', 'ESO', 'Universidad', 'Otro']
              .map(n => `<option ${p.nivel === n ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </div>
        <div class="campo">
          <label for="pf-curso">Centro o curso</label>
          <input id="pf-curso" type="text" value="${escapa(p.curso || '')}">
        </div>
      </div>
      <div class="campo">
        <label for="pf-email">Correo</label>
        <input id="pf-email" type="text" value="${escapa(u?.email || '')}" readonly>
        <div class="pista">El correo identifica tu cuenta y no se puede cambiar desde aquí.</div>
      </div>`,
    pie: `<button class="boton fantasma" data-accion="cerrar-hoja">Cancelar</button>
          <button class="boton" data-accion="perfil-guardar">Guardar</button>`,
    alAbrir(v) { enfocar(v, '#pf-nombre'); },
  });
});

accion('perfil-guardar', async (d, el) => {
  const v = el.closest('.hoja');
  const nombre = v.querySelector('#pf-nombre').value.trim();
  const nivel = v.querySelector('#pf-nivel').value;
  const curso = v.querySelector('#pf-curso').value.trim();
  if (!nombre) return aviso('Ponte un nombre', 'mal');

  guardar('perfil', { ...leer('perfil', {}), nivel, curso });
  emitir('local-cambio');
  el.disabled = true;
  try {
    await sesion.guardarNombre(nombre);
    cerrarHoja();
    render();
    emitir('usuario-cambio');
    aviso('Perfil guardado');
  } catch (e) {
    aviso(e.message || 'No se pudo guardar', 'mal');
  } finally {
    el.disabled = false;
  }
});

accion('tema-poner', d => {
  guardar('prefs', { ...leer('prefs', {}), tema: d.t });
  document.documentElement.setAttribute('data-tema', d.t);
  render();
});

/* -------------------------------- cuenta ----------------------------------- */

accion('clave-cambiar', () => {
  const u = sesion.usuario();
  hoja({
    titulo: u?.tieneClave ? 'Cambiar contraseña' : 'Poner contraseña',
    cuerpo: `
      <div class="error-caja oculto" id="clave-error"></div>
      ${u?.tieneClave ? `
        <div class="campo">
          <label for="cl-actual">Contraseña actual</label>
          <input id="cl-actual" type="password" autocomplete="current-password">
        </div>` : ''}
      <div class="campo">
        <label for="cl-nueva">Contraseña nueva</label>
        <input id="cl-nueva" type="password" autocomplete="new-password">
        <div class="pista">Mínimo 8 caracteres. Se cerrará la sesión en tus otros aparatos.</div>
      </div>`,
    pie: `<button class="boton fantasma" data-accion="cerrar-hoja">Cancelar</button>
          <button class="boton" data-accion="clave-guardar">Guardar</button>`,
    alAbrir(v) { enfocar(v, u?.tieneClave ? '#cl-actual' : '#cl-nueva'); },
  });
});

accion('clave-guardar', async (d, el) => {
  const v = el.closest('.hoja');
  const err = v.querySelector('#clave-error');
  const nueva = v.querySelector('#cl-nueva').value;
  const actual = v.querySelector('#cl-actual')?.value || '';
  if (nueva.length < 8) {
    err.textContent = 'La contraseña necesita al menos 8 caracteres.';
    err.classList.remove('oculto');
    return;
  }
  el.disabled = true;
  try {
    await sesion.cambiarContrasena({ actual, nueva });
    cerrarHoja();
    aviso('Contraseña cambiada');
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('oculto');
  } finally {
    el.disabled = false;
  }
});

accion('codigo-nuevo', async () => {
  if (!await confirmar('Se genera un código nuevo y el anterior deja de valer.', 'Generar', false)) return;
  try {
    const codigo = await sesion.nuevoCodigoRecuperacion();
    hoja({
      titulo: 'Tu nuevo código',
      cuerpo: `
        <p class="parrafo">Guárdalo: es la única forma de recuperar la cuenta si olvidas
        la contraseña, y no se puede volver a ver.</p>
        <div class="codigo-recuperacion">${escapa(codigo)}</div>`,
      pie: `<button class="boton" data-accion="cerrar-hoja">Ya lo he guardado</button>`,
    });
  } catch (e) {
    aviso(e.message || 'No se pudo generar', 'mal');
  }
});

accion('cerrar-sesion', async () => {
  if (!await confirmar('Se cierra la sesión en este aparato. Tus datos siguen en tu cuenta.', 'Cerrar sesión', false)) return;
  await sesion.salir();
  emitir('sesion-fuera');
});

accion('sync-ahora', async (d, el) => {
  el.disabled = true;
  const r = await sync.sincronizar({ forzar: true });
  el.disabled = false;
  render();
  aviso(r === null ? 'No se pudo sincronizar' : r.length ? 'Actualizado' : 'Ya estabas al día',
    r === null ? 'mal' : 'ok');
});

/* ------------------------------- conexiones -------------------------------- */

function fabricaProveedor({ prov, elId, api, boton, cuenta }) {
  async function cargar() {
    const el = document.querySelector(`#${elId}`);
    if (!el) return;
    try {
      const estado = await sesion.pedir(`/api/${api}/estado`);
      el.innerHTML = estado.conectado
        ? `<p class="parrafo chico">Conectado como <b>${escapa(estado.email || cuenta)}</b>.</p>
           <button class="boton fantasma ancho" data-accion="${prov}-desconectar">Desconectar</button>`
        : `<p class="parrafo chico">Conecta ${escapa(cuenta)} y tus exámenes y entregas se meten
           y se actualizan solos ahí.</p>
           <a class="boton ancho" href="/api/${api}/conectar">${escapa(boton)}</a>`;
    } catch {
      el.innerHTML = `<p class="parrafo chico">No se pudo comprobar ahora mismo.</p>
        <button class="boton fantasma ancho" data-accion="${prov}-reintentar">Reintentar</button>`;
    }
  }
  accion(`${prov}-reintentar`, cargar);
  accion(`${prov}-desconectar`, async (d, el) => {
    if (!await confirmar('Se retiran de ahí los exámenes y entregas que metió META, y deja de actualizarlo.', 'Desconectar')) return;
    el.disabled = true;
    try {
      await sesion.pedir(`/api/${api}/desconectar`, { metodo: 'POST' });
      aviso('Desconectado');
    } catch {
      aviso('No se pudo desconectar', 'mal');
    } finally {
      el.disabled = false;
      cargar();
    }
  });
  return cargar;
}

const cargarGoogle = fabricaProveedor({
  prov: 'google', elId: 'bloque-google', api: 'google',
  boton: 'Conectar con Google Calendar', cuenta: 'tu Google Calendar',
});
const cargarMicrosoft = fabricaProveedor({
  prov: 'microsoft', elId: 'bloque-microsoft', api: 'microsoft',
  boton: 'Conectar con Outlook', cuenta: 'tu Outlook del instituto',
});

async function cargarNotion() {
  const el = document.querySelector('#bloque-notion');
  if (!el) return;
  try {
    const estado = await sesion.pedir('/api/notion/estado');
    el.innerHTML = estado.conectado
      ? `<p class="parrafo chico">Conectado · ${escapa(desdeCuando(estado.ultima))}.</p>
         <button class="boton fantasma ancho" data-accion="notion-desconectar">Desconectar</button>`
      : `<p class="parrafo chico">Comparte tu página de Notion con la integración y aquí se
         crean solas las bases de tareas y apuntes, sincronizadas en los dos sentidos.</p>
         <button class="boton ancho" data-accion="notion-conectar">Conectar con Notion</button>`;
  } catch {
    el.innerHTML = '<p class="parrafo chico">Notion no está disponible en este momento.</p>';
  }
}

/* ---------------------------- NotebookLM ------------------------------------
   No hay API de NotebookLM para cuentas personales (solo la de Gemini
   Notebook Enterprise, que va por Google Cloud). Lo que sí existe: desde el 26
   de mayo de 2026, NotebookLM mantiene al día SOLO las fuentes que son
   Documentos de Google. Así que META escribe un documento por asignatura en su
   Drive y él lo añade UNA vez a su cuaderno — a partir de ahí se actualiza
   solo. Ver worker/notebooklm.js. */
async function cargarNotebookLM() {
  const el = document.querySelector('#bloque-nblm');
  if (!el) return;
  try {
    const e = await sesion.pedir('/api/notebooklm/estado');

    if (!e.conectado) {
      el.innerHTML = `<p class="parrafo chico">Un documento por asignatura en tu Drive —con tu
        temario, tus apuntes y tus tarjetas— para añadirlo como fuente en NotebookLM. Se
        actualiza solo cuando apuntas algo aquí.</p>
        <p class="parrafo chico">Hace falta conectar antes tu cuenta de Google, ahí arriba.</p>`;
      return;
    }

    if (e.hayQueReconectar) {
      el.innerHTML = `<p class="parrafo chico">Tu conexión con Google es de antes de esto y no
        tiene permiso para escribir en Drive. Vuelve a conectarla y se pedirá.</p>
        <a class="boton ancho" href="/api/google/conectar">Volver a conectar Google</a>`;
      return;
    }

    const filas = e.asignaturas.map(a => a.url
      ? `<a class="fila" href="${escapa(a.url)}" target="_blank" rel="noopener">
           <span class="izq"><span class="t1">${escapa(a.asignatura)}</span>
           <span class="t2">${a.alDia ? 'Al día' : 'Pendiente de actualizar'} · ${escapa(desdeCuando(a.ultima))}</span></span>
         </a>`
      : `<div class="fila"><span class="izq"><span class="t1">${escapa(a.asignatura)}</span>
           <span class="t2">Todavía sin documento</span></span></div>`).join('');

    el.innerHTML = `<p class="parrafo chico">Un documento por asignatura en tu Drive, con tu
      temario, tus apuntes y tus tarjetas de repaso. Añádelo una vez a un cuaderno de
      NotebookLM (Nuevo cuaderno → Google Drive) y a partir de ahí se actualiza solo:
      es el único tipo de fuente que NotebookLM sigue.</p>
      ${filas ? `<div class="lista" data-mt>${filas}</div>` : `<p class="parrafo chico">
        Cuando tengas temas o apuntes en una asignatura, aparecerá aquí su documento.</p>`}
      ${e.ultimoFallo ? `<p class="parrafo chico mal" data-mt>${escapa(textoFallo(e.ultimoFallo))}</p>` : ''}
      <button class="boton ancho" data-accion="nblm-sincronizar" data-mt>Actualizar ahora</button>`;
  } catch {
    el.innerHTML = `<p class="parrafo chico">No se pudo comprobar ahora mismo.</p>
      <button class="boton fantasma ancho" data-accion="nblm-reintentar">Reintentar</button>`;
  }
}

/* Los fallos de Drive que de verdad pasan son dos, y ninguno se arregla
   reintentando: hay que hacer algo concreto. Decir "error 403" no ayudaría. */
function textoFallo(f) {
  if (f.motivo === 'api-apagada') {
    return 'Falta encender la API de Google Drive en tu proyecto de Google Cloud. Es un interruptor, y tarda un minuto en hacer efecto.';
  }
  if (f.motivo === 'reconectar') return 'Vuelve a conectar Google para dar permiso de Drive.';
  if (f.motivo === 'espera') return 'Google está limitando las peticiones. Se reintenta solo más tarde.';
  return f.detalle || 'No se pudo escribir en Drive.';
}

accion('nblm-reintentar', cargarNotebookLM);

accion('nblm-sincronizar', async (d, el) => {
  el.disabled = true;
  el.textContent = 'Actualizando…';
  try {
    const r = await sesion.pedir('/api/notebooklm/sincronizar', { metodo: 'POST' });
    const n = r.actualizados?.length || 0;
    aviso(n ? `${n} documento${n === 1 ? '' : 's'} al día` : 'Ya estaba todo al día');
  } catch (err) {
    aviso(err?.message || 'No se pudo actualizar', 'mal');
  } finally {
    el.disabled = false;
    cargarNotebookLM();
  }
});

accion('notion-conectar', async (d, el) => {
  el.disabled = true;
  try {
    await sesion.pedir('/api/notion/conectar', { metodo: 'POST' });
    aviso('Conectado con Notion');
  } catch {
    aviso('Comparte antes la página "Meta" con la integración', 'mal');
  } finally {
    el.disabled = false;
    cargarNotion();
  }
});

accion('notion-desconectar', async (d, el) => {
  if (!await confirmar('Deja de sincronizar con Notion. Lo que ya haya allí se queda.', 'Desconectar')) return;
  el.disabled = true;
  try { await sesion.pedir('/api/notion/desconectar', { metodo: 'POST' }); aviso('Desconectado'); }
  finally { el.disabled = false; cargarNotion(); }
});

accion('enlace-carpeta-generar', async (d, el) => {
  el.disabled = true;
  try {
    const { token } = await sesion.pedir('/api/auth/token-aparato', { metodo: 'POST' });
    hoja({
      titulo: 'Enlazar tu carpeta',
      cuerpo: `
        <p class="parrafo">Copia esta clave y, en la Terminal de tu Mac, ejecuta el
        instalador con ella. Solo se enseña una vez.</p>
        <div class="codigo-recuperacion">${escapa(token)}</div>
        <p class="parrafo chico" data-mt>
          <code>cd ~/Documents/Playground/meta && ./tools/instala-enlace.sh ${escapa(token)}</code>
        </p>
        <p class="pista">Cambiar tu contraseña invalida esta clave: si eso pasa, genera otra
        aquí y vuelve a ejecutar el instalador.</p>`,
      pie: `<button class="boton" data-accion="cerrar-hoja">Ya lo he copiado</button>`,
    });
  } catch (e) {
    aviso(e.message || 'No se pudo generar', 'mal');
  } finally {
    el.disabled = false;
  }
});

accion('ics-sel', (d, el) => el.select());

accion('ics-copiar', async () => {
  const url = sync.urlIcs();
  if (!url) return;
  try { await navigator.clipboard.writeText(url); aviso('Enlace copiado'); }
  catch { document.querySelector('#ics-url')?.select(); aviso('Selecciónalo y cópialo a mano'); }
});

/* --------------------------------- datos ----------------------------------- */

accion('datos-exportar', () => {
  const copia = exportar();
  const texto = JSON.stringify(copia, null, 1);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([texto], { type: 'application/json' }));
  a.download = `meta-${hoyLocal()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  aviso('Descargado');
});

accion('datos-importar', () => {
  hoja({
    titulo: 'Restaurar datos',
    cuerpo: `
      <p class="parrafo">Sobrescribe lo que tengas ahora en esta cuenta con lo del archivo.
      No incluye las fotos ni los PDF de apuntes.</p>
      <div class="campo" data-mt-grande>
        <input id="restaurar-archivo" type="file" accept="application/json,.json">
      </div>`,
    alAbrir(v) {
      v.querySelector('#restaurar-archivo').addEventListener('change', async ev => {
        const f = ev.target.files?.[0];
        if (!f) return;
        try {
          const datos = JSON.parse(await f.text());
          if (!await confirmar('Esto sobrescribe tus datos actuales. ¿Seguimos?', 'Restaurar')) return;
          const n = importar(datos);
          cerrarHoja();
          aviso(`Restauradas ${n} secciones`);
          await sync.sincronizar({ forzar: true });
          setTimeout(() => location.reload(), 700);
        } catch {
          aviso('Ese archivo no vale', 'mal');
        }
      });
    },
  });
});

accion('datos-borrar', async () => {
  if (!await confirmar('Se borra TODO lo que tienes en META: asignaturas, horario, temas, tareas, exámenes, notas, sesiones y apuntes. La cuenta se queda. No se puede deshacer.', 'Borrar todo')) return;
  borrarTodo();
  await sync.sincronizar({ forzar: true }).catch(() => {});
  aviso('Datos borrados');
  setTimeout(() => location.reload(), 700);
});

accion('cuenta-borrar', async () => {
  if (!await confirmar('Se elimina tu cuenta, todos tus datos y las conexiones con Google, Outlook y Notion. No se puede deshacer.', 'Eliminar la cuenta')) return;
  try {
    await sesion.borrarCuenta();
    borrarTodo();
    aviso('Cuenta eliminada');
    setTimeout(() => location.reload(), 800);
  } catch (e) {
    aviso(e.message || 'No se pudo eliminar', 'mal');
  }
});

export default {
  montar(el) {
    raiz = el;
    render();
    on('datos-cambio', render);
    on('usuario-cambio', render);
  },
  activar() { render(); },
};
