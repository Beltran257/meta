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

export async function fusionar(kv, codigo, entrante) {
  const actual = (await leerBuzon(kv, codigo)) || { claves: {}, creado: Date.now() };
  const claves = { ...actual.claves };

  for (const [nombre, paquete] of Object.entries(entrante?.claves || {})) {
    if (!paquete || typeof paquete.ts !== 'number') continue;
    const previo = claves[nombre];
    if (!previo || paquete.ts > previo.ts) {
      claves[nombre] = { ts: paquete.ts, datos: paquete.datos ?? null };
    }
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
