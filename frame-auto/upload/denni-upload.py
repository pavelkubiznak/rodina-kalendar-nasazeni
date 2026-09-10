#!/usr/bin/env python3
"""
Denni upload plakatu na The Frame.

Spousti ho launchd kazdych 10 minut (viz nainstaluj-mac.sh). Kdyz uz dnesni plakat
na TV visi, hned skonci. Jinak overi, ze na Pages je plakat na DNESEK - ne vcerejsi,
kdyz render v GitHub Actions selhal - nahraje ho, nastavi jako aktualni a smaze
drivejsi plakaty, jinak se uloziste televize za rok zaplni.

Televize v noci spi a API neprijme; pokus pak selze a dalsi prijde za 10 minut.
"""
import os, sys, json, time, datetime, urllib.request
from samsungtvws import SamsungTVWS

TV_IP    = os.environ.get("FRAME_IP", "10.0.0.116")
PAGES    = "https://pavelkubiznak.github.io/rodina-kalendar-nasazeni/"
HERE     = os.path.dirname(os.path.abspath(__file__))
TOKEN    = os.path.join(HERE, "tv-token.txt")
STATE    = os.path.join(HERE, "posledni.json")   # content_id a datum posledniho nahraneho plakatu

def log(*a):
    print(time.strftime("%F %T"), *a, flush=True)

def stahni(nazev):
    # Pages drzi cache 10 minut, parametr s casem ji obejde
    return urllib.request.urlopen("%s%s?t=%d" % (PAGES, nazev, time.time()), timeout=30).read()

dnes = datetime.date.today().isoformat()          # Mac jede v prazskem case
stav = json.load(open(STATE)) if os.path.exists(STATE) else {}
if stav.get("datum") == dnes:
    sys.exit(0)

try:
    data = json.loads(stahni("frame-data.json"))
    if data.get("datumIso") != dnes:
        # stary plakat nenahravat - a hlavne kvuli nemu nesmazat ten, co na TV visi
        log("na Pages je plakat na %s, ne na %s - cekam" % (data.get("datumIso"), dnes))
        sys.exit(1)
    jpg = stahni("frame.jpg")

    art = SamsungTVWS(host=TV_IP, port=8002, token_file=TOKEN).art(timeout=20)
    novy = art.upload(jpg, file_type="JPEG", matte="none")
    art.select_image(novy, show=True)

    # az kdyz novy visi, smazat drivejsi plakaty - i ty, ktere se minule smazat nepovedlo.
    # Maze jen to, co nahral tenhle skript (content_id v posledni.json), rucne nahrane fotky ne.
    stare = (set(stav.get("nesmazane", [])) | {stav.get("content_id")}) - {None, novy}
    nesmazane = []
    if stare:
        try:
            # co uz na TV neni (smazane rucne), se preskoci
            nesmazane = sorted(stare & {a.get("content_id") for a in art.available()})
            if nesmazane and art.delete_list(nesmazane):
                log("smazano:", ", ".join(nesmazane))
                nesmazane = []
            elif nesmazane:
                log("TV smazani nepotvrdila, zkusi se priste:", ", ".join(nesmazane))
        except Exception as e:
            nesmazane = sorted(stare)
            log("nepodarilo se smazat, zkusi se priste:", ", ".join(nesmazane), type(e).__name__, e)

    json.dump({"content_id": novy, "nesmazane": nesmazane, "datum": dnes, "kdy": time.strftime("%F %T")},
              open(STATE, "w"))
    log("ok:", novy, "plakat na", dnes)
except Exception as e:
    log("nepovedlo se, dalsi pokus za 10 min:", type(e).__name__, e)
    sys.exit(1)
