/* ===========================================================================
   ACCESO — registro, entrar, recuperar contraseña y primeros pasos.

   Es la primera pantalla que ve alguien, así que no puede parecer un
   formulario pegado a la app: la mitad izquierda es la entrada y la derecha
   (solo en pantallas anchas) enseña META de verdad, dibujado con los mismos
   componentes que el producto — así nunca queda desfasada.
   =========================================================================== */

import * as sesion from '../core/sesion.js';
import { accion, emitir } from '../core/bus.js';
import { aviso, pintaEstilos, icono } from '../core/ui.js';
import { escapa, fechaLarga, hoyLocal, inicialesNombre } from '../core/fmt.js';
import { leer, guardar, estadoSync } from '../core/store.js';
import { listaAsignaturas, siguienteColor, nuevoId } from '../core/asignaturas.js';

const raiz = () => document.getElementById('acceso-caja');

/* Mismo alfabeto y mismo formato que usaba la sincronización por código. */
const normalizaCodigo = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
const conGuion = c => (c && c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c || '');

let modo = 'entrar';
let datosRegistro = null;     // guarda el código de recuperación entre pantallas
let paso = 0;

/* ------------------------------ piezas comunes ----------------------------- */

const MARCA = '<div class="marca"><i></i>Meta</div>';

const botonGoogle = texto => `
  <a class="boton google ancho" href="${sesion.urlGoogle(true)}">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M21.6 12.2c0-.6-.1-1.3-.2-1.9H12v3.6h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.2z"/>
      <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.7-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"/>
      <path fill="#FBBC05" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2z"/>
      <path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.8-2.8C16.9 2.9 14.7 2 12 2a10 10 0 0 0-8.9 5.4L6.4 10c.8-2.4 3-4.1 5.6-4.1z"/>
    </svg>
    ${escapa(texto)}
  </a>`;

const campoContrasena = (id, etiqueta, autocomplete) => `
  <div class="campo">
    <label for="${id}">${escapa(etiqueta)}</label>
    <div class="con-boton">
      <input id="${id}" type="password" autocomplete="${autocomplete}" spellcheck="false">
      <button type="button" class="ver" data-accion="ver-clave" data-id="${id}" aria-label="Mostrar contraseña">
        ${icono('ojo')}
      </button>
    </div>
  </div>`;

function error(texto) {
  const el = raiz().querySelector('#acceso-error');
  if (el) { el.textContent = texto; el.classList.toggle('oculto', !texto); }
}

/* --------------------------------- entrar ---------------------------------- */

function pantallaEntrar() {
  return `
    ${MARCA}
    <h1>Bienvenido de vuelta</h1>
    <p class="acceso-lema">Sigue donde lo dejaste.</p>

    <div class="error-caja oculto" id="acceso-error"></div>

    ${botonGoogle('Continuar con Google')}
    <div class="separador">o</div>

    <div class="campo">
      <label for="ac-email">Correo</label>
      <input id="ac-email" type="email" autocomplete="username" inputmode="email" spellcheck="false">
    </div>
    ${campoContrasena('ac-clave', 'Contraseña', 'current-password')}

    <label class="check"><input type="checkbox" id="ac-recordar" checked> Mantener la sesión abierta</label>

    <button class="boton ancho" data-accion="ac-entrar" data-mt>Entrar</button>

    <div class="acceso-pie">
      ¿No tienes cuenta? <button data-accion="ac-modo" data-m="registro">Crear una</button><br>
      <button data-accion="ac-modo" data-m="recuperar">He olvidado la contraseña</button>
    </div>`;
}

/* -------------------------------- registro --------------------------------- */

function pantallaRegistro() {
  // Si este aparato ya tenía datos de la versión sin cuentas, se ofrece
  // traerlos en vez de dejarlos ahí muertos.
  const heredado = leer('sync', {}).codigo || null;
  return `
    ${MARCA}
    <h1>Tu espacio académico</h1>
    <p class="acceso-lema"><b>Organiza. Estudia. Avanza.</b>
      Todo tu curso en un sitio que sabe qué toca ahora.</p>

    <div class="error-caja oculto" id="acceso-error"></div>

    ${botonGoogle('Continuar con Google')}
    <div class="separador">o</div>

    <div class="campo">
      <label for="ac-nombre">Cómo te llamas</label>
      <input id="ac-nombre" type="text" autocomplete="given-name" spellcheck="false">
    </div>
    <div class="campo">
      <label for="ac-email">Correo</label>
      <input id="ac-email" type="email" autocomplete="username" inputmode="email" spellcheck="false">
    </div>
    ${campoContrasena('ac-clave', 'Contraseña', 'new-password')}
    <div class="pista">Mínimo 8 caracteres. No sale de tu navegador: se cifra aquí antes de enviarse.</div>

    ${heredado ? `
      <label class="check" data-mt><input type="checkbox" id="ac-importar" checked>
        Traer los datos que ya hay en este aparato (${escapa(conGuion(heredado))})</label>`
    : `
      <div class="campo" data-mt>
        <label for="ac-codigo-viejo">¿Ya usabas Meta sin cuenta? (opcional)</label>
        <input id="ac-codigo-viejo" type="text" placeholder="ABCD-EFGH" maxlength="9"
               autocomplete="off" spellcheck="false" autocapitalize="characters">
        <div class="pista">El código de sincronización que salía en Ajustes. Trae tus
        asignaturas, horario, tareas y apuntes a esta cuenta.</div>
      </div>`}

    <button class="boton ancho" data-accion="ac-registrar" data-mt>Crear cuenta</button>

    <div class="acceso-pie">
      ¿Ya tienes cuenta? <button data-accion="ac-modo" data-m="entrar">Iniciar sesión</button>
    </div>`;
}

/* ------------------------------- recuperar --------------------------------- */

function pantallaRecuperar() {
  return `
    ${MARCA}
    <h1>Recuperar el acceso</h1>
    <p class="acceso-lema">Con el código de recuperación que guardaste al crear la cuenta.</p>

    <div class="error-caja oculto" id="acceso-error"></div>

    <div class="campo">
      <label for="ac-email">Correo</label>
      <input id="ac-email" type="email" autocomplete="username" inputmode="email" spellcheck="false">
    </div>
    <div class="campo">
      <label for="ac-codigo">Código de recuperación</label>
      <input id="ac-codigo" type="text" autocomplete="off" spellcheck="false"
             placeholder="XXXX-XXXX-XXXX-XXXX" autocapitalize="characters">
    </div>
    ${campoContrasena('ac-clave', 'Contraseña nueva', 'new-password')}

    <button class="boton ancho" data-accion="ac-recuperar" data-mt>Cambiar la contraseña</button>

    <div class="acceso-pie">
      ¿No lo tienes? Si entraste alguna vez con Google, usa
      <button data-accion="ac-modo" data-m="entrar">ese botón</button> para volver a entrar.
    </div>`;
}

/* ---------------------- código de recuperación (una vez) -------------------- */

function pantallaCodigo() {
  return `
    ${MARCA}
    <h1>Guarda esto</h1>
    <p class="acceso-lema">Es la única forma de recuperar tu cuenta si olvidas la
      contraseña. No se puede volver a ver.</p>

    <div class="codigo-recuperacion" id="codigo-rec">${escapa(datosRegistro?.codigoRecuperacion || '')}</div>

    <div class="acciones" data-mt>
      <button class="boton fantasma" data-accion="ac-copiar-codigo">Copiar</button>
      <button class="boton fantasma" data-accion="ac-bajar-codigo">Descargar</button>
    </div>

    <label class="check" data-mt-grande>
      <input type="checkbox" id="ac-guardado"> Lo he guardado en un sitio seguro
    </label>

    <button class="boton ancho" data-accion="ac-sigue-onboarding" data-mt>Continuar</button>`;
}

/* -------------------------------- onboarding -------------------------------
   Cuatro pasos y ninguno obligatorio salvo el primero. El objetivo no es
   rellenar una ficha: es que la pantalla "Hoy" tenga algo que enseñar. */

const SUGERENCIAS = {
  '2º Bachillerato': ['Lengua y Literatura', 'Inglés', 'Matemáticas', 'Historia de España',
    'Historia de la Filosofía', 'Historia del Arte', 'Economía', 'Física', 'Química', 'Biología', 'Latín', 'Dibujo Técnico'],
  '1º Bachillerato': ['Lengua y Literatura', 'Inglés', 'Matemáticas', 'Filosofía',
    'Historia del Mundo Contemporáneo', 'Física y Química', 'Biología y Geología', 'Economía', 'Latín'],
  ESO: ['Lengua', 'Matemáticas', 'Inglés', 'Biología y Geología', 'Física y Química',
    'Geografía e Historia', 'Educación Física', 'Tecnología'],
  Universidad: [],
};

const PASOS_TOTAL = 4;

function barraPasos() {
  return `<div class="pasos">${Array.from({ length: PASOS_TOTAL },
    (_, i) => `<i class="${i <= paso ? 'on' : ''}"></i>`).join('')}</div>`;
}

function pantallaOnboarding() {
  const p = { ...leer('perfil', {}) };
  if (paso === 0) {
    return `
      ${barraPasos()}
      <h1>Vamos a montar tu curso</h1>
      <p class="acceso-lema">Dos minutos. Luego META ya sabe qué enseñarte cada día.</p>
      <div class="campo">
        <label for="ob-nivel">¿Qué estás estudiando?</label>
        <select id="ob-nivel">
          ${['2º Bachillerato', '1º Bachillerato', 'ESO', 'Universidad', 'Otro']
            .map(n => `<option ${p.nivel === n ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
      </div>
      <div class="campo">
        <label for="ob-curso">Centro o curso (opcional)</label>
        <input id="ob-curso" type="text" value="${escapa(p.curso || '')}" placeholder="IES / Colegio">
      </div>
      <button class="boton ancho" data-accion="ob-siguiente" data-mt>Continuar</button>`;
  }

  if (paso === 1) {
    return `
      ${barraPasos()}
      <h1>Tus asignaturas</h1>
      <p class="acceso-lema">Son la base de todo lo demás: horario, tareas, exámenes y apuntes cuelgan de ellas.</p>
      <div class="lista suelta" id="ob-lista">${filasAsignaturas()}</div>
      <div class="campo" data-mt>
        <div class="con-boton">
          <input id="ob-asig" type="text" placeholder="Escribe una y pulsa Intro" autocomplete="off">
        </div>
      </div>
      <div id="ob-sugerencias">${bloqueSugerencias()}</div>
      <div class="acciones" data-mt-grande>
        <button class="boton fantasma" data-accion="ob-atras">Atrás</button>
        <button class="boton" data-accion="ob-siguiente">Continuar</button>
      </div>`;
  }

  if (paso === 2) {
    const d = { ...{ 1: 90, 2: 90, 3: 90, 4: 90, 5: 60, 6: 120, 0: 90 }, ...(p.disponibilidad || {}) };
    const dias = [[1, 'Lunes'], [2, 'Martes'], [3, 'Miércoles'], [4, 'Jueves'], [5, 'Viernes'], [6, 'Sábado'], [0, 'Domingo']];
    return `
      ${barraPasos()}
      <h1>¿Cuánto puedes estudiar?</h1>
      <p class="acceso-lema">Fuera de clase, un día normal. Es lo que META usará para repartir el trabajo.
        Se cambia cuando quieras.</p>
      <div class="lista">
        ${dias.map(([n, et]) => `
          <div class="fila">
            <div class="izq"><div class="t1">${et}</div></div>
            <div class="der">
              <select data-disp="${n}">
                ${[0, 30, 60, 90, 120, 150, 180, 240].map(v =>
                  `<option value="${v}" ${Number(d[n]) === v ? 'selected' : ''}>${v === 0 ? 'Nada' : v + ' min'}</option>`).join('')}
              </select>
            </div>
          </div>`).join('')}
      </div>
      <div class="acciones" data-mt-grande>
        <button class="boton fantasma" data-accion="ob-atras">Atrás</button>
        <button class="boton" data-accion="ob-siguiente">Continuar</button>
      </div>`;
  }

  return `
    ${barraPasos()}
    <h1>Listo</h1>
    <p class="acceso-lema">Ya puedes empezar. Lo demás (horario, exámenes, temas)
      se va añadiendo sobre la marcha, no hace falta configurarlo ahora.</p>
    <div class="lista">
      <div class="fila"><div class="izq"><div class="t1">Apunta tu primera tarea o examen</div>
        <div class="t2">Con el botón + de arriba, desde cualquier pantalla</div></div></div>
      <div class="fila"><div class="izq"><div class="t1">Monta tu horario</div>
        <div class="t2">En Horario → Franjas, y luego tocas cada casilla</div></div></div>
      <div class="fila"><div class="izq"><div class="t1">Conecta tu calendario</div>
        <div class="t2">En Perfil → Conexiones: Google, Outlook o un enlace universal</div></div></div>
    </div>
    <button class="boton ancho" data-accion="ob-terminar" data-mt-grande>Entrar en META</button>`;
}

function filasAsignaturas() {
  const l = listaAsignaturas();
  if (!l.length) return '<div class="vacio"><p>Aún no has añadido ninguna.</p></div>';
  return l.map(a => `
    <div class="fila">
      <span class="punto-color" data-bg="${escapa(a.color)}"></span>
      <div class="izq"><div class="t1">${escapa(a.nombre)}</div></div>
      <button class="btn-icono" data-accion="ob-quitar" data-id="${escapa(a.id)}" aria-label="Quitar">
        ${icono('papelera')}
      </button>
    </div>`).join('');
}

/** Sugerencias del nivel elegido, sin las que ya están en su lista: una vez
    añadida, el chip desaparece — si no, parece que "+ Física" no ha hecho
    nada al seguir viéndose ahí. */
function bloqueSugerencias() {
  const nivel = leer('perfil', {}).nivel || '2º Bachillerato';
  const yaPuestas = new Set(listaAsignaturas().map(a => a.nombre.toLowerCase()));
  const sug = (SUGERENCIAS[nivel] || []).filter(s => !yaPuestas.has(s.toLowerCase()));
  if (!sug.length) return '';
  return `<div class="sugerencias">${sug.map(s =>
    `<button class="chip" data-accion="ob-sugerida" data-n="${escapa(s)}">+ ${escapa(s)}</button>`).join('')}</div>`;
}

function repintarObAsignaturas() {
  const lista = document.getElementById('ob-lista');
  if (lista) { lista.innerHTML = filasAsignaturas(); pintaEstilos(lista); }
  const sug = document.getElementById('ob-sugerencias');
  if (sug) sug.innerHTML = bloqueSugerencias();
}

/* ------------------------------ vista previa ------------------------------- */

function muestra() {
  const el = document.getElementById('acceso-muestra');
  if (!el) return;
  el.innerHTML = `
    <div class="muestra-fecha">${escapa(fechaLarga(hoyLocal()))} · ejemplo</div>
    <div class="muestra-tit">Buenos días, Alex</div>

    <div class="estado" data-mt>
      <div class="aro">
        <svg viewBox="0 0 62 62">
          <circle cx="31" cy="31" r="27" fill="none" stroke="var(--sup3)" stroke-width="5"/>
          <circle cx="31" cy="31" r="27" fill="none" stroke="var(--acento)" stroke-width="5"
                  stroke-linecap="round" data-aro="82"/>
        </svg>
        <div class="val">82</div>
      </div>
      <div class="txt">
        <h3>Bajo riesgo</h3>
        <p>1 examen en 4 días · 3 tareas esta semana</p>
      </div>
    </div>

    <div class="ahora" data-mt-grande>
      <div class="et">Ahora</div>
      <h3>Física</h3>
      <div class="cuando">17:00 – 17:50 · Dinámica</div>
    </div>

    <div class="seccion-cab" data-mt-grande><h2>META recomienda</h2></div>
    <div class="lista">
      <div class="recomendacion"><span class="min">45 min</span>
        <div class="q"><div class="t1">Derivadas</div><div class="t2">Matemáticas · examen en 4 días · dominio 42%</div></div></div>
      <div class="recomendacion"><span class="min">30 min</span>
        <div class="q"><div class="t1">Problemas de Física</div><div class="t2">Física · para mañana</div></div></div>
    </div>`;
  pintaEstilos(el);
}

/* --------------------------------- pintar ---------------------------------- */

export function mostrar(nuevoModo) {
  if (nuevoModo) modo = nuevoModo;
  const el = raiz();
  el.innerHTML =
    modo === 'registro' ? pantallaRegistro()
    : modo === 'recuperar' ? pantallaRecuperar()
    : modo === 'codigo' ? pantallaCodigo()
    : modo === 'onboarding' ? pantallaOnboarding()
    : pantallaEntrar();
  pintaEstilos(el);
  muestra();

  const primero = el.querySelector('input:not([type=checkbox])');
  if (primero && modo !== 'codigo') setTimeout(() => primero.focus(), 120);

  // Intro envía el formulario de la pantalla en la que estés.
  el.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('keydown', ev => {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      if (inp.id === 'ob-asig') return anadirAsignatura(inp.value, inp);
      const b = el.querySelector('[data-accion^="ac-"].boton.ancho, [data-accion="ob-siguiente"]');
      b?.click();
    });
  });
}

accion('ac-modo', d => mostrar(d.m));

accion('ver-clave', (d, el) => {
  const inp = document.getElementById(d.id);
  if (!inp) return;
  const oculto = inp.type === 'password';
  inp.type = oculto ? 'text' : 'password';
  el.setAttribute('aria-label', oculto ? 'Ocultar contraseña' : 'Mostrar contraseña');
  el.innerHTML = icono(oculto ? 'ojoTachado' : 'ojo');
});

/* -------------------------------- acciones --------------------------------- */

const valor = id => document.getElementById(id)?.value?.trim() || '';

async function conBoton(el, fn) {
  el.disabled = true;
  const antes = el.textContent;
  el.textContent = 'Un momento…';
  try { await fn(); }
  finally { el.disabled = false; el.textContent = antes; }
}

accion('ac-entrar', (d, el) => conBoton(el, async () => {
  error('');
  const email = valor('ac-email'), clave = document.getElementById('ac-clave').value;
  if (!email || !clave) return error('Rellena el correo y la contraseña.');
  try {
    await sesion.entrar({ email, contrasena: clave, recordar: document.getElementById('ac-recordar').checked });
    emitir('sesion-lista', { nueva: false });
  } catch (e) {
    error(e.message);
  }
}));

accion('ac-registrar', (d, el) => conBoton(el, async () => {
  error('');
  const nombre = valor('ac-nombre'), email = valor('ac-email');
  const clave = document.getElementById('ac-clave').value;
  if (!nombre) return error('Dinos cómo te llamas.');
  if (!email) return error('Hace falta un correo.');
  if (clave.length < 8) return error('La contraseña necesita al menos 8 caracteres.');

  // Dos caminos para no perder los datos de la época sin cuentas: el código
  // que este aparato ya tenía guardado, o el que él escriba a mano.
  const importar = document.getElementById('ac-importar')?.checked;
  const escrito = document.getElementById('ac-codigo-viejo')?.value || '';
  const codigoImportar = importar
    ? (leer('sync', {}).codigo || null)
    : (normalizaCodigo(escrito) || null);

  try {
    const r = await sesion.registrar({ email, contrasena: clave, nombre, recordar: true, codigoImportar });
    datosRegistro = r;
    if (r.importado) aviso('Datos de este aparato traídos a tu cuenta');
    mostrar('codigo');
  } catch (e) {
    error(e.message);
  }
}));

accion('ac-recuperar', (d, el) => conBoton(el, async () => {
  error('');
  const email = valor('ac-email'), codigo = valor('ac-codigo');
  const clave = document.getElementById('ac-clave').value;
  if (clave.length < 8) return error('La contraseña nueva necesita al menos 8 caracteres.');
  try {
    const r = await sesion.recuperar({ email, codigoRecuperacion: codigo, contrasena: clave });
    datosRegistro = r;
    aviso('Contraseña cambiada');
    mostrar('codigo');    // el código usado ya no vale: se enseña el nuevo
  } catch (e) {
    error(e.message);
  }
}));

accion('ac-copiar-codigo', async () => {
  try {
    await navigator.clipboard.writeText(datosRegistro?.codigoRecuperacion || '');
    aviso('Código copiado');
  } catch {
    aviso('Selecciónalo y cópialo a mano', 'mal');
  }
});

accion('ac-bajar-codigo', () => {
  const texto = `META — código de recuperación\n\nCuenta: ${sesion.usuario()?.email || ''}\nCódigo: ${datosRegistro?.codigoRecuperacion || ''}\n\nGuárdalo: es la única forma de recuperar la cuenta si olvidas la contraseña.\n`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([texto], { type: 'text/plain' }));
  a.download = 'meta-codigo-recuperacion.txt';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
});

accion('ac-sigue-onboarding', () => {
  if (!document.getElementById('ac-guardado')?.checked) {
    return aviso('Marca la casilla cuando lo tengas guardado', 'mal');
  }
  const p = leer('perfil', {});
  if (p.onboarding) return emitir('sesion-lista', { nueva: true });
  paso = 0;
  mostrar('onboarding');
});

/* ------------------------------ pasos guiados ------------------------------ */

function guardaPaso() {
  const p = { ...leer('perfil', {}) };
  if (paso === 0) {
    p.nivel = document.getElementById('ob-nivel')?.value || p.nivel;
    p.curso = valor('ob-curso');
  }
  if (paso === 2) {
    const disponibilidad = { ...(p.disponibilidad || {}) };
    document.querySelectorAll('[data-disp]').forEach(s => { disponibilidad[s.dataset.disp] = Number(s.value); });
    p.disponibilidad = disponibilidad;
  }
  guardar('perfil', p);
  emitir('local-cambio');
}

function anadirAsignatura(nombre, inp) {
  const n = String(nombre || '').trim();
  if (!n) return;
  if (listaAsignaturas().some(a => a.nombre.toLowerCase() === n.toLowerCase())) {
    if (inp) inp.value = '';
    return;
  }
  guardar('asignaturas', [...listaAsignaturas(), { id: nuevoId(), nombre: n, profesor: '', color: siguienteColor() }]);
  emitir('local-cambio');
  if (inp) inp.value = '';
  repintarObAsignaturas();
}

accion('ob-sugerida', d => anadirAsignatura(d.n));

accion('ob-quitar', d => {
  guardar('asignaturas', listaAsignaturas().filter(a => a.id !== d.id));
  emitir('local-cambio');
  repintarObAsignaturas();
});

accion('ob-siguiente', () => {
  guardaPaso();
  if (paso === 1) {
    const texto = document.getElementById('ob-asig')?.value;
    if (texto) anadirAsignatura(texto);
  }
  paso = Math.min(PASOS_TOTAL - 1, paso + 1);
  mostrar('onboarding');
});

accion('ob-atras', () => { guardaPaso(); paso = Math.max(0, paso - 1); mostrar('onboarding'); });

accion('ob-terminar', () => {
  guardar('perfil', { ...leer('perfil', {}), onboarding: true });
  emitir('local-cambio');
  emitir('sesion-lista', { nueva: true });
});

/* --------------------------------- arranque -------------------------------- */

/** Qué pantalla toca al abrir la app sin sesión. Si este aparato ya tenía
    datos de la versión anterior, se propone crear cuenta (para no perderlos);
    si no, entrar. */
export function inicial() {
  const teniaDatos = !!estadoSync().codigo || listaAsignaturas().length > 0;
  mostrar(teniaDatos ? 'registro' : 'entrar');
}

/** Tras entrar: ¿le falta la puesta a punto? */
export function necesitaOnboarding() {
  return !leer('perfil', {}).onboarding && !listaAsignaturas().length;
}

export function abrirOnboarding() {
  paso = 0;
  mostrar('onboarding');
}
