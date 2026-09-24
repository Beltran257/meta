/* ===========================================================================
   VÍNCULO DEL STATE CON EL NAVEGADOR — en observación, sin bloquear nada.

   El state de "entrar con Google" es de un solo uso y lo emite esta app (ver
   canjearEstadoOAuth en index.js), pero no está atado al navegador que lo
   pidió: alguien puede empezar el flujo con SU cuenta de Google, quedarse la
   URL de vuelta sin abrirla y hacérsela abrir a Beltrán, que acabaría dentro
   de la cuenta del otro, apuntando ahí sus cosas ("login cruzado"). El
   arreglo de manual es una cookie que se pone al salir hacia Google y se
   exige a la vuelta.

   No se exige todavía: no se sabe si la PWA instalada en el iPhone conserva
   esa cookie en el viaje de ida y vuelta a Google (iOS separa las cookies de
   la app instalada de las de Safari), y exigirla a ciegas podía dejarle sin
   poder entrar. Así que de momento solo se ANOTA si volvió, en la clave
   `oauth:vinculo` de META_DATOS (las últimas 10 entradas), diciendo si venía
   de la app instalada. Cuando haya una entrada con aparato 'iOS', pwa true y
   vuelve true, se puede pasar a exigirla.
   =========================================================================== */

export const COOKIE_VINCULO = 'meta_oauth';
const CLAVE = 'oauth:vinculo';
const RE_COOKIE = new RegExp(`(?:^|;\\s*)${COOKIE_VINCULO}=([0-9a-f]{32})(?:;|$)`);

/** Solo viaja a la vuelta de Google (Path), no la lee JS (HttpOnly), y Lax
    basta: la vuelta es una navegación GET de primer nivel desde google.com. */
export const cookieVinculo = estado =>
  `${COOKIE_VINCULO}=${estado}; Path=/api/oauth/google; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;

export function leeVinculo(request) {
  return (request.headers.get('Cookie') || '').match(RE_COOKIE)?.[1] || null;
}

// Un iPad con iPadOS se presenta como Mac: para esto da igual, lo que se busca
// es el iPhone.
const aparato = ua => /iPhone|iPad/.test(ua) ? 'iOS' : /Macintosh/.test(ua) ? 'Mac' : 'otro';

export async function anotaVinculo(env, request, estado, pwa) {
  const vuelta = leeVinculo(request);
  const entrada = {
    cuando: new Date().toISOString(),
    aparato: aparato(request.headers.get('User-Agent') || ''),
    pwa: !!pwa,
    vuelve: !!vuelta,
    coincide: vuelta === estado,
  };
  const previas = (await env.META_DATOS.get(CLAVE, 'json').catch(() => null)) || [];
  await env.META_DATOS.put(CLAVE, JSON.stringify([...previas, entrada].slice(-10)));
  return entrada;
}
