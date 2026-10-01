#!/bin/sh
# Spoustec uploaderu plakatu na Synology NAS - vola ho Planovac uloh DSM kazdych 10 minut.
# Slozka: /volume1/NAS_6TB/frame-upload (vse ostatni si skript stahne a udrzuje sam).
#
# Kazdy beh:
#  1. stahne z GitHubu aktualni denni-upload.py a tv-ip.txt (oprava v repu = oprava na NASu,
#     kdyz GitHub neodpovi, jede se se starou kopii),
#  2. kdyz chybi knihovny, nainstaluje je (instaluj.py, jen standardni Python, bez pipu),
#  3. spusti uploader a log uklada do frame-upload.log (orezava se na posledni 2000 radku).
D=$(cd "$(dirname "$0")" && pwd)
cd "$D" || exit 1
RAW=https://raw.githubusercontent.com/pavelkubiznak/rodina-kalendar-nasazeni/main/frame-auto
LOG="$D/frame-upload.log"

PY=""
for p in /usr/local/bin/python3.9 /var/packages/Python3.9/target/usr/bin/python3.9 /usr/local/bin/python3 /usr/bin/python3; do
  if [ -x "$p" ]; then PY="$p"; break; fi
done
if [ -z "$PY" ]; then
  echo "$(date '+%F %T') chybi Python 3.9 (Centrum balicku -> Python 3.9)" >> "$LOG"; exit 1
fi

# zabranit prekryvu dvou behu (pomaly NAS + dlouhe nahravani)
if ! mkdir "$D/.bezi" 2>/dev/null; then
  if [ -n "$(find "$D/.bezi" -maxdepth 0 -mmin +30 2>/dev/null)" ]; then rmdir "$D/.bezi"; mkdir "$D/.bezi"; else exit 0; fi
fi
trap 'rmdir "$D/.bezi" 2>/dev/null' EXIT

for f in upload/denni-upload.py upload/tv-ip.txt nas/instaluj.py nas/spust.sh; do
  cil="$D/$(basename "$f")"
  if curl -fsS --max-time 60 "$RAW/$f" -o "$cil.novy" 2>/dev/null && [ -s "$cil.novy" ]; then
    mv "$cil.novy" "$cil"
  else
    rm -f "$cil.novy"
  fi
done

if [ ! -d "$D/lib/samsungtvws" ]; then
  echo "$(date '+%F %T') instaluji knihovny" >> "$LOG"
  "$PY" "$D/instaluj.py" >> "$LOG" 2>&1 || exit 1
fi

PYTHONPATH="$D/lib" "$PY" -W ignore "$D/denni-upload.py" >> "$LOG" 2>&1
kod=$?
if [ "$(wc -l < "$LOG")" -gt 3000 ]; then tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"; fi
exit $kod
