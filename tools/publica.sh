#!/bin/bash
# Publicar = subir versión + auditar + desplegar. Siempre junto.
# Si la versión no sube, el service worker sirve lo viejo desde caché y el
# cambio "no aparece" en los móviles aunque el despliegue haya ido bien.
set -e
cd "$(dirname "$0")/.."

# Lo desplegado tiene que ser EXACTAMENTE lo que hay en GitHub. Con cambios sin
# commitear se desplegaría algo que no está en ningún sitio más: si luego se
# pierde el Mac, producción tendría código que no existe en el repo. (Pasó con la
# 2.0.28: el salto de versión se quedó sin commit.)
if [ -z "$PUBLICA_SUCIO" ] && [ -n "$(git status --porcelain)" ]; then
  echo "❌ hay cambios sin commitear:"; git status --short | head -10
  echo "   Commitea antes de publicar (o PUBLICA_SUCIO=1 para saltarlo a propósito)."; exit 1
fi

ACTUAL=$(grep -o "APP_VERSION = '[^']*'" app/shell.js | cut -d"'" -f2)
NUEVA=$(echo "$ACTUAL" | awk -F. '{printf "%d.%d.%d", $1, $2, $3+1}')

sed -i '' "s/APP_VERSION = '$ACTUAL'/APP_VERSION = '$NUEVA'/" app/shell.js
sed -i '' "s/version: '$ACTUAL'/version: '$NUEVA'/" app/js/core/registry.js
# Sin esto, sw.js sale idéntico en cada despliegue y Safari NO se entera de que
# hay versión nueva: el iPhone se queda congelado para siempre. Ver app/sw.js.
sed -i '' "s|shell.js?v=$ACTUAL|shell.js?v=$NUEVA|" app/sw.js
# El rescate de versión tiene que llevar SIEMPRE la versión que se publica: si
# se queda atrás, deja de detectar la caché vieja y vuelve el HTML nuevo con el
# JavaScript viejo. Ver app/arranque.js.
sed -i '' "s|var VERSION = '$ACTUAL'|var VERSION = '$NUEVA'|" app/arranque.js
sed -i '' "s|arranque.js?v=$ACTUAL|arranque.js?v=$NUEVA|" app/index.html
# El README tiene que decir la versión que se publica (la auditoría lo exige).
sed -i '' "s/Versión desplegada: \*\*[0-9.]*\*\*/Versión desplegada: **$NUEVA**/" README.md
echo "versión $ACTUAL → $NUEVA"

node tools/audita.mjs

# Guard: ninguna prueba puede quedarse fuera de esta lista. Las de arriba van
# nombradas una a una a propósito (cada una dice qué se rompe si falla), pero
# una lista a mano se queda vieja sin avisar — esto lo caza.
for p in tools/prueba-*.mjs; do
  [ -e "$p" ] || continue
  grep -q "$(basename "$p")" "$0" || { echo "❌ $p existe y no se ejecuta al publicar: añádela arriba"; exit 1; }
done
# El feed de calendario es lo único que consume un programa ajeno (Apple
# Calendar, Google, Outlook): un formato mal puesto no se ve en la app, se ve
# en que el calendario no sincroniza. Sin red, pasa siempre.
node tools/prueba-ics.mjs > /dev/null || { echo '❌ el feed de calendario falla'; exit 1; }
echo '✅ feed de calendario correcto'
# Lo que acaba dentro del documento que NotebookLM lee como fuente. Lo que más
# vigila: que no se cuele contenido de una asignatura en el dossier de otra —
# eso daría respuestas mezcladas sin que se note desde ningún sitio.
node tools/prueba-dossier.mjs > /dev/null || { echo '❌ el dossier de NotebookLM falla'; exit 1; }
echo '✅ dossier de NotebookLM correcto'
# El único sitio donde META decide algo: estado, prioridades y planes. Un
# error aquí no se ve, da números falsos y se cree.
node tools/prueba-motor.mjs > /dev/null || { echo '❌ el motor (prioridades y planes) falla'; exit 1; }
echo '✅ motor correcto'
# Cambiar el enlace del calendario tiene que cortar el viejo de verdad.
node tools/prueba-feed.mjs > /dev/null || { echo '❌ el enlace del calendario falla'; exit 1; }
echo '✅ enlace del calendario correcto'
# Entrar con Google: sin la cookie de state se tiene que seguir entrando.
node tools/prueba-vinculo.mjs > /dev/null || { echo '❌ entrar con Google falla'; exit 1; }
echo '✅ entrar con Google correcto'
# Calendario del instituto (P5): solo exámenes y entregas, sin bucles con Outlook.
node tools/prueba-calendario-centro.mjs > /dev/null || { echo '❌ el calendario del instituto falla'; exit 1; }
echo '✅ calendario del instituto correcto'
# Las horas de estudio entran solas desde el calendario: un fallo aquí no se
# ve, se cree (horas de más, o de la asignatura que no es).
node tools/prueba-estudio-calendario.mjs > /dev/null || { echo '❌ el estudio desde el calendario falla'; exit 1; }
echo '✅ estudio desde el calendario correcto'
# Fusionar asignaturas toca ocho secciones a la vez: una referencia colgando no
# se ve, solo faltan horas, casillas o apuntes.
node tools/prueba-asignaturas.mjs > /dev/null || { echo '❌ fusionar asignaturas o el temario falla'; exit 1; }
echo '✅ asignaturas y temario correctos'
# Archivos de más de 20 MB: van en trozos; un trozo mal pegado corrompe un PDF sin avisar.
node tools/prueba-archivos-grandes.mjs > /dev/null || { echo '❌ los archivos grandes fallan'; exit 1; }
echo '✅ archivos grandes correctos'
# Lector de PDF propio y esquema de un archivo-tema: si falla, un temario con
# texto de verdad vuelve a leerse como "sin apartados" y nadie se entera.
node tools/prueba-pdf-texto.mjs > /dev/null || { echo '❌ el lector de PDF o el esquema falla'; exit 1; }
echo '✅ lector de PDF correcto'
# La vigilancia: cada alarma tiene que sonar cuando toca y no sonar sin motivo.
node tools/prueba-vigilancia.mjs > /dev/null || { echo '❌ la vigilancia falla'; exit 1; }
echo '✅ vigilancia correcta'
# Sacar los temas de un PDF/Word/foto: un tema que falta o con otro número no se
# ve, se cree. Textos tal como los suelta un PDF de verdad.
node tools/prueba-temario.mjs > /dev/null || { echo '❌ leer el temario de un archivo falla'; exit 1; }
echo '✅ lectura del temario correcta'
# Las fotos de apuntes se reducen y nunca se pierden.
node tools/prueba-foto.mjs > /dev/null || { echo '❌ la reducción de fotos falla'; exit 1; }
echo '✅ reducción de fotos correcta'
# El enlace de carpeta pide a iCloud los archivos que solo están en la nube.
node tools/prueba-enlace.mjs > /dev/null || { echo '❌ el enlace de carpeta falla'; exit 1; }
echo '✅ enlace de carpeta correcto'
npx wrangler deploy 2>&1 | tail -3

URL="https://meta.beltranfersan.workers.dev"
echo "esperando propagación entre edges…"
V=""
for i in $(seq 1 24); do
  sleep 5
  V=$(curl -s -m 20 "$URL/shell.js?x=$(date +%s%N)" | grep -o "APP_VERSION = '[^']*'" | cut -d"'" -f2)
  [ "$V" = "$NUEVA" ] && break
done
if [ "$V" = "$NUEVA" ]; then
  echo "✅ producción sirve la versión $V"

  SW=""
  for i in $(seq 1 24); do
    SW=$(curl -s -m 20 "$URL/sw.js?x=$(date +%s%N)" | grep -o "shell\.js?v=[^']*" | cut -d= -f2)
    [ "$SW" = "$NUEVA" ] && break
    sleep 5
  done
  [ "$SW" = "$NUEVA" ] && echo "✅ sw.js nuevo en producción (?v=$SW): el iPhone verá el cambio" \
                       || { echo "❌ sw.js sirve '?v=$SW' y toca '$NUEVA': el iPhone NO recibiría el cambio"; exit 1; }

  SALUD=$(curl -s -m 20 "$URL/api/salud?x=$(date +%s%N)")
  LIM=$(echo "$SALUD" | grep -o '"limitador":"[^"]*"' | cut -d'"' -f4)
  [ "$LIM" = "activo" ] && echo "✅ limitador de peticiones activo" \
                        || { echo "❌ limitador NO activo (dice: '$LIM')"; exit 1; }

  # Sin el binding a cuentas NADIE puede registrarse ni entrar por correo: la
  # app quedaría inservible y el despliegue diría que fue bien. Reintenta
  # como el resto: justo tras desplegar puede tardar un pase en calentar.
  CUE=$(echo "$SALUD" | grep -o '"cuentas":"[^"]*"' | cut -d'"' -f4)
  for i in $(seq 1 6); do
    [ "$CUE" = "listas" ] && break
    sleep 5
    CUE=$(curl -s -m 20 "$URL/api/salud?x=$(date +%s%N)" | grep -o '"cuentas":"[^"]*"' | cut -d'"' -f4)
  done
  [ "$CUE" = "listas" ] && echo "✅ identidad compartida (cuentas) responde" \
                        || { echo "❌ cuentas NO operativas (dice: '$CUE')"; exit 1; }

  FALTAN=""
  CAB=$(curl -sI -m 20 "$URL/?x=$(date +%s%N)")
  for h in content-security-policy x-frame-options strict-transport-security cross-origin-opener-policy; do
    echo "$CAB" | grep -qi "^$h" || FALTAN="$FALTAN $h"
  done
  [ -z "$FALTAN" ] && echo "✅ cabeceras de seguridad presentes" \
                   || { echo "❌ faltan cabeceras:$FALTAN"; exit 1; }
else
  echo "⚠️  tras 2 min producción sigue sirviendo '$V' y esperábamos '$NUEVA'"
  exit 1
fi

# El salto de versión se commitea AQUÍ, con producción ya verificada (el README ya
# lo refleja, ver arriba): antes se hacía a mano y se olvidaba (el README llegó a
# decir 2.0.23 con la 2.0.37 en producción).
git add app/shell.js app/sw.js app/arranque.js app/index.html app/js/core/registry.js README.md
git commit -q -m "Publicada la v$NUEVA

Co-Authored-By: Claude <noreply@anthropic.com>" || true

# GitHub va AL FINAL, con producción ya verificada: un fallo aquí solo avisa
# (lo desplegado ya está bien) en vez de tumbar la publicación. Mismo criterio
# que bolsa y salud. Si no hay remoto configurado, no dice nada.
if git remote get-url origin > /dev/null 2>&1; then
  echo "subiendo commits a GitHub…"
  git push origin main || echo "⚠️  no se pudo subir a GitHub — revisar a mano con: git push"
fi

# La misma vigilancia que corre sola cada 6 h desde GitHub, ahora mismo y contra
# lo recién desplegado. Informativa: ya se ha desplegado y subido, no se puede
# deshacer aquí, pero así se ve en el acto si algo de fuera (Google, el script
# del estudio…) o algo que el despliegue no ha cubierto está mal.
echo "vigilando producción…"
node tools/vigila.mjs | sed -n '1,25p' || echo "⚠️  la vigilancia encuentra fallos: ver arriba (también se abrirá una incidencia en GitHub)"

