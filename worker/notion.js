/* ===========================================================================
   NOTION — apuntes de texto, tareas y exámenes reflejados en su workspace.
   A diferencia de Google/Outlook no hay OAuth: es un token de integración
   interna (un único workspace suyo), así que no va atado al código de sync
   como los otros dos, solo comprueba que la página "Meta" esté compartida
   con la integración. Bajo esa página crea (una vez) dos bases de datos:
   "Tareas y exámenes" y "Apuntes". Es el único proveedor con sincronización
   en los DOS sentidos: lo que él escriba directamente en la base "Apuntes"
   de Notion se trae también a Meta.
   =========================================================================== */

import { fusionar } from './sync.js';

const API = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';

function cab(env) {
  return {
    Authorization: `Bearer ${env.NOTION_TOKEN}`,
    'Notion-Version': VERSION,
    'Content-Type': 'application/json',
  };
}

async function notion(env, method, path, cuerpo) {
  const r = await fetch(API + path, { method, headers: cab(env), body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  if (!r.ok) throw new Error(`notion ${method} ${path}: ${(await r.text()).slice(0, 300)}`);
  return r.status === 204 ? null : r.json();
}

const tituloDe = pagina => Object.values(pagina?.properties || {}).find(p => p.type === 'title')?.title?.[0]?.plain_text ?? '';

async function paginaRaiz(env) {
  const r = await notion(env, 'POST', '/search', { query: 'Meta', filter: { property: 'object', value: 'page' }, page_size: 20 });
  return (r.results || []).find(p => !p.archived && tituloDe(p).trim() === 'Meta') || null;
}

/* ------------------------------- estructura --------------------------------
   Se crea una sola vez por página compartida; si ya existe (por ejemplo,
   la creó una sesión anterior) se reutiliza en vez de duplicar. */

async function buscarHija(env, paginaId, titulo) {
  const r = await notion(env, 'GET', `/blocks/${paginaId}/children?page_size=100`);
  return (r.results || []).find(b => b.type === 'child_database' && b.child_database?.title === titulo)?.id || null;
}

async function crearDbTareas(env, paginaId) {
  const r = await notion(env, 'POST', '/databases', {
    parent: { type: 'page_id', page_id: paginaId },
    title: [{ type: 'text', text: { content: 'Tareas y exámenes' } }],
    properties: {
      Nombre: { title: {} },
      Asignatura: { select: {} },
      Tipo: { select: { options: [{ name: 'Tarea' }, { name: 'Examen' }] } },
      Fecha: { date: {} },
      Hecho: { checkbox: {} },
      Notas: { rich_text: {} },
    },
  });
  return r.id;
}

async function crearDbApuntes(env, paginaId) {
  const r = await notion(env, 'POST', '/databases', {
    parent: { type: 'page_id', page_id: paginaId },
    title: [{ type: 'text', text: { content: 'Apuntes' } }],
    properties: { Título: { title: {} }, Asignatura: { select: {} }, Fecha: { date: {} } },
  });
  return r.id;
}

async function asegurarEstructura(env, codigo) {
  const clave = `notion:${codigo}`;
  const actual = await env.META_DATOS.get(clave, 'json');
  if (actual?.tareasDbId && actual?.apuntesDbId) return actual;

  const raiz = await paginaRaiz(env);
  if (!raiz) throw new Error('no hay ninguna página "Meta" compartida con la integración');

  const tareasDbId = (await buscarHija(env, raiz.id, 'Tareas y exámenes')) || (await crearDbTareas(env, raiz.id));
  const apuntesDbId = (await buscarHija(env, raiz.id, 'Apuntes')) || (await crearDbApuntes(env, raiz.id));

  const registro = { tareasDbId, apuntesDbId, ultima: Date.now() };
  await env.META_DATOS.put(clave, JSON.stringify(registro));
  return registro;
}

export async function estadoConexion(env, codigo) {
  const g = await env.META_DATOS.get(`notion:${codigo}`, 'json');
  return { conectado: !!(g?.tareasDbId && g?.apuntesDbId), ultima: g?.ultima || null };
}

export async function conectar(env, codigo) {
  return asegurarEstructura(env, codigo);
}

export async function desconectar(env, codigo) {
  // No borra nada de su Notion: es contenido suyo, solo deja de sincronizar.
  await env.META_DATOS.delete(`notion:${codigo}`);
}

/* ------------------------------ tareas (empuje) ----------------------------- */

function propsTarea(t, nombreAsig) {
  return {
    Nombre: { title: [{ text: { content: t.titulo } }] },
    Asignatura: nombreAsig ? { select: { name: nombreAsig } } : { select: null },
    Tipo: { select: { name: t.tipo === 'examen' ? 'Examen' : 'Tarea' } },
    Fecha: { date: { start: t.fecha } },
    Hecho: { checkbox: !!t.hecho },
    Notas: { rich_text: t.notas ? [{ text: { content: t.notas.slice(0, 1900) } }] : [] },
  };
}

async function sincronizarTareas(env, codigo, tareasDbId, buzon) {
  const asignaturas = buzon?.claves?.asignaturas?.datos || [];
  const tareas = buzon?.claves?.tareas?.datos || [];
  const nombreDe = id => asignaturas.find(a => a.id === id)?.nombre || null;

  const mk = `notionTareaMap:${codigo}`;
  const mapa = (await env.META_DATOS.get(mk, 'json')) || {};
  const vivos = new Set(tareas.map(t => t.id));

  for (const [tareaId, pageId] of Object.entries(mapa)) {
    if (vivos.has(tareaId)) continue;
    await notion(env, 'PATCH', `/pages/${pageId}`, { archived: true }).catch(() => {});
    delete mapa[tareaId];
  }

  for (const t of tareas) {
    const props = propsTarea(t, nombreDe(t.asignaturaId));
    if (mapa[t.id]) {
      try { await notion(env, 'PATCH', `/pages/${mapa[t.id]}`, { properties: props }); continue; }
      catch { delete mapa[t.id]; } // pudo borrarse a mano en Notion
    }
    const r = await notion(env, 'POST', '/pages', { parent: { database_id: tareasDbId }, properties: props });
    mapa[t.id] = r.id;
  }

  await env.META_DATOS.put(mk, JSON.stringify(mapa));
}

/* ------------------------------ apuntes (empuje) ---------------------------- */

function bloquesDeTexto(texto) {
  const partes = (texto || '').split(/\n{2,}/).filter(Boolean);
  const lista = partes.length ? partes : [texto || ''];
  return lista.slice(0, 90).map(p => ({
    object: 'block', type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: p.slice(0, 1900) } }] },
  }));
}

async function reemplazarContenido(env, pageId, texto) {
  const hijos = await notion(env, 'GET', `/blocks/${pageId}/children?page_size=100`);
  for (const b of hijos.results || []) await notion(env, 'DELETE', `/blocks/${b.id}`).catch(() => {});
  const bloques = bloquesDeTexto(texto);
  if (bloques.length) await notion(env, 'PATCH', `/blocks/${pageId}/children`, { children: bloques });
}

async function sincronizarApuntes(env, codigo, apuntesDbId, buzon) {
  const asignaturas = buzon?.claves?.asignaturas?.datos || [];
  const apuntes = (buzon?.claves?.apuntesMeta?.datos || []).filter(a => a.tipo === 'texto');
  const nombreDe = id => asignaturas.find(a => a.id === id)?.nombre || null;

  const mk = `notionApunteMap:${codigo}`;
  const mapa = (await env.META_DATOS.get(mk, 'json')) || {};
  const vivos = new Set(apuntes.map(a => a.id));

  for (const [apunteId, pageId] of Object.entries(mapa)) {
    if (vivos.has(apunteId)) continue;
    await notion(env, 'PATCH', `/pages/${pageId}`, { archived: true }).catch(() => {});
    delete mapa[apunteId];
  }

  for (const a of apuntes) {
    const props = {
      Título: { title: [{ text: { content: a.titulo } }] },
      Asignatura: nombreDe(a.asignaturaId) ? { select: { name: nombreDe(a.asignaturaId) } } : { select: null },
      Fecha: { date: { start: a.fecha } },
    };
    if (mapa[a.id]) {
      try {
        await notion(env, 'PATCH', `/pages/${mapa[a.id]}`, { properties: props });
        await reemplazarContenido(env, mapa[a.id], a.texto);
        continue;
      } catch { delete mapa[a.id]; }
    }
    const r = await notion(env, 'POST', '/pages', { parent: { database_id: apuntesDbId }, properties: props, children: bloquesDeTexto(a.texto) });
    mapa[a.id] = r.id;
  }

  await env.META_DATOS.put(mk, JSON.stringify(mapa));
}

/* ------------------------------ apuntes (arrastre) -------------------------
   Filas de la base "Apuntes" que él haya creado a mano en Notion (su id no
   está en el mapa): se traen a Meta como apunte de texto nuevo. */

async function textoDePagina(env, pageId) {
  const hijos = await notion(env, 'GET', `/blocks/${pageId}/children?page_size=100`);
  return (hijos.results || [])
    .map(b => (b[b.type]?.rich_text || []).map(rt => rt.plain_text).join(''))
    .filter(Boolean)
    .join('\n\n');
}

async function traerApuntesNuevos(env, codigo, apuntesDbId, buzon) {
  const mk = `notionApunteMap:${codigo}`;
  const mapa = (await env.META_DATOS.get(mk, 'json')) || {};
  const idsConocidos = new Set(Object.values(mapa));

  const r = await notion(env, 'POST', `/databases/${apuntesDbId}/query`, { page_size: 100 });
  const nuevas = (r.results || []).filter(p => !p.archived && !idsConocidos.has(p.id));
  if (!nuevas.length) return null;

  const asignaturas = buzon?.claves?.asignaturas?.datos || [];
  const asignaturaIdDe = nombre => asignaturas.find(a => a.nombre.toLowerCase() === (nombre || '').toLowerCase())?.id;

  const actuales = buzon?.claves?.apuntesMeta?.datos || [];
  const añadidos = [];
  for (const p of nuevas) {
    const titulo = p.properties?.Título?.title?.[0]?.plain_text || 'Sin título';
    const asigNombre = p.properties?.Asignatura?.select?.name || null;
    const fecha = p.properties?.Fecha?.date?.start || (p.created_time || '').slice(0, 10);
    const texto = await textoDePagina(env, p.id);
    const id = 'p' + p.id.replace(/-/g, '').slice(0, 16);
    mapa[id] = p.id;
    añadidos.push({ id, asignaturaId: asignaturaIdDe(asigNombre), tipo: 'texto', titulo, texto, fecha });
  }

  await env.META_DATOS.put(mk, JSON.stringify(mapa));
  return [...actuales, ...añadidos];
}

/* ---------------------------------- todo junto ------------------------------ */

export async function reconciliar(env, codigo, buzon) {
  const g = await env.META_DATOS.get(`notion:${codigo}`, 'json');
  if (!g?.tareasDbId || !g?.apuntesDbId) return;

  await sincronizarTareas(env, codigo, g.tareasDbId, buzon);
  await sincronizarApuntes(env, codigo, g.apuntesDbId, buzon);

  const traidos = await traerApuntesNuevos(env, codigo, g.apuntesDbId, buzon);
  if (traidos) await fusionar(env.META_DATOS, codigo, { claves: { apuntesMeta: { ts: Date.now(), datos: traidos } } });

  g.ultima = Date.now();
  await env.META_DATOS.put(`notion:${codigo}`, JSON.stringify(g));
}
