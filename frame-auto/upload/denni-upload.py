#!/usr/bin/env python3
"""
Denni upload plakatu na The Frame + hlidka zobrazeni.

Spousti ho launchd kazdych 10 minut (viz nainstaluj-mac.sh).

1) Kdyz dnesni plakat jeste nahrany neni: overi, ze na Pages je plakat na DNESEK
   - ne vcerejsi, kdyz render v GitHub Actions selhal - nahraje ho, OVERI, ze si ho
   televize opravdu ulozila, nastavi jako aktualni, vypne slideshow a smaze
   drivejsi plakaty, jinak se uloziste TV zaplni.

2) Kdyz uz nahrany je: jen se podiva, co TV opravdu ukazuje. Kdyz se mezitim
   prepnula na obrazek z Art Store (typicky po zapnuti slideshow nebo po
   restartu televize), vrati nas plakat zpatky. Vlastni fotky, ktere si clovek
   na TV vybere rucne, necha byt.

Proc se overuje (15. 9. 2026): televize prideluje vlastnim obrazkum ID MY_F0001 az
MY_F0007 dokola. Obcas potvrdi "image_added" a vrati nove ID, ale v tom slotu si
necha STARY soubor - na zdi pak visi plakat z jineho dne (v utery sobotni, v
pondeli patecni). Proto se po nahrani stahne nahled z TV a porovna se (a) s tim,
co v tom slotu bylo minule, a (b) s plakatem, ktery se nahraval. Pri neshode se
spatny obrazek smaze a nahrani se zopakuje.

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

# ------------------------------------------------------------------ upload
def nahraj(art, data, file_type="jpg"):
    """
    Vlastni odeslani obrazku pres D2D socket. Knihovna (fork NickWaterton 3.0.5)
    posle data po kouskach a socket nikdy nezavre - zavre se az pri konci procesu,
    dlouho po select_image. Upstream samsungtvws 3.x naopak posle vse najednou
    (sendall) a socket ZAVRE, teprve pak ceka na "image_added". Delame to stejne:
    televize dostane konec souboru drive, nez se po ni chce cokoli dalsiho.
    Vraci content_id.
    """
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
            "image_date": datetime.datetime.now().strftime("%Y:%m:%d %H:%M:%S"),
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
    return hotovo["content_id"] if hotovo else None

# --------------------------------------------------------- porovnani nahledu
def nahled_z_tv(art, cid):
    try:
        n = art.get_thumbnail(cid)
        return bytes(n) if n else None
    except Exception as e:
        log("nahled %s z TV se nepodarilo stahnout:" % cid, type(e).__name__, e)
        return None

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
# nadpis nahledu vs. nadpis drive stazeneho nahledu z TV: pod timhle je to tentyz obrazek.
# Kalibrace 15. 9.: tentyz nahled znovu zkomprimovany JPEGem ~3-5, jiny den 10-16.
PRAH_STEJNY  = 6.0

def glob_overeni():
    return [os.path.join(NAHLEDY, f) for f in os.listdir(NAHLEDY) if f.startswith("_overeni_")]

def over_nahrani(art, cid, cesta_plakatu, sedy_plakat):
    """
    Vrati (ok, popis, nahled_bytes). ok=False jen kdyz je jiste, ze TV ukazuje neco jineho,
    nez co jsme poslali. Kdyz nejde nic porovnat, ok=True (radeji neoverene nez nic).

    Rozhoduje se jen podle nahledu ze same televize (stejny scaler, stejna komprese):
    kdyz se nadpis noveho nahledu shoduje s nadpisem kterehokoli drive stazeneho nahledu
    (nahledy/MY_F000N.jpg), TV nam podstrcila stary obrazek - nazev dne a datum se totiz
    meni kazdy den. Porovnani s nasi vlastni zmenseninou plakatu se jen loguje (jiny scaler,
    cisla nejsou spolehliva) - hodi se pro pozdejsi kalibraci.
    """
    nahled = nahled_z_tv(art, cid)
    if not nahled:
        return True, "nahled nedostupny, neovereno", None
    popis = {}
    cesta_novy = os.path.join(NAHLEDY, "_overeni_%s.jpg" % cid)
    with open(cesta_novy, "wb") as f:
        f.write(nahled)
    sedy_novy = sedy_obrazek(cesta_novy)

    shody = {}
    for jmeno in sorted(os.listdir(NAHLEDY)):
        if not (jmeno.startswith("MY_") and jmeno.endswith(".jpg")):
            continue
        cesta = os.path.join(NAHLEDY, jmeno)
        with open(cesta, "rb") as f:
            if f.read() == nahled:
                popis["stejny_jako"] = jmeno
                popis["shoda"] = "bajt po bajtu"
                return False, popis, nahled
        d = rozdil(sedy_novy, sedy_obrazek(cesta), VYREZ_NADPIS)
        if d is not None:
            shody[jmeno[:-4]] = round(d, 2)
    popis["nadpis_vs_drivejsi"] = shody
    if shody:
        nej = min(shody, key=shody.get)
        if shody[nej] < PRAH_STEJNY:
            popis["stejny_jako"] = nej
            return False, popis, nahled

    d = rozdil(sedy_novy, sedy_plakat, VYREZ_NADPIS)
    popis["nadpis_vs_plakat"] = None if d is None else round(d, 2)   # jen informativne
    return True, popis, nahled

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

os.makedirs(NAHLEDY, exist_ok=True)
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
    if stav.get("datum") == dnes:
        log("znovu.zadej: dnesni plakat se nahraje znovu (dosud %s)" % stav.get("content_id"))
        stav["datum"] = None
        stav["pokusy"] = {}
        uloz(stav)

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
    cesta_plakatu = os.path.join(NAHLEDY, "stazeno.jpg")
    with open(cesta_plakatu, "wb") as f:
        f.write(jpg)
    sedy_plakat = sedy_obrazek(cesta_plakatu)
    if sedy_plakat is None:
        log("sips nedal zmenseninu plakatu - nahrani se overi jen proti minulemu obsahu slotu")

    pokusy = stav.get("pokusy") or {}
    behu = (pokusy.get("n", 0) if pokusy.get("datum") == dnes else 0) + 1
    vzdat_overovani = behu > BEHU_NEZ_VZDAT

    art = art_spoj()
    spatne = []            # dnesni nahrani, ktera TV pokazila - smazat
    novy = None
    for pokus in range(1, POKUSU_V_BEHU + 1):
        cid = nahraj(art, jpg)
        if not cid:
            raise RuntimeError("TV nevratila content_id")
        time.sleep(PAUZA_PO_UPLOADU)
        art.select_image(cid, show=True)
        vypni_slideshow(art)
        ok, popis, nahled = over_nahrani(art, cid, cesta_plakatu, sedy_plakat)
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
        log("POZOR: TV do %s ulozila jiny obrazek nez poslany (%s) - pokus %d/%d"
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
        nesmazane = smaz_na_tv(art, spatne)
        if stav.get("content_id"):
            try:
                art.select_image(stav["content_id"], show=True)
            except Exception:
                pass
        stav["pokusy"] = {"datum": dnes, "n": behu}
        stav["nesmazane"] = sorted(set(stav.get("nesmazane", [])) | set(nesmazane))
        uloz(stav)
        log("dnesni plakat se nepodarilo nahrat spravne (beh %d), dalsi pokus za 10 min" % behu)
        sys.exit(1)

    # az kdyz novy visi a je overeny, smazat drivejsi plakaty - i ty, ktere se minule smazat
    # nepovedlo, a dnesni pokazene pokusy. Maze jen to, co nahral tenhle skript, rucne
    # nahrane fotky ne.
    stare = (set(stav.get("nesmazane", [])) | {stav.get("content_id")} | set(spatne)) - {None, novy}
    nesmazane = smaz_na_tv(art, stare)

    uloz({"content_id": novy, "nesmazane": nesmazane, "datum": dnes,
          "otisk": hashlib.sha256(nahled).hexdigest()[:16] if nahled else None,
          "kdy": time.strftime("%F %T"), "pokusy": {}})
    uloz_hlidku(stav="cerstve nahrano", nas=novy, slideshow=stav_slideshow(art)[1])
    log("ok:", novy, "plakat na", dnes)
except SystemExit:
    raise
except Exception as e:
    log("nepovedlo se, dalsi pokus za 10 min:", type(e).__name__, e)
    sys.exit(1)
