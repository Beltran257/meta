/* ===========================================================================
   META AI (cliente) — pregunta al Worker con el contexto real de la app.

   Lo que se manda es el RESUMEN que arma core/motor.js: títulos, fechas y
   porcentajes. Nunca los apuntes enteros, ni las notas, ni el correo. La única
   excepción es "explícame este tema", donde el texto del apunte es justo lo
   que hay que explicar — y entonces se manda solo ese.
   =========================================================================== */

import { pedir } from './sesion.js';
import { contextoIA } from './motor.js';

export const ACCIONES = [
  { id: 'que-estudiar', et: '¿Qué debería estudiar ahora?' },
  { id: 'planifica-semana', et: 'Planifica mi semana' },
  { id: 'que-atrasado', et: '¿Qué llevo atrasado?' },
  { id: 'que-asignatura', et: '¿Qué asignatura necesita más atención?' },
  { id: 'resumen-dia', et: 'Resúmeme el día' },
];

export async function preguntar({ accion, pregunta, examen = null, texto = null }) {
  const contexto = contextoIA({ examen, texto });
  return pedir('/api/ia', { metodo: 'POST', datos: { accion, pregunta, contexto } });
}
