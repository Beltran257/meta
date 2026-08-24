#!/bin/bash
# Publicar = subir versión + auditar + desplegar. Siempre junto.
# Si la versión no sube, el service worker sirve lo viejo desde caché y el
# cambio "no aparece" en los móviles aunque el despliegue haya ido bien.
set -e
cd "$(dirname "$0")/.."

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
echo "versión $ACTUAL → $NUEVA"

node tools/audita.mjs
# El feed de calendario es lo único que consume un programa ajeno (Apple
# Calendar, Google, Outlook): un formato mal puesto no se ve en la app, se ve
# en que el calendario no sincroniza. Sin red, pasa siempre.
node tools/prueba-ics.mjs > /dev/null || { echo '❌ el feed de calendario falla'; exit 1; }
echo '✅ feed de calendario correcto'
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
