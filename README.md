# Rodinný kalendář

> Už nikdy nechceme jako rodina nic propásnout.

Statický webový kalendář pro rodinu: kroužky kluků, školní rozvrhy, výlety, platby a termíny,
svátky a narozeniny. Běží na GitHub Pages, funguje na počítači i mobilu, a generuje `rodina.ics`,
který si předplatíš v Google Kalendáři nebo na iPhonu — a máš nativní upomínky zdarma.

---

## Jak to je postavené

| Vrstva | Kde | Proč |
|---|---|---|
| **Zdroj pravdy** | `data/*.json` v tomhle repu | Verzované v gitu, žádná databáze, žádné API klíče |
| **Web** | `index.html` + `assets/` → GitHub Pages | Statika, načte se okamžitě, funguje i offline po prvním otevření |
| **Upomínky** | `rodina.ics` → předplatné v Google Kalendáři | Nativní push na mobil, zdarma, bez vlastního serveru |
| **Automatika** | GitHub Actions | Po každém pushi přegeneruje svátky + ICS a nasadí web |

**Poctivě k omezením:**

- GitHub Pages u privátního repa vyžadují Enterprise. Tenhle web je proto **veřejný pro kohokoli, kdo zná URL**.
  Pokud to bude vadit, přesun na Cloudflare Pages + Cloudflare Access (přihlášení e-mailem, zdarma)
  je otázka půl hodiny a **nevyžaduje žádnou změnu kódu** — repo zůstane na GitHubu.
- **Google Kalendář ignoruje upomínky z odebíraných feedů** a vlastní notifikace u nich nastavit nejde —
  je to jeho dlouhodobé omezení. Události v něm uvidíš, ale nepípne. **Apple Kalendář na iPhonu
  upomínky z feedu respektuje** (při přidávání nech zapnuté „Alarmy").
- Google navíc předplacené feedy obnovuje **za 8–24 hodin**.
- Proto na upomínkách nestojí kalendář, ale **workflow `upominky.yml`**: každé ráno spočítá,
  které upomínky mají padnout dnes (podle `upominky` u každého záznamu — třeba 90/60/30 dní
  před koncem pasu), a pošle je do Telegramu. Když není co říct, **neposílá nic** — ať si
  na ty zprávy nezvyknete jako na spam.

---

## Nasazení (jednorázově, ~10 minut)

1. **Vytvoř repo** na GitHubu, např. `rodinny-kalendar`, a nahraj obsah téhle složky:

   ```bash
   git init && git add -A
   git commit -m "Rodinný kalendář – první verze"
   git branch -M main
   git remote add origin git@github.com:<tvuj-ucet>/rodinny-kalendar.git
   git push -u origin main
   ```

2. **Zapni Pages**: Settings → Pages → Source: **GitHub Actions**.

3. Za minutu je web na `https://<tvuj-ucet>.github.io/rodinny-kalendar/`.

### Vlastní adresa (volitelné, ale doporučuju)

Aby to nebyla dlouhá URL, dá se pověsit na vlastní doménu — např. `kalendar.sintera.cz`:

1. U správce DNS pro `sintera.cz` přidej **CNAME** záznam:
   `kalendar` → `<tvuj-ucet>.github.io`
2. V repu přejmenuj `CNAME.priklad` na `CNAME` (obsahuje jen tu doménu, nic víc) a pushni.
3. Settings → Pages → Custom domain vyplň `kalendar.sintera.cz`, zaškrtni **Enforce HTTPS**.

Certifikát si GitHub vyřídí sám, trvá to zhruba čtvrt hodiny. Pak je kalendář na
`https://kalendar.sintera.cz` a stejná adresa platí i pro `rodina.ics`.
Pořadí je důležité: nejdřív DNS, teprve pak soubor `CNAME` — jinak Pages chvíli hlásí chybu.

4. **Předplať si kalendář** (ty i Šárka):
   - **Google Kalendář** (na počítači): vlevo *Jiné kalendáře* → **+** → *Přidat pomocí URL* →
     vlož `https://<tvuj-ucet>.github.io/rodinny-kalendar/rodina.ics`
   - **iPhone**: Nastavení → Kalendář → Účty → Přidat účet → Jiný → **Přidat odebíraný kalendář** → stejná URL
   - Kalendář se pak zobrazuje vedle vašich vlastních a chodí z něj upomínky.

5. **Upomínky do Telegramu** (tohle je ta hlavní cesta, jak se to k vám dostane):
   - V Telegramu napiš [@BotFather](https://t.me/BotFather) → `/newbot` → dostaneš **token**
   - Založ skupinu (třeba „Rodina"), přidej do ní sebe, Šárku a toho bota
   - Napiš do skupiny cokoli a otevři `https://api.telegram.org/bot<TOKEN>/getUpdates` —
     v odpovědi najdeš `"chat":{"id":-100…}`. To je **chat ID** (u skupiny začíná mínusem)
   - V repu: Settings → Secrets and variables → Actions → přidej `TELEGRAM_TOKEN` a `TELEGRAM_CHAT`
   - Otestuj: Actions → *Ranní zpráva a upomínky* → **Run workflow**

---

## Tři pohledy

Přepínač nad kalendářem:

- **Týden** — každý den jako karta s celým textem: kdy kluci končí ve škole, jaké mají kroužky, kdy začínají. Výchozí na mobilu.
- **Měsíc** — klasická mřížka. Cesty a pobyty se kreslí jako **průběžný barevný pruh** přes dny, kroužky jako obrysové štítky s proužkem v barvě dítěte. Na mobilu se štítky mění na tečky (na to není místo), proto je tam výchozí týden.
- **Agenda** — souvislý seznam nejbližších dní, ve kterých něco je. Nejlepší na „co nás čeká".

Barva vždy znamená **osobu** (Matěj modrá, Tomáš oranžová, společné růžová), kategorie se pozná tvarem: plný pruh = cesta, obrysový štítek = kroužek. Kolize mají čárkovaný červený okraj.

Volba pohledu se pamatuje v prohlížeči. Režim na zeď (`?display=1`) používá vždy měsíc.

## Jak se přidávají data

Všechno je v `data/`. Po uložení a pushnutí se web i ICS přegenerují samy.

| Soubor | Co obsahuje |
|---|---|
| `krouzky.json` | Kroužky: den v týdnu (`0`=neděle … `6`=sobota), čas, první lekce, stav, platba |
| `events.json` | Jednorázové akce a výlety (Oslo, Villa Rudolf, Benidorm, splatnosti) |
| `rozvrhy.json` | Školní rozvrhy kluků (Bakaláři, 4.B a 2.B) — hodiny, časy zvonění, konec vyučování |
| `ukoly.json` | Věci k rozhodnutí s termínem — kolize kroužků, rezervace auta apod. |
| `narozeniny.json` | Narozeniny (opakují se ročně) |
| `people.json` | Členové rodiny a jejich barvy v kalendáři |
| `svatky.json` | **Generované** — needituj, přepíše se (`node scripts/gen-svatky.mjs`) |

Lokální náhled bez nasazování:

```bash
python3 -m http.server 8000    # a otevři http://localhost:8000
node scripts/build-ics.mjs     # přegeneruje rodina.ics
node scripts/denni-souhrn.mjs  # vypíše dnešní přehled
```

---

## Knihovna

`data/knihovna.json` drží aktuální výpůjčky z Knihovny města Hradce Králové — rozdělené podle
oddělení a čtenáře, s termínem vrácení. Web z toho udělá rozklikávací seznam, ICS událost
a hlavně: **upomínka do Telegramu obsahuje celý seznam titulů**, aby se nemuselo dohledávat,
co se vlastně vrací.

### Plánovač návštěvy

`scripts/plan-knihovna.mjs` neřeší jen „dokdy", ale **kdy tam reálně můžete jít**. Kombinuje:

- otevírací dobu jednotlivých oddělení (`data/knihovna-oteviraci.json`, staženo z webu knihovny)
- konce vyučování obou kluků z `rozvrhy.json` + 20 minut na cestu
- kroužky toho dne — okno končí 20 minut před začátkem
- svátky, neděle a rodinné výlety

Vybere nejlepší termín (nejdřív takový, kdy jsou otevřená všechna potřebná oddělení, pak nejdelší
okno), nabídne dva náhradní, a zvlášť upozorní, když v den termínu zbývá jen málo času.

**Bibliobox** počítá zvlášť: z boxu se konto odepisuje *následující pracovní den*, takže poslední
den na vhození je ten, po kterém následuje pracovní den ještě v termínu. Vhodit v den termínu
znamená pokutu.

Plán se přegeneruje při každém buildu i ráno před odesláním upomínek — je tedy vždy k dnešku.
Když je otevírací doba ověřená dřív než před 90 dny, plánovač na to sám upozorní.

Po každém novém e-mailu *„Souhrn výpůjček"* přepiš `vratitDo` a seznam titulů; vrácené výpůjčky
označ `"vraceno": true` (zůstanou v souboru jako historie, ale přestanou upomínat).

Čtenářská čísla v repu záměrně nejsou — web je veřejný.

## Doklady a platnosti

`data/doklady.json` hlídá věci, které propadají — pasy, občanky, řidičák, STK, pojištění.
Kalendář z toho udělá kartu s odpočtem v měsících a upomínky tři měsíce, dva měsíce
a měsíc předem (nebo jak si nastavíš v `upominky`).

## Přidání akce hlasem

Sekce **Nadiktuj, co se má stát** je hned nahoře na stránce (na mobilu i jako plovoucí ＋ vpravo dole).
Klikneš do pole, na iPhonu zmáčkneš mikrofon na klávesnici a mluvíš normálně. Kalendář z věty pozná:

| Rozumí | Příklady |
|---|---|
| datum | `6. 3.`, `6. března`, `začátkem března`, `koncem dubna`, `za dva měsíce`, `za tři týdny`, `zítra`, `příští středu` |
| čas | `v 9:30`, `v 17 hodin` |
| koho se týká | `Matěj`, `Tomáš`, `Tomík`, `Šárka`, `klukům` (= oba) |
| upomínky | `měsíc předem`, `dva měsíce předem`, `14 dní předem` |
| typ záznamu | akce · úkol (`objednat`, `zařídit`, `nezapomenout`) · doklad (`končí platnost`, `končí pasy`) |

Vždycky dostaneš **návrh, který musíš potvrdit** — nic se nezapíše samo.

### Aby se to opravdu uložilo

Klikni na ⚙ vedle nadpisu a vyplň:

- **Repozitář** — `ucet/rodinny-kalendar`
- **Token** — na GitHubu: Settings → Developer settings → Personal access tokens →
  **Fine-grained token**, vyber jen tenhle repozitář, oprávnění **Contents: Read and write**

Token se uloží do `localStorage` tvého prohlížeče a odesílá se jen na `api.github.com`.
Poctivě: kdo se dostane do tvého prohlížeče, dostane se i k tomu tokenu — proto ho dej jen na
vlastní zařízení a použij fine-grained token omezený na jediný repozitář, ať nemůže nic jiného.

Po potvrzení se záznam zapíše do `data/events.json`, `data/ukoly.json` nebo `data/doklady.json`,
GitHub Actions přebuildí web (~1 minuta) a Šárka to uvidí taky. Bez tokenu kalendář návrh jen
zobrazí a dá ti JSON ke zkopírování.

### iPhone: zadání bez otevírání webu

V aplikaci Zkratky si udělej zkratku *„Do rodinného kalendáře"* → **Diktovat text** → **Otevřít URL**
s adresou kalendáře a textem v parametru. Zkratku pak jde spustit ze zamykací obrazovky nebo Siri.
Až poběží n8n webhook (fáze 2), půjde stejná zkratka poslat rovnou tam a AI větu rozebere líp než
lokální parser — hlavně u složitějších vět.

---

## Zobrazení na zeď

`?display=1` na konci URL zapne režim bez ovládacích prvků, s většími písmy a automatickým
obnovením každých 15 minut — pro tablet nebo e-ink displej.

- **Levný tablet v kiosk módu** — barevný, dotykový, nejjednodušší a nejspolehlivější.
- **TRMNL 7,5" e-ink** — umí zobrazit URL, hezky vypadá, ale jen černobíle a pomalu se překresluje.
- **Samsung The Frame (Art mode)** — Art mode neumí zobrazovat živý obsah. Šlo by to jen obcházet
  nahráváním vyrenderovaného obrázku přes lokální API / SmartThings; je to křehké a Samsung
  tuhle cestu postupně zavírá. Nedoporučuju jako první krok.

---

## Tři kolize, které kalendář hlídá

Web je má v sekci **Vyžaduje rozhodnutí** a červeně v tabulce kroužků:

1. **Robotika pro nejmenší 2** (ST 14:00) — Matěj má ve středu výtvarku do 14:25, nestihne to.
2. **Programování ve Scratchi** (ČT 16:00) — kryje se s druhou hodinou leteckých modelářů (15:00–17:00).
3. **Středeční karate vs. Chovatelský 6** — Tomášovi se od 30. 9. kryje 16:00–17:00 s 16:45–17:30.

Prvních dvou se týká 4 100 Kč, které je lepší nezaplatit, dokud se to nevyjasní s DDM.

## Co ještě chybí doplnit

- adresa tělocvičny karate (ať jde spočítat přesun ze školy)
- termín splatnosti školních kroužků p. McKinnon (pokyny přijdou přes Bakaláře)
- termíny školních prázdnin 2026/27 (nebyly ověřeny, záměrně nevyplněny)
