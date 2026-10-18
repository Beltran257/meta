/* ===========================================================================
   EL APPS SCRIPT DEL ESTUDIO — el código que él pega en script.google.com.

   Vive en SU cuenta de Google y lee lo suyo (bloques de tareas del
   calendario, la casilla de cada tarea, las particulares del calendario del
   horario) sin que META tenga que pedir permisos a Google: ver por qué en
   worker/estudio.js. Cada hora manda los datos EN BRUTO a
   /api/estudio/recibir; la lógica (qué es hecho, qué asignatura) no está
   aquí sino en META, donde está probada (tools/prueba-estudio-calendario.mjs).

   Solo manda lo justo: de cada bloque, el id, el título, las horas y el
   enlace a su tarea — no la descripción entera ni nada del resto del
   calendario.

   Se genera desde Perfil con la clave del script ya dentro. Las APIs van como
   "servicios avanzados" (declarados en el manifiesto): se activan solos en el
   proyecto del script, sin pasar por la consola de Google Cloud.
   =========================================================================== */

export const MANIFIESTO = JSON.stringify({
  timeZone: 'Europe/Madrid',
  runtimeVersion: 'V8',
  exceptionLogging: 'STACKDRIVER',
  dependencies: {
    enabledAdvancedServices: [
      { userSymbol: 'Calendar', serviceId: 'calendar', version: 'v3' },
      { userSymbol: 'Tasks', serviceId: 'tasks', version: 'v1' },
    ],
  },
  oauthScopes: [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/tasks.readonly',
    'https://www.googleapis.com/auth/script.external_request',
    'https://www.googleapis.com/auth/script.scriptapp',
  ],
}, null, 2);

/** El Código.gs, listo para pegar. `clave` es la que da /api/estudio/clave. */
export function codigoScript({ origen, clave, desde }) {
  return `// Meta · estudio desde tu calendario
// Lee tus tareas con hora de Google Tasks (y si las marcaste como hechas) y
// tus clases particulares, y se lo manda a Meta cada hora. Solo lee: no
// cambia nada de tu calendario ni de tus tareas.
//
// Para instalarlo: elige la función "instalar" arriba y pulsa Ejecutar.

var META = ${JSON.stringify(origen)};
var CLAVE = ${JSON.stringify(clave)};
var DESDE = ${JSON.stringify(desde)};

function instalar() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('enviar').timeBased().everyHours(1).create();
  enviar();
}

function todas(pedir) {
  var salida = [], token;
  do {
    var r = pedir(token);
    salida = salida.concat(r.items || []);
    token = r.nextPageToken;
  } while (token);
  return salida;
}

function enviar() {
  var timeMin = new Date(DESDE + 'T00:00:00Z').toISOString();
  var timeMax = new Date().toISOString();
  var RE_TAREA = /tasks\\.google\\.com\\/task\\/[A-Za-z0-9_-]+/;

  var eventos = todas(function (p) {
    return Calendar.Events.list('primary', { timeMin: timeMin, timeMax: timeMax, singleEvents: true, orderBy: 'startTime', maxResults: 2500, pageToken: p });
  }).filter(function (e) { return RE_TAREA.test(e.description || ''); })
    .map(function (e) {
      return { id: e.id, summary: e.summary, description: RE_TAREA.exec(e.description)[0], start: e.start, end: e.end, status: e.status };
    });

  var tareas = [];
  todas(function (p) { return Tasks.Tasklists.list({ maxResults: 100, pageToken: p }); }).forEach(function (l) {
    todas(function (p) {
      return Tasks.Tasks.list(l.id, { showCompleted: true, showHidden: true, updatedMin: timeMin, maxResults: 100, pageToken: p });
    }).forEach(function (t) {
      tareas.push({ id: t.id, title: t.title, status: t.status, due: t.due, webViewLink: t.webViewLink, lista: l.title });
    });
  });

  var particulares = [];
  todas(function (p) { return Calendar.CalendarList.list({ minAccessRole: 'owner', pageToken: p }); })
    .filter(function (c) { return !c.primary; })
    .forEach(function (c) {
      todas(function (p) {
        return Calendar.Events.list(c.id, { timeMin: timeMin, timeMax: timeMax, singleEvents: true, maxResults: 2500, pageToken: p });
      }).filter(function (e) { return /particular/i.test(e.summary || ''); })
        .forEach(function (e) { particulares.push({ id: e.id, summary: e.summary, start: e.start, end: e.end, status: e.status }); });
    });

  var r = UrlFetchApp.fetch(META + '/api/estudio/recibir', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + CLAVE },
    payload: JSON.stringify({ eventos: eventos, tareas: tareas, particulares: particulares }),
    muteHttpExceptions: true,
  });
  if (r.getResponseCode() !== 200) {
    throw new Error('Meta ha respondido ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
  }
  Logger.log('Enviado a Meta: ' + r.getContentText());
}
`;
}
