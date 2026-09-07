#!/bin/bash
# Instala el enlace de carpeta: guarda la clave y da de alta un LaunchAgent
# que ejecuta tools/enlace-carpeta.mjs al iniciar sesión y cada pocos minutos.
# Uso: ./tools/instala-enlace.sh <clave>   (la clave sale de Perfil → Enlace de carpeta)
set -e
cd "$(dirname "$0")/.."

TOKEN="${1:?Uso: ./tools/instala-enlace.sh <clave>  (genérala en Perfil → Enlace de carpeta)}"
SOPORTE="$HOME/Library/Application Support/Meta"
# El LaunchAgent NO ejecuta el script desde el repositorio. `~/Documents` está
# sincronizado con iCloud, iCloud va expulsando archivos que no se tocan
# ("dataless"), y cuando le toca a este el agente no puede materializarlo:
# node revienta con `Unknown system error -11 (EAGAIN)` al leer el propio
# archivo, antes de ejecutar ni una línea. Pasó de verdad: estuvo fallando
# cada 3 minutos, dejando 700 KB de log, sin que nada lo dijera.
# Se copia a Application Support, que no está en iCloud, y de ahí se ejecuta.
SCRIPT_ORIGEN="$(pwd)/tools/enlace-carpeta.mjs"
SCRIPT="$SOPORTE/enlace-carpeta.mjs"
NODE="$(command -v node)"
PLIST="$HOME/Library/LaunchAgents/com.beltran.meta.enlace.plist"
CARPETA="${META_CARPETA:-/Users/Beltran/Desktop/ /2º BACHILLERATO}"

if [ ! -d "$CARPETA" ]; then
  echo "❌ No encuentro la carpeta: $CARPETA"
  echo "   Si la moviste, pásala con: META_CARPETA=\"/ruta/nueva\" ./tools/instala-enlace.sh $TOKEN"
  exit 1
fi
if [ -z "$NODE" ]; then
  echo "❌ No encuentro 'node' en el PATH."
  exit 1
fi

mkdir -p "$SOPORTE"
printf '%s' "$TOKEN" > "$SOPORTE/token"
chmod 600 "$SOPORTE/token"

# La copia que de verdad se ejecuta. Si algún día se toca el script del
# repositorio, hay que volver a lanzar este instalador para que la copia se
# actualice — es el precio de no depender de iCloud, y es barato.
cp "$SCRIPT_ORIGEN" "$SCRIPT"
chmod +x "$SCRIPT"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.beltran.meta.enlace</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$SCRIPT</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>META_CARPETA</key><string>$CARPETA</string>
  </dict>
  <key>StartInterval</key><integer>180</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$SOPORTE/registro.log</string>
  <key>StandardErrorPath</key><string>$SOPORTE/registro.log</string>
</dict>
</plist>
EOF

# El registro crece sin freno (el agente corre cada 3 minutos). Si ya pesa
# más de 1 MB se empieza de cero: lo que importa son las últimas ejecuciones,
# y un log de megas es un log que nadie abre.
if [ -f "$SOPORTE/registro.log" ] && [ "$(wc -c < "$SOPORTE/registro.log")" -gt 1048576 ]; then
  : > "$SOPORTE/registro.log"
fi

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "✅ Enlazado. Revisa cada ~3 min (y también ahora mismo, al arrancar)."
echo "   Registro: $SOPORTE/registro.log"
echo "   Prueba: suelta un PDF o una foto en una carpeta de asignatura y espera un momento."
