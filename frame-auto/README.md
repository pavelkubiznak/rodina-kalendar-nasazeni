# Frame — denní kalendář na zeď

Automatizace toho, co teď děláš ručně: každý den v 5:30 se vyrenderuje nový obrázek
a sám se nahraje na televizi.

## Jak to teče

```
21:00 GitHub Actions  →  render 3840×2160 JPEG na zítřek z data/*.json  →  publikace na Pages
      (součást deploy.yml; přerenderuje se i po každém pushi)
5:30  lokální skript  →  stáhne JPEG  →  nahraje do TV  →  smaže včerejší
```

**Proč to rozdělení:** renderování potřebuje headless Chromium (těžké, ale běží zadarmo
v cloudu), upload potřebuje být na tvé LAN (lehké — jen python a jedna knihovna).
Lokálně tak běží pár kilobajtů kódu, ne celý prohlížeč.

**Proč se JPEG necommituje do repa:** 600 kB denně je 200 MB v git historii za rok.
Publikuje se jako Pages artefakt, historie zůstává čistá.

## Krok 0 — ověřit, že TV přijme obrázek přes API (20 minut)

Ruční nahrání přes SmartThings ≠ API funguje. Jde o jinou cestu a tohle je jediná
skutečná neznámá celého projektu. **Nedělej nic dalšího, dokud tenhle test neprojde.**

```bash
pip install git+https://github.com/NickWaterton/samsung-tv-ws-api.git
python3 upload/test-tv.py 192.168.1.xx nejaky-obrazek.jpg
```

Televize musí být **v Art Mode, ne vypnutá** (krátký stisk vypínače na ovladači).
Při prvním spuštění na ní vyskočí párovací dialog — potvrdit ovladačem.

Když skript skončí na `art mode nedostupny`, končíme a zůstává ruční nahrávání.

## Krok 1 — renderer

V kořeni repa:

```bash
npm ci && npx playwright install chromium
node scripts/build-frame-data.mjs > frame-data.json          # --datum 2026-10-24 pro náhled jiného dne
node frame-auto/render/render.mjs frame-data.json frame.jpg
```

`render/template.mjs` je hotový a vyladěný — typografie sedí na 65" ze tří metrů.
Nesahat na velikosti písma, jsou spočítané (1 px na 65" 4K = 0,375 mm, pod 40 px
už to z gauče nikdo nepřečte).

`scripts/build-frame-data.mjs` sestaví datový objekt (tvar viz `render/priklad-data.json`)
stejnými pravidly jako ICS a denní souhrn; knihovnu počítá plánovač. Když se obsah
na plakát nevejde, `render/vejit.mjs` vynechá nejdřív nejvzdálenější položky „Blíží se",
pak cesty — měří se ve skutečném Chromiu, takže to sedí i na fonty v CI.

## Krok 2 — GitHub Action

Render je krok v `.github/workflows/deploy.yml`, **ne samostatný workflow**. Pages nasazuje
vždy celý web najednou — samostatný workflow by buď přepsal web jen obrázkem, nebo by
každý push nasadil web bez obrázku.

Běží při každém pushi, ráno ve 3:00 UTC a večer v 19:00 UTC (21:00 SELČ, 20:00 SEČ).
**Po 18:00 pražského času se renderuje plakát na zítřek.** Důvod: plánované běhy GitHubu
tu chodí i o 4–5 hodin později (ranní deploy 10. 9. naplánovaný na 5:00 doběhl v 9:33),
takže ranní render by upload v 5:30 nestihl. Večerní běh má rezervu přes celou noc
a push v noci plakát na zítřek jen zaktualizuje.

Na Pages přibude `frame.jpg` a `frame-data.json` (pole `datumIso` — uploader podle něj
pozná, že nestahuje včerejší plakát). Když render selže, web se nasadí i tak, jen bez
`frame.jpg`, a televize zůstane na včerejším.

## Krok 3 — lokální uploader

`upload/denni-upload.py` na něčem, co v 5:30 běží — HA Green, Mac, Raspberry Pi.

```
30 5 * * *  /usr/bin/python3 /cesta/upload/denni-upload.py
```

Nastavit `FRAME_IP` a `IMG_URL`.

## Na co si dát pozor

**Pevná IP televize.** Rezervace v DHCP na routeru. Když TV skočí na jinou adresu,
upload tiše přestane fungovat a budeš to hledat týden.

**Mazání starých obrázků.** Skript maže včerejší až *po* úspěšném nahrání nového —
`posledni.json` si drží content_id. Bez toho se úložiště televize zaplní.

**TV v 5:30 spí.** Proto těch 6 pokusů po 5 minutách. Jestli Frame na noc vypínáš
úplně ze zásuvky, tohle nepomůže a upload musí jít až ráno, kdy ji zapneš.

**Matte = "none".** S paspartou to ukousne okraje a rozhodí layout.

**Slideshow vypnutá.** Jinak se nahraný obrázek za pár minut přetočí na obraz
z Art Store a bude to vypadat, že upload nefunguje.

**Samsung může API rozbít firmwarem.** Není oficiální. Až přestane fungovat,
ruční nahrávání přes SmartThings zůstane — takže o nic nepřijdeš, jen o pohodlí.

## Časový odhad

| | |
|---|---|
| Krok 0 — test API | 20–30 min |
| Krok 1 — napojení rendereru na data | 45–60 min |
| Krok 2 — Action | 20 min |
| Krok 3 — uploader a cron | 30–45 min |
| Doladění | 30 min |

**Celkem 2–3 hodiny.** Layout, který byl původně největší kus, je hotový.

## Kde to dělat

Claude Code na Macu, ve složce s repem. Cowork nemá přístup ani na tvou LAN
(televize, HA Green), ani push do GitHubu.
