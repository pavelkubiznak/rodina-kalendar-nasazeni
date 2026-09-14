#!/usr/bin/env python3
"""
Denni upload plakatu na The Frame + hlidka zobrazeni.

Spousti ho launchd kazdych 10 minut (viz nainstaluj-mac.sh).

1) Kdyz dnesni plakat jeste nahrany neni: overi, ze na Pages je plakat na DNESEK
   - ne vcerejsi, kdyz render v GitHub Actions selhal - nahraje ho, nastavi jako
   aktualni, vypne slideshow a smaze drivejsi plakaty, jinak se uloziste TV zaplni.

2) Kdyz uz nahrany je: jen se podiva, co TV opravdu ukazuje. Kdyz se mezitim
   prepnula na obrazek z Art Store (typicky po zapnuti slideshow nebo po
   restartu televize), vrati nas plakat zpatky. Vlastni fotky, ktere si clovek
   na TV vybere rucne, necha byt.

Televize v noci spi a API neprijme; pokus pak selze a dalsi prijde za 10 minut.
"""
import os, sys, json, time, datetime, urllib.request
from samsungtvws import SamsungTVWS

TV_IP    = os.environ.get("FRAME_IP", "10.0.0.116")
PAGES    = "https://pavelkubiznak.github.io/rodina-kalendar-nasazeni/"
HERE     = os.path.dirname(os.path.abspath(__file__))
TOKEN    = os.path.join(HERE, "tv-token.txt")
STATE    = os.path.join(HERE, "posledni.json")   # content_id a datum posledniho nahraneho plakatu
HLIDKA   = os.path.join(HERE, "hlidka.json")     # co TV naposledy opravdu ukazovala (jen pro diagnostiku)

def log(*a):
    print(time.strftime("%F %T"), *a, flush=True)

def stahni(nazev):
    # Pages drzi cache 10 minut, parametr s casem ji obejde
    return urllib.request.urlopen("%s%s?t=%d" % (PAGES, nazev, time.time()), timeout=30).read()

def art_spoj():
    return SamsungTVWS(host=TV_IP, port=8002, token_file=TOKEN).art(timeout=20)

def aktualni_id(art):
    data = art.get_current()
    if isinstance(data, dict):
        return data.get("content_id") or data.get("current_content_id")
    return None

def vypni_slideshow(art):
    # Slideshow prehodi plakat za par minut na obraz z Art Store. Vypnout po kazdem zasahu.
    for nastav in (art.set_slideshow_status, art.set_auto_rotation_status):
        try:
            nastav(duration=0)
        except Exception:
            pass

def uloz(stav):
    json.dump(stav, open(STATE, "w"))

def uloz_hlidku(**kv):
    kv["kdy"] = time.strftime("%F %T")
    try:
        json.dump(kv, open(HLIDKA, "w"))
    except Exception:
        pass

dnes = datetime.date.today().isoformat()          # Mac jede v prazskem case
stav = json.load(open(STATE)) if os.path.exists(STATE) else {}

# ---------------------------------------------------------------- 2) hlidka
if stav.get("datum") == dnes:
    nas = stav.get("content_id")
    if not nas:
        sys.exit(0)
    try:
        art = art_spoj()
        rezim = art.get_artmode()
        if rezim != "on":
            uloz_hlidku(stav="art mode vypnuty", artmode=rezim, nas=nas)
            sys.exit(0)                      # televize se prave kouka, do toho nesahat
        visi = aktualni_id(art)
    except Exception as e:
        uloz_hlidku(stav="TV neodpovida", chyba="%s: %s" % (type(e).__name__, e), nas=nas)
        sys.exit(0)                          # TV spi nebo neodpovida - normalni stav, neplnit log
    if not visi or visi == nas:
        uloz_hlidku(stav="ok, visi nas plakat", visi=visi, nas=nas)
        sys.exit(0)
    # Vlastni fotky (MY_) necha byt - krome nasich drivejsich plakatu, ktere se nepovedlo smazat.
    nase_stare = set(stav.get("nesmazane", []))
    if str(visi).startswith("MY_") and visi not in nase_stare:
        uloz_hlidku(stav="vlastni fotka, necham byt", visi=visi, nas=nas)
        sys.exit(0)
    try:
        art.select_image(nas, show=True)
        vypni_slideshow(art)
        log("TV ukazovala %s, vracim nas plakat %s a vypinam slideshow" % (visi, nas))
        uloz_hlidku(stav="opraveno", visi_predtim=visi, nas=nas)
    except Exception as e:
        log("nepovedlo se vratit plakat:", type(e).__name__, e)
        sys.exit(1)
    sys.exit(0)

# ------------------------------------------------------------- 1) novy den
try:
    data = json.loads(stahni("frame-data.json"))
    if data.get("datumIso") != dnes:
        # stary plakat nenahravat - a hlavne kvuli nemu nesmazat ten, co na TV visi
        log("na Pages je plakat na %s, ne na %s - cekam" % (data.get("datumIso"), dnes))
        sys.exit(1)
    jpg = stahni("frame.jpg")

    art = art_spoj()
    novy = art.upload(jpg, file_type="JPEG", matte="none")
    art.select_image(novy, show=True)
    vypni_slideshow(art)

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

    uloz({"content_id": novy, "nesmazane": nesmazane, "datum": dnes, "kdy": time.strftime("%F %T")})
    log("ok:", novy, "plakat na", dnes)
except Exception as e:
    log("nepovedlo se, dalsi pokus za 10 min:", type(e).__name__, e)
    sys.exit(1)
