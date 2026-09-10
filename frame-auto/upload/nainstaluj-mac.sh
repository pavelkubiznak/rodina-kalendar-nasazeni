#!/bin/sh
# Zaregistruje denni-upload.py v launchd: bezi kazdych 10 minut a hned po probuzeni Macu.
# Kdyz uz dnesni plakat na TV visi, skript hned skonci.
#
#   sh frame-auto/upload/nainstaluj-mac.sh          (znovu spustit i po presunuti repa)
#   log:          ~/Library/Logs/frame-upload.log
#   odinstalace:  launchctl bootout gui/$(id -u)/cz.kubiznak.frame-upload
#                 rm ~/Library/LaunchAgents/cz.kubiznak.frame-upload.plist
set -eu

LABEL=cz.kubiznak.frame-upload
DIR=$(cd "$(dirname "$0")" && pwd)
PY="$(cd "$DIR/.." && pwd)/.venv/bin/python3"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/frame-upload.log"

if [ ! -x "$PY" ]; then
  echo "chybi venv - v kořeni repa spust:"
  echo "  python3 -m venv frame-auto/.venv"
  echo "  frame-auto/.venv/bin/pip install git+https://github.com/NickWaterton/samsung-tv-ws-api.git"
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PY</string>
    <string>-W</string><string>ignore</string>
    <string>$DIR/denni-upload.py</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>FRAME_IP</key><string>${FRAME_IP:-10.0.0.116}</string></dict>
  <key>StartInterval</key><integer>600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF

plutil -lint "$PLIST" >/dev/null
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "nainstalovano: $PLIST"
echo "log: $LOG"
