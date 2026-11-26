# meta: planificador de estudio

## Al abrir un chat nuevo (obligatorio, sin que se pida)

Antes de proponer nada, ponte al día leyendo el proyecto:

1. Este archivo y `README.md`.
2. `git log --oneline -15`, `git status -sb` y `git branch -a` (en qué rama se
   trabaja y si `main` va por detrás).
3. Recorre `app/` (PWA sin framework), `worker/` y `tools/`; lee
   `vigila-informe.md` si existe.
4. Ejecuta las pruebas: `npm run audita && npm run prueba` (el hook de
   `pre-push` las repite).

Después responde en pocas líneas: versión, qué está hecho, qué falta de verdad
(comprobado en el código, no de memoria ni del texto de traspaso) y
modelo/esfuerzo recomendados. Si algo de «Estado» ya no es cierto, corrígelo.

## Cuidado en este proyecto

- **Repo público**: nada personal en código, pruebas, commits ni en este
  archivo. Ejemplos neutros.
- Identidad compartida vía `cuentas`; morning-briefing, salud y revisor leen
  de aquí. Si cambia un contrato, revísalos.
- Desplegar solo con `tools/publica.sh`.

## Estado (actualizar al cerrar cada trabajo; a 26 nov 2026)

- **26 nov 2026 (fase 4 de Centralita), 2.0.57: tareas que no se pisan y escrituras del conector.** `tareas` se une por elemento (`mod` por tarea, lápidas en la sección nueva `borrados`, regla en `app/js/core/union.js` compartida por aparato y servidor; una app vieja une pero no borra). El conector de Claude puede apuntar, marcar hecha, mover, borrar y restaurar tareas (`worker/escrituras.js`, rutas POST de `/api/conector/`); lo que escribe va también a `conector:bandeja:<espacio>`, que `fusionar` vuelve a unir por si un aparato pisa el buzón con una copia vieja de KV. `ponerAlDia` (calendarios) sacado de `/api/datos` y usado por las dos. Pruebas: `tools/prueba-union.mjs` (nueva, en `publica.sh`) y `prueba-conector.mjs` ampliada; regla del auditor ampliada. Probado en el navegador con dos aparatos (dos puertos) contra un servidor local con el `fusionar` real.
- 26 nov 2026 (fase 3 de Centralita), 2.0.56: puerta de lectura `/api/conector/` para Centralita (`worker/conector.js`): solo entre Workers, con testigo de conector verificado contra `cuentas` y permiso de cada acción; no escribe nada. Regla del auditor y `tools/prueba-conector.mjs` con datos de ejemplo (repo público). Rutas: `hoy` (`meta:hoy`), `agenda` (`meta:agenda`, función nueva `agendaPendiente`) y `dias` (`meta:dias`, hasta 60 fechas). Busca el espacio por correo y uid SIN crearlo (la entrada normal sí crea).
- Versión desplegada: 2.0.57 (26 nov: tareas por elemento y escrituras del conector; 2.0.56, la puerta del conector; 2.0.55, subida de nota; 21 nov: nota de cada examen; 13 nov: enlace a los permisos de Claude en Perfil → Cuenta; vigilancia del 12 nov en verde; temario por bloques con puntos como subtemas desde la 2.0.49; histórico con la hora de la primera clase para Salud desde la 2.0.50). Se trabaja en `main`, al día con `origin`.
- Estudio desde el calendario revisado el 12 nov con datos reales: el script envía cada hora y las sesiones guardadas coincidían con las calculadas. Los bloques que se pisan ahora reparten el tiempo común por igual (`repartirMinutos`, en `core/calendario.js`): con sus datos, 9 tareas hechas que sumaban 0 min pasan a contar y el total no cambia (88,3 h). Publicado en la 2.0.52 (12 nov).
- **21 nov 2026, publicada en la 2.0.54: nota de cada examen.** Puntuar exámenes hechos (aproximada y luego oficial), enlazados a `notas` con `examenId`; resultados en Exámenes y una tarjeta en Análisis; aviso en Hoy; campos nuevos y aditivos para Salud (`examen_nota`, `examen_nota_aprox` en el histórico) y el briefing (`examenesSinPuntuar`). Prueba nueva `tools/prueba-notas-examenes.mjs` (ya en `publica.sh`). Probado en el navegador con sesión simulada. Falta: que Salud y Morning Briefing USEN los campos nuevos (en cada uno, en su chat: ambos tenían cambios sin commitear del conector el 21 nov).
- **26 nov 2026, publicada en la 2.0.55: subida de nota** (repetir un examen; cuenta la mayor). Se apunta desde la hoja del examen; `valor` sigue siendo la nota que cuenta y se añaden `valorInicial`/`aproxInicial`/`subidas` (ver README). Prueba ampliada en `tools/prueba-notas-examenes.mjs` y probado en el navegador con sesión simulada (apuntar, ver en Exámenes y quitar). Salud recibe el primer intento como `examen_nota`; si Beltrán quiere también la nota final, sería un campo nuevo.
- Descartado el 18 nov 2026: TimeNavi (conector de calendario para hojas de horas). Cuenta clases y vida normal, no estudio; las horas de estudio salen de Google Tasks, que no ve; es de pago y daría a un tercero acceso a la agenda.
