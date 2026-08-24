/* ===========================================================================
   GRÁFICO — línea de evolución de notas en canvas. Sencillo a propósito: eje Y
   fijo 0–10, eje X por orden cronológico de las notas puestas.
   =========================================================================== */

function colorVar(nombre) {
  return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
}

/** puntos: [{fecha:'YYYY-MM-DD', valor:Number, etiqueta?:String}], ordenados. */
export function dibujarEvolucion(canvas, puntos, { objetivo } = {}) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, rect.width), h = Math.max(1, rect.height || 140);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // Los colores salen de las variables CSS: cambiar de tema (o de identidad
  // visual entera) repinta el gráfico sin tocar este archivo.
  const acento = colorVar('--acento') || '#6857e8';
  const rejilla = colorVar('--borde') || 'rgba(0,0,0,.07)';
  const tenue = colorVar('--apagado') || '#9a9ca3';

  const padI = 24, padD = 8, padA = 10, padB = 18;
  const x0 = padI, x1 = w - padD, y0 = padA, y1 = h - padB;

  // rejilla horizontal cada 2 puntos (0,2,4,6,8,10)
  ctx.strokeStyle = rejilla;
  ctx.lineWidth = 1;
  ctx.fillStyle = tenue;
  ctx.font = '10px system-ui, -apple-system, sans-serif';
  ctx.textBaseline = 'middle';
  for (let v = 0; v <= 10; v += 2) {
    const y = y1 - (v / 10) * (y1 - y0);
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    ctx.fillText(String(v), 2, y);
  }

  if (!puntos.length) return;

  const px = i => puntos.length === 1 ? (x0 + x1) / 2 : x0 + (i / (puntos.length - 1)) * (x1 - x0);
  const py = v => y1 - (Math.max(0, Math.min(10, v)) / 10) * (y1 - y0);

  // línea de objetivo, discontinua
  if (objetivo != null) {
    ctx.strokeStyle = tenue;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x0, py(objetivo));
    ctx.lineTo(x1, py(objetivo));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // línea de evolución
  ctx.strokeStyle = acento;
  ctx.lineWidth = 2.2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  puntos.forEach((p, i) => {
    const x = px(i), y = py(p.valor);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  // puntos
  ctx.fillStyle = acento;
  puntos.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(px(i), py(p.valor), 3.2, 0, Math.PI * 2);
    ctx.fill();
  });
}
