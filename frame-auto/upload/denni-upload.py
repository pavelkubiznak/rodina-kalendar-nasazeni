#!/usr/bin/env python3
"""
Denni upload plakatu na The Frame + hlidka zobrazeni.

Spousti ho launchd kazdych 10 minut (viz nainstaluj-mac.sh).

Ktery den ma na TV viset: do 17:00 dnesek, od 17:00 ZITREK (vecer uz rodina kouka,
co bude zitra). CI publikuje oba plakaty (frame.jpg + frame-zitra.jpg s jejich
frame-data*.json); skript si vybere ten, jehoz datumIso odpovida.

1) Kdyz plakat na cilovy den jeste nahrany neni: overi, ze na Pages plakat s tim
   datem je - ne stary, kdyz render v GitHub Actions selhal - nahraje ho, OVERI,
   ze si ho televize opravdu ulozila, nastavi jako aktualni, vypne slideshow
   a smaze drivejsi plakaty, jinak se uloziste TV zaplni.

2) Kdyz uz nahrany je: porovna otisk obsahu plakatu na Pages s tim, co visi
   (bez casoveho razitka) - kdyz se obsah zmenil (nova udalost), nahraje znovu.
   Jinak se jen podiva, co TV opravdu ukazuje. Kdyz se mezitim prepnula na
   obrazek z Art Store (typicky po zapnuti slideshow nebo po restartu televize),
   vrati nas plakat zpatky. Vlastni fotky, ktere si clovek na TV vybere rucne,
   necha byt.

Proc se overuje (15. 9. 2026): televize prideluje vlastnim obrazkum ID MY_F0001 az
MY_F0007 dokola. Obcas potvrdi "image_added" a vrati nove ID, ale v tom slotu si
necha STARY soubor - na zdi pak visi plakat z jineho dne (v utery sobotni, v
pondeli patecni). Soubor se navic posila najednou a spojeni se hned zavre
(jako upstream knihovna).

Jak se overuje (prepsano 22. 9. 2026): puvodni kontrola porovnavala nadpis nove
stazeneho nahledu s nadpisy VSECH drivejsich nahledu a kdyz nekteremu odpovidal,
prohlasila nahrani za pokazene. To bylo spatne polozena otazka a delalo to jen
falesne poplachy - za 21. 9. ctyri behy po trech pokusech, tedy 12 zbytecnych
nahrani denne, a nakonec se obrazek stejne vzal ("po 4 bezich ho beru i tak").
Duvody jsou dva a oba jsou v datech videt:
  - Tyz den se plakat nahrava znovu, kdyz se na Pages zmeni obsah. Novy nahled ma
    pak pochopitelne stejny nadpis jako ten predchozi (MY_F0105 vs MY_F0118 pro
    22. 9. = vzdalenost 0.18, MY_F0063/0078/0092 pro 21. 9. = 0.00).
  - Vyrez nadpisu zabira nazev dne, ale ne dost z datumu, takze tyz den v tydnu
    o tyden pozdeji vyjde jako shoda (MY_F0004 ze 14. 9. vs MY_F0063 z 21. 9.,
    presne 7 dni, vzdalenost 0.58).
Misto toho se ted overuje primo proti televizi: slot s nasim content_id musi
existovat a nest image_date, ktere jsme pri nahrani poslali. Kdyz si TV v slotu
necha stary soubor, nese i jeho stare razitko - a presne to je ta porucha.
Podobnost nadpisu se uz jen loguje pro diagnostiku a o nicem nerozhoduje.

Rucni zasahy (soubor vedle skriptu):
  inventura.zadej  - vypise, co ma TV ulozeno, a stahne nahledy do nahledy/
  znovu.zadej      - vynuti nove nahrani dnesniho plakatu, i kdyz uz "visi"

Televize v noci spi a API neprijme; pokus pak selze a dalsi prijde za 10 minut.
"""
import os, sys, json, time, datetime, urllib.request, hashlib, random, socket, subprocess
from samsungtvws import SamsungTVWS
from samsungtvws.helper import get_ssl_context

TV_IP    = os.environ.get("FRAME_IP", "10.0.0.116")
PAGES    = "https://pavelkubiznak.github.io/rodina-kalendar-nasazeni/"
HERE     = os.path.dirname(os.path.abspath(__file__))
TOKEN    = os.path.join(HERE, "tv-token.txt")
STATE    = os.path.join(HERE, "posledni.json")   # content_id a datum posledniho nahraneho plakatu
HLIDKA   = os.path.join(HERE, "hlidka.json")     # co TV naposledy opravdu ukazovala (jen pro diagnostiku)
NAHLEDY  = os.path.join(HERE, "nahledy")         # MY_F000N.jpg = posledni ZNAMY obsah slotu na TV
SIPS     = "/usr/bin/sips"                       # macOS: zmenseni a prevod na BMP bez dalsich knihoven

POKUSU_V_BEHU   = 3    # kolikrat zkusit nahrat v jednom behu, kdyz TV podstrci stary obrazek
BEHU_NEZ_VZDAT  = 4    # po kolika neuspesnych bezich (po 10 min) vzit i neovereny obrazek
PAUZA_PO_UPLOADU = 4   # s - dat TV cas soubor dopsat, nez se vybere a stahne nahled
ZITREK_OD = 17         # od teto hodiny visi na TV plakat na zitrek
# O kolik se smi lisit image_date v slotu od razitka, ktere jsme pri nahrani poslali.
# Chyba, kterou hledame, je plakat z JINEHO DNE, takze i 6 hodin ji spolehlive chyti;
# siroka tolerance zaroven pohlti pripadny posun hodin mezi Macem a televizi. Radeji
# neoverene nez falesny poplach - to je cela lekce z 21. 9.
TOLERANCE_RAZITKA = 6 * 3600   # s

def log(*a):
    print(time.strftime("%F %T"), *a, flush=True)

def stahni(nazev):
    # Pages drzi cache 10 minut, parametr s casem ji obejde
    return urllib.request.urlopen("%s%s?t=%d" % (PAGES, nazev, time.time()), timeout=30).read()

def cilove_datum():
    """Do 17:00 dnesek, od 17:00 zitrek. Mac jede v prazskem case."""
    ted = datetime.datetime.now()
    den = ted.date() + datetime.timedelta(days=1 if ted.hour >= ZITREK_OD else 0)
    return den.isoformat()

def otisk_dat(data):
    """Otisk obsahu plakatu bez casoveho razitka - stejna data = stejny otisk, i kdyz CI rendrovalo znovu."""
    d = dict(data)
    d.pop("razitko", None)
    return hashlib.sha256(json.dumps(d, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:16]

def plakat_na_pages(cil):
    """Vrati (data, nazev_jpg) plakatu s datumIso == cil, nebo (None, popis toho, co na Pages je)."""
    nalezeno = []
    for nazev_json, nazev_jpg in (("frame-data.json", "frame.jpg"), ("frame-data-zitra.json", "frame-zitra.jpg")):
        try:
            data = json.loads(stahni(nazev_json))
        except Exception as e:
            nalezeno.append("%s: %s" % (nazev_json, type(e).__name__))
            continue
        if data.get("datumIso") == cil:
            return data, nazev_jpg
        nalezeno.append("%s: %s" % (nazev_json, data.get("datumIso")))
    return None, ", ".join(nalezeno)

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

# ------------------------------------------------------------------ upload
def nahraj(art, data, file_type="jpg"):
    """
    Vlastni odeslani obrazku pres D2D socket. Knihovna (fork NickWaterton 3.0.5)
    posle data po kouskach a socket nikdy nezavre - zavre se az pri konci procesu,
    dlouho po select_image. Upstream samsungtvws 3.x naopak posle vse najednou
    (sendall) a socket ZAVRE, teprve pak ceka na "image_added". Delame to stejne:
    televize dostane konec souboru drive, nez se po ni chce cokoli dalsiho.
    Vraci (content_id, razitko), kde razitko je image_date poslane televizi.
    """
    razitko = datetime.datetime.now().strftime("%Y:%m:%d %H:%M:%S")
    odpoved = art._send_art_request(
        {
            "request": "send_image",
            "file_type": file_type,
            "request_id": art.get_uuid(),
            "id": art.art_uuid,
            "conn_info": {
                "d2d_mode": "socket",
                "connection_id": random.randrange(4 * 1024 * 1024 * 1024),
                "id": art.art_uuid,
            },
            "image_date": razitko,
            "matte_id": "none",
            "portrait_matte_id": "none",
            "file_size": len(data),
        },
        wait_for_event="ready_to_use",
    )
    assert odpoved
    conn = json.loads(odpoved["conn_info"])
    hlavicka = json.dumps({
        "num": 0, "total": 1, "fileLength": len(data), "fileName": "dummy",
        "fileType": file_type, "secKey": conn["key"], "version": "0.0.1",
    }).encode("ascii")
    raw = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    raw.settimeout(60)
    sock = get_ssl_context().wrap_socket(raw) if conn.get("secured", False) else raw
    try:
        sock.connect((conn["ip"], int(conn["port"])))
        sock.sendall(len(hlavicka).to_bytes(4, "big"))
        sock.sendall(hlavicka)
        sock.sendall(data)
        try:
            sock.shutdown(socket.SHUT_WR)   # konec souboru - uz nic neposleme
        except OSError:
            pass
    finally:
        try:
            sock.close()
        except OSError:
            pass
    hotovo = art.wait_for_response("image_added")
    return (hotovo["content_id"] if hotovo else None), razitko

# --------------------------------------------------------- porovnani nahledu
def nahled_z_tv(art, cid, pokusu=3):
    """Nahled z TV; po nahrani byva D2D kanal chvili rozhozeny (EADDRNOTAVAIL, broken pipe),
    tak se to zkousi vickrat a pokazde s cerstvym spojenim."""
    for i in range(pokusu):
        try:
            n = art.get_thumbnail(cid)
            if n:
                return bytes(n), art
        except Exception as e:
            log("nahled %s z TV se nepodarilo stahnout (%d/%d):" % (cid, i + 1, pokusu), type(e).__name__, e)
        time.sleep(3)
        try:
            art = art_spoj()
        except Exception as e:
            log("nove spojeni s TV selhalo:", type(e).__name__, e)
    return None, art

def sedy_obrazek(cesta_jpg, w=320, h=180):
    """
    Zmensi obrazek pres sips na w x h a vrati ho jako seznam radku hodnot jasu 0-255.
    Bez PIL - BMP z sips se precte rucne. Pri jakekoli chybe vrati None.
    """
    bmp = cesta_jpg + ".%dx%d.bmp" % (w, h)
    try:
        r = subprocess.run([SIPS, "-z", str(h), str(w), "-s", "format", "bmp", cesta_jpg, "--out", bmp],
                           capture_output=True, timeout=60)
        if r.returncode != 0 or not os.path.exists(bmp):
            return None
        with open(bmp, "rb") as f:
            b = f.read()
        if b[:2] != b"BM":
            return None
        ofs = int.from_bytes(b[10:14], "little")
        sirka = int.from_bytes(b[18:22], "little", signed=True)
        vyska = int.from_bytes(b[22:26], "little", signed=True)
        bpp = int.from_bytes(b[28:30], "little")
        komprese = int.from_bytes(b[30:34], "little")
        if komprese not in (0, 3) or bpp not in (24, 32) or sirka != w or abs(vyska) != h:
            return None
        bajtu = bpp // 8
        krok = ((bpp * sirka + 31) // 32) * 4
        radky = []
        for y in range(h):
            # BMP je obvykle odspodu; poradi radku je pro oba porovnavane obrazky stejne, ale
            # pro pripad ze by sips jednou dal top-down, otocime podle znamenka vysky
            yy = (h - 1 - y) if vyska > 0 else y
            z = ofs + yy * krok
            radek = []
            for x in range(sirka):
                p = z + x * bajtu
                bl, g, rr = b[p], b[p + 1], b[p + 2]
                radek.append((rr * 299 + g * 587 + bl * 114) // 1000)
            radky.append(radek)
        return radky
    except Exception as e:
        log("sips/BMP selhalo:", type(e).__name__, e)
        return None
    finally:
        try:
            os.remove(bmp)
        except OSError:
            pass

def rozdil(a, b, vyrez=None):
    """Prumerny absolutni rozdil jasu dvou obrazku (seznamy radku), pripadne jen ve vyrezu (x0,y0,x1,y1)."""
    if not a or not b or len(a) != len(b) or len(a[0]) != len(b[0]):
        return None
    h, w = len(a), len(a[0])
    x0, y0, x1, y1 = vyrez or (0, 0, w, h)
    s = n = 0
    for y in range(y0, y1):
        ra, rb = a[y], b[y]
        for x in range(x0, x1):
            s += abs(ra[x] - rb[x]); n += 1
    return s / n if n else None

# kde na plakatu je velky nazev dne ("Uterý", "Sobota") a datum - tam se ruzne dny lisi vzdy
VYREZ_NADPIS = (6, 18, 96, 58)     # v 320x180: x 6-96, y 18-58
# Orientacni prah pro cteni cisel v logu: pod nim jde o tentyz obrazek.
# Kalibrace 15. 9.: tentyz nahled znovu zkomprimovany JPEGem ~3-5, jiny den 10-16.
# Od 22. 9. uz nic nezamita, nahrani se overuje razitkem primo na TV (viz over_nahrani).
PRAH_STEJNY  = 6.0

def glob_overeni():
    return [os.path.join(NAHLEDY, f) for f in os.listdir(NAHLEDY) if f.startswith("_overeni_")]

def polozka_na_tv(art, cid):
    """Vrati polozku se zadanym content_id ze seznamu obrazku na TV, nebo None."""
    for a in art.available():
        if a.get("content_id") == cid:
            return a
    return None


def razitko_na_datum(s):
    """'2026:09:22 07:15:03' -> datetime; pri jakemkoli jinem tvaru None."""
    try:
        return datetime.datetime.strptime(str(s), "%Y:%m:%d %H:%M:%S")
    except Exception:
        return None


def over_nahrani(art, cid, razitko, cesta_plakatu, sedy_plakat):
    """
    Vrati (ok, popis, nahled_bytes, art). ok=False jen kdyz je JISTE, ze v slotu neni to,
    co jsme prave poslali. Kdyz nejde nic overit, ok=True (radeji neoverene nez nic).

    Overuje se:
      1) slot s nasim content_id na TV opravdu existuje,
      2) jeho image_date sedi na razitko, ktere jsme pri nahrani poslali (TOLERANCE_RAZITKA);
         kdyz si TV v slotu nechala stary soubor, nese i jeho stare razitko,
      3) nahled ze slotu neni BAJT PO BAJTU shodny s nahledem nektereho drivejsiho plakatu
         (to by znamenalo doslova tentyz ulozeny soubor - jina komprese by bajtovou shodu nedala).

    Podobnost nadpisu s drivejsimi nahledy se uz jen LOGUJE a nerozhoduje; proc, viz hlavicka.
    """
    popis = {}

    # 1) + 2) existence slotu a jeho razitko - hlavni dukaz
    polozka = None
    try:
        polozka = polozka_na_tv(art, cid)
    except Exception as e:
        popis["seznam_z_tv"] = "chyba %s" % type(e).__name__
        log("seznam obrazku z TV se nepodarilo nacist:", type(e).__name__, e)
    else:
        if polozka is None:
            popis["chyba"] = "slot %s na TV vubec neni" % cid
            return False, popis, None, art
        popis["image_date"] = polozka.get("image_date")
        na_tv = razitko_na_datum(polozka.get("image_date"))
        poslano = razitko_na_datum(razitko)
        if na_tv and poslano:
            lisi = abs((na_tv - poslano).total_seconds())
            popis["razitko_lisi_o_s"] = int(lisi)
            if lisi > TOLERANCE_RAZITKA:
                popis["chyba"] = ("slot %s nese razitko %s, poslali jsme %s - TV si nechala stary soubor"
                                  % (cid, polozka.get("image_date"), razitko))
                nahled, art = nahled_z_tv(art, cid)
                return False, popis, nahled, art
        else:
            popis["razitko"] = "neporovnatelne"

    # nahled ze slotu: pro bajtovou shodu, pro ulozeni jako novy znamy obsah slotu a pro diagnostiku
    nahled, art = nahled_z_tv(art, cid)
    if not nahled:
        popis["nahled"] = "nedostupny, neoveren obrazem"
        return True, popis, None, art

    cesta_novy = os.path.join(NAHLEDY, "_overeni_%s.jpg" % cid)
    with open(cesta_novy, "wb") as f:
        f.write(nahled)
    sedy_novy = sedy_obrazek(cesta_novy)

    # 3) bajtova shoda = doslova tentyz ulozeny soubor
    shody = {}
    for jmeno in sorted(os.listdir(NAHLEDY)):
        if not (jmeno.startswith("MY_") and jmeno.endswith(".jpg")):
            continue
        cesta = os.path.join(NAHLEDY, jmeno)
        with open(cesta, "rb") as f:
            if f.read() == nahled:
                popis["stejny_jako"] = jmeno
                popis["shoda"] = "bajt po bajtu"
                return False, popis, nahled, art
        d = rozdil(sedy_novy, sedy_obrazek(cesta), VYREZ_NADPIS)
        if d is not None:
            shody[jmeno[:-4]] = round(d, 2)

    # uz jen diagnostika do logu, nic nezamita
    popis["nadpis_vs_drivejsi"] = shody
    d = rozdil(sedy_novy, sedy_plakat, VYREZ_NADPIS)
    popis["nadpis_vs_plakat"] = None if d is None else round(d, 2)
    return True, popis, nahled, art


def uloz(stav):
    json.dump(stav, open(STATE, "w"))

def uloz_hlidku(**kv):
    kv["kdy"] = time.strftime("%F %T")
    try:
        json.dump(kv, open(HLIDKA, "w"))
    except Exception:
        pass

def smaz_na_tv(art, ids):
    """Smaze z TV nase drivejsi plakaty. Vraci seznam tech, co se smazat nepovedlo."""
    ids = sorted(set(ids) - {None})
    if not ids:
        return []
    try:
        # co uz na TV neni (smazane rucne), se preskoci
        na_tv = sorted(set(ids) & {a.get("content_id") for a in art.available()})
        if not na_tv:
            return []
        if art.delete_list(na_tv):
            log("smazano:", ", ".join(na_tv))
            return []
        log("TV smazani nepotvrdila, zkusi se priste:", ", ".join(na_tv))
        return na_tv
    except Exception as e:
        log("nepodarilo se smazat, zkusi se priste:", ", ".join(ids), type(e).__name__, e)
        return ids

def smaz_na_tv_s_opakovanim(art, ids):
    """Mazani: pri chybe spojeni jeste jednou na cerstvem websocketu."""
    zbyle = smaz_na_tv(art, ids)
    if zbyle:
        time.sleep(3)
        try:
            zbyle = smaz_na_tv(art_spoj(), zbyle)
        except Exception as e:
            log("nove spojeni s TV pro mazani selhalo:", type(e).__name__, e)
    return zbyle

os.makedirs(NAHLEDY, exist_ok=True)
dnes = datetime.date.today().isoformat()          # Mac jede v prazskem case
cil = cilove_datum()                              # ktery den ma ted na TV viset
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
        stazeno = []
        for a in polozky:
            cid = a.get("content_id", "")
            if not str(cid).startswith("MY_"):
                continue
            try:
                data = art.get_thumbnail(cid)
                if data:
                    with open(os.path.join(NAHLEDY, "%s.jpg" % cid), "wb") as f:
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

# ------------------------------------------------- vynucene nove nahrani
ZNOVU = os.path.join(HERE, "znovu.zadej")
if os.path.exists(ZNOVU):
    os.remove(ZNOVU)
    if stav.get("datum") == cil:
        log("znovu.zadej: plakat na %s se nahraje znovu (dosud %s)" % (cil, stav.get("content_id")))
        stav["datum"] = None
        stav["pokusy"] = {}
        uloz(stav)

# ------------------------------------------- zmenil se obsah plakatu na Pages?
# Kdyz uz plakat na cilovy den visi, ale CI mezitim vyrenderovalo jiny obsah (pribyla
# udalost), nahraje se znovu. Razitko "aktualizovano" se do otisku nepocita.
if stav.get("datum") == cil and stav.get("otisk_dat"):
    try:
        data_pages, _ = plakat_na_pages(cil)
        if data_pages and otisk_dat(data_pages) != stav["otisk_dat"]:
            log("plakat na %s se na Pages zmenil (%s -> %s), nahraji znovu"
                % (cil, stav["otisk_dat"], otisk_dat(data_pages)))
            stav["datum"] = None
            stav["pokusy"] = {}
            uloz(stav)
    except Exception as e:
        log("kontrola zmeny plakatu selhala:", type(e).__name__, e)

# ---------------------------------------------------------------- 2) hlidka
if stav.get("datum") == cil:
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
    data, nazev_jpg = plakat_na_pages(cil)
    if not data:
        # stary plakat nenahravat - a hlavne kvuli nemu nesmazat ten, co na TV visi
        log("na Pages neni plakat na %s (%s) - cekam" % (cil, nazev_jpg))
        sys.exit(1)
    jpg = stahni(nazev_jpg)
    # kontrolni kopie toho, co se opravdu stahlo z Pages - at je videt, jestli chyba
    # vznikla uz pri stahovani, nebo az na televizi
    cesta_plakatu = os.path.join(NAHLEDY, "stazeno.jpg")
    with open(cesta_plakatu, "wb") as f:
        f.write(jpg)
    sedy_plakat = sedy_obrazek(cesta_plakatu)
    if sedy_plakat is None:
        log("sips nedal zmenseninu plakatu - nahrani se overi jen proti minulemu obsahu slotu")

    pokusy = stav.get("pokusy") or {}
    behu = (pokusy.get("n", 0) if pokusy.get("datum") == cil else 0) + 1
    vzdat_overovani = behu > BEHU_NEZ_VZDAT

    art = art_spoj()
    spatne = []            # dnesni nahrani, ktera TV pokazila - smazat
    novy = None
    for pokus in range(1, POKUSU_V_BEHU + 1):
        cid, razitko = nahraj(art, jpg)
        if not cid:
            raise RuntimeError("TV nevratila content_id")
        time.sleep(PAUZA_PO_UPLOADU)
        # po prenosu souboru byva websocket i D2D kanal TV chvili rozhozeny - dal jedeme
        # na cerstvem spojeni, at kvuli tomu neselze vyber, overeni ani mazani
        try:
            art = art_spoj()
        except Exception as e:
            log("nove spojeni s TV po nahrani selhalo, pokracuji na starem:", type(e).__name__, e)
        art.select_image(cid, show=True)
        vypni_slideshow(art)
        ok, popis, nahled, art = over_nahrani(art, cid, razitko, cesta_plakatu, sedy_plakat)
        if ok or vzdat_overovani:
            if not ok:
                log("POZOR: %s neprosel overenim %s, ale po %d bezich ho beru i tak" % (cid, popis, behu - 1))
            elif not isinstance(popis, str):
                log("overeno %s: %s" % (cid, popis))
            else:
                log("%s: %s" % (cid, popis))
            if nahled:
                with open(os.path.join(NAHLEDY, "%s.jpg" % cid), "wb") as f:
                    f.write(nahled)      # od ted je tohle znamy obsah slotu
            novy = cid
            break
        log("POZOR: v slotu %s neni to, co jsme poslali (%s) - pokus %d/%d"
            % (cid, popis, pokus, POKUSU_V_BEHU))
        spatne.append(cid)
        time.sleep(3)

    try:
        for c in glob_overeni():
            os.remove(c)
    except Exception:
        pass

    if novy is None:
        # vratit na zed to, co tam bylo (plakat z minuleho dne je porad lepsi nez cizi obrazek)
        nesmazane = smaz_na_tv_s_opakovanim(art, spatne)
        if stav.get("content_id"):
            try:
                art.select_image(stav["content_id"], show=True)
            except Exception:
                pass
        stav["pokusy"] = {"datum": cil, "n": behu}
        stav["nesmazane"] = sorted(set(stav.get("nesmazane", [])) | set(nesmazane))
        uloz(stav)
        log("dnesni plakat se nepodarilo nahrat spravne (beh %d), dalsi pokus za 10 min" % behu)
        sys.exit(1)

    # az kdyz novy visi a je overeny, smazat drivejsi plakaty - i ty, ktere se minule smazat
    # nepovedlo, a dnesni pokazene pokusy. Maze jen to, co nahral tenhle skript, rucne
    # nahrane fotky ne.
    stare = (set(stav.get("nesmazane", [])) | {stav.get("content_id")} | set(spatne)) - {None, novy}
    nesmazane = smaz_na_tv_s_opakovanim(art, stare)

    uloz({"content_id": novy, "nesmazane": nesmazane, "datum": cil, "otisk_dat": otisk_dat(data),
          "otisk": hashlib.sha256(nahled).hexdigest()[:16] if nahled else None,
          "kdy": time.strftime("%F %T"), "pokusy": {}})
    uloz_hlidku(stav="cerstve nahrano", nas=novy, slideshow=stav_slideshow(art)[1])
    log("ok:", novy, "plakat na", cil, "(zitrek)" if cil != dnes else "")
except SystemExit:
    raise
except Exception as e:
    log("nepovedlo se, dalsi pokus za 10 min:", type(e).__name__, e)
    sys.exit(1)
