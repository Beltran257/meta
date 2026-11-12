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

## Estado (actualizar al cerrar cada trabajo; a 12 nov 2026)

- Versión desplegada: 2.0.51 (vigilancia del 10 nov en verde; temario por bloques con puntos como subtemas desde la 2.0.49; histórico con la hora de la primera clase para Salud desde la 2.0.50). Se trabaja en `main`, al día con `origin`.
- Estudio desde el calendario revisado el 12 nov con datos reales: el script envía cada hora y las sesiones guardadas coincidían con las calculadas. Los bloques que se pisan ahora reparten el tiempo común por igual (`repartirMinutos`, en `core/calendario.js`): con sus datos, 9 tareas hechas que sumaban 0 min pasan a contar y el total no cambia (88,3 h). Hecho en código y GitHub; **sin publicar** (falta `tools/publica.sh`, que pide orden explícita).
- Pendientes: ninguno registrado.
