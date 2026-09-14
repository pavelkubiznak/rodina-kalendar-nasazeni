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
import os, sys, json, time, datetime, urllib.request, hashlib
import socket as _socket, ssl as _ssl
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

def stav_slideshow(art):
    """Vrati (bezi, popis). Slideshow i auto rotation maji 'value': 'off' nebo pocet minut."""
    popis = {}
    bezi = False
    for nazev, zjisti in (("slideshow", art.get_slideshow_status), ("rotace", art.get_auto_rotation_status)):
        try:
            d = zjisti()
            v = d.get("value") if isinstance(d, dict) else d
            popis[nazev] = v
            if str(v).lower() not in ("off", "none", ""):
                bezi = True
        except Exception as e:
            popis[nazev] = "chyba %s" % type(e).__name__
    return bezi, popis

def vypni_slideshow(art):
    # Slideshow prehodi plakat za par minut na obraz z Art Store. Vypnout po kazdem zasahu.
    for nastav in (art.set_slideshow_status, art.set_auto_rotation_status):
        try:
            nastav(duration=0)
        except Exception:
            pass

class posli_vse:
    """
    samsungtvws posila obrazek po 64 kB pres socket.send(), ktery ale nezarucuje,
    ze odesle cely blok - u velkych JPEGu se prenos utne a televize si misto noveho
    obrazku nechá ten predchozi (metadata pritom aktualizuje, takze to vypada ok).
    Po dobu uploadu tedy send() dosila zbytek sam. Nejde volat sendall() - ten u
    SSLSocketu vola zpatky send() a vznikla by nekonecna rekurze.
    """
    TYPY = (_socket.socket, _ssl.SSLSocket)

    def __enter__(self):
        # socket.socket dedi send() z C tridy _socket.socket, takze v jeho __dict__
        # nic neni - puvodni si bereme pres getattr a pamatujeme si, jestli tam vlastni byl
        self.puvodni = [(typ, getattr(typ, "send"), "send" in typ.__dict__) for typ in self.TYPY]
        for typ, puvodni, _ in self.puvodni:
            def udelej(puvodni=puvodni):
                def send(sock, data, *a, **k):
                    pohled = memoryview(data)
                    celkem = 0
                    while celkem < len(pohled):
                        poslano = puvodni(sock, pohled[celkem:], *a, **k)
                        if not poslano:
                            break
                        celkem += poslano
                    return celkem
                return send
            typ.send = udelej()
        return self

    def __exit__(self, *e):
        for typ, puvodni, mel_vlastni in self.puvodni:
            if mel_vlastni:
                typ.send = puvodni
            else:
                try:
                    delattr(typ, "send")
                except AttributeError:
                    pass
        return False

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

# --------------------------------------------------- jednorazova inventura TV
# Vznikne, kdyz vedle skriptu lezi soubor "inventura.zadej". Vypise, co ma TV
# ulozeno, a stahne nahledy do slozky "nahledy/", aby slo poznat, co je co.
ZADOST = os.path.join(HERE, "inventura.zadej")
if os.path.exists(ZADOST):
    vystup = {"kdy": time.strftime("%F %T")}
    try:
        art = art_spoj()
        vystup["artmode"] = art.get_artmode()
        vystup["aktualni"] = art.get_current()
        polozky = art.available()
        vystup["polozky"] = polozky
        slozka = os.path.join(HERE, "nahledy")
        os.makedirs(slozka, exist_ok=True)
        stazeno = []
        for a in polozky:
            cid = a.get("content_id", "")
            if not str(cid).startswith("MY_"):
                continue
            try:
                data = art.get_thumbnail(cid)
                if data:
                    with open(os.path.join(slozka, "%s.jpg" % cid), "wb") as f:
                        f.write(bytes(data))
                    stazeno.append(cid)
            except Exception as e:
                vystup.setdefault("chyby_nahledu", {})[cid] = "%s: %s" % (type(e).__name__, e)
        vystup["nahledy"] = stazeno
        os.remove(ZADOST)
    except Exception as e:
        vystup["chyba"] = "%s: %s" % (type(e).__name__, e)
    with open(os.path.join(HERE, "inventura.json"), "w") as f:
        json.dump(vystup, f, ensure_ascii=False, indent=1, default=str)
    log("inventura hotova:", vystup.get("nahledy") or vystup.get("chyba"))

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
    bezi, popis = stav_slideshow(art)
    if bezi:
        # API dal hlasi nas plakat jako "aktualni", ale slideshow obrazky pretaci -
        # na obrazovce je pak neco z Art Store. Vypnout a plakat znovu vybrat.
        try:
            vypni_slideshow(art)
            art.select_image(nas, show=True)
            log("bezela slideshow %s - vypnuto, vracim plakat %s" % (popis, nas))
            uloz_hlidku(stav="slideshow vypnuta", slideshow=popis, visi=visi, nas=nas)
        except Exception as e:
            log("nepovedlo se vypnout slideshow:", type(e).__name__, e)
            uloz_hlidku(stav="slideshow bezi, vypnuti selhalo", slideshow=popis, visi=visi, nas=nas)
            sys.exit(1)
        sys.exit(0)
    if not visi or visi == nas:
        uloz_hlidku(stav="ok, visi nas plakat", visi=visi, nas=nas, slideshow=popis)
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
        uloz_hlidku(stav="opraveno", visi_predtim=visi, nas=nas, slideshow=popis)
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
    # kontrolni kopie toho, co se opravdu stahlo z Pages - at je videt, jestli chyba
    # vznikla uz pri stahovani, nebo az na televizi
    try:
        os.makedirs(os.path.join(HERE, "nahledy"), exist_ok=True)
        with open(os.path.join(HERE, "nahledy", "stazeno.jpg"), "wb") as f:
            f.write(jpg)
    except Exception:
        pass

    art = art_spoj()
    with posli_vse():
        novy = art.upload(jpg, file_type="JPEG", matte="none")
    art.select_image(novy, show=True)
    vypni_slideshow(art)

    # Kontrola, ze se obrazek do TV opravdu dostal: stahnout jeho nahled a porovnat
    # otisk s tim vcerejsim. Kdyz je stejny, TV si nechala stary obrazek (presne to
    # delal utnuty prenos pres socket.send) a je potreba to poznat, ne to mlcky prejit.
    otisk = None
    try:
        nahled = art.get_thumbnail(novy)
        if nahled:
            otisk = hashlib.sha256(bytes(nahled)).hexdigest()[:16]
    except Exception as e:
        log("nahled z TV se nepodarilo stahnout:", type(e).__name__, e)
    if otisk and otisk == stav.get("otisk"):
        log("POZOR: nahled z TV je stejny jako minule (%s) - obrazek se zrejme nenahral" % otisk)

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

    uloz({"content_id": novy, "nesmazane": nesmazane, "datum": dnes,
          "otisk": otisk, "kdy": time.strftime("%F %T")})
    uloz_hlidku(stav="cerstve nahrano", nas=novy, slideshow=stav_slideshow(art)[1])
    log("ok:", novy, "plakat na", dnes)
except Exception as e:
    log("nepovedlo se, dalsi pokus za 10 min:", type(e).__name__, e)
    sys.exit(1)
