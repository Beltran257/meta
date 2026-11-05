# meta: instrucciones para Claude Code

## Al abrir un chat nuevo (obligatorio, sin que se pida)

Antes de proponer nada, ponte al día leyendo el proyecto entero:

1. `README.md` y este archivo.
2. `git log --oneline -15`, `git status -sb` y las ramas (`git branch -a`).
3. La estructura de `app/`, `worker/` y `tools/`, y las pruebas existentes.
4. `vigila-informe.md` si existe.

Después responde en pocas líneas: versión desplegada, qué está hecho, qué
falta de verdad (comprobado en el código, no de memoria) y modelo/esfuerzo
recomendados. No des por pendiente nada que el código ya haga, ni por hecho
nada que no puedas verificar.

## Estado (actualizar al cerrar cada trabajo)

- Versión desplegada: 2.0.48. GitHub al día, pruebas en verde.
- Pendientes: ninguno registrado. Lo anotado en chats anteriores (limpieza de
  apuntes y exámenes, marcado de temas por examen, temarios, repos privados de
  otros proyectos, ramas `auditoria/…`) se da por resuelto o descartado.
- Si aparece trabajo nuevo, anótalo aquí en lugar de depender del chat.
