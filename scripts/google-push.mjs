/* Nasype do kalendáře „Rodina – automaticky" všechno, co se generuje z dat v gitu:
   rozvrhy a kroužky, svátky, narozeniny, výlety, splatnosti, knihovnu, deadliny úkolů.

   Tenhle kalendář je robotí — co do něj napíše člověk, to příští běh smaže.
   Ruční zápisy patří do kalendáře „Rodina", odkud je zase čte google-pull.mjs.
   Proto se ty dva nikdy nepotkají a nemůže vzniknout smyčka.

   --nanecisto vypíše, co by se stalo, a nic nezapíše. */
import crypto from 'node:crypto';
import { KAL, api, udalosti } from './google-auth.mjs';
import { generovane } from './udalosti.mjs';

const NANECISTO = process.argv.includes('--nanecisto');
const MAX_UPOMINKA = 40320;   // Google neumí upomínku dřív než 28 dní předem

const plusDen = s => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const otisk = o => crypto.createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 16);

function naGoogle(o) {
  const ev = {
    summary: o.nazev,
    start: o.celodenni ? { date: o.od } : { dateTime: `${o.od}T${o.cas}:00`, timeZone: 'Europe/Prague' },
    end:   o.celodenni ? { date: plusDen(o.do || o.od) } : { dateTime: `${o.od}T${o.casDo || o.cas}:00`, timeZone: 'Europe/Prague' },
    reminders: {
      useDefault: false,
      overrides: [...new Set((o.upominky || []).map(d => Math.min(d * 1440, MAX_UPOMINKA)))]
        .sort((a, b) => a - b).slice(0, 5).map(minutes => ({ method: 'popup', minutes })),
    },
  };
  if (o.misto) ev.location = o.misto;
  if (o.popis) ev.description = o.popis;
  if (o.rrule) ev.recurrence = [`RRULE:${o.rrule}`];
  // svátky a narozeniny nemají blokovat čas v „kdy máš volno"
  if (/^(svatek-|nar-)/.test(o.klic)) ev.transparency = 'transparent';
  return ev;
}

const zdroj = generovane();
const stavajici = await udalosti(KAL.auto, { privateExtendedProperty: 'zdroj=git', showDeleted: 'false' });
const podleKlice = new Map();
for (const ev of stavajici) {
  const k = ev.extendedProperties?.private?.klic;
  if (k) podleKlice.set(k, ev);
}

let novych = 0, zmenenych = 0, beze = 0, smazanych = 0;
const chyby = [];

for (const o of zdroj) {
  const telo = naGoogle(o);
  const h = otisk(telo);
  const stary = podleKlice.get(o.klic);
  telo.extendedProperties = { private: { zdroj: 'git', klic: o.klic, otisk: h } };
  try {
    if (!stary) {
      if (!NANECISTO) await api('POST', `/calendars/${encodeURIComponent(KAL.auto)}/events`, telo);
      novych++;
    } else if (stary.extendedProperties?.private?.otisk !== h) {
      if (!NANECISTO) await api('PUT', `/calendars/${encodeURIComponent(KAL.auto)}/events/${stary.id}`, telo);
      zmenenych++;
    } else {
      beze++;
    }
  } catch (e) {
    chyby.push(`${o.klic}: ${e.message}`);
  }
  podleKlice.delete(o.klic);
}

// co zbylo, už v datech není — pryč s tím
for (const [klic, ev] of podleKlice) {
  try {
    if (!NANECISTO) await api('DELETE', `/calendars/${encodeURIComponent(KAL.auto)}/events/${ev.id}`);
    smazanych++;
  } catch (e) {
    if (e.status !== 410 && e.status !== 404) chyby.push(`smazat ${klic}: ${e.message}`);
  }
}

console.log(`${NANECISTO ? '[nanečisto] ' : ''}nových ${novych} · upravených ${zmenenych} · beze změny ${beze} · smazaných ${smazanych}`);
if (chyby.length) {
  console.error(`\n${chyby.length} chyb:`);
  for (const c of chyby.slice(0, 20)) console.error('  ' + c);
  process.exit(1);
}
