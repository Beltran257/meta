/* Auditoría del proyecto. Vive en el repo (no en un scratchpad que se borra).
   Uso:  node tools/audita.mjs                                                */

import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';

const RAIZ = new URL('..', import.meta.url).pathname;
const APP = join(RAIZ, 'app');
let fallos = 0, avisos = 0;

const mal = m => { console.log('❌ ' + m); fallos++; };
const ojo = m => { console.log('⚠️  ' + m); avisos++; };
const bien = m => console.log('✅ ' + m);

/* --- todos los archivos de app/ ------------------------------------------- */
function recorre(dir, acc = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    statSync(p).isDirectory() ? recorre(p, acc) : acc.push(p);
  }
  return acc;
}
const archivos = recorre(APP).map(p => './' + relative(APP, p));

/* --- 1. la precaché cubre TODOS los módulos ------------------------------- */
const shell = readFileSync(join(APP, 'shell.js'), 'utf8');
const enShell = [...shell.matchAll(/'(\.\/[^']*)'/g)].map(m => m[1]);
const debenEstar = archivos.filter(f =>
  (f.endsWith('.js') || f.endsWith('.css')) && f !== './sw.js' && f !== './shell.js');

const faltan = debenEstar.filter(f => !enShell.includes(f));
const sobran = enShell.filter(f => f !== './' && !archivos.includes(f));

faltan.length ? mal(`En shell.js faltan: ${faltan.join(', ')}`)
              : bien(`Precaché completa (${debenEstar.length} módulos + estáticos)`);
sobran.length ? mal(`shell.js apunta a archivos inexistentes: ${sobran.join(', ')}`)
              : bien('shell.js no apunta a nada que no exista');

/* --- 2. sintaxis de todo el JS, COMO MÓDULO -------------------------------- */
const tmp = mkdtempSync(join(tmpdir(), 'meta-'));
let rotos = 0;
const losJS = archivos.filter(f => f.endsWith('.js'));
for (const f of losJS) {
  const copia = join(tmp, f.replace(/[^a-z0-9]/gi, '_') + '.mjs');
  writeFileSync(copia, readFileSync(join(APP, f), 'utf8'));
  try {
    execFileSync(process.execPath, ['--check', copia], { stdio: 'pipe' });
  } catch (e) {
    const detalle = String(e.stderr).split('\n').filter(Boolean).slice(0, 3).join(' | ');
    mal(`Sintaxis en ${f}: ${detalle}`);
    rotos++;
  }
}
rmSync(tmp, { recursive: true, force: true });
if (!rotos) bien(`Sintaxis correcta (como módulo) en ${losJS.length} archivos JS`);

/* --- 3. nada de onclick con texto interpolado ------------------------------ */
const sinComentarios = t => t
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/<!--[\s\S]*?-->/g, '');

let inline = 0;
for (const f of archivos.filter(f => f.endsWith('.js') || f.endsWith('.html'))) {
  const t = sinComentarios(readFileSync(join(APP, f), 'utf8'));
  if (/on(click|change|input)\s*=/.test(t)) { ojo(`${f} usa un manejador inline: usa data-accion`); inline++; }
}
if (!inline) bien('Sin manejadores inline (data-accion en todas partes)');

/* --- 3b. toda data-accion declarada tiene su manejador registrado --------- */
const declaradas = new Set(), registradas = new Set();
for (const f of archivos.filter(f => f.endsWith('.js') || f.endsWith('.html'))) {
  const t = readFileSync(join(APP, f), 'utf8');
  for (const m of t.matchAll(/data-accion=["']([a-z-]+)["']/g)) declaradas.add(m[1]);
  // también las que se ponen desde JS: el.dataset.accion = 'algo'
  for (const m of t.matchAll(/dataset\.accion\s*=\s*['"]([a-z-]+)['"]/g)) declaradas.add(m[1]);
  for (const m of t.matchAll(/\baccion\(\s*['"]([a-z-]+)['"]/g)) registradas.add(m[1]);
}
const huerfanas = [...declaradas].filter(a => !registradas.has(a));
const sinUsar = [...registradas].filter(a => !declaradas.has(a));
huerfanas.length ? mal(`Acciones declaradas que nadie maneja: ${huerfanas.join(', ')}`)
                 : bien(`Las ${declaradas.size} acciones del HTML tienen manejador`);
if (sinUsar.length) ojo(`Manejadores que ya no usa nadie: ${sinUsar.join(', ')}`);

/* --- 3c. seguridad: CSP estricta y ningún style="" en plantillas ----------- */
const html = readFileSync(join(APP, 'index.html'), 'utf8');
const cabeceras = readFileSync(join(APP, '_headers'), 'utf8');

for (const [donde, txt] of [['index.html', html], ['_headers', cabeceras]]) {
  const csp = txt.match(/Content-Security-Policy[\s\S]{0,60}?(default-src[^"\n]*)/)?.[1] || '';
  if (!csp) { mal(`Sin Content-Security-Policy en ${donde}`); continue; }
  if (/unsafe-inline|unsafe-eval/.test(csp)) mal(`La CSP de ${donde} permite código o estilos en línea`);
  for (const d of ['frame-ancestors', 'object-src', 'base-uri']) {
    if (donde === '_headers' && !csp.includes(d)) mal(`La CSP de ${donde} no declara ${d}`);
  }
}
bien('CSP estricta en el HTML y en la cabecera: ni unsafe-inline ni unsafe-eval');

for (const cab of ['X-Frame-Options', 'Strict-Transport-Security', 'Cross-Origin-Opener-Policy']) {
  if (!cabeceras.includes(cab)) mal(`Falta la cabecera ${cab} en _headers`);
}

let estilosEnLinea = 0;
for (const f of archivos.filter(f => f.endsWith('.js') || f.endsWith('.html'))) {
  const t = sinComentarios(readFileSync(join(APP, f), 'utf8'));
  if (/style=["']/.test(t)) { mal(`${f} usa style="" en una plantilla: la CSP lo bloquea`); estilosEnLinea++; }
}
if (!estilosEnLinea) bien('Ningún style="" en plantillas (todo por CSS o CSSOM)');

/* --- 3d. toda clase y utilidad que se usa en una plantilla existe en el CSS -
   Bug real: `data-mt` y `data-mt-grande` se usaban 78 veces para separar
   bloques y NO tenían regla en el CSS. No falla nada, no sale nada en consola:
   simplemente la app entera sale apretada y parece mal acabada. */
const css = ['css/base.css', 'css/app.css']
  .map(f => readFileSync(join(APP, f), 'utf8')).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const clasesCSS = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(m => m[1]));
const atributosCSS = new Set([...css.matchAll(/\[(data-[\w-]+)/g)].map(m => m[1]));

// Clases que las pone el navegador o el propio JS por estado, no la plantilla.
const CLASES_DINAMICAS = new Set(['oculto', 'visible', 'on', 'hecha', 'corriendo', 'urge',
  'ahora', 'pasado', 'hoy', 'finde', 'libre', 'bien', 'mal', 'ojo', 'acc', 'chico',
  'grande', 'ancho', 'ancha', 'fina', 'peligro', 'fantasma', 'sutil', 'centrado',
  'plana', 'suelta', 'envolver', 'alto', 'medio', 'buscador', 'izquierda', 'google']);

const usadas = new Set(), atributosUsados = new Set();
for (const f of archivos.filter(f => f.endsWith('.js') || f.endsWith('.html'))) {
  const t = sinComentarios(readFileSync(join(APP, f), 'utf8'));
  for (const m of t.matchAll(/class="([^"$]*)"/g)) {
    for (const c of m[1].split(/\s+/)) if (c) usadas.add(c);
  }
  for (const m of t.matchAll(/\b(data-(?:mt|mt-grande))\b/g)) atributosUsados.add(m[1]);
}

const huerfanasClase = [...usadas].filter(c => !clasesCSS.has(c) && !CLASES_DINAMICAS.has(c));
huerfanasClase.length
  ? mal(`Clases usadas en plantillas que no existen en el CSS: ${huerfanasClase.join(', ')}`)
  : bien(`Las ${usadas.size} clases de las plantillas tienen estilo`);

const huerfanasAttr = [...atributosUsados].filter(a => !atributosCSS.has(a));
huerfanasAttr.length
  ? mal(`Utilidades de separación sin regla en el CSS: ${huerfanasAttr.join(', ')}`)
  : bien('Las utilidades de separación tienen su regla');

/* --- 4. toda clave de almacenamiento pasa por el registro ------------------ */
let sueltas = 0;
/* shell.js es la ÚNICA excepción y es a propósito: deja puesto el tema antes
   del primer pintado, y para eso tiene que correr antes de que exista ningún
   módulo. Solo se le permite LEER. */
const EXENTOS = ['./shell.js'];
for (const f of archivos.filter(f => f.endsWith('.js') && !f.includes('core/store'))) {
  const t = readFileSync(join(APP, f), 'utf8');
  const escrituras = t.match(/localStorage\.(set|remove)Item/g);
  const lecturas = t.match(/localStorage\.getItem/g);
  if (escrituras) { mal(`${f} ESCRIBE en localStorage directamente (${escrituras.length}×): usa core/store.js`); sueltas++; }
  if (lecturas && !EXENTOS.includes(f)) { mal(`${f} lee localStorage directamente: usa core/store.js`); sueltas++; }
}
if (!sueltas) bien('Todo el almacenamiento pasa por el registro de claves');

/* --- 4b. lo que se sincroniza tiene que existir en el registro ------------- */
const registro = readFileSync(join(APP, 'js/core/registry.js'), 'utf8');
const declaradasClaves = [...registro.matchAll(/^\s{2}(\w+):\s*\{\s*k:/gm)].map(m => m[1]);
const sincro = (registro.match(/CLAVES_SINCRONIZABLES\s*=\s*\[([^\]]*)\]/)?.[1] || '')
  .split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
const fantasma = sincro.filter(c => !declaradasClaves.includes(c));
fantasma.length ? mal(`CLAVES_SINCRONIZABLES nombra claves que no existen: ${fantasma.join(', ')}`)
                : bien(`Las ${sincro.length} secciones sincronizables existen en el registro`);

/* --- 4c. ningún enlace externo sin rel="noopener" -------------------------- */
let abiertos = 0;
for (const f of archivos.filter(f => f.endsWith('.js') || f.endsWith('.html'))) {
  const t = readFileSync(join(APP, f), 'utf8');
  for (const m of t.matchAll(/<a\s[^>]*target=["']_blank["'][^>]*>/g)) {
    if (!/rel=["'][^"']*noopener/.test(m[0])) { mal(`${f} abre un enlace externo sin rel="noopener"`); abiertos++; }
  }
}
if (!abiertos) bien('Los enlaces que salen de la app llevan rel="noopener"');

/* --- 4d. un despliegue tiene que verse a la PRIMERA apertura --------------- */
const sw = readFileSync(join(APP, 'sw.js'), 'utf8');
const mainJS = readFileSync(join(APP, 'js/main.js'), 'utf8');
const piezas = [
  ['sw.js', sw, 'skipWaiting'],
  ['sw.js', sw, 'clients.claim'],
  ['main.js', mainJS, 'controllerchange'],
];
const faltaAlguna = piezas.filter(([, txt, senal]) => !txt.includes(senal));
faltaAlguna.length
  ? mal(`Un despliegue no se vería hasta la 2ª apertura: falta ${faltaAlguna.map(p => `${p[2]} en ${p[0]}`).join(', ')}`)
  : bien('Lo que se publica se ve al abrir la app, sin abrirla dos veces');

/* --- 5. la versión del SW sube cuando cambia la app ------------------------ */
const ver = shell.match(/APP_VERSION\s*=\s*'([^']+)'/)?.[1];
const verReg = registro.match(/version:\s*'([^']+)'/)?.[1];
ver === verReg ? bien(`Versión ${ver} igual en shell.js y en el registro`)
               : mal(`Versión descuadrada: shell.js=${ver} registry.js=${verReg}`);

/* --- 5b. sw.js TIENE que cambiar de bytes en cada despliegue --------------- */
const verSw = sw.match(/shell\.js\?v=([^'"]+)/)?.[1];
verSw === ver
  ? bien(`sw.js cambia en cada despliegue (?v=${verSw}): Safari también ve la versión nueva`)
  : mal(`sw.js no lleva la versión actual (tiene '${verSw || 'nada'}', toca '${ver}'): en el iPhone no llegaría el cambio`);

/* --- 5c. el rescate de versión va a la par que la app ----------------------
   Si arranque.js o su ?v= se quedan en la versión anterior, deja de detectar
   la caché vieja y vuelve el fallo de "HTML nuevo + JavaScript viejo". */
const rescate = readFileSync(join(APP, 'arranque.js'), 'utf8');
const verRescate = rescate.match(/var VERSION = '([^']+)'/)?.[1];
const verEnHtml = html.match(/arranque\.js\?v=([^'"]+)/)?.[1];
(verRescate === ver && verEnHtml === ver)
  ? bien(`El rescate de versión va a la par (${ver}): nadie se queda con el JS viejo`)
  : mal(`Rescate descuadrado: arranque.js=${verRescate} index.html=${verEnHtml} app=${ver}`);

/* --- 5d. NotebookLM: el permiso de Drive y la cabecera anti-CSRF ------------
   Dos fallos que no dan la cara al escribirlos:

   · Si worker/notebooklm.js pide a Drive sin que el SCOPE de google.js lleve
     drive.file, Google responde 403 y el usuario solo ve "no se pudo
     actualizar". Peor todavía: la app parecería conectada, porque el
     calendario seguiría funcionando.
   · Si la ruta que escribe no está en ESCRIBEN, se queda sin la cabecera
     X-Meta y el propio Worker la rechaza con un 400 que parece otra cosa. */
const nblm = existsSync(join(RAIZ, 'worker/notebooklm.js'));
if (nblm) {
  const g = readFileSync(join(RAIZ, 'worker/google.js'), 'utf8');
  g.includes('auth/drive.file')
    ? bien('El permiso de Drive está pedido: los dossieres de NotebookLM se pueden escribir')
    : mal('worker/notebooklm.js escribe en Drive pero el SCOPE de google.js no pide drive.file (403 sin explicación)');

  const idx = readFileSync(join(RAIZ, 'worker/index.js'), 'utf8');
  const enEscriben = /const ESCRIBEN = \[[^\]]*\/api\/notebooklm\/sincronizar/s.test(idx);
  enEscriben
    ? bien('La ruta que reescribe los dossieres exige la cabecera X-Meta')
    : mal('/api/notebooklm/sincronizar no está en ESCRIBEN: el propio Worker la rechazaría con un 400');
}

/* --- 6. fechas locales, no UTC --------------------------------------------- */
for (const f of archivos.filter(f => f.endsWith('.js'))) {
  const t = readFileSync(join(APP, f), 'utf8');
  if (/toISOString\(\)\.s(lice|ubstring)\(0,\s*10\)/.test(t))
    mal(`${f} saca la fecha de hoy en UTC: usa fmt.hoyLocal()`);
}

/* --- 7. el worker limita por IP y valida lo que entra ---------------------- */
const worker = readFileSync(join(RAIZ, 'worker/index.js'), 'utf8');
for (const senal of ['codigoValido', 'env.LIMITE', 'demasiadoGrande']) {
  if (!worker.includes(senal)) mal(`worker/index.js ya no comprueba ${senal}`);
}
bien('El worker limita por IP y valida el tamaño y el formato de lo que entra');

/* --- 8. AISLAMIENTO ENTRE USUARIOS ----------------------------------------
   La regla que sostiene todo lo demás: los datos de una cuenta salen SIEMPRE
   del usuario de la cookie, nunca de un parámetro de la URL. Si alguien
   volviera a aceptar ?codigo=… en una ruta de datos, esto lo caza. */
const rutasDatos = ['/api/datos', '/api/google/estado', '/api/microsoft/estado', '/api/notion/'];
for (const ruta of rutasDatos) {
  if (!worker.includes(ruta)) mal(`worker/index.js ya no sirve ${ruta}`);
}
if (!/const usuario = await auth\.usuarioDe\(request, env\);\s*\n\s*if \(!usuario\) return noAutorizado\(\);/.test(worker)) {
  mal('El worker ya no exige sesión antes de servir los datos de un usuario');
} else {
  bien('Los datos de cada usuario salen de su sesión, no de la URL');
}
if (/apiDatos[\s\S]{0,400}searchParams\.get\(['"]codigo/.test(worker)) {
  mal('La ruta de datos vuelve a aceptar un código por la URL: eso rompe el aislamiento');
}

/* --- 8b. las cuentas, como toca -------------------------------------------
   Desde el 16 ago 2026 el correo+contraseña vive en el Worker compartido
   `cuentas` (mismo repo hermano, no este) — worker/auth.js de meta ya NO
   guarda verificador ni pimienta, solo delega por service binding. Lo que
   sigue siendo de este archivo: la cookie de sesión y que nunca guarde la
   contraseña en claro. Si algún día `../cuentas` no existe al lado (otro
   ordenador, otra copia), este bloque se salta solo en vez de fallar en falso. */
const autenticacion = readFileSync(join(RAIZ, 'worker/auth.js'), 'utf8');
for (const [senal, queja] of [
  ['HttpOnly', 'la cookie de sesión ya no es HttpOnly'],
  ['SameSite=Lax', 'la cookie de sesión ya no declara SameSite'],
  ['env.CUENTAS', 'ya no delega la identidad en el Worker compartido cuentas'],
]) {
  if (!autenticacion.includes(senal)) mal(`worker/auth.js: ${queja}`);
}
if (/JSON\.stringify\([^)]*contrasena/.test(autenticacion)) mal('worker/auth.js parece guardar una contraseña');
if (/verificador\s*:|salServidor\s*:/.test(autenticacion)) {
  mal('worker/auth.js parece volver a guardar un verificador de contraseña LOCAL: eso es cosa de cuentas, no de meta');
}
bien('Sesiones en cookie HttpOnly; la identidad se delega en el Worker cuentas, nunca se guarda en claro');

const identidadCompartida = join(RAIZ, '..', 'cuentas', 'worker', 'identidad.js');
if (existsSync(identidadCompartida)) {
  const idn = readFileSync(identidadCompartida, 'utf8');
  for (const [senal, queja] of [
    ['AUTH_PEPPER', 'cuentas/worker/identidad.js ya no usa la pimienta del servidor'],
    ['igualesEnTiempoConstante', 'cuentas/worker/identidad.js ya no compara en tiempo constante'],
  ]) {
    if (!idn.includes(senal)) mal(queja);
  }
} else {
  ojo('no se encontró ../cuentas al lado: no se pudo auditar la pimienta ni la comparación en tiempo constante');
}

/* --- 8c. el dueño de un buzón no se puede borrar por accidente ------------
   Bug real: fusionar() reescribía el buzón desde cero y se llevaba por delante
   el campo `duenyo`. Sin dueño, cualquiera podía reclamar ese espacio al
   registrarse usando el código que va a la vista en la URL del feed ICS. */
const workerSync = readFileSync(join(RAIZ, 'worker/sync.js'), 'utf8');
const lineaSalida = workerSync.match(/const salida = \{[^}]*\}/)?.[0] || '';
if (!lineaSalida.includes('...actual')) {
  mal('worker/sync.js: fusionar() reescribe el buzón sin conservar lo que ya tenía (perdería el dueño)');
} else {
  bien('Fusionar conserva el dueño del buzón: nadie puede reclamar un espacio ajeno');
}
if (!autenticacion.includes('if (buzon.duenyo && buzon.duenyo !== uid) return false;')) {
  mal('worker/auth.js: marcarDuenyo ya no protege un buzón que ya tiene dueño');
}

const cliente = readFileSync(join(APP, 'js/core/sesion.js'), 'utf8');
if (!cliente.includes('PBKDF2') || !cliente.includes('150_000')) {
  mal('El cliente ya no deriva la contraseña con PBKDF2 antes de enviarla');
} else {
  bien('La contraseña se deriva en el navegador: nunca viaja en claro');
}
if (!cliente.includes("'X-Meta'")) mal('Las peticiones que escriben ya no llevan la cabecera anti-CSRF');

/* --- el `state` de OAuth es un número al azar, no el código de espacio ------
   Encontrado el 3 sep 2026. Antes el state era `cal:<codigo de espacio>`, y
   ese código va a la vista en la URL del feed ICS (se pega en Google Calendar
   o en Outlook). Quien lo conociera podía montarse la URL de consentimiento
   con el espacio de otro dentro, aceptar con SU cuenta de Google, y quedarse
   con el calendario ajeno conectado: exámenes y tareas copiándose solos a un
   calendario que no es el suyo. */
const idx = readFileSync(join(RAIZ, 'worker/index.js'), 'utf8');
if (!idx.includes('nuevoEstadoOAuth') || !idx.includes('canjearEstadoOAuth')) {
  mal('worker/index.js: el state de OAuth vuelve a no ser un número al azar de un solo uso');
} else if (/urlAutorizacion\(env, redirectUri, `cal:\$\{usuario\.espacio\}`\)/.test(idx)) {
  mal('worker/index.js: se vuelve a mandar el código de espacio dentro del state de OAuth');
} else if (!/canjearEstadoOAuth\(env, 'login'/.test(idx)) {
  mal('worker/index.js: la vuelta de "entrar con Google" no canjea el state (login CSRF)');
} else {
  bien('El state de OAuth es un número al azar de un solo uso, en los dos flujos');
}

/* --- los apuntes se sirven solo con tipos conocidos -------------------------
   El MIME lo elegía el cliente: con `X-Meta-Mime: text/html` meta servía el
   archivo como PÁGINA WEB desde su propio dominio. Y esa respuesta sale del
   Worker, no de app/, así que no lleva la CSP de _headers. */
if (!idx.includes('MIME_FOTO') || !idx.includes('mimeDeFoto')) {
  mal('worker/index.js: el tipo de archivo de un apunte vuelve a venir del cliente sin filtro');
} else if (!/'Content-Security-Policy': "default-src 'none'; sandbox"/.test(idx)) {
  mal('worker/index.js: la descarga de un apunte ya no lleva su propia CSP');
} else {
  bien('Los apuntes se sirven solo con tipos conocidos y con CSP propia');
}

/* --- las copias no se leen clave a clave ------------------------------------ */
if (!/Promise\.all\(tanda\.map/.test(idx)) {
  mal('worker/index.js: el volcado de la copia vuelve a leer KV clave a clave');
} else {
  bien('El volcado de la copia lee KV en tandas, no clave a clave');
}

console.log(`\n${fallos} fallos · ${avisos} avisos`);
process.exit(fallos ? 1 : 0);
