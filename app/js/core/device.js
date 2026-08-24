/* ===========================================================================
   DISPOSITIVO — clasificadores en <html> como único punto de extensión.
   Recorte de pantalla, plataforma, navegador y potencia.
   =========================================================================== */

export const D = {
  ios: false, android: false, escritorio: false,
  standalone: false, tactil: false, bajo: false, dpr: 1, reduce: false,
};

export function clasificar() {
  const h = document.documentElement;
  const ua = navigator.userAgent;
  const cls = [];

  const iOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  D.ios = iOS; D.android = android; D.escritorio = !iOS && !android;
  cls.push(iOS ? 'os-ios' : android ? 'os-android' : 'os-escritorio');

  const nav = /Edg\//.test(ua) ? 'edge'
    : /SamsungBrowser/.test(ua) ? 'samsung'
    : /FxiOS|Firefox/.test(ua) ? 'firefox'
    : /CriOS|Chrome/.test(ua) ? 'chrome'
    : /Safari/.test(ua) ? 'safari' : 'otro';
  cls.push('br-' + nav);

  const sat = parseFloat(getComputedStyle(h).getPropertyValue('--sat')) || 0;
  cls.push(sat >= 50 ? 'hw-island' : sat >= 20 ? 'hw-notch' : 'hw-plano');

  D.standalone = window.matchMedia('(display-mode: standalone)').matches ||
    navigator.standalone === true;
  if (D.standalone) cls.push('standalone');

  D.tactil = window.matchMedia('(hover: none)').matches;
  if (D.tactil) cls.push('tactil');

  D.reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mem = navigator.deviceMemory;
  const cores = navigator.hardwareConcurrency || 4;
  D.bajo = (mem !== undefined && mem <= 4) || cores <= 4 || android || D.reduce;
  if (D.bajo) cls.push('perf-bajo');

  D.dpr = D.bajo ? 1 : Math.min(2, window.devicePixelRatio || 1);

  h.classList.add(...cls);
  return D;
}

/* --- pintado con disciplina: oculto o tapado = no se pinta ------ */
const tapadores = new Set();
export function tapar(id, si) { si ? tapadores.add(id) : tapadores.delete(id); }
export const hayTapador = () => tapadores.size > 0;

export function bucle(fn, fps) {
  const paso = 1000 / (fps || (D.bajo ? 30 : 60));
  let ultimo = 0, vivo = true;
  const tic = t => {
    if (!vivo) return;
    requestAnimationFrame(tic);
    if (document.hidden || hayTapador()) return;
    if (t - ultimo < paso) return;
    ultimo = t;
    fn(t);
  };
  requestAnimationFrame(tic);
  return () => { vivo = false; };
}
