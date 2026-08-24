/* ===========================================================================
   META AI — capa de IA con contexto real, sobre Workers AI.

   Por qué Workers AI y no una API de pago: ya está en su cuenta de Cloudflare,
   no hace falta tarjeta ni una cuenta aparte. El modelo es más flojo que uno
   de pago, y por eso META no le pide a la IA nada que se pueda calcular bien
   sin ella: el estado académico, las prioridades, el plan del día y los avisos
   de riesgo son ALGORITMO (app/js/core/motor.js), determinista y offline. La
   IA solo redacta, explica y sugiere por encima de esos números.

   Si Workers AI no está disponible, el endpoint lo dice claramente y la app
   enseña igualmente el plan calculado. Nunca se finge una respuesta de IA.
   =========================================================================== */

/* Workers AI retira modelos sin avisar y el listado del CLI a veces sigue
   anunciando uno ya retirado (error 5028 al usarlo). Por eso NO hay un modelo:
   hay una cadena, se prueba en orden y se pasa al siguiente en cuanto uno
   falla o devuelve algo vacío. La respuesta dice cuál contestó, así que
   cuando esta lista se quede corta se ve enseguida, sin adivinar.
   Comprobado el 12 ago 2026: llama-3.1-8b-instruct estaba retirado. */
const MODELOS = [
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/openai/gpt-oss-20b',
  '@cf/mistralai/mistral-small-3.1-24b-instruct',
  '@cf/google/gemma-3-12b-it',
  '@cf/meta/llama-3.2-3b-instruct',
  '@cf/meta/llama-3.1-8b-instruct-fast',
  '@cf/qwen/qwen2.5-coder-32b-instruct',
  '@cf/meta/llama-3-8b-instruct',
];

const SISTEMA = [
  'Eres META, el asistente de estudio de un alumno de 2º de Bachillerato en España.',
  'Respondes en español de España, en segunda persona, sin rodeos ni saludos.',
  'Eres concreto: bloques de tiempo, temas y acciones. Nada de consejos genéricos',
  'tipo "organízate mejor" o "descansa bien".',
  'Usa SOLO los datos que te den. Si un dato no está, dilo en una línea en vez de inventarlo.',
  'Máximo 180 palabras. Sin markdown de tablas, sin emojis. Listas con guiones.',
].join(' ');

/** Texto de la respuesta, venga en la forma que venga (cada familia de
    modelos lo coloca en un sitio distinto). */
function textoDe(r) {
  if (typeof r === 'string') return r;
  const t = r?.response
    ?? r?.choices?.[0]?.message?.content
    ?? r?.output?.map?.(o => o?.content?.map?.(c => c?.text).join('')).join('')
    ?? r?.result?.response;
  return typeof t === 'string' ? t.trim() : '';
}

async function preguntar(env, mensajes) {
  const fallos = [];
  for (const modelo of MODELOS) {
    try {
      const r = await env.IA.run(modelo, { messages: mensajes, max_tokens: 512 });
      const texto = textoDe(r);
      // Una respuesta vacía cuenta como fallo del modelo: se pasa al siguiente
      // en vez de devolver una ficha hueca que parezca una respuesta.
      if (texto && texto.length > 15) return { texto, modelo };
      fallos.push(`${modelo}: vacía`);
    } catch (e) {
      fallos.push(`${modelo}: ${String(e?.message || e).slice(0, 80)}`);
    }
  }
  throw new Error('ningún modelo respondió — ' + fallos.join(' | '));
}

/* --------------------------- contexto -> texto plano -----------------------
   Lo que se manda es un resumen, no la base de datos: títulos, fechas y
   números. El contenido de los apuntes solo viaja si él ha pedido
   explícitamente que se le explique un tema concreto. */

function lineaTarea(t) {
  const partes = [t.titulo, t.asignatura, t.fecha, t.estado].filter(Boolean);
  return '- ' + partes.join(' · ');
}

function contextoATexto(c) {
  const p = [];
  p.push(`Hoy es ${c.hoy}.`);
  if (c.estado) p.push(`Estado académico: ${c.estado.puntos}/100 (${c.estado.etiqueta}).`);
  if (c.disponible != null) p.push(`Tiempo libre hoy: ${c.disponible} minutos.`);

  if (c.asignaturas?.length) p.push(`Asignaturas: ${c.asignaturas.join(', ')}.`);

  if (c.examenes?.length) {
    p.push('Exámenes próximos:');
    for (const e of c.examenes.slice(0, 8)) {
      p.push(`- ${e.titulo} (${e.asignatura}) el ${e.fecha}, faltan ${e.dias} días, preparación ${e.preparacion}%`);
    }
  }
  if (c.tareas?.length) {
    p.push('Tareas pendientes (las más urgentes primero):');
    for (const t of c.tareas.slice(0, 12)) p.push(lineaTarea(t));
  }
  if (c.temasFlojos?.length) {
    p.push('Temas peor dominados:');
    for (const t of c.temasFlojos.slice(0, 8)) p.push(`- ${t.nombre} (${t.asignatura}): dominio ${t.dominio}%`);
  }
  if (c.riesgos?.length) {
    p.push('Avisos detectados por el propio programa:');
    for (const r of c.riesgos.slice(0, 6)) p.push(`- ${r}`);
  }
  if (c.plan?.length) {
    p.push('Plan que ya ha calculado el programa para hoy:');
    for (const b of c.plan.slice(0, 8)) p.push(`- ${b.minutos} min · ${b.que}`);
  }
  if (c.texto) p.push(`Texto de sus apuntes:\n${String(c.texto).slice(0, 4000)}`);
  return p.join('\n');
}

const PETICIONES = {
  'que-estudiar': 'Dime qué debería ponerme a estudiar AHORA y por qué, con un reparto en minutos del tiempo libre que me queda hoy.',
  'planifica-semana': 'Hazme un plan de estudio para los próximos 7 días, día a día, repartiendo por asignatura según lo que tengo encima.',
  'prepara-examen': 'Prepárame un plan para este examen: qué temas atacar primero, en qué orden y cuánto tiempo a cada uno.',
  'explica-tema': 'Explícame este tema con mis propias palabras, en pasos, y acaba con tres preguntas para comprobar si lo he entendido.',
  'que-atrasado': 'Dime qué llevo atrasado y en qué orden lo recupero.',
  'que-asignatura': '¿Qué asignatura necesita más atención ahora mismo y qué hago exactamente con ella esta semana?',
  'resumen-dia': 'Resúmeme mi día en tres líneas: lo que tengo, lo que es urgente y por dónde empezar.',
};

export async function responder(env, { accion, pregunta, contexto }) {
  if (!env.IA) throw new Error('Workers AI no está enlazado en este entorno');

  const peticion = PETICIONES[accion] || String(pregunta || '').slice(0, 400);
  if (!peticion) throw new Error('sin pregunta');

  const mensajes = [
    { role: 'system', content: SISTEMA },
    { role: 'user', content: `${contextoATexto(contexto || {})}\n\n${peticion}` },
  ];
  return preguntar(env, mensajes);
}

export const ACCIONES = Object.keys(PETICIONES);
