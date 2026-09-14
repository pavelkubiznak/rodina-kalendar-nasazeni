/* Vygeneruje rodina.ics ze souborů v data/ a z ručních událostí staženého Google Kalendáře.
   Feed je doplněk — hlavní cesta na telefon je sdílený Google Kalendář (viz README). */
import fs from 'node:fs';
import { generovane, rucniProFeed } from './udalosti.mjs';

const config = JSON.parse(fs.readFileSync('data/config.json', 'utf8'));
const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
const esc = s => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
const den = s => s.replace(/-/g, '');
const hhmm = s => s.replace(':', '');
const plusDen = s => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10).replace(/-/g, ''); };

const out = [];
for (const o of [...generovane(), ...rucniProFeed()]) {
  const L = ['BEGIN:VEVENT', `UID:${o.klic}@rodinny-kalendar`, `DTSTAMP:${stamp}`];
  if (o.celodenni) {
    L.push(`DTSTART;VALUE=DATE:${den(o.od)}`, `DTEND;VALUE=DATE:${plusDen(o.do || o.od)}`);
  } else {
    L.push(`DTSTART;TZID=Europe/Prague:${den(o.od)}T${hhmm(o.cas)}00`,
           `DTEND;TZID=Europe/Prague:${den(o.od)}T${hhmm(o.casDo || o.cas)}00`);
  }
  L.push(`SUMMARY:${esc(o.nazev)}`);
  if (o.misto) L.push(`LOCATION:${esc(o.misto)}`);
  if (o.popis) L.push(`DESCRIPTION:${esc(o.popis)}`);
  if (o.rrule) L.push(`RRULE:${o.rrule}`);
  for (const dnu of (o.upominky || [])) {
    L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER:-P${dnu}D`, `DESCRIPTION:${esc(o.nazev)}`, 'END:VALARM');
  }
  L.push('END:VEVENT');
  out.push(L.join('\r\n'));
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
