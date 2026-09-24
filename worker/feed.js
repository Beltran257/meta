/* ===========================================================================
   ENLACE DEL CALENDARIO (feed ICS) — separado del código del espacio.

   El feed era /ics/<codigo>.ics: el mismo código que identifica el espacio
   de datos. Y como Apple, Google y Outlook no saben iniciar sesión, el enlace
   ES la llave. Si ese enlace se escapaba (un calendario compartido, una
   captura), no había forma de cortarlo: cambiar el código de un espacio no
   existe.

   Ahora cada espacio tiene un enlace propio al azar, `/ics/f<32 hex>.ics`, que
   se puede cambiar desde Perfil. Cambiarlo invalida el anterior Y cierra el
   antiguo con el código: a partir de ahí solo vale el nuevo. Hasta que se
   pulse por primera vez, el antiguo sigue funcionando, para no romper de
   golpe la suscripción que ya está puesta en los calendarios.

   Claves en META_DATOS, sin caducidad:
     ics:feed:<enlace>  → código del espacio
     ics:de:<código>    → { enlace, antiguoCerrado }
   =========================================================================== */

const RE_ENLACE = /^f[0-9a-f]{32}$/;
const kFeed = e => `ics:feed:${e}`;
const kDe = c => `ics:de:${c}`;

const nuevoEnlace = () => 'f' + [...crypto.getRandomValues(new Uint8Array(16))]
  .map(b => b.toString(16).padStart(2, '0')).join('');

/** El enlace del espacio; lo crea la primera vez que se pide. */
export async function enlaceDe(env, codigo) {
  const de = await env.META_DATOS.get(kDe(codigo), 'json').catch(() => null);
  if (de?.enlace) return de;
  const enlace = nuevoEnlace();
  await env.META_DATOS.put(kFeed(enlace), codigo);
  const nuevo = { enlace, antiguoCerrado: false };
  await env.META_DATOS.put(kDe(codigo), JSON.stringify(nuevo));
  return nuevo;
}

/** Enlace nuevo: el anterior deja de valer y el antiguo con el código también. */
export async function renovarEnlace(env, codigo) {
  const de = await env.META_DATOS.get(kDe(codigo), 'json').catch(() => null);
  const enlace = nuevoEnlace();
  await env.META_DATOS.put(kFeed(enlace), codigo);
  const nuevo = { enlace, antiguoCerrado: true };
  await env.META_DATOS.put(kDe(codigo), JSON.stringify(nuevo));
  if (de?.enlace) await env.META_DATOS.delete(kFeed(de.enlace));
  return nuevo;
}

/** A qué espacio lleva lo que viene detrás de /ics/, o null si no vale.
    `codigoValido` llega de fuera para no duplicar la regla de index.js. */
export async function espacioDelFeed(env, pedido, codigoValido) {
  if (RE_ENLACE.test(pedido)) return (await env.META_DATOS.get(kFeed(pedido))) || null;
  if (!codigoValido(pedido)) return null;
  const de = await env.META_DATOS.get(kDe(pedido), 'json').catch(() => null);
  return de?.antiguoCerrado ? null : pedido;
}
