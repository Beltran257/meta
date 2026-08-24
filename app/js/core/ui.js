/* ===========================================================================
   UI — piezas compartidas: hojas, avisos, confirmaciones e iconos.
   Todo lo que se repite en dos vistas vive aquí, para que un formulario o un
   diálogo se vean y se comporten igual en toda la app.
   =========================================================================== */
import { escapa } from './fmt.js';
import { accion } from './bus.js';

let hojaActual = null;
let alCerrarHoja = null;

export function hoja({ titulo, cuerpo, pie = '', ancha = false, clase = '', alAbrir, alCerrar }) {
  cerrarHoja();
  // cerrarHoja() solo retira la hoja que ESTE módulo tenía apuntada, con una
  // animación de 200ms antes de quitarla del DOM de verdad. Si algo abre una
  // hoja nueva en ese margen (dos acciones muy seguidas), sin esto quedaría
  // una hoja huérfana detrás, con sus propios botones aún respondiendo a
  // clics — un buscador de botones podría encontrar el de la hoja vieja en
  // vez de el de la nueva. Se limpia cualquier resto antes de abrir esta.
  document.querySelectorAll('.velo').forEach(v => v.remove());
  const velo = document.createElement('div');
  velo.className = 'velo ' + clase;
  velo.innerHTML = `
    <div class="hoja ${ancha ? 'ancha' : ''}" role="dialog" aria-modal="true" aria-label="${escapa(titulo)}">
      <div class="hoja-cab">
        <h3>${escapa(titulo)}</h3>
        <button class="cerrar" data-accion="cerrar-hoja" aria-label="Cerrar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <div class="hoja-cuerpo">${cuerpo}</div>
      ${pie ? `<div class="hoja-pie">${pie}</div>` : ''}
    </div>`;
  document.body.appendChild(velo);
  hojaActual = velo;
  alCerrarHoja = alCerrar || null;
  velo.addEventListener('click', ev => { if (ev.target === velo) cerrarHoja(); });

  void velo.offsetHeight;
  velo.classList.add('visible');
  pintaEstilos(velo);
  alAbrir?.(velo);
  return velo;
}

export function cerrarHoja() {
  if (!hojaActual) return;
  const v = hojaActual;
  const fn = alCerrarHoja;
  hojaActual = null;
  alCerrarHoja = null;
  v.classList.add('saliendo');   // cambia a --t-hoja-sale, ver app.css
  v.classList.remove('visible');
  setTimeout(() => v.remove(), 180);
  fn?.();
}

export const hayHoja = () => !!hojaActual;

accion('cerrar-hoja', () => cerrarHoja());

document.addEventListener('keydown', ev => { if (ev.key === 'Escape') cerrarHoja(); });

/* --------------------------------- avisos --------------------------------- */
export function aviso(texto, tipo = 'ok') {
  const t = document.createElement('div');
  t.className = `aviso aviso-${tipo}`;
  t.textContent = texto;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('visible'));
  setTimeout(() => { t.classList.remove('visible'); setTimeout(() => t.remove(), 250); }, 2800);
}

/* ------------------------------ confirmación ------------------------------ */
export function confirmar(texto, botonSi = 'Sí, hazlo', peligro = true) {
  return new Promise(resolve => {
    let respondido = false;
    const responder = v => { if (!respondido) { respondido = true; resolve(v); } };
    const v = hoja({
      titulo: 'Confirmar',
      cuerpo: `<p class="parrafo">${escapa(texto)}</p>`,
      pie: `<button class="boton fantasma" data-si="no">Cancelar</button>
            <button class="boton ${peligro ? 'peligro' : ''}" data-si="si">${escapa(botonSi)}</button>`,
      // Cerrar con la ✕, con Escape o tocando fuera cuenta como "no": si no,
      // la promesa se quedaría colgada para siempre y con ella quien esperaba.
      alCerrar: () => responder(false),
    });
    v.addEventListener('click', ev => {
      const b = ev.target.closest('[data-si]');
      if (!b) return;
      responder(b.dataset.si === 'si');
      cerrarHoja();
    });
  });
}

/* ===========================================================================
   ESTILOS DINÁMICOS POR CSSOM — la CSP bloquea el atributo style="" escrito
   en las plantillas, pero SÍ permite que JS ponga el.style.propiedad = valor.
   Las vistas marcan el elemento con data-bg / data-ancho / … y llaman a
   pintaEstilos(raiz) después de fijar el innerHTML.
   =========================================================================== */
export function pintaEstilos(root) {
  root.querySelectorAll('[data-bg]').forEach(el => { el.style.background = el.dataset.bg; });
  root.querySelectorAll('[data-color]').forEach(el => { el.style.color = el.dataset.color; });
  root.querySelectorAll('[data-ancho]').forEach(el => { el.style.width = el.dataset.ancho + '%'; });
  root.querySelectorAll('[data-alto]').forEach(el => { el.style.height = el.dataset.alto + '%'; });
  // Aro de progreso: un círculo SVG al que se le recorta el trazo.
  root.querySelectorAll('[data-aro]').forEach(el => {
    const r = Number(el.getAttribute('r')) || 27;
    const vuelta = 2 * Math.PI * r;
    const p = Math.max(0, Math.min(100, Number(el.dataset.aro) || 0));
    el.style.strokeDasharray = `${(vuelta * p) / 100} ${vuelta}`;
  });
}

/* --------------------------------- iconos ---------------------------------- */
const TRAZOS = {
  mas: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12.5 5 5L19 7"/>',
  reloj: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
  aviso: '<path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17.5v.01"/>',
  fuego: '<path d="M12 3s5 4.5 5 9a5 5 0 0 1-10 0c0-1.5.6-2.8 1.5-3.8C9 10.5 12 8 12 3z"/>',
  libro: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 3H20v18H6.5A2.5 2.5 0 0 1 4 18.5v-13A2.5 2.5 0 0 1 6.5 3z"/>',
  nota: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/>',
  lapiz: '<path d="M4 20h4L20 8l-4-4L4 16z"/>',
  foto: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5"/>',
  pdf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  calendario: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  flecha: '<path d="m9 6 6 6-6 6"/>',
  atras: '<path d="m15 6-6 6 6 6"/>',
  analisis: '<path d="M4 20V11M10 20V5M16 20v-6M21 20H3"/>',
  estrella: '<path d="m12 4 2.4 5.2 5.6.6-4.2 3.8 1.2 5.6L12 16.4 6.9 19.2l1.2-5.6L4 9.8l5.6-.6z"/>',
  papelera: '<path d="M4 7h16M9 7V5h6v2M6.5 7l1 13h9l1-13"/>',
  play: '<path d="M7 5.5v13l11-6.5z"/>',
  pausa: '<path d="M8.5 5.5v13M15.5 5.5v13"/>',
  usuario: '<circle cx="12" cy="8.5" r="3.5"/><path d="M4.5 20c1.2-3.8 4-5.5 7.5-5.5s6.3 1.7 7.5 5.5"/>',
  salir: '<path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14"/><path d="M10 8 6 12l4 4M6 12h10"/>',
  chispa: '<path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5 10.1 12.8 4.5 10.9 10.1 9z"/>',
  descarga: '<path d="M12 4v11m0 0 4-4m-4 4-4-4"/><path d="M5 19h14"/>',
  ojo: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  ojoTachado: '<path d="M2.5 12S6 5.5 12 5.5c1.6 0 3 .5 4.2 1.1M21.5 12s-3.5 6.5-9.5 6.5c-1.6 0-3-.5-4.2-1.1"/><path d="M4 4l16 16"/>',
};

export function icono(nombre, clase = '') {
  return `<svg class="${clase}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${TRAZOS[nombre] || ''}</svg>`;
}

/* ------------------------------ piezas sueltas ----------------------------- */

export const barra = (porcentaje, clase = '') =>
  `<div class="progreso"><i class="${clase}" data-ancho="${Math.max(0, Math.min(100, Math.round(porcentaje || 0)))}"></i></div>`;

export const vacio = (titulo, texto, boton = '') => `
  <div class="vacio">
    <h4>${escapa(titulo)}</h4>
    <p>${escapa(texto)}</p>
    ${boton}
  </div>`;

export const cargando = () => '<div class="cargando"><div class="giro"></div></div>';

/** Enfoca un campo cuando la hoja ya ha terminado de entrar: hacerlo antes
    hace que iOS mueva la pantalla a medio camino de la animación. */
export function enfocar(raiz, selector) {
  setTimeout(() => raiz.querySelector(selector)?.focus(), 160);
}

/* ===========================================================================
   MOVIMIENTO — confirmación de check y reordenado de listas sin saltos.

   Las vistas repintan una lista entera con innerHTML (más simple que un DOM
   virtual, pero de golpe: una fila que desaparece o cambia de sitio, salta).
   Estas dos piezas arreglan justo eso sin tocar cómo renderiza cada vista:
   marcarCheck() da el "recibo" en el botón que se acaba de tocar, y
   flipLista() mide las filas antes/después de un repintado y las desliza a su
   sitio nuevo en vez de dejarlas saltar. Solo hace falta que la fila lleve
   data-flip="<id>" para que participe.
   =========================================================================== */

/** Marca visualmente una casilla como hecha AL INSTANTE (dibuja el check y
    rebota), antes de guardar nada. El elemento es efímero — el próximo
    repintado lo sustituye por uno nuevo ya con .on "de fábrica" — así que no
    hace falta quitar la clase después. */
export function marcarCheck(boton) {
  boton?.classList.add('on', 'marcando');
}

/** Repinta con fn() pero, si alguna fila con data-flip="id" existe antes Y
    después en `contenedor`, la desliza desde su posición vieja a la nueva en
    vez de dejarla saltar (técnica FLIP). Una fila que desaparece del todo
    (p. ej. una tarea marcada que sale del filtro activo) no se anima a sí
    misma — pero las que quedan sí deslizan al hueco, que es lo que se nota. */
export function flipLista(contenedor, fn) {
  if (!contenedor) return fn();
  const antes = new Map();
  contenedor.querySelectorAll('[data-flip]').forEach(el => antes.set(el.dataset.flip, el.getBoundingClientRect()));
  fn();
  contenedor.querySelectorAll('[data-flip]').forEach(el => {
    const r0 = antes.get(el.dataset.flip);
    if (!r0) return;
    const r1 = el.getBoundingClientRect();
    const dx = r0.left - r1.left, dy = r0.top - r1.top;
    if (!dx && !dy) return;
    el.style.transition = 'none';
    el.style.transform = `translate(${dx}px,${dy}px)`;
    requestAnimationFrame(() => {
      el.style.transition = `transform var(--t-flip)`;
      el.style.transform = '';
    });
  });
}
