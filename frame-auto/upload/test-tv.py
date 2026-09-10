#!/usr/bin/env python3
"""
20minutovy test: umi tvoje TV prijmout obrazek pres lokalni API?
Spustit z Macu / HA Green, ktery je na stejne siti jako televize.

  pip install git+https://github.com/NickWaterton/samsung-tv-ws-api.git
  python3 test-tv.py 192.168.1.xx obrazek.jpg

Televize musi byt v Art Mode (kratky stisk vypinace na ovladaci), NE vypnuta.
Pri prvnim spusteni na ni vyskoci parovaci dialog - potvrdit ovladacem.
"""
import sys, os, time
from samsungtvws import SamsungTVWS

ip  = sys.argv[1]
img = sys.argv[2]
token = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tv-token.txt")

tv = SamsungTVWS(host=ip, port=8002, token_file=token)

print("1/5  info o zarizeni ...")
print("     ", tv.rest_device_info().get("device", {}).get("name"))

print("2/5  podporuje art mode?")
if not tv.art().supported():
    print("     NE - tudy cesta nevede, konec.")
    sys.exit(1)
print("      ANO")

print("3/5  nahravam obrazek ...")
with open(img, "rb") as f:
    content_id = tv.art().upload(f.read(), file_type="JPEG", matte="none")
print("      content_id =", content_id)

print("4/5  nastavuji jako aktualni ...")
tv.art().select_image(content_id, show=True)
time.sleep(3)
print("      aktualni:", tv.art().get_current())

print("5/5  co je na TV ulozeno (MY-* jsou tvoje nahrane):")
for a in tv.art().available():
    print("      ", a.get("content_id"), a.get("category_id", ""))

print()
print("HOTOVO. Jestli se obrazek objevil na TV, automatizace je proveditelna.")
print("Token ulozen v", token, "- priste uz se neptá.")
