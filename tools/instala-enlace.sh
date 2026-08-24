#!/bin/bash
# Instala el enlace de carpeta: guarda la clave y da de alta un LaunchAgent
# que ejecuta tools/enlace-carpeta.mjs al iniciar sesión y cada pocos minutos.
# Uso: ./tools/instala-enlace.sh <clave>   (la clave sale de Perfil → Enlace de carpeta)
set -e
cd "$(dirname "$0")/.."

TOKEN="${1:?Uso: ./tools/instala-enlace.sh <clave>  (genérala en Perfil → Enlace de carpeta)}"
SOPORTE="$HOME/Library/Application Support/Meta"
SCRIPT="$(pwd)/tools/enlace-carpeta.mjs"
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

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "✅ Enlazado. Revisa cada ~3 min (y también ahora mismo, al arrancar)."
echo "   Registro: $SOPORTE/registro.log"
echo "   Prueba: suelta un PDF o una foto en una carpeta de asignatura y espera un momento."
