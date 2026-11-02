/* ===========================================================================
   VIGILANCIA — lo que avisa cuando algo falla SIN que nadie lo esté mirando.

   Nació de un fallo real (2 nov 2026): la importación del calendario
   reconstruía las horas de estudio solo con lo que el calendario tiene hoy, y
   al desaparecer tareas completadas se perdieron ~13 h. Llevaban 2 semanas
   perdidas y no se enteró nadie: ni la auditoría (el código estaba "bien"), ni
   /api/salud (todo en verde). Tres cosas que no se veían, tres sondas:

   1. PÉRDIDA DE DATOS: si una sección (sesiones, apuntes…) encoge de golpe al
      sincronizar, se anota (y se guarda lo que había, en la "papelera", para
      poder devolverlo). No bloquea nada: borrar mucho a propósito es legítimo;
      lo que importa es que se VEA.
   2. EL SCRIPT DEL ESTUDIO: si el Apps Script del calendario lleva horas sin
      mandar, las horas dejan de crecer sin que nada falle.
   3. ERRORES DE JAVASCRIPT en el aparato de verdad (el iPad): hasta ahora solo
      se veían los que salían probando en el Mac.

   Todo sale resumido por /api/salud, SIN identificar a nadie (ni códigos de
   espacio ni contenido): solo secciones, cifras y fechas. Lo lee Morning
   Briefing cada día y tools/vigila.mjs cada pocas horas desde GitHub.
   =========================================================================== */

const DIA = 864e5;
const MIN_PARA_VIGILAR = 10;      // una lista de menos de 10 elementos no se vigila: demasiado ruido
const CAIDA_SOSPECHOSA = 0.6;     // se anota si queda en el 60 % o menos de lo que había

/** ¿Encogió esta sección de golpe? {de, a} o null. Solo listas: las demás
    (perfil, horario…) no tienen un "tamaño" con sentido. */
export function detectaPerdida(previo, nuevo) {
  if (!Array.isArray(previo) || previo.length < MIN_PARA_VIGILAR) return null;
  const a = Array.isArray(nuevo) ? nuevo.length : 0;
  return a <= previo.length * CAIDA_SOSPECHOSA ? { de: previo.length, a } : null;
}

/** Anota la pérdida y guarda lo que había (la última por sección, 30 días). */
export async function anotaPerdida(kv, espacio, clave, previo, nuevo) {
  const p = detectaPerdida(previo, nuevo);
  if (!p) return null;
  const ahora = Date.now();
  await kv.put(`alerta:${espacio}:${clave}`, JSON.stringify({ clave, ...p, ts: ahora }), { expirationTtl: 7 * DIA / 1000 });
  await kv.put(`papelera:${espacio}:${clave}`, JSON.stringify({ clave, n: p.de, ts: ahora, datos: previo }), { expirationTtl: 30 * DIA / 1000 });
  return p;
}

const fechaCorta = ts => new Date(ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'Europe/Madrid' });

/** Texto para /api/salud: "ok" o "ALERTA: sesiones 70→31 (2 nov)". */
export function textoAlertas(alertas) {
  if (!alertas.length) return 'ok';
  return 'ALERTA: ' + alertas.sort((a, b) => b.ts - a.ts).map(a => `${a.clave} ${a.de}→${a.a} (${fechaCorta(a.ts)})`).join(' · ');
}

export async function sondaDatos(kv) {
  const lista = await kv.list({ prefix: 'alerta:' });
  const alertas = [];
  for (const k of lista.keys) {
    const a = await kv.get(k.name, 'json');
    if (a?.clave) alertas.push(a);
  }
  return textoAlertas(alertas);
}

/* ------------------------- el script del estudio --------------------------- */

const HORAS_MAX_SCRIPT = 6;       // el script manda cada hora: 6 h sin noticias es que no va

/** Texto de la sonda del script a partir de la edad (en ms) de cada envío. */
export function textoEstudio(edades) {
  if (!edades.length) return 'sin script instalado';
  const peor = Math.max(...edades);
  const horas = peor / 36e5;
  return horas > HORAS_MAX_SCRIPT
    ? `ATRASADO: sin enviar desde hace ${Math.floor(horas)} h`
    : `ok (último envío hace ${Math.max(1, Math.round(Math.min(...edades) / 6e4))} min)`;
}

export async function sondaEstudio(kv, ahora = Date.now()) {
  const lista = await kv.list({ prefix: 'estudio:' });
  const edades = [];
  for (const k of lista.keys) {
    const d = await kv.get(k.name, 'json');
    if (d?.ultima) edades.push(ahora - d.ultima);
  }
  return textoEstudio(edades);
}

/* ---------------------- errores de JavaScript del aparato ------------------ */

const IGNORAR = [
  /ResizeObserver loop/i,
  /^script error\.?$/i,                          // error de otro origen: no trae nada útil
  /load failed|failed to fetch|networkerror|network request failed|the operation was aborted|abort/i,   // sin conexión
  /serviceworker|service worker/i,               // registro del SW (falla en navegación privada y es normal)
];

/** Limpia y valida un error que manda el navegador. null si no merece anotarse. */
export function limpiaError(e) {
  const msg = String(e?.msg ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!msg || IGNORAR.some(re => re.test(msg))) return null;
  // De la ruta solo el archivo: ni el origen ni la query (podría llevar datos).
  const src = String(e?.src ?? '').replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '').slice(0, 120);
  return {
    msg, src,
    linea: Number.isFinite(+e?.linea) ? +e.linea : 0,
    version: String(e?.version ?? '').replace(/[^0-9.]/g, '').slice(0, 12),
    vista: String(e?.vista ?? '').replace(/[^a-z]/g, '').slice(0, 20),
  };
}

async function huella(texto) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(b)].slice(0, 6).map(x => x.toString(16).padStart(2, '0')).join('');
}

/** Anota un error (uno por mensaje+lugar y día, con contador: una tormenta de
    errores iguales no llena el KV). */
export async function registraError(kv, crudo, ahora = Date.now()) {
  const e = limpiaError(crudo);
  if (!e) return false;
  const dia = new Date(ahora).toISOString().slice(0, 10);
  const clave = `errcli:${dia}:${await huella(`${e.msg}|${e.src}|${e.linea}`)}`;
  const previo = await kv.get(clave, 'json');
  await kv.put(clave, JSON.stringify({ ...e, n: (previo?.n || 0) + 1, primero: previo?.primero || ahora, ultimo: ahora }),
    { expirationTtl: 14 * DIA / 1000 });
  return true;
}

export function textoErrores(registros) {
  if (!registros.length) return 'ninguno en 24 h';
  const total = registros.reduce((t, r) => t + (r.n || 1), 0);
  const top = registros.sort((a, b) => b.n - a.n)[0];
  return `${registros.length} distintos (${total} veces en 24 h) · el más repetido: ${top.msg.slice(0, 80)} (${top.src.split('/').pop()}:${top.linea}, v${top.version})`;
}

export async function sondaErrores(kv, ahora = Date.now()) {
  const dias = [new Date(ahora).toISOString().slice(0, 10), new Date(ahora - DIA).toISOString().slice(0, 10)];
  const registros = [];
  for (const dia of dias) {
    const lista = await kv.list({ prefix: `errcli:${dia}:` });
    for (const k of lista.keys) {
      const r = await kv.get(k.name, 'json');
      if (r && ahora - (r.ultimo || 0) <= DIA) registros.push(r);
    }
  }
  return textoErrores(registros);
}
