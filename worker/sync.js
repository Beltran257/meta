/* ===========================================================================
   SYNC — buzón compartido entre los dispositivos de una misma persona.

   No hay cuentas ni contraseñas: hay un CÓDIGO de emparejamiento que actúa como
   la llave. Quien tiene el código, tiene los datos — por eso el código es largo
   (8 caracteres de un alfabeto sin letras confundibles) y por eso el límite de
   peticiones por IP también protege esto.

   No se guarda un único bloque: se guarda CADA SECCIÓN con su fecha. Así, si en
   el móvil añades una tarea y en la tablet una nota, al sincronizar ganan las
   dos — con un bloque único, una de las dos se perdería.

   Este mismo buzón es la fuente del feed ICS (ver worker/ics.js): las tareas y
   exámenes que hay aquí son justo lo que se ofrece a Calendar/Outlook.
   =========================================================================== */

import { anotaPerdida } from './vigilancia.js';
import { unirTareas, unirLapidas, sellarAntiguas, huella } from '../app/js/core/union.js';

// Sin I, O, 0, 1: son las que se copian mal de una pantalla a otra.
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LARGO = 8;
const RE_CODIGO = new RegExp(`^[${ALFABETO}]{${LARGO}}$`);

const MAX_BYTES = 512 * 1024;        // fotos de apuntes no viajan aquí; texto sobra de sitio
const VIDA = 400 * 24 * 3600;        // el buzón caduca a los ~13 meses sin usarse (un curso entero)

export const codigoValido = c => RE_CODIGO.test(c);

export const conGuion = c => `${c.slice(0, 4)}-${c.slice(4)}`;

export const normaliza = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function nuevoCodigo() {
  const bytes = crypto.getRandomValues(new Uint8Array(LARGO));
  return [...bytes].map(b => ALFABETO[b % ALFABETO.length]).join('');
}

export async function crearBuzon(kv) {
  for (let i = 0; i < 5; i++) {
    const c = nuevoCodigo();
    if (!(await kv.get(`sync:${c}`))) {
      await kv.put(`sync:${c}`, JSON.stringify({ claves: {}, creado: Date.now() }),
        { expirationTtl: VIDA });
      return c;
    }
  }
  throw new Error('no se pudo generar un código libre');
}

export async function leerBuzon(kv, codigo) {
  const d = await kv.get(`sync:${codigo}`, 'json');
  return d || null;
}

/* BANDEJA DEL CONECTOR — lo que escribe Claude (worker/conector.js) va al
   buzón Y a esta clave aparte, que solo escribe la puerta del conector.
   Hace falta porque KV no sabe «escribir solo si nadie ha escrito entretanto»
   y en otra región puede servir una copia de hasta un minuto: un aparato que
   sincroniza justo después podría pisar en el buzón lo que acaba de escribir
   Claude. Como cada sincronización vuelve a unir la bandeja, y unir lo mismo
   dos veces da lo mismo, lo pisado vuelve en la siguiente. Nunca se pierde. */
export const claveBandeja = espacio => `conector:bandeja:${espacio}`;
export const VIDA_BANDEJA = 30 * 24 * 3600 * 1000;

export async function leerBandeja(kv, espacio) {
  const b = await kv.get(claveBandeja(espacio), 'json').catch(() => null);
  return { tareas: Array.isArray(b?.tareas) ? b.tareas : [], borrados: b?.borrados && typeof b.borrados === 'object' ? b.borrados : {} };
}

/* LISTAS QUE SE UNEN, NO SE PISAN: `tareas` (por id y fecha de cada tarea) y
   `borrados` (sus lápidas). La regla está en app/js/core/union.js, el mismo
   archivo que usa el aparato. Si lo unido no es lo que trae este aparato, la
   fecha de la sección sube POR ENCIMA de las dos (lo mismo que hace bolsa):
   así lo adoptan tanto él como los demás. Un aparato con la app vieja (sin
   `formato: 2`) no deja lápidas: sus tareas se unen igual, pero no puede
   borrar ninguna (ver sellarAntiguas). */
function unirSecciones(claves, entrante, bandeja, ahora) {
  const moderno = entrante?.formato >= 2;
  const et = entrante?.claves?.tareas, eb = entrante?.claves?.borrados;
  const pt = claves.tareas, pb = claves.borrados;
  const tsEt = typeof et?.ts === 'number' ? et.ts : 0;
  const lapidas = unirLapidas([pb?.datos, moderno ? eb?.datos : null, bandeja.borrados], ahora);
  const suyas = moderno ? et?.datos : sellarAntiguas(pt?.datos, et?.datos, tsEt);
  // A igualdad de fecha (tareas de antes de esto, sin `mod`) gana el más nuevo.
  const orden = tsEt > (pt?.ts || 0) ? [pt?.datos, suyas] : [suyas, pt?.datos];
  const tareas = unirTareas([...orden, bandeja.tareas], lapidas);

  const fecha = (previo, paquete, unida, suya) => {
    const base = Math.max(previo?.ts || 0, typeof paquete?.ts === 'number' ? paquete.ts : 0);
    return huella(unida) === huella(suya) ? base : base + 1;
  };
  return {
    tareas: { ts: fecha(pt, et, tareas, et?.datos), datos: tareas },
    borrados: { ts: fecha(pb, moderno ? eb : null, lapidas, moderno ? eb?.datos : null), datos: lapidas },
  };
}

export async function fusionar(kv, codigo, entrante, ahora = Date.now()) {
  const actual = (await leerBuzon(kv, codigo)) || { claves: {}, creado: Date.now() };
  const claves = { ...actual.claves };
  const bandeja = await leerBandeja(kv, codigo);
  const unidas = unirSecciones(claves, entrante, bandeja, ahora);

  for (const [nombre, paquete] of Object.entries(entrante?.claves || {})) {
    if (nombre in unidas) continue;
    if (!paquete || typeof paquete.ts !== 'number') continue;
    const previo = claves[nombre];
    if (!previo || paquete.ts > previo.ts) {
      // Si una lista encoge de golpe se anota y se guarda lo que había: es lo
      // único que habría delatado la pérdida de horas de nov 2026 (vigilancia.js).
      try { await anotaPerdida(kv, codigo, nombre, previo?.datos, paquete.datos); } catch { /* vigilar nunca rompe sincronizar */ }
      claves[nombre] = { ts: paquete.ts, datos: paquete.datos ?? null };
    }
  }
  for (const [nombre, paquete] of Object.entries(unidas)) {
    // Unir no encoge por sí solo, pero muchas lápidas de golpe sí: que se vea.
    if (nombre === 'tareas') { try { await anotaPerdida(kv, codigo, nombre, claves.tareas?.datos, paquete.datos); } catch { /* idem */ } }
    // Un buzón sin tareas ni lápidas en ningún lado no estrena la sección.
    const vacia = Array.isArray(paquete.datos) ? !paquete.datos.length : !Object.keys(paquete.datos).length;
    if (vacia && !claves[nombre] && !entrante?.claves?.[nombre]) continue;
    claves[nombre] = paquete;
  }

  /* OJO: se conserva TODO lo que ya tenía el buzón (…actual) y luego se pisan
     solo las claves. Escribir un objeto nuevo desde cero borraba el campo
     `duenyo`, y sin dueño el buzón volvía a quedar libre para que cualquiera
     lo reclamara al registrarse — con el código a la vista en la URL del feed
     ICS. Bug real, encontrado probando el aislamiento entre cuentas. */
  const salida = { ...actual, claves, creado: actual.creado, actualizado: Date.now() };
  await kv.put(`sync:${codigo}`, JSON.stringify(salida), { expirationTtl: VIDA });
  return salida;
}

export const demasiadoGrande = texto => texto.length > MAX_BYTES;
