/* Stáhne ruční události z kalendáře „Rodina" do data/events-google.json.
   Tenhle směr je jediný, kterým se do repa dostane to, co někdo napsal
   v Kalendáři na iPhonu, na Macu nebo ve webovém Google Kalendáři. */
import fs from 'node:fs';
import { KAL, udalosti } from './google-auth.mjs';

const CIL = 'data/events-google.json';
const ZPET_DNI = 60;      // kus historie, ať plakát umí ukázat i „bylo včera"
const DOPREDU_DNI = 400;  // rok a kus dopředu

const posun = (dni) => { const d = new Date(); d.setDate(d.getDate() + dni); return d.toISOString(); };
const minusDen = s => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };

// „🎾 Tenis" → { ikona: '🎾', nazev: 'Tenis' }; bez emoji zůstane výchozí špendlík
function rozdel(summary) {
  const s = (summary || '(bez názvu)').trim();
  const m = s.match(/^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)\s+(.+)$/u);
  return m ? { ikona: m[1], nazev: m[2] } : { ikona: '📌', nazev: s };
}

const items = await udalosti(KAL.rucni, {
  singleEvents: 'true',          // opakované události rozbalit na jednotlivé výskyty
  orderBy: 'startTime',
  timeZone: 'Europe/Prague',
  timeMin: posun(-ZPET_DNI),
  timeMax: posun(DOPREDU_DNI),
});

const out = [];
for (const ev of items) {
  if (ev.status === 'cancelled' || !ev.start) continue;
  const celodenni = !!ev.start.date;
  const { ikona, nazev } = rozdel(ev.summary);
  const zaznam = {
    id: `g-${ev.id}`,
    nazev, ikona,
    kdo: ['rodina'],
    typ: 'google',
    celodenni,
    upominky: [1],
  };
  if (celodenni) {
    zaznam.od = ev.start.date;
    // Google drží u celodenních konec exkluzivně (den po); my inkluzivně
    const konec = ev.end?.date ? minusDen(ev.end.date) : ev.start.date;
    if (konec > zaznam.od) zaznam.do = konec;
  } else {
    zaznam.od = ev.start.dateTime.slice(0, 10);
    zaznam.cas = ev.start.dateTime.slice(11, 16);
    if (ev.end?.dateTime) zaznam.casDo = ev.end.dateTime.slice(11, 16);
  }
  if (ev.location) zaznam.misto = ev.location;
  if (ev.description) zaznam.popis = ev.description.replace(/<[^>]+>/g, '').trim();
  out.push(zaznam);
}

out.sort((a, b) => (a.od + (a.cas || '')).localeCompare(b.od + (b.cas || '')));

const stary = fs.existsSync(CIL) ? fs.readFileSync(CIL, 'utf8') : '';
const novy = JSON.stringify(out, null, 2) + '\n';
if (stary === novy) { console.log(`Beze změny — ${out.length} ručních událostí.`); }
else { fs.writeFileSync(CIL, novy); console.log(`Staženo ${out.length} ručních událostí → ${CIL}`); }
