/* Přepíše data/knihovna.json podle e-mailů z Knihovny města Hradce Králové.

   Vstup na stdin: JSON pole e-mailů
     [{ "id": "...", "datum": "2026-09-14T05:15:00Z", "odesilatel": "pujcho@knihovnahk.cz",
        "predmet": "Souhrn výpůjček z data 14.09.2026", "telo": "...plain text..." }]

   Rozumí třem druhům zpráv:
     • „Souhrn výpůjček"  — úplný stav konta daného čtenáře v daném oddělení (přepíše vše)
     • „Upozornění před koncem výpůjční doby" a „1./2. upomínka" — seznam k jednomu termínu
       (přepíše jen skupinu se stejným datem vrácení)

   Stav se skládá po skupinách (oddělení × čtenář × termín); vítězí vždy novější e-mail.
   Skupiny s termínem starším než 30 dní se zahazují — to už je dávno vrácené.

   node scripts/knihovna-z-mailu.mjs < maily.json          zapíše data/knihovna.json
   node scripts/knihovna-z-mailu.mjs --dry < maily.json    jen vypíše, co by zapsal
*/
import fs from 'node:fs';

const ODDELENI = {
  'ustrednipujc@knihovnahk.cz': { nazev: 'Ústřední půjčovna dospělí', telefon: '495 075 025' },
  'detske@knihovnahk.cz':       { nazev: 'Ústřední půjčovna děti',    telefon: '495 075 033' },
  'pujcho@knihovnahk.cz':       { nazev: 'Hudební oddělení',          telefon: '495 075 034' },
};
// čísla čtenářských průkazů → id osoby v data/people.json
const CTENARI = { '632301': 'pavel', '631076': 'tomas', '630669': 'matej' };
const KNIHOVNA = 'Knihovna města Hradce Králové';
const UPOMINKY = [7, 3, 1];
const PROSKRTNOUT_PO = 30;   // dní po termínu, kdy se skupina přestane hlídat

const iso = d => `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)}`;   // DD.MM.YYYY → YYYY-MM-DD
const jeDatum = s => /^\d{2}\.\d{2}\.\d{4}$/.test(s.trim());
const rozdel = rest => {                       // „Autor : Název" nebo „: Název"
  const i = rest.indexOf(' : ');
  if (rest.startsWith(': ')) return { autor: null, nazev: rest.slice(2).trim() };
  if (i < 0) return { autor: null, nazev: rest.trim() };
  return { autor: rest.slice(0, i).trim() || null, nazev: rest.slice(i + 3).trim() };
};

function ctenar(telo) {
  const m = telo.match(/čtenáře? č\.\s*(\d+)/);
  if (!m) return null;
  return { cislo: m[1], id: CTENARI[m[1]] ?? null };
}

/* „do 14.09.2026 - Autor : Název" (upomínky mají „od") */
function zSeznamu(telo) {
  // první položka bývá nalepená na větu „Nyní máte půjčeno:", proto se nehledá po řádcích
  const out = [];
  for (const m of telo.matchAll(/(?:^|[\n\s])(?:do|od)\s+(\d{2}\.\d{2}\.\d{4})\s*-\s*([^\n]+)/g))
    out.push({ vratitDo: iso(m[1]), ...rozdel(m[2]) });
  return out;
}

/* tabulka: půjčeno od / dokdy vrátit / [označení] / autor / název */
function zTabulky(telo) {
  const radky = telo.split('\n').map(r => r.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < radky.length; i++) {
    if (!jeDatum(radky[i]) || !jeDatum(radky[i + 1] ?? '')) continue;
    const vratitDo = iso(radky[i + 1]);
    const blok = [];
    let j = i + 2;
    while (j < radky.length && !jeDatum(radky[j]) && !/^(Nejpozději do|Celkem|Na shledanou|Telefon|E-mail|https)/.test(radky[j])) blok.push(radky[j++]);
    if (blok.length) out.push({ vratitDo, autor: blok.length > 1 ? blok.at(-2) : null, nazev: blok.at(-1) });
    i = j - 1;
  }
  return out;
}

const maily = JSON.parse(fs.readFileSync(0, 'utf8'))
  .filter(m => ODDELENI[m.odesilatel])
  .sort((a, b) => new Date(a.datum) - new Date(b.datum));   // od nejstaršího, novější přepisuje

const skupiny = new Map();   // "oddeleni|ctenar|vratitDo" → { …, kdy }
const klic = (od, ct, dat) => `${od}|${ct}|${dat}`;

for (const m of maily) {
  const od = m.odesilatel, ct = ctenar(m.telo);
  if (!ct?.id) continue;
  const souhrn = /Souhrn výpůjček/i.test(m.predmet) || /má půjčeno|nemá nic půjčeno/.test(m.telo);
  const polozky = souhrn ? zTabulky(m.telo) : zSeznamu(m.telo);
  if (souhrn) for (const k of [...skupiny.keys()]) if (k.startsWith(`${od}|${ct.id}|`)) skupiny.delete(k);
  else for (const d of new Set(polozky.map(p => p.vratitDo))) skupiny.delete(klic(od, ct.id, d));
  for (const p of polozky) {
    const k = klic(od, ct.id, p.vratitDo);
    if (!skupiny.has(k)) skupiny.set(k, { od, ctenar: ct.id, vratitDo: p.vratitDo, kdy: m.datum, zdroj: m.predmet, tituly: [] });
    skupiny.get(k).tituly.push({ autor: p.autor, nazev: p.nazev });
  }
}

const dnes = new Date().toISOString().slice(0, 10);
const prosle = d => (new Date(dnes) - new Date(d)) / 86400000 > PROSKRTNOUT_PO;

const podleTerminu = new Map();
for (const s of [...skupiny.values()].filter(s => !prosle(s.vratitDo))) {
  if (!podleTerminu.has(s.vratitDo)) podleTerminu.set(s.vratitDo, []);
  podleTerminu.get(s.vratitDo).push(s);
}

const vysledek = [...podleTerminu.entries()].sort().map(([vratitDo, sk]) => ({
  id: `vypujcky-${vratitDo}`,
  vratitDo,
  knihovna: KNIHOVNA,
  upominky: UPOMINKY,
  vraceno: false,
  zdroj: `E-maily z knihovny (poslední ${sk.map(s => s.kdy).sort().at(-1).slice(0, 10)})`,
  oddeleni: sk
    .sort((a, b) => (a.od + a.ctenar).localeCompare(b.od + b.ctenar))
    .map(s => ({
      nazev: ODDELENI[s.od].nazev,
      ctenar: s.ctenar,
      telefon: ODDELENI[s.od].telefon,
      email: s.od,
      tituly: s.tituly,
    })),
}));

const json = JSON.stringify(vysledek, null, 2) + '\n';
if (process.argv.includes('--dry')) {
  console.log(json);
} else {
  fs.writeFileSync('data/knihovna.json', json);
  const celkem = vysledek.reduce((a, v) => a + v.oddeleni.reduce((b, o) => b + o.tituly.length, 0), 0);
  console.log(`data/knihovna.json zapsán — ${vysledek.length} termín(ů), ${celkem} titulů.`);
}
