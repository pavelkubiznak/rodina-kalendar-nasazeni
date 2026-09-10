#!/usr/bin/env python3
"""
Denni upload kalendare na The Frame.
Stahne hotovy JPEG z GitHub Pages, nahraje ho do TV, nastavi jako aktualni
a smaze vcerejsi - jinak se uloziste televize za rok zaplni.

Cron na 5:30:  30 5 * * *  /usr/bin/python3 /cesta/denni-upload.py
"""
import os, sys, json, time, urllib.request
from samsungtvws import SamsungTVWS

TV_IP    = os.environ.get("FRAME_IP", "192.168.1.xx")
IMG_URL  = "https://pavelkubiznak.github.io/rodina-kalendar-nasazeni/frame.jpg"
HERE     = os.path.dirname(os.path.abspath(__file__))
TOKEN    = os.path.join(HERE, "tv-token.txt")
STATE    = os.path.join(HERE, "posledni.json")   # content_id vcerejsiho obrazku
RETRIES  = 6      # TV muze jeste spat - zkousime 6x po 5 minutach
WAIT     = 300

def nahraj():
    data = urllib.request.urlopen(IMG_URL, timeout=30).read()
    tv = SamsungTVWS(host=TV_IP, port=8002, token_file=TOKEN)
    if not tv.art().supported():
        raise RuntimeError("art mode nedostupny")

    novy = tv.art().upload(data, file_type="JPEG", matte="none")
    tv.art().select_image(novy, show=True)

    # az kdyz novy visi, smazat stary
    if os.path.exists(STATE):
        stary = json.load(open(STATE)).get("content_id")
        if stary and stary != novy:
            try:
                tv.art().delete(stary)
            except Exception as e:
                print("nepodarilo se smazat", stary, e, file=sys.stderr)

    json.dump({"content_id": novy, "kdy": time.strftime("%F %T")}, open(STATE, "w"))
    print("ok:", novy)

for pokus in range(1, RETRIES + 1):
    try:
        nahraj()
        sys.exit(0)
    except Exception as e:
        print("pokus %d/%d selhal: %s" % (pokus, RETRIES, e), file=sys.stderr)
        if pokus < RETRIES:
            time.sleep(WAIT)
sys.exit(1)
