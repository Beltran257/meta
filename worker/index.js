/* ===========================================================================
   META — Worker: sirve la app, las cuentas, los datos de cada usuario, el
   feed ICS, los conectores de calendario/Notion y META AI.

   REGLA DE ORO DE ESTE ARCHIVO: la identidad SIEMPRE sale de la cookie de
   sesión (auth.usuarioDe) y el espacio de datos SIEMPRE sale del usuario
   (usuario.espacio). Ninguna ruta acepta un identificador de espacio por la
   URL, así que no existe un "cambia el id y mira los datos de otro".
   La única excepción, a propósito, es /ics/<codigo>.ics: un cliente de
   calendario no puede iniciar sesión, así que ese enlace es la llave (igual
   que los enlaces de calendario de Google o de Outlook).
   =========================================================================== */

import { leerBuzon, fusionar, codigoValido, normaliza, demasiadoGrande } from './sync.js';
import { construirIcs } from './ics.js';
import * as auth from './auth.js';
import * as google from './google.js';
import * as microsoft from './microsoft.js';
import * as notion from './notion.js';
import * as ia from './ia.js';
import * as archivos from './archivos.js';
import { resumenBriefing } from './briefing.js';

const ORIGEN = 'https://meta.beltranfersan.workers.dev';

const SEGURIDAD = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      ...SEGURIDAD, ...extra,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });

const malaPeticion = motivo => json({ error: 'peticion no valida', motivo }, 400);
const noAutorizado = () => json({ error: 'Necesitas iniciar sesión.', sesion: false }, 401);

function redirigir(destino, cookie) {
  const headers = { ...SEGURIDAD, Location: destino, 'Cache-Control': 'no-store' };
  if (cookie) headers['Set-Cookie'] = cookie;
  return new Response(null, { status: 302, headers });
}

/* ---------------------------- límite por IP -------------------------------
   El limitador de Cloudflare es lo principal. Si algún día falla o desaparece
   el binding, entra un contador de respaldo en memoria del isolate: más flojo
   (cada centro de datos cuenta por su cuenta) pero mejor que dejar la puerta
   abierta a cualquiera que encuentre la URL. */
const RESPALDO = new Map();
const RESPALDO_MAX = 100, RESPALDO_VENTANA = 60_000;

function respaldoDejaPasar(ip) {
  const ahora = Date.now();
  const e = RESPALDO.get(ip);
  if (!e || ahora - e.t > RESPALDO_VENTANA) { RESPALDO.set(ip, { n: 1, t: ahora }); return true; }
  e.n++;
  if (RESPALDO.size > 5000) RESPALDO.clear();
  return e.n <= RESPALDO_MAX;
}

async function dejaPasar(env, ip) {
  if (env.LIMITE) {
    try {
      const { success } = await env.LIMITE.limit({ key: ip });
      if (typeof success === 'boolean') return success;
    } catch { /* cae al respaldo */ }
  }
  return respaldoDejaPasar(ip);
}

/* ------------------------------ cuerpo JSON -------------------------------- */
async function cuerpo(request) {
  const texto = await request.text();
  if (demasiadoGrande(texto)) return { error: json({ error: 'demasiados datos' }, 413) };
  try { return { datos: texto ? JSON.parse(texto) : {} }; }
  catch { return { error: malaPeticion('cuerpo') }; }
}

/* ===========================================================================
   CUENTAS
   =========================================================================== */

async function apiAuth(request, url, env, ctx) {
  const ruta = url.pathname.slice('/api/auth/'.length);
  const ip = request.headers.get('CF-Connecting-IP') || 'sin-ip';
  const seguro = url.protocol === 'https:';

  /* --- quién soy: lo primero que pregunta la app al abrirse --------------- */
  if (ruta === 'yo') {
    const u = await auth.usuarioDe(request, env);
    return u ? json({ usuario: auth.usuarioPublico(u) }) : noAutorizado();
  }

  /* --- entrar con Google: navegación real, no fetch ----------------------- */
  if (ruta === 'google') {
    if (!env.GOOGLE_CLIENT_ID) return json({ error: 'Google no está configurado' }, 503);
    const recordar = url.searchParams.get('recordar') === '1' ? '1' : '0';
    return redirigir(google.urlLogin(env, `${ORIGEN}/api/oauth/google/callback`, `login${recordar}:${crypto.randomUUID()}`));
  }

  if (request.method !== 'POST') return json({ error: 'metodo no permitido' }, 405);

  const { datos, error } = await cuerpo(request);
  if (error) return error;

  /* ------------------------------- registro ------------------------------- */
  if (ruta === 'registro') {
    const email = auth.normalizaEmail(datos.email);
    if (!auth.emailValido(email)) return json({ error: 'Ese correo no parece válido.' }, 400);
    if (!auth.claveValida(datos.clave)) return malaPeticion('clave');

    const codigoImportar = datos.codigoImportar ? normaliza(datos.codigoImportar) : null;
    if (codigoImportar && !codigoValido(codigoImportar)) return malaPeticion('codigoImportar');

    const r = await auth.registrar(env, {
      email, clave: datos.clave, nombre: datos.nombre,
      codigoImportar, recordar: !!datos.recordar,
    });
    if (r.error) return json({ error: r.error }, r.status);

    return json({
      usuario: auth.usuarioPublico(r.usuario),
      codigoRecuperacion: r.codigoRecuperacion,
      importado: r.importado,
    }, 200, { 'Set-Cookie': auth.cookieDeSesion(r.sesion.testigo, r.sesion.vida, seguro) });
  }

  /* -------------------------------- entrar -------------------------------- */
  if (ruta === 'entrar') {
    const email = auth.normalizaEmail(datos.email);
    if (!auth.emailValido(email) || !auth.claveValida(datos.clave)) {
      return json({ error: 'Correo o contraseña incorrectos.' }, 401);
    }
    const r = await auth.entrar(env, { email, clave: datos.clave, recordar: !!datos.recordar, ip });
    if (r.error) return json({ error: r.error }, r.status);
    return json({ usuario: auth.usuarioPublico(r.usuario) }, 200,
      { 'Set-Cookie': auth.cookieDeSesion(r.sesion.testigo, r.sesion.vida, seguro) });
  }

  /* -------------------------- recuperar la contraseña --------------------- */
  if (ruta === 'recuperar') {
    const email = auth.normalizaEmail(datos.email);
    if (!auth.emailValido(email) || !auth.claveValida(datos.clave)) return malaPeticion('datos');
    const r = await auth.recuperar(env, {
      email, codigoRecuperacion: datos.codigoRecuperacion, clave: datos.clave, ip,
    });
    if (r.error) return json({ error: r.error }, r.status);
    return json({ usuario: auth.usuarioPublico(r.usuario), codigoRecuperacion: r.codigoRecuperacion }, 200,
      { 'Set-Cookie': auth.cookieDeSesion(r.sesion.testigo, r.sesion.vida, seguro) });
  }

  /* --------------------------------- salir -------------------------------- */
  if (ruta === 'salir') {
    await auth.cerrarSesion(request, env);
    return json({ ok: true }, 200, { 'Set-Cookie': auth.cookieBorrada(seguro) });
  }

  /* ----------------- de aquí abajo, todo exige sesión --------------------- */
  const usuario = await auth.usuarioDe(request, env);
  if (!usuario) return noAutorizado();

  if (ruta === 'clave') {
    if (!auth.claveValida(datos.claveNueva)) return malaPeticion('claveNueva');
    if (!usuario.google && !auth.claveValida(datos.claveActual)) return malaPeticion('claveActual');
    const r = await auth.cambiarClave(env, usuario, datos);
    if (r.error) return json({ error: r.error }, r.status);
    return json({ ok: true }, 200, { 'Set-Cookie': auth.cookieDeSesion(r.sesion.testigo, r.sesion.vida, seguro) });
  }

  if (ruta === 'codigo-recuperacion') {
    return json({ codigoRecuperacion: await auth.nuevoCodigoParaUsuario(env, usuario) });
  }

  // Token para un aparato sin navegador (el enlace de carpeta): se enseña una
  // vez, igual que el código de recuperación. Cambiar la contraseña lo revoca
  // solo, porque usa el mismo `generacion` que cualquier otra sesión.
  if (ruta === 'token-aparato') {
    return json({ token: await auth.crearTokenAparato(env, usuario.id) });
  }

  if (ruta === 'perfil') {
    const u = await auth.actualizarPerfil(env, usuario, { nombre: datos.nombre });
    return json({ usuario: auth.usuarioPublico(u) });
  }

  if (ruta === 'borrar') {
    // Antes de borrar nada, se corta con los proveedores: si no, quedarían
    // eventos suyos en Google/Outlook sin nadie que pudiera retirarlos.
    for (const mod of [google, microsoft, notion]) {
      try { await mod.desconectar(env, usuario.espacio); } catch { /* seguimos */ }
    }
    await auth.borrarCuenta(env, usuario);
    await auth.cerrarSesion(request, env);
    return json({ ok: true }, 200, { 'Set-Cookie': auth.cookieBorrada(seguro) });
  }

  return json({ error: 'ruta desconocida' }, 404);
}

/* ===========================================================================
   DATOS DEL USUARIO — el mismo buzón por secciones de siempre (fusión por
   fecha más nueva), pero ahora el espacio lo decide la sesión, no la URL.
   =========================================================================== */

async function apiDatos(request, env, ctx, usuario) {
  if (!env.META_DATOS) return json({ error: 'almacenamiento no disponible' }, 503);
  const codigo = usuario.espacio;

  if (request.method === 'GET') {
    const b = (await leerBuzon(env.META_DATOS, codigo)) || { claves: {}, creado: Date.now() };
    return json(b, 200);
  }

  if (request.method === 'POST') {
    const { datos, error } = await cuerpo(request);
    if (error) return error;
    const fusionado = await fusionar(env.META_DATOS, codigo, datos);

    // Deja los conectores al día en segundo plano: no retrasa la respuesta,
    // que es lo que el aparato está esperando para seguir.
    if (env.GOOGLE_CLIENT_ID) {
      ctx.waitUntil(google.reconciliar(env, codigo, fusionado).catch(e => console.log('google-sync', String(e.message).slice(0, 150))));
    }
    if (env.MS_CLIENT_ID) {
      ctx.waitUntil(microsoft.reconciliar(env, codigo, fusionado).catch(e => console.log('ms-sync', String(e.message).slice(0, 150))));
    }
    if (env.NOTION_TOKEN) {
      ctx.waitUntil(notion.reconciliar(env, codigo, fusionado).catch(e => console.log('notion-sync', String(e.message).slice(0, 150))));
    }
    return json(fusionado, 200);
  }

  return json({ error: 'metodo no permitido' }, 405);
}

/* ===========================================================================
   FEED ICS — GET /ics/<codigo>.ics
   Sin cookie a propósito: Apple Calendar, Google Calendar y Outlook no saben
   iniciar sesión. El enlace ES la llave, y por eso el código es largo y el
   limitador por IP también cubre esta ruta.
   =========================================================================== */
async function apiIcs(codigoConExtension, env) {
  const codigo = normaliza(codigoConExtension.replace(/\.ics$/i, ''));
  if (!codigoValido(codigo)) return new Response('código no válido', { status: 400 });
  if (!env.META_DATOS) return new Response('almacenamiento no disponible', { status: 503 });

  const buzon = await leerBuzon(env.META_DATOS, codigo);
  if (!buzon) return new Response('ese código no existe', { status: 404 });

  return new Response(construirIcs(buzon, codigo), {
    status: 200,
    headers: {
      ...SEGURIDAD,
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="meta.ics"',
      'Cache-Control': 'public, max-age=300',
    },
  });
}

/* ===========================================================================
   CONECTORES — Google Calendar y Outlook. Mismo contrato en los dos módulos,
   así que una sola fábrica sirve las cuatro rutas de cada uno.
   =========================================================================== */
const REDIRECT_GOOGLE = `${ORIGEN}/api/oauth/google/callback`;
const REDIRECT_MS = `${ORIGEN}/api/oauth/microsoft/callback`;

function fabricaProveedor(prov, mod, redirectUri) {
  return {
    /** Conectar es una NAVEGACIÓN (un <a href>), no un fetch: el flujo OAuth
        necesita salir del sitio. Por eso aquí la sesión se lee de la cookie
        igual que en el resto, pero la respuesta es una redirección. */
    async conectar(request, env) {
      const usuario = await auth.usuarioDe(request, env);
      if (!usuario) return redirigir(`${ORIGEN}/?sesion=caducada`);
      return redirigir(mod.urlAutorizacion(env, redirectUri, `cal:${usuario.espacio}`));
    },
    async callback(url, env) {
      const state = url.searchParams.get('state') || '';
      const codigo = normaliza(state.replace(/^cal:/, ''));
      const code = url.searchParams.get('code');

      if (url.searchParams.get('error')) return redirigir(`${ORIGEN}/?${prov}=cancelado`);
      if (!codigoValido(codigo) || !code) return redirigir(`${ORIGEN}/?${prov}=error`);

      try {
        const tokens = await mod.intercambiarCodigo(env, code, redirectUri);
        if (!tokens.refresh_token) return redirigir(`${ORIGEN}/?${prov}=repetir`);
        const email = await mod.emailDe(tokens.access_token);
        await mod.guardarConexion(env, codigo, tokens, email);
        const buzon = await leerBuzon(env.META_DATOS, codigo);
        if (buzon) await mod.reconciliar(env, codigo, buzon).catch(() => {});
        return redirigir(`${ORIGEN}/?${prov}=ok`);
      } catch {
        return redirigir(`${ORIGEN}/?${prov}=error`);
      }
    },
    async estado(env, usuario) {
      return json(await mod.estadoConexion(env, usuario.espacio), 200);
    },
    async desconectar(env, usuario) {
      await mod.desconectar(env, usuario.espacio);
      return json({ ok: true }, 200);
    },
  };
}

const apiGoogle = fabricaProveedor('google', google, REDIRECT_GOOGLE);
const apiMicrosoft = fabricaProveedor('microsoft', microsoft, REDIRECT_MS);

/* --- vuelta de Google: el mismo callback sirve para "entrar con Google" y
       para "conectar mi calendario". Lo que los distingue es el prefijo del
       parámetro state, que es cosa nuestra y no de Google — así no hace falta
       registrar una segunda URL de retorno en la consola. ------------------ */
async function callbackGoogle(url, env) {
  const state = url.searchParams.get('state') || '';
  if (!state.startsWith('login')) return apiGoogle.callback(url, env);

  const recordar = state.startsWith('login1');
  const code = url.searchParams.get('code');
  if (url.searchParams.get('error') || !code) return redirigir(`${ORIGEN}/?entrar=cancelado`);

  try {
    const tokens = await google.intercambiarCodigo(env, code, REDIRECT_GOOGLE);
    const perfil = await google.perfilDe(tokens.access_token);
    if (!perfil?.sub) return redirigir(`${ORIGEN}/?entrar=error`);
    const r = await auth.entrarConGoogle(env, { ...perfil, recordar });
    if (r.error) return redirigir(`${ORIGEN}/?entrar=error`);
    return redirigir(`${ORIGEN}/?entrar=ok`, auth.cookieDeSesion(r.sesion.testigo, r.sesion.vida, true));
  } catch {
    return redirigir(`${ORIGEN}/?entrar=error`);
  }
}

/* ===========================================================================
   NOTION — sin OAuth: token de integración interna de su propio workspace.
   =========================================================================== */
async function apiNotion(url, env, usuario) {
  if (!env.NOTION_TOKEN) return json({ error: 'Notion no configurado' }, 503);
  const codigo = usuario.espacio;

  if (url.pathname === '/api/notion/estado') return json(await notion.estadoConexion(env, codigo), 200);

  if (url.pathname === '/api/notion/conectar') {
    try {
      await notion.conectar(env, codigo);
      const buzon = await leerBuzon(env.META_DATOS, codigo);
      if (buzon) await notion.reconciliar(env, codigo, buzon).catch(() => {});
      return json(await notion.estadoConexion(env, codigo), 200);
    } catch (e) {
      return json({ error: String(e.message || e).slice(0, 200) }, 502);
    }
  }

  if (url.pathname === '/api/notion/desconectar') {
    await notion.desconectar(env, codigo);
    return json({ ok: true }, 200);
  }

  return json({ error: 'ruta desconocida' }, 404);
}

/* ===========================================================================
   ARCHIVOS — el contenido real de fotos y PDF (ver worker/archivos.js). Solo
   lo usan quien tenga sesión: el navegador al subir una foto/PDF nuevo, y el
   enlace de carpeta con su token de aparato (misma comprobación de sesión,
   ver auth.usuarioDe).
   =========================================================================== */
const RE_ID_APUNTE = /^p[0-9a-z]+$/;

async function apiArchivosSubir(request, env, usuario) {
  if (!env.META_ARCHIVOS) return json({ error: 'almacenamiento de archivos no disponible' }, 503);

  const id = request.headers.get('X-Meta-Id') || '';
  if (!RE_ID_APUNTE.test(id)) return malaPeticion('id');
  const tipo = request.headers.get('X-Meta-Tipo') || '';
  if (!['foto', 'pdf'].includes(tipo)) return malaPeticion('tipo');

  let titulo = '';
  try { titulo = decodeURIComponent(request.headers.get('X-Meta-Titulo') || ''); }
  catch { return malaPeticion('titulo'); }
  const asignaturaId = request.headers.get('X-Meta-Asignatura') || '';
  const evaluacion = request.headers.get('X-Meta-Evaluacion') || null;
  const fecha = request.headers.get('X-Meta-Fecha') || '';
  if (!titulo || !asignaturaId || !fecha) return malaPeticion('campos');

  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) return malaPeticion('vacio');
  // Distinto del demasiadoGrande importado de sync.js (ese mide TEXTO del
  // buzón, en caracteres); este mide bytes de archivo, límite muy distinto.
  if (archivos.demasiadoGrande(bytes.byteLength)) return json({ error: 'archivo demasiado grande' }, 413);

  const espacio = usuario.espacio;
  const mime = tipo === 'pdf' ? 'application/pdf' : (request.headers.get('X-Meta-Mime') || 'image/jpeg');
  await archivos.subir(env, espacio, id, bytes, mime);
  await archivos.registrarApunte(env, espacio, {
    id, tipo, titulo, asignaturaId, evaluacion, fecha, r2: true, actualizado: Date.now(),
  });
  return json({ ok: true }, 200);
}

async function apiArchivosLista(env, usuario) {
  if (!env.META_ARCHIVOS) return json({ error: 'almacenamiento de archivos no disponible' }, 503);
  const buzon = (await leerBuzon(env.META_DATOS, usuario.espacio)) || { claves: {} };
  const lista = (buzon.claves?.apuntesMeta?.datos || []).filter(a => a.r2);
  return json({ apuntes: lista }, 200);
}

async function apiArchivosBorrar(request, env, usuario) {
  const { datos, error } = await cuerpo(request);
  if (error) return error;
  if (!RE_ID_APUNTE.test(datos.id || '')) return malaPeticion('id');
  await archivos.borrarApunte(env, usuario.espacio, datos.id);
  return json({ ok: true }, 200);
}

async function apiArchivosDescarga(url, env, usuario) {
  const id = url.pathname.slice('/api/archivos/'.length);
  if (!RE_ID_APUNTE.test(id)) return malaPeticion('id');
  const { value, metadata } = await archivos.leer(env, usuario.espacio, id);
  if (!value) return new Response('no encontrado', { status: 404 });
  return new Response(value, {
    status: 200,
    headers: {
      ...SEGURIDAD,
      'Content-Type': metadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}

/* ===========================================================================
   META AI
   =========================================================================== */
async function apiIa(request, env) {
  if (request.method !== 'POST') return json({ error: 'metodo no permitido' }, 405);
  if (!env.IA) return json({ error: 'La IA no está disponible en este entorno.' }, 503);
  const { datos, error } = await cuerpo(request);
  if (error) return error;
  try {
    const r = await ia.responder(env, datos);
    return json({ texto: r.texto, modelo: r.modelo });
  } catch (e) {
    return json({ error: 'La IA no ha podido responder ahora mismo.', detalle: String(e.message).slice(0, 160) }, 502);
  }
}

/* --------------------------------- salud ----------------------------------- */
async function apiSalud(env) {
  let limitador = 'ausente';
  if (env.LIMITE) {
    try {
      const r = await env.LIMITE.limit({ key: 'sonda-salud' });
      limitador = typeof r?.success === 'boolean' ? 'activo' : `respuesta rara: ${JSON.stringify(r)}`;
    } catch (e) {
      limitador = `error: ${String(e).slice(0, 120)}`;
    }
  }
  // Sin el binding a `cuentas` no se puede ni registrar ni entrar por correo
  // (Google sigue funcionando aparte): el script de publicar lo comprueba de
  // verdad, con una llamada real, y falla antes de dejar la app rota en producción.
  let cuentas = 'sin binding';
  if (env.CUENTAS) {
    try {
      const r = await env.CUENTAS.fetch('https://cuentas.beltranfersan.workers.dev/api/salud');
      cuentas = r.ok ? 'listas' : `error ${r.status}`;
    } catch (e) { cuentas = `error: ${String(e).slice(0, 100)}`; }
  }
  return json({
    ok: true,
    servicio: 'meta',
    limitador,
    cuentas,
    ia: env.IA ? 'enlazada' : 'ausente',
  }, 200);
}

// /api/interno/backup -> volcado completo de META_DATOS para la copia de
// seguridad automática que hace morning-briefing cada noche (colgada de su
// cron, ver [[services]] META en su wrangler.toml). Protegido con un secreto
// compartido, no con la cuenta de usuario: no hay usuario detrás de esta
// llamada, es Worker-a-Worker. Mismo criterio que RESERVAS_SECRETO.
// META_ARCHIVOS (fotos/PDF de apuntes, binario) se queda fuera a propósito:
// meterlo en JSON de texto corrompería los bytes — tools/backup.mjs local sí
// lo respalda bien, con un fichero por clave.
//
// La comparación del secreto es en tiempo constante: BACKUP_SECRETO es un
// secreto de verdad, y === dejaría un canal de tiempo por el que se podría
// adivinar carácter a carácter.
function secretosIguales(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function apiInternoBackup(request, env) {
  if (!env.BACKUP_SECRETO || !secretosIguales(request.headers.get('X-Backup-Secreto') || '', env.BACKUP_SECRETO)) {
    return json({ error: 'no autorizado' }, 401);
  }
  if (!env.META_DATOS) return json({ error: 'almacenamiento no disponible' }, 503);
  const datos = {};
  let cursor;
  do {
    const pagina = await env.META_DATOS.list(cursor ? { cursor } : {});
    for (const k of pagina.keys) datos[k.name] = await env.META_DATOS.get(k.name);
    cursor = pagina.list_complete ? null : pagina.cursor;
  } while (cursor);
  return json({ app: 'meta', generado: new Date().toISOString(), datos }, 200);
}

/* -------------------------------- router ---------------------------------- */

/* Rutas que cambian algo. Además de POST, exigen la cabecera X-Meta: un
   formulario de otra web no puede ponerla (le haría falta un preflight CORS
   que no se responde), así que esto corta el CSRF de raíz sin tokens. */
const ESCRIBEN = [
  '/api/datos', '/api/ia',
  '/api/google/desconectar', '/api/microsoft/desconectar',
  '/api/notion/conectar', '/api/notion/desconectar',
  '/api/archivos/subir', '/api/archivos/borrar',
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/ics/')) {
      if (!['GET', 'HEAD'].includes(request.method)) return new Response('metodo no permitido', { status: 405 });
      const ip = request.headers.get('CF-Connecting-IP') || 'sin-ip';
      if (!(await dejaPasar(env, ip))) return new Response('demasiadas peticiones', { status: 429 });
      try {
        return await apiIcs(url.pathname.slice('/ics/'.length), env);
      } catch {
        return new Response('fallo interno', { status: 500 });
      }
    }

    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    if (!['GET', 'HEAD', 'POST'].includes(request.method)) {
      return json({ error: 'metodo no permitido' }, 405);
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'sin-ip';
    if (!(await dejaPasar(env, ip))) {
      return json({ error: 'demasiadas peticiones' }, 429, { 'Retry-After': '60' });
    }

    if (request.method === 'POST' &&
        (ESCRIBEN.includes(url.pathname) || url.pathname.startsWith('/api/auth/')) &&
        request.headers.get('X-Meta') !== '1') {
      return json({ error: 'peticion no valida' }, 400);
    }

    try {
      if (url.pathname === '/api/salud') return await apiSalud(env);
      if (url.pathname === '/api/interno/backup') return await apiInternoBackup(request, env);
      if (url.pathname.startsWith('/api/auth/')) return await apiAuth(request, url, env, ctx);
      if (url.pathname === '/api/oauth/google/callback') return await callbackGoogle(url, env);
      if (url.pathname === '/api/oauth/microsoft/callback') return await apiMicrosoft.callback(url, env);
      if (url.pathname === '/api/google/conectar') return await apiGoogle.conectar(request, env);
      if (url.pathname === '/api/microsoft/conectar') return await apiMicrosoft.conectar(request, env);

      /* --- de aquí abajo, TODO exige sesión y trabaja sobre el espacio del
             usuario de la cookie. Es el punto único donde se comprueba. ---- */
      const usuario = await auth.usuarioDe(request, env);
      if (!usuario) return noAutorizado();

      if (url.pathname === '/api/datos') return await apiDatos(request, env, ctx, usuario);
      // /api/mi/briefing -> horario de hoy, próximo examen y tareas que vencen
      // pronto, para Morning Briefing. Igual que el resto, nunca acepta un
      // espacio por la URL: sale siempre de la cookie (o del token de aparato).
      if (url.pathname === '/api/mi/briefing') {
        const buzon = await leerBuzon(env.META_DATOS, usuario.espacio);
        return json({ briefing: resumenBriefing(buzon) }, 200);
      }
      if (url.pathname === '/api/ia') return await apiIa(request, env);
      if (url.pathname === '/api/archivos/subir') return await apiArchivosSubir(request, env, usuario);
      if (url.pathname === '/api/archivos/lista') return await apiArchivosLista(env, usuario);
      if (url.pathname === '/api/archivos/borrar') return await apiArchivosBorrar(request, env, usuario);
      if (url.pathname.startsWith('/api/archivos/')) return await apiArchivosDescarga(url, env, usuario);
      if (url.pathname === '/api/google/estado') return await apiGoogle.estado(env, usuario);
      if (url.pathname === '/api/google/desconectar') return await apiGoogle.desconectar(env, usuario);
      if (url.pathname === '/api/microsoft/estado') return await apiMicrosoft.estado(env, usuario);
      if (url.pathname === '/api/microsoft/desconectar') return await apiMicrosoft.desconectar(env, usuario);
      if (url.pathname.startsWith('/api/notion/')) return await apiNotion(url, env, usuario);

      return json({ error: 'ruta desconocida' }, 404);
    } catch (e) {
      console.log('fallo', url.pathname, String(e?.message || e).slice(0, 200));
      return json({ error: 'fallo interno' }, 500);
    }
  },
};
