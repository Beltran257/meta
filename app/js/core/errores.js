/* ===========================================================================
   ERRORES DEL APARATO — que un fallo de JavaScript en el iPad no se pierda.

   Un error en la consola del navegador no lo ve nadie, y los que salen en un
   iPad con Safari no salen en el Mac donde se prueba. Aquí se anotan (mensaje,
   archivo y línea; nunca contenido de la app ni datos de nadie) en
   /api/error, y /api/salud los cuenta. Ver worker/vigilancia.js.

   Acotado a propósito: como mucho 5 distintos por carga de página y ninguno
   repetido — una tormenta de errores iguales no tiene que saturar nada.
   =========================================================================== */

import { APP } from './registry.js';

const MAX_POR_CARGA = 5;

export function vigilarErrores(vistaActual = () => '') {
  const vistos = new Set();
  const mandar = (msg, src, linea) => {
    const huella = `${msg}|${src}|${linea}`;
    if (vistos.size >= MAX_POR_CARGA || vistos.has(huella)) return;
    vistos.add(huella);
    try {
      fetch('/api/error', {
        method: 'POST', keepalive: true, credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Meta': '1' },
        body: JSON.stringify({ msg, src, linea, version: APP.version, vista: vistaActual() }),
      }).catch(() => {});
    } catch { /* anotar un error nunca puede ser otro error */ }
  };

  addEventListener('error', e => mandar(e.message, e.filename || '', e.lineno || 0));
  addEventListener('unhandledrejection', e => {
    const r = e.reason;
    mandar(String(r?.message || r || ''), String(r?.stack || '').match(/https?:[^\s)]+\.js/)?.[0] || '', 0);
  });
}
