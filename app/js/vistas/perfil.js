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

/* Marcas de terceros (Google Calendar, Outlook, Notion): a color real, a
   propósito — es la única familia de icono en toda la app que NO sigue
   stroke="currentColor", porque aquí lo que hay que reconocer de un vistazo
   es la identidad de marca, no un control propio. Todo lo demás en Conexiones
   sigue siendo icono de línea de ui.js. */
const LOGOS = {
  google: `<svg viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
<g clip-path="url(#lg-clip)">
<path d="M390.736 121.264H121.264V390.736H390.736V121.264Z" fill="white"/>
<path d="M390.736 512L512 390.736L451.368 380.392L390.736 390.736L379.67 446.196L390.736 512Z" fill="#EA4335"/>
<path d="M0 390.736V471.578C0 493.912 18.088 512 40.42 512H121.264L133.714 451.368L121.264 390.736L55.198 380.392L0 390.736Z" fill="#188038"/>
<path d="M512 121.264V40.42C512 18.088 493.912 0 471.58 0H390.736C383.36 30.072 379.671 52.2027 379.67 66.392C379.67 80.58 383.359 98.8707 390.736 121.264C417.556 128.944 437.767 132.784 451.368 132.784C464.969 132.784 485.18 128.945 512 121.264Z" fill="#1967D2"/>
<path d="M512 121.264H390.736V390.736H512V121.264Z" fill="#FBBC04"/>
<path d="M390.736 390.736H121.264V512H390.736V390.736Z" fill="#34A853"/>
<path d="M390.736 0H40.422C18.088 0 0 18.088 0 40.42V390.736H121.264V121.264H390.736V0Z" fill="#4285F4"/>
<path d="M176.54 330.308C166.468 323.504 159.494 313.568 155.688 300.428L179.066 290.796C181.186 298.88 184.891 305.145 190.182 309.592C195.436 314.038 201.836 316.228 209.314 316.228C216.959 316.228 223.527 313.903 229.018 309.254C234.51 304.606 237.272 298.678 237.272 291.504C237.272 284.16 234.375 278.164 228.582 273.516C222.788 268.868 215.512 266.544 206.822 266.544H193.314V243.404H205.44C212.917 243.404 219.216 241.382 224.336 237.338C229.456 233.298 232.016 227.772 232.016 220.732C232.016 214.468 229.726 209.482 225.146 205.744C220.566 202.004 214.77 200.118 207.73 200.118C200.858 200.118 195.402 201.938 191.36 205.608C187.319 209.289 184.282 213.937 182.534 219.116L159.394 209.482C162.458 200.792 168.084 193.112 176.336 186.476C184.588 179.84 195.132 176.506 207.932 176.506C217.398 176.506 225.92 178.326 233.466 181.996C241.01 185.668 246.938 190.754 251.216 197.222C255.496 203.722 257.616 210.998 257.616 219.082C257.616 227.334 255.63 234.308 251.656 240.034C247.682 245.76 242.796 250.138 237.002 253.204V254.584C244.483 257.669 250.982 262.735 255.798 269.238C260.682 275.806 263.142 283.654 263.142 292.818C263.142 301.978 260.816 310.164 256.168 317.338C251.52 324.514 245.088 330.172 236.934 334.282C228.75 338.392 219.554 340.482 209.348 340.482C197.524 340.514 186.612 337.112 176.54 330.308ZM320.132 214.298L294.466 232.858L281.632 213.39L327.678 180.176H345.328V336.842H320.132V214.298Z" fill="#4285F4"/>
</g>
<defs><clipPath id="lg-clip"><rect width="512" height="512" fill="white"/></clipPath></defs>
</svg>`,
  notion: `<svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid" viewBox="0 0 256 268"><path fill="#FFF" d="M16.092 11.538 164.09.608c18.179-1.56 22.85-.508 34.28 7.801l47.243 33.282C253.406 47.414 256 48.975 256 55.207v182.527c0 11.439-4.155 18.205-18.696 19.24L65.44 267.378c-10.913.517-16.11-1.043-21.825-8.327L8.826 213.814C2.586 205.487 0 199.254 0 191.97V29.726c0-9.352 4.155-17.153 16.092-18.188Z"/><path d="M164.09.608 16.092 11.538C4.155 12.573 0 20.374 0 29.726v162.245c0 7.284 2.585 13.516 8.826 21.843l34.789 45.237c5.715 7.284 10.912 8.844 21.825 8.327l171.864-10.404c14.532-1.035 18.696-7.801 18.696-19.24V55.207c0-5.911-2.336-7.614-9.21-12.66l-1.185-.856L198.37 8.409C186.94.1 182.27-.952 164.09.608ZM69.327 52.22c-14.033.945-17.216 1.159-25.186-5.323L23.876 30.778c-2.06-2.086-1.026-4.69 4.163-5.207l142.274-10.395c11.947-1.043 18.17 3.12 22.842 6.758l24.401 17.68c1.043.525 3.638 3.637.517 3.637L71.146 52.095l-1.819.125Zm-16.36 183.954V81.222c0-6.767 2.077-9.887 8.3-10.413L230.02 60.93c5.724-.517 8.31 3.12 8.31 9.879v153.917c0 6.767-1.044 12.49-10.387 13.008l-161.487 9.361c-9.343.517-13.489-2.594-13.489-10.921ZM212.377 89.53c1.034 4.681 0 9.362-4.681 9.897l-7.783 1.542v114.404c-6.758 3.637-12.981 5.715-18.18 5.715-8.308 0-10.386-2.604-16.609-10.396l-50.898-80.079v77.476l16.1 3.646s0 9.362-12.989 9.362l-35.814 2.077c-1.043-2.086 0-7.284 3.63-8.318l9.351-2.595V109.823l-12.98-1.052c-1.044-4.68 1.55-11.439 8.826-11.965l38.426-2.585 52.958 81.113v-71.76l-13.498-1.552c-1.043-5.733 3.111-9.896 8.3-10.404l35.84-2.087Z"/></svg>`,
  outlook: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="60 90.4 570.02 539.67"><defs><linearGradient id="ol-a" x1="9.989" x2="30.932" y1="22.365" y2="9.375" gradientTransform="scale(15)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#20a7fa" stop-opacity="1"/><stop offset=".4" stop-color="#3bd5ff" stop-opacity="1"/><stop offset="1" stop-color="#c4b0ff" stop-opacity="1"/></linearGradient><linearGradient id="ol-b" x1="17.197" x2="28.856" y1="26.794" y2="8.126" gradientTransform="scale(15)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#165ad9" stop-opacity="1"/><stop offset=".501" stop-color="#1880e5" stop-opacity="1"/><stop offset="1" stop-color="#8587ff" stop-opacity="1"/></linearGradient><linearGradient id="ol-c" x1="25.701" x2="12.756" y1="27.048" y2="16.501" gradientTransform="scale(15)" gradientUnits="userSpaceOnUse"><stop offset=".237" stop-color="#448aff" stop-opacity="0"/><stop offset=".792" stop-color="#0032b1" stop-opacity=".2"/></linearGradient><linearGradient id="ol-d" x1="24.053" x2="44.51" y1="31.11" y2="18.018" gradientTransform="scale(15)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1a43a6" stop-opacity="1"/><stop offset=".492" stop-color="#2052cb" stop-opacity="1"/><stop offset="1" stop-color="#5f20cb" stop-opacity="1"/></linearGradient><linearGradient id="ol-e" x1="29.828" x2="17.397" y1="30.327" y2="19.571" gradientTransform="scale(15)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#0045b9" stop-opacity="0"/><stop offset=".67" stop-color="#0d1f69" stop-opacity=".2"/></linearGradient><linearGradient id="ol-g" x1="41.998" x2="23.852" y1="29.943" y2="29.943" gradientTransform="scale(15)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4dc4ff" stop-opacity="1"/><stop offset=".196" stop-color="#0fafff" stop-opacity="1"/></linearGradient><linearGradient id="ol-k" x1="3.458" x2="20.929" y1="37.872" y2="37.86" gradientTransform="scale(15)" gradientUnits="userSpaceOnUse"><stop offset=".206" stop-color="#6ce0ff" stop-opacity="1"/><stop offset=".535" stop-color="#50d5ff" stop-opacity="0"/></linearGradient><radialGradient id="ol-f" cx="0" cy="0" r="1" fx="0" fy="0" gradientTransform="matrix(0 -405.04051 438.393 0 360.027 102.268)" gradientUnits="userSpaceOnUse"><stop offset=".568" stop-color="#275ff0" stop-opacity="0"/><stop offset=".992" stop-color="#002177" stop-opacity="1"/></radialGradient><radialGradient id="ol-h" cx="0" cy="0" r="1" fx="0" fy="0" gradientTransform="scale(173.58) rotate(-45 5.168 -1.292)" gradientUnits="userSpaceOnUse"><stop offset=".259" stop-color="#0060d1" stop-opacity=".4"/><stop offset=".908" stop-color="#0383f1" stop-opacity="0"/></radialGradient><radialGradient id="ol-i" cx="0" cy="0" r="1" fx="0" fy="0" gradientTransform="matrix(357.40702 -468.44593 423.59457 323.18709 159.471 697.08)" gradientUnits="userSpaceOnUse"><stop offset=".732" stop-color="#f4a7f7" stop-opacity="0"/><stop offset="1" stop-color="#f4a7f7" stop-opacity=".501961"/></radialGradient><radialGradient id="ol-j" cx="0" cy="0" r="1" fx="0" fy="0" gradientTransform="matrix(-170.86087 259.7254 -674.01813 -443.40415 278.562 412.979)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#49deff" stop-opacity="1"/><stop offset=".724" stop-color="#29c3ff" stop-opacity="1"/></radialGradient><radialGradient id="ol-l" cx="0" cy="0" r="1" fx="0" fy="0" gradientTransform="rotate(46.924 -378.504 245.25) scale(315.927)" gradientUnits="userSpaceOnUse"><stop offset=".039" stop-color="#0091ff" stop-opacity="1"/><stop offset=".919" stop-color="#183dad" stop-opacity="1"/></radialGradient><radialGradient id="ol-m" cx="0" cy="0" r="1" fx="0" fy="0" gradientTransform="matrix(0 168 -193.782 0 180 491.159)" gradientUnits="userSpaceOnUse"><stop offset=".558" stop-color="#0fa5f7" stop-opacity="0"/><stop offset="1" stop-color="#74c6ff" stop-opacity=".501961"/></radialGradient></defs><path d="m463.984 140.145-344.347 218.27-29.614-46.72v-40.257a43.26 43.26 0 0 1 19.72-36.293L309.91 105.258c30.496-19.79 69.777-19.793 100.277-.008Zm0 0" stroke="none" fill-rule="nonzero" fill="url(#ol-a)"/><path d="M407.102 103.34a91.293 91.293 0 0 1 3.082 1.914l156.214 101.332-387.336 245.52-59.437-93.77L403.895 177.8c26.925-17.102 28.105-55.57 3.207-74.461Zm0 0" stroke="none" fill-rule="nonzero" fill="url(#ol-b)"/><path d="M407.102 103.34a91.293 91.293 0 0 1 3.082 1.914l156.214 101.332-387.336 245.52-59.437-93.77L403.895 177.8c26.925-17.102 28.105-55.57 3.207-74.461Zm0 0" stroke="none" fill-rule="nonzero" fill="url(#ol-c)"/><path d="M333.602 498.988 179.066 452.11 507.63 243.836c27.672-17.54 27.601-57.938-.133-75.379l-1.48-.93 4.261 2.649 99.996 64.867a43.263 43.263 0 0 1 19.723 36.3v38.962Zm0 0" stroke="none" fill-rule="nonzero" fill="url(#ol-d)"/><path d="M333.602 498.988 179.066 452.11 507.63 243.836c27.672-17.54 27.601-57.938-.133-75.379l-1.48-.93 4.261 2.649 99.996 64.867a43.263 43.263 0 0 1 19.723 36.3v38.962Zm0 0" stroke="none" fill-rule="nonzero" fill="url(#ol-e)"/><path d="M410.188 105.25c-30.5-19.785-69.782-19.781-100.282.008L109.742 235.145a43.26 43.26 0 0 0-19.719 36.292v1.97a44.479 44.479 0 0 0 20.735 36.16l248.887 156.91L609.16 309.805a44.468 44.468 0 0 0 20.824-37.664v38.168l.008-38.965c0-14.66-7.426-28.32-19.722-36.301Zm0 0" stroke="none" fill-rule="nonzero" fill="url(#ol-f)"/><path d="M315.77 630.05h220.449c51.777 0 93.75-41.972 93.75-93.75V272.14c0 15.301-7.864 29.528-20.82 37.665l-327.907 205.89a60.712 60.712 0 0 0-28.422 51.414c.004 34.762 28.184 62.942 62.95 62.942Zm0 0" stroke="none" fill-rule="nonzero" fill="url(#ol-g)"/><path d="M315.77 630.05h220.449c51.777 0 93.75-41.972 93.75-93.75V272.14c0 15.301-7.864 29.528-20.82 37.665l-327.907 205.89a60.712 60.712 0 0 0-28.422 51.414c.004 34.762 28.184 62.942 62.95 62.942Zm0 0" stroke="none" fill-rule="nonzero" fill="url(#ol-h)"/><path d="M315.77 630.05h220.449c51.777 0 93.75-41.972 93.75-93.75V272.14c0 15.301-7.864 29.528-20.82 37.665l-327.907 205.89a60.712 60.712 0 0 0-28.422 51.414c.004 34.762 28.184 62.942 62.95 62.942Zm0 0" stroke="none" fill-rule="nonzero" fill="url(#ol-i)"/><path d="M405.402 630.035H183.738c-51.777 0-93.75-41.972-93.75-93.75v-264.34a44.473 44.473 0 0 0 20.754 37.621l327.582 206.52a61.737 61.737 0 0 1 28.809 52.226c-.004 34.09-27.64 61.723-61.73 61.723Zm0 0" stroke="none" fill-rule="nonzero" fill="url(#ol-j)"/><path d="M405.402 630.035H183.738c-51.777 0-93.75-41.972-93.75-93.75v-264.34a44.473 44.473 0 0 0 20.754 37.621l327.582 206.52a61.737 61.737 0 0 1 28.809 52.226c-.004 34.09-27.64 61.723-61.73 61.723Zm0 0" stroke="none" fill-rule="nonzero" fill="url(#ol-k)"/><path d="M108.75 345h142.5c26.926 0 48.75 21.824 48.75 48.75v142.5c0 26.926-21.824 48.75-48.75 48.75h-142.5C81.824 585 60 563.176 60 536.25v-142.5C60 366.824 81.824 345 108.75 345Zm0 0" stroke="none" fill-rule="nonzero" fill="url(#ol-l)"/><path d="M108.75 345h142.5c26.926 0 48.75 21.824 48.75 48.75v142.5c0 26.926-21.824 48.75-48.75 48.75h-142.5C81.824 585 60 563.176 60 536.25v-142.5C60 366.824 81.824 345 108.75 345Zm0 0" stroke="none" fill-rule="nonzero" fill="url(#ol-m)"/><path d="M179.387 534c-19.848 0-36.137-6.21-48.875-18.625-12.739-12.414-19.11-28.617-19.11-48.605 0-21.11 6.465-38.18 19.395-51.22C143.73 402.517 160.66 396 181.594 396c19.781 0 35.879 6.238 48.297 18.715 12.484 12.476 18.726 28.93 18.726 49.351 0 20.985-6.469 37.899-19.398 50.75C216.352 527.606 199.742 534 179.387 534Zm.574-26.352c10.816 0 19.523-3.695 26.117-11.082 6.594-7.386 9.89-17.664 9.89-30.824 0-13.719-3.202-24.394-9.6-32.031-6.403-7.637-14.95-11.453-25.638-11.453-11.011 0-19.878 3.941-26.597 11.824-6.723 7.824-10.082 18.191-10.082 31.102 0 13.101 3.36 23.468 10.082 31.101 6.719 7.574 15.328 11.363 25.828 11.363Zm0 0" stroke="none" fill-rule="nonzero" fill="#fff"/><path d="M179.332 535.848c-19.77 0-36-6.375-48.691-19.13-12.688-12.753-19.036-29.398-19.036-49.929 0-21.684 6.442-39.219 19.325-52.61 12.882-13.394 29.75-20.09 50.601-20.09 19.703 0 35.742 6.411 48.114 19.227 12.437 12.82 18.652 29.72 18.652 50.7 0 21.55-6.442 38.93-19.32 52.129-12.82 13.136-29.368 19.703-49.645 19.703Zm.57-27.067c10.778 0 19.453-3.797 26.02-11.383 6.57-7.59 9.851-18.144 9.851-31.664 0-14.093-3.187-25.058-9.562-32.902-6.379-7.844-14.89-11.766-25.54-11.766-10.972 0-19.804 4.047-26.5 12.149-6.694 8.031-10.042 18.683-10.042 31.945 0 13.457 3.348 24.106 10.043 31.95 6.695 7.78 15.273 11.671 25.73 11.671Zm0 0" stroke="none" fill-rule="nonzero" fill="#fff"/></svg>`,
};

const marca = (nombre) => `<span class="marca-conexion">${LOGOS[nombre]}</span>`;

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
      <div class="tarjeta"><h3>${marca('google')}Google Calendar</h3><div id="bloque-google">${cargandoChico()}</div></div>
      <div class="tarjeta"><h3>${marca('outlook')}Outlook del instituto</h3><div id="bloque-microsoft">${cargandoChico()}</div></div>
      <div class="tarjeta"><h3>${marca('notion')}Notion</h3><div id="bloque-notion">${cargandoChico()}</div></div>
      <div class="tarjeta"><h3>${icono('chispa', 'marca-conexion marca-conexion-linea')}NotebookLM</h3><div id="bloque-nblm">${cargandoChico()}</div></div>
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
