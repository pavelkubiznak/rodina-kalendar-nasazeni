/* Vygeneruje rodina.ics ze souborů v data/. Feed si předplatíš v Google Kalendáři / iPhonu. */
import fs from 'node:fs';
const J = n => JSON.parse(fs.readFileSync(`data/${n}.json`, 'utf8'));
const people = J('people'), krouzky = J('krouzky'), events = J('events'),
      svatky = J('svatky'), narozeniny = J('narozeniny'), config = J('config'), ukoly = J('ukoly'), doklady = J('doklady'), knihovna = J('knihovna');

const SKOLNI_ROK = { od: '2026-09-01', do: '2027-06-30' };
const jmeno = id => (people.find(p => p.id === id) || {}).jmeno || id;
const d2 = n => String(n).padStart(2, '0');
const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
const esc = s => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
const den = s => s.replace(/-/g, '');
const plusDen = s => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10).replace(/-/g, ''); };

const out = [];
const push = (uid, o) => {
  const L = ['BEGIN:VEVENT', `UID:${uid}@rodinny-kalendar`, `DTSTAMP:${stamp}`];
  if (o.celodenni) { L.push(`DTSTART;VALUE=DATE:${den(o.od)}`, `DTEND;VALUE=DATE:${plusDen(o.do || o.od)}`); }
  else { L.push(`DTSTART;TZID=Europe/Prague:${den(o.od)}T${o.od2}00`, `DTEND;TZID=Europe/Prague:${den(o.od)}T${o.do2}00`); }
  L.push(`SUMMARY:${esc(o.nazev)}`);
  if (o.misto) L.push(`LOCATION:${esc(o.misto)}`);
  if (o.popis) L.push(`DESCRIPTION:${esc(o.popis)}`);
  if (o.rrule) L.push(`RRULE:${o.rrule}`);
  for (const dnu of (o.upominky || [])) {
    L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER:-P${dnu}D`, `DESCRIPTION:${esc(o.nazev)}`, 'END:VALARM');
  }
  L.push('END:VEVENT');
  out.push(L.join('\r\n'));
};

// 1) akce, lety, ubytování, výlety
for (const e of events) {
  if (e.cas) {
    push(e.id, { nazev: `${e.ikona || ''} ${e.nazev}`.trim(), od: e.od, celodenni: false,
      od2: e.cas.replace(':', ''), do2: (e.casDo || e.cas).replace(':', ''),
      misto: e.misto, popis: e.popis, upominky: e.upominky || [1] });
  } else {
    push(e.id, { nazev: `${e.ikona || ''} ${e.nazev}`.trim(), od: e.od, do: e.do,
      celodenni: true, misto: e.misto, popis: e.popis, upominky: e.upominky || [7, 1] });
  }
}

// 1b) úkoly s termínem
for (const u of ukoly) {
  if (u.hotovo) continue;
  push(`ukol-${u.id}`, { nazev: `${u.ikona || '✅'} ${u.nazev}`, od: u.doKdy, celodenni: true,
    popis: u.popis, upominky: u.upominky || [7, 1] });
}

// 1c) platnost dokladů
for (const dok of doklady) {
  push(`doklad-${dok.id}`, {
    nazev: `${dok.ikona || '📄'} Končí platnost: ${dok.nazev}`,
    od: dok.platnostDo, celodenni: true,
    popis: [dok.poznamka, dok.presne === false ? '⚠️ Přesné datum ověřit v dokladu.' : ''].filter(Boolean).join(' '),
    upominky: dok.upominky || [90, 60, 30] });
}

// 1d) výpůjčky z knihovny – se seznamem titulů v popisu
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

// 2) kroužky – týdenní opakování do konce školního roku
const DNI_ICS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
for (const k of krouzky) {
  const dny = [k.den, k.denDalsi].filter(x => x != null);
  if (!dny.length || !k.od) continue;               // bez dne nebo času nemá smysl generovat
  const start = k.prvniLekce || SKOLNI_ROK.od;
  const d = new Date(start + 'T00:00:00Z');
  while (!dny.includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  push(`krouzek-${k.id}`, {
    nazev: `${k.stav === 'kolize' ? '⚠️ ' : ''}${k.nazev} — ${k.kdo.map(jmeno).join(' + ')}`,
    od: d.toISOString().slice(0, 10), od2: k.od.replace(':', ''), do2: (k.do || k.od).replace(':', ''),
    celodenni: false, misto: k.misto, popis: [k.poskytovatel, k.poznamka].filter(Boolean).join(' — '),
    rrule: `FREQ=WEEKLY;BYDAY=${dny.map(x => DNI_ICS[x]).join(',')};UNTIL=${den(k.konecKurzu || SKOLNI_ROK.do)}T235900Z`,
    upominky: [],
  });
}

// 3) splatnosti
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

// 4) narozeniny (opakující se ročně)
for (const n of narozeniny) {
  push(`nar-${n.jmeno}`, { nazev: `🎂 ${n.jmeno} — narozeniny`, od: n.datum, celodenni: true,
    rrule: 'FREQ=YEARLY', popis: `Narozen(a) ${n.datum}.`, upominky: [7, 1] });
}

// 5) svátky a významné dny
for (const s of svatky) {
  push(`svatek-${s.datum}-${s.nazev.slice(0, 12).replace(/\W/g, '')}`,
    { nazev: `${s.volno ? '🇨🇿' : '·'} ${s.nazev}`, od: s.datum, celodenni: true, upominky: [] });
}

const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rodinny kalendar//CS//', 'CALSCALE:GREGORIAN',
  'METHOD:PUBLISH', `X-WR-CALNAME:${config.nazev}`, 'X-WR-TIMEZONE:Europe/Prague',
  'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H',
  ...out, 'END:VCALENDAR'].join('\r\n') + '\r\n';

// složení dlouhých řádků podle RFC 5545 (max 75 oktetů)
const fold = txt => txt.split('\r\n').map(line => {
  if (Buffer.byteLength(line, 'utf8') <= 75) return line;
  const parts = []; let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch, 'utf8') > (parts.length ? 74 : 75)) { parts.push(cur); cur = ''; }
    cur += ch;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}).join('\r\n');

fs.writeFileSync('rodina.ics', fold(ics));
console.log(`rodina.ics — ${out.length} událostí.`);
