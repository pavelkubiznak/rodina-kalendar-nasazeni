/* Jediné místo, kde se z dat v data/*.json skládá seznam událostí.
   Používá to build-ics.mjs (feed) i google-push.mjs (Google Kalendář),
   aby se stejná logika nepsala dvakrát a nerozešla se.

   Tvar jedné položky:
     { klic, nazev, od, do, celodenni, cas, casDo, misto, popis, rrule, upominky }
   `klic` je stabilní identifikátor — podle něj se v Google Kalendáři pozná,
   že jde o tutéž událost, a jen se upraví místo smazání a založení znovu. */
import fs from 'node:fs';

const J = n => JSON.parse(fs.readFileSync(`data/${n}.json`, 'utf8'));

export const SKOLNI_ROK = { od: '2026-09-01', do: '2027-06-30' };

/* Ruční události z Google Kalendáře, které stáhl google-pull.mjs.
   Když soubor není (první běh, nebo sync vypnutý), vrátí prázdno. */
export function googleEvents() {
  try { return JSON.parse(fs.readFileSync('data/events-google.json', 'utf8')); }
  catch { return []; }
}

/* events.json z gitu + ruční z Google. Tohle chce plakát, upomínky i web. */
export function vsechnyEvents() {
  return [...J('events'), ...googleEvents()];
}

export function generovane() {
  const people = J('people'), krouzky = J('krouzky'), events = J('events'),
        svatky = J('svatky'), narozeniny = J('narozeniny'),
        ukoly = J('ukoly'), doklady = J('doklady'), knihovna = J('knihovna');

  const jmeno = id => (people.find(p => p.id === id) || {}).jmeno || id;
  const den = s => s.replace(/-/g, '');
  const out = [];
  const push = (klic, o) => out.push({ klic, upominky: [], ...o });

  // 1) akce, lety, ubytování, výlety
  for (const e of events) {
    if (e.cas) {
      push(e.id, { nazev: `${e.ikona || ''} ${e.nazev}`.trim(), od: e.od, celodenni: false,
        cas: e.cas, casDo: e.casDo || e.cas,
        misto: e.misto, popis: e.popis, upominky: e.upominky || [1] });
    } else {
      push(e.id, { nazev: `${e.ikona || ''} ${e.nazev}`.trim(), od: e.od, do: e.do,
        celodenni: true, misto: e.misto, popis: e.popis, upominky: e.upominky || [7, 1] });
    }
  }

  // 2) úkoly s termínem
  for (const u of ukoly) {
    if (u.hotovo) continue;
    push(`ukol-${u.id}`, { nazev: `${u.ikona || '✅'} ${u.nazev}`, od: u.doKdy, celodenni: true,
      popis: u.popis, upominky: u.upominky || [7, 1] });
  }

  // 3) platnost dokladů
  for (const dok of doklady) {
    push(`doklad-${dok.id}`, {
      nazev: `${dok.ikona || '📄'} Končí platnost: ${dok.nazev}`,
      od: dok.platnostDo, celodenni: true,
      popis: [dok.poznamka, dok.presne === false ? '⚠️ Přesné datum ověřit v dokladu.' : ''].filter(Boolean).join(' '),
      upominky: dok.upominky || [90, 60, 30] });
  }

  // 4) výpůjčky z knihovny – se seznamem titulů v popisu
  for (const v of knihovna) {
    if (v.vraceno) continue;
    const celkem = v.oddeleni.reduce((a, o) => a + o.tituly.length, 0);
    const seznam = v.oddeleni.map(o =>
      `${o.nazev} — ${jmeno(o.ctenar)} (tel. ${o.telefon}):\n` +
      o.tituly.map(t => `  - ${t.autor ? t.autor + ': ' : ''}${t.nazev}`).join('\n')
    ).join('\n\n');
    push(`knihovna-${v.id}`, {
      nazev: `📚 Vrátit do knihovny (${celkem} titulů)`,
      od: v.vratitDo, celodenni: true, misto: v.knihovna,
      popis: `${v.knihovna}\n\n${seznam}`,
      upominky: v.upominky || [7, 3, 1] });
  }

  // 5) kroužky – týdenní opakování do konce školního roku
  const DNI_ICS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  for (const k of krouzky) {
    const dny = [k.den, k.denDalsi].filter(x => x != null);
    if (!dny.length || !k.od) continue;               // bez dne nebo času nemá smysl generovat
    const start = k.prvniLekce || SKOLNI_ROK.od;
    const d = new Date(start + 'T00:00:00Z');
    while (!dny.includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
    push(`krouzek-${k.id}`, {
      nazev: `${k.stav === 'kolize' ? '⚠️ ' : ''}${k.nazev} — ${k.kdo.map(jmeno).join(' + ')}`,
      od: d.toISOString().slice(0, 10), cas: k.od, casDo: k.do || k.od,
      celodenni: false, misto: k.misto, popis: [k.poskytovatel, k.poznamka].filter(Boolean).join(' — '),
      rrule: `FREQ=WEEKLY;BYDAY=${dny.map(x => DNI_ICS[x]).join(',')};UNTIL=${den(k.konecKurzu || SKOLNI_ROK.do)}T235900Z`,
      upominky: [] });
  }

  // 6) splatnosti
  const splat = new Map();
  for (const k of krouzky) {
    if (!k.platba?.splatnost || k.platba.zaplaceno) continue;
    const key = `${k.platba.splatnost}|${k.platba.kde}`;
    if (!splat.has(key)) splat.set(key, []);
    splat.get(key).push(k);
  }
  for (const [key, ks] of splat) {
    const [kdy, kde] = key.split('|');
    const suma = ks.reduce((a, k) => a + (k.platba.castka || 0), 0);
    const detail = ks.map(k => {
      const vs = k.vs ? ' (VS ' + Object.entries(k.vs).map(([who, v]) => `${jmeno(who)} ${v}`).join(', ') + ')' : '';
      return `• ${k.nazev}${vs}${k.stav === 'kolize' ? ' ⚠️ zatím neplatit' : ''}`;
    }).join('\n');
    push(`platba-${kdy}-${kde.slice(0, 10).replace(/\W/g, '')}`, {
      nazev: `💳 Zaplatit ${suma.toLocaleString('cs-CZ')} Kč — ${kde}`,
      od: kdy, celodenni: true, popis: `${kde}\n${detail}`, upominky: [21, 7, 3, 1] });
  }

  // 7) narozeniny (opakující se ročně)
  for (const n of narozeniny) {
    push(`nar-${n.jmeno}`, { nazev: `🎂 ${n.jmeno} — narozeniny`, od: n.datum, celodenni: true,
      rrule: 'FREQ=YEARLY', popis: `Narozen(a) ${n.datum}.`, upominky: [7, 1] });
  }

  // 8) svátky a významné dny
  for (const s of svatky) {
    push(`svatek-${s.datum}-${s.nazev.slice(0, 12).replace(/\W/g, '')}`,
      { nazev: `${s.volno ? '🇨🇿' : '·'} ${s.nazev}`, od: s.datum, celodenni: true, upominky: [] });
  }

  return out;
}

/* Ruční události z Google ve stejném tvaru — aby je feed uměl vypsat taky. */
export function rucniProFeed() {
  return googleEvents().map(e => ({
    klic: e.id,
    nazev: `${e.ikona || ''} ${e.nazev}`.trim(),
    od: e.od, do: e.do, celodenni: e.celodenni,
    cas: e.cas, casDo: e.casDo,
    misto: e.misto, popis: e.popis,
    upominky: e.celodenni ? [1] : [],
  }));
}
