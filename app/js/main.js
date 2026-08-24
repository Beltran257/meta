/* ===========================================================================
   MAIN — arranque, sesión, navegación y service worker.

   Orden de arranque, y el orden importa: primero se pregunta al servidor QUIÉN
   ERES y hasta que responde no se pinta nada. Enseñar la app y luego echar a
   alguien, o enseñar "entra" a quien ya tenía sesión, se ve como un fallo.
   =========================================================================== */

import { clasificar } from './core/device.js';
import { accion, iniciarAcciones, on, emitir } from './core/bus.js';
import { leer, guardar, pedirPersistencia } from './core/store.js';
import { APP } from './core/registry.js';
import { aviso } from './core/ui.js';
import { inicialesNombre, hoyLocal, diasHasta } from './core/fmt.js';
import * as sesion from './core/sesion.js';
import * as sync from './core/sync.js';
import * as motor from './core/motor.js';

import * as acceso from './vistas/acceso.js';
import hoy from './vistas/hoy.js';
import horario from './vistas/horario.js';
import tareas from './vistas/tareas.js';
import examenes from './vistas/examenes.js';
import estudiar from './vistas/estudiar.js';
import apuntes from './vistas/apuntes.js';
import asignaturas from './vistas/asignaturas.js';
import analisis from './vistas/analisis.js';
import perfil from './vistas/perfil.js';
import './vistas/captura.js';   // registra el botón +, el menú "Más" y META AI
import './vistas/buscar.js';    // registra la búsqueda global

clasificar();
iniciarAcciones();
pedirPersistencia();

/* =============================== NAVEGACIÓN ================================ */

const VISTAS = { hoy, horario, tareas, examenes, estudiar, apuntes, asignaturas, analisis, perfil };
const TITULOS = {
  hoy: 'Hoy', horario: 'Horario', tareas: 'Tareas', examenes: 'Exámenes',
  estudiar: 'Estudiar', apuntes: 'Apuntes', asignaturas: 'Asignaturas',
  analisis: 'Análisis', perfil: 'Perfil',
};

const montadas = new Set();
let actual = null;

function abrirVista(id, extra = {}) {
  if (!VISTAS[id]) id = 'hoy';
  if (actual && actual !== id) VISTAS[actual]?.desactivar?.();
  actual = id;

  for (const k of Object.keys(VISTAS)) {
    document.getElementById('v-' + k).classList.toggle('oculto', k !== id);
  }
  document.querySelectorAll('[data-accion="ir"]').forEach(b => {
    b.setAttribute('aria-current', String(b.dataset.id === id));
  });
  document.getElementById('titulo-vista').textContent = TITULOS[id] || 'Meta';

  const el = document.getElementById('v-' + id);
  if (!montadas.has(id)) { VISTAS[id].montar(el); montadas.add(id); }
  VISTAS[id].activar?.(extra);

  document.getElementById('principal').scrollTop = 0;
  guardar('prefs', { ...leer('prefs', {}), vista: id });
}

accion('ir', d => abrirVista(d.id));
on('ir', d => abrirVista(typeof d === 'string' ? d : d.id, typeof d === 'object' ? d : {}));

/* Globos de la barra lateral: lo que está atrasado y los exámenes de la
   próxima semana. Solo se enseña un número si de verdad hay algo. */
function pintarGlobos() {
  const atrasadas = motor.atrasadas().length;
  const hoyYmd = hoyLocal();
  const examenes7 = motor.soloExamenes()
    .filter(e => e.fecha >= hoyYmd && diasHasta(e.fecha) <= 7).length;
  const riesgoAlto = motor.riesgos().some(r => r.nivel === 'alto');

  const poner = (nombre, n, urge) => {
    const el = document.querySelector(`[data-globo="${nombre}"]`);
    if (!el) return;
    el.textContent = n;
    el.classList.toggle('oculto', !n);
    el.classList.toggle('urge', !!urge);
  };
  poner('tareas', atrasadas, true);
  poner('examenes', examenes7, false);

  // "Hoy" no lleva número (ya se explica dentro): solo un punto si hay algo
  // que de verdad no puede esperar, visible aunque estés en otra pantalla.
  document.querySelector('[data-globo="hoy"]')?.classList.toggle('oculto', !riesgoAlto);
  document.querySelector('[data-globo-punto="hoy"]')?.classList.toggle('oculto', !riesgoAlto);
}

/* ============================ RESUMEN DEL DÍA ===============================
   "Recordatorios y resumen del día" sin cron ni notificación push: al abrir
   la app se comprueba una vez si hay algo urgente y, si lo hay, sale como
   aviso — nada que instalar ni configurar, y nada que revisar si todo va bien
   (no interrumpe si no hay nada que decir). Una vez por día como mucho: no se
   repite si vuelves a abrir la app dentro del mismo día. */
function avisoResumenDelDia() {
  const ymd = hoyLocal();
  const prefs = leer('prefs', {});
  if (prefs.resumenVisto === ymd) return;
  guardar('prefs', { ...prefs, resumenVisto: ymd });

  const r = motor.riesgos();
  if (!r.length) return;
  const resumen = motor.resumenDelDia();
  // Un pelín después del pintado inicial, para que no compita con el aviso
  // de "versión nueva" si los dos coincidieran justo al abrir.
  setTimeout(() => aviso(resumen, r[0].nivel === 'alto' ? 'mal' : 'ojo'), 900);
}

function pintarUsuario() {
  const u = sesion.usuario();
  if (!u) return;
  document.getElementById('avatar-lateral').textContent = inicialesNombre(u.nombre || u.email);
  document.getElementById('nombre-lateral').textContent = u.nombre || 'Mi cuenta';
  document.getElementById('email-lateral').textContent = u.email || '';
}

on('datos-cambio', pintarGlobos);
on('usuario-cambio', pintarUsuario);

/* ============================== ARRANQUE =================================== */

const $arranque = document.getElementById('arranque');
const $acceso = document.getElementById('acceso');
const $app = document.getElementById('app');

function mostrarAcceso() {
  $arranque.classList.add('oculto');
  $app.classList.add('oculto');
  $acceso.classList.remove('oculto');
  acceso.inicial();
}

function mostrarApp() {
  $arranque.classList.add('oculto');
  $acceso.classList.add('oculto');
  $app.classList.remove('oculto');
  pintarUsuario();
  pintarGlobos();
  abrirVista(leer('prefs', {}).vista || 'hoy');
  avisoResumenDelDia();
}

async function entrarEnLaApp() {
  const u = sesion.usuario();
  if (!u) return mostrarAcceso();

  // Si en este navegador había datos de OTRA cuenta, se limpian antes de
  // traer los de esta. Es la frontera de aislamiento del lado del cliente.
  sync.prepararPara(u);

  try { await sync.traerTodo(); } catch { /* sin conexión: se trabaja con lo local */ }

  if (acceso.necesitaOnboarding()) {
    $arranque.classList.add('oculto');
    $app.classList.add('oculto');
    $acceso.classList.remove('oculto');
    return acceso.abrirOnboarding();
  }
  mostrarApp();
  sync.sincronizar();
}

on('sesion-lista', entrarEnLaApp);

on('sesion-fuera', () => {
  $app.classList.add('oculto');
  $acceso.classList.remove('oculto');
  acceso.mostrar('entrar');
});

(async function arrancar() {
  await sesion.comprobar();
  sync.arrancar();
  await entrarEnLaApp();
  avisosDeVuelta();
})();

/* Vuelta de Google / Outlook / entrar con Google. Se limpia la URL enseguida:
   si se queda, un refresco repetiría el aviso sin venir a cuento. */
function avisosDeVuelta() {
  const p = new URLSearchParams(location.search);
  const MENSAJES = {
    google: { ok: ['Google Calendar conectado', 'ok'], error: ['No se pudo conectar con Google Calendar', 'mal'],
      cancelado: ['Conexión cancelada', 'mal'], repetir: ['Desconéctalo y vuelve a conectarlo para renovar el permiso', 'mal'] },
    microsoft: { ok: ['Outlook conectado', 'ok'], error: ['No se pudo conectar con Outlook', 'mal'],
      cancelado: ['Conexión cancelada', 'mal'], repetir: ['Desconéctalo y vuelve a conectarlo para renovar el permiso', 'mal'] },
    entrar: { ok: ['Sesión iniciada', 'ok'], error: ['No se pudo entrar con Google', 'mal'],
      cancelado: ['Has cancelado el acceso', 'mal'] },
    sesion: { caducada: ['Tu sesión había caducado: entra otra vez', 'mal'] },
  };
  let limpiar = false;
  for (const clave of Object.keys(MENSAJES)) {
    const valor = p.get(clave);
    if (!valor) continue;
    limpiar = true;
    const [texto, tipo] = MENSAJES[clave][valor] || [];
    if (texto) aviso(texto, tipo);
  }
  if (limpiar) history.replaceState(null, '', location.pathname);
}

/* ===========================================================================
   SERVICE WORKER — que un despliegue llegue de verdad al móvil.
   Cuatro formas independientes de detectar una versión nueva; todas acaban en
   el mismo aviso "toca para actualizar". Nunca se recarga solo. El porqué de
   las cuatro está en lessons_pwa_web_apps (el bug de Safari con sw.js).
   =========================================================================== */
if ('serviceWorker' in navigator) {
  let avisoActual = null, workerPendiente = null;

  function avisoVersionNueva(worker) {
    if (worker) workerPendiente = worker;
    if (avisoActual) return;
    const t = document.createElement('div');
    t.className = 'aviso aviso-actualizar';
    t.dataset.accion = 'sw-actualizar';
    t.textContent = 'Hay una versión nueva — toca para actualizar';
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('visible'));
    avisoActual = t;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      if (reg.waiting && navigator.serviceWorker.controller) avisoVersionNueva(reg.waiting);

      reg.addEventListener('updatefound', () => {
        const nuevo = reg.installing;
        if (!nuevo) return;
        nuevo.addEventListener('statechange', () => {
          if (nuevo.state === 'installed' && navigator.serviceWorker.controller) avisoVersionNueva(nuevo);
        });
      });

      reg.update().catch(() => {});
    }).catch(e => console.warn('SW:', e));

    comprobarVersionServida();
  });

  const habiaControlador = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (habiaControlador) avisoVersionNueva(null);
  });

  async function comprobarVersionServida() {
    try {
      const r = await fetch(`./shell.js?c=${Date.now()}`, { cache: 'reload' });
      if (!r.ok) return;
      const servida = (await r.text()).match(/APP_VERSION\s*=\s*'([^']+)'/)?.[1];
      if (esMasNueva(servida, APP.version)) avisoVersionNueva(null);
    } catch { /* sin conexión: ya se mirará en la próxima apertura */ }
  }

  /* Comparar con !== da avisos falsos: Cloudflare tarda un rato en propagar
     entre edges y durante ese rato una petición devuelve la versión vieja y
     otra la nueva. Se compara número a número y solo se avisa si la del
     servidor es MÁS nueva (como texto, '1.0.9' saldría mayor que '1.0.10'). */
  function esMasNueva(a, b) {
    if (!a || !b) return false;
    const na = a.split('.').map(Number), nb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(na.length, nb.length); i++) {
      const x = na[i] || 0, y = nb[i] || 0;
      if (x !== y) return x > y;
    }
    return false;
  }

  accion('sw-actualizar', () => {
    if (workerPendiente && workerPendiente.state === 'installed') {
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
      workerPendiente.postMessage({ tipo: 'toma-el-control' });
      setTimeout(() => location.reload(), 1200);
      return;
    }
    location.reload();
  });
}
