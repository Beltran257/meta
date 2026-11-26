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

- 26 nov 2026 (fase 3 de Centralita), 2.0.56: puerta de lectura `/api/conector/` para Centralita (`worker/conector.js`): solo entre Workers, con testigo de conector verificado contra `cuentas` y permiso de cada acción; no escribe nada. Regla del auditor y `tools/prueba-conector.mjs` con datos de ejemplo (repo público). Rutas: `hoy` (`meta:hoy`), `agenda` (`meta:agenda`, función nueva `agendaPendiente`) y `dias` (`meta:dias`, hasta 60 fechas). Busca el espacio por correo y uid SIN crearlo (la entrada normal sí crea).
- Versión desplegada: 2.0.56 (26 nov: la puerta del conector; 2.0.55, subida de nota; 21 nov: nota de cada examen; 13 nov: enlace a los permisos de Claude en Perfil → Cuenta; vigilancia del 12 nov en verde; temario por bloques con puntos como subtemas desde la 2.0.49; histórico con la hora de la primera clase para Salud desde la 2.0.50). Se trabaja en `main`, al día con `origin`.
- Estudio desde el calendario revisado el 12 nov con datos reales: el script envía cada hora y las sesiones guardadas coincidían con las calculadas. Los bloques que se pisan ahora reparten el tiempo común por igual (`repartirMinutos`, en `core/calendario.js`): con sus datos, 9 tareas hechas que sumaban 0 min pasan a contar y el total no cambia (88,3 h). Publicado en la 2.0.52 (12 nov).
- Pendientes (a 18 nov 2026): hay trabajo SIN commitear del 17 nov, de una sesión anterior: la puerta de lectura del conector de Claude (fase 3 de Centralita), con `worker/conector.js` (nuevo), `agendaPendiente` en `worker/briefing.js` y el enganche de `/api/conector/` en `worker/index.js`. Está a medias: no tiene prueba propia (haría falta `tools/prueba-conector.mjs` y añadirla a `publica.sh`), los permisos `meta:hoy`, `meta:agenda` y `meta:dias` no constan en `cuentas` ni en Centralita (sin ellos respondería 403) y no está publicado. Auditoría y pruebas pasan con ese trabajo en el árbol. Se retomará con el plan de Centralita (`../centralita/docs/plan-maestro.md`); cambia `cuentas`, así que máximo cuidado.
- **21 nov 2026, publicada en la 2.0.54: nota de cada examen.** Puntuar exámenes hechos (aproximada y luego oficial), enlazados a `notas` con `examenId`; resultados en Exámenes y una tarjeta en Análisis; aviso en Hoy; campos nuevos y aditivos para Salud (`examen_nota`, `examen_nota_aprox` en el histórico) y el briefing (`examenesSinPuntuar`). Prueba nueva `tools/prueba-notas-examenes.mjs` (ya en `publica.sh`). Probado en el navegador con sesión simulada. Falta: que Salud y Morning Briefing USEN los campos nuevos (en cada uno, en su chat: ambos tenían cambios sin commitear del conector el 21 nov).
- **26 nov 2026, publicada en la 2.0.55: subida de nota** (repetir un examen; cuenta la mayor). Se apunta desde la hoja del examen; `valor` sigue siendo la nota que cuenta y se añaden `valorInicial`/`aproxInicial`/`subidas` (ver README). Prueba ampliada en `tools/prueba-notas-examenes.mjs` y probado en el navegador con sesión simulada (apuntar, ver en Exámenes y quitar). Para publicar se apartó el trabajo del conector con `git stash` y se recuperó después (sigue sin commitear). Salud recibe el primer intento como `examen_nota`; si Beltrán quiere también la nota final, sería un campo nuevo. Ojo: `publica.sh` se niega a desplegar con el árbol sucio, así que el conector sin commitear obliga a apartarlo cada vez que se publique.
- Descartado el 18 nov 2026: TimeNavi (conector de calendario para hojas de horas). Cuenta clases y vida normal, no estudio; las horas de estudio salen de Google Tasks, que no ve; es de pago y daría a un tercero acceso a la agenda.
