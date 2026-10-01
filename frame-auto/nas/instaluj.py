#!/usr/bin/env python3
"""
Jednorazova instalace knihoven pro denni-upload.py na Synology NAS (DS213j, DSM 7.1,
Python 3.9 z Centra balicku). Bez pipu - jen standardni knihovna:

  - ciste pythonovske wheely z PyPI (requests a spol., websocket-client) se rozbali do lib/
  - samsungtvws je fork NickWaterton na stejnem commitu jako na Macu (uploader pouziva
    jeho vnitrnosti: get_uuid, art_uuid, _send_art_request(..., wait_for_event))

Spousti ho spust.sh, kdyz lib/ chybi. Rucne:  python3 instaluj.py
"""
import io, json, os, shutil, sys, urllib.request, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
LIB = os.path.join(HERE, "lib")

# stejne verze jako ve venv na Macu (overene s uploaderem), vsechny maji py3-none-any wheel
BALICKY = [
    ("requests", "2.32.5"),
    ("urllib3", "2.6.3"),
    ("idna", "3.19"),
    ("certifi", "2026.7.22"),
    ("charset-normalizer", "3.4.2"),   # 3.5.x nema ciste pythonovsky wheel; requests bere 2-3.x
    ("websocket-client", "1.9.0"),
]
FORK = ("https://github.com/NickWaterton/samsung-tv-ws-api/archive/"
        "fe95ef1d784cd32f49bf9a07ec479576574eea07.zip")


def stahni(url):
    req = urllib.request.Request(url, headers={"User-Agent": "rodina-kalendar-nas/1"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def wheel(jmeno, verze):
    info = json.loads(stahni("https://pypi.org/pypi/%s/%s/json" % (jmeno, verze)))
    for soubor in info["urls"]:
        if soubor["filename"].endswith("-py3-none-any.whl") or soubor["filename"].endswith("-py2.py3-none-any.whl"):
            return soubor["url"]
    raise RuntimeError("%s %s: chybi ciste pythonovsky wheel" % (jmeno, verze))


def main():
    docasne = LIB + ".nova"
    shutil.rmtree(docasne, ignore_errors=True)
    os.makedirs(docasne)
    for jmeno, verze in BALICKY:
        url = wheel(jmeno, verze)
        zipfile.ZipFile(io.BytesIO(stahni(url))).extractall(docasne)
        print("ok", jmeno, verze, flush=True)
    archiv = zipfile.ZipFile(io.BytesIO(stahni(FORK)))
    for clen in archiv.namelist():
        cast = clen.split("/", 1)          # samsung-tv-ws-api-<sha>/samsungtvws/...
        if len(cast) == 2 and cast[1].startswith("samsungtvws/") and not clen.endswith("/"):
            cil = os.path.join(docasne, cast[1])
            os.makedirs(os.path.dirname(cil), exist_ok=True)
            with open(cil, "wb") as f:
                f.write(archiv.read(clen))
    print("ok samsungtvws (fork NickWaterton fe95ef1)", flush=True)
    # kontrola importu jeste nad docasnou slozkou - rozbita instalace nesmi nahradit funkcni
    sys.path.insert(0, docasne)
    from samsungtvws import SamsungTVWS  # noqa: F401
    from samsungtvws.helper import get_ssl_context  # noqa: F401
    import requests  # noqa: F401
    shutil.rmtree(LIB, ignore_errors=True)
    os.rename(docasne, LIB)
    print("knihovny hotove v", LIB, flush=True)


if __name__ == "__main__":
    main()
