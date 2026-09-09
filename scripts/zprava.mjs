/* Ranní zpráva do Telegramu. Vypíše text jen když je co říct — jinak nic. */
import fs from 'node:fs';
import { sestavUpominky } from './upominky.mjs';

const J = n => JSON.parse(fs.readFileSync(`data/${n}.json`, 'utf8'));
const people = J('people'), krouzky = J('krouzky'), events = J('events'),
      svatky = J('svatky'), narozeniny = J('narozeniny'), rozvrhy = J('rozvrhy');

const DNY = ['neděle','pondělí','úterý','středa','čtvrtek','pátek','sobota'];
const MES = ['ledna','února','března','dubna','května','června','července','srpna','září','října','listopadu','prosince'];
const SR = { od:'2026-09-01', do:'2027-06-30' };
const jmeno = id => (people.find(p => p.id === id) || {}).jmeno || id;
const iso = d => d.toISOString().slice(0, 10);

const dnes = new Date();
const s = iso(dnes), dow = dnes.getDay();
const sv = svatky.find(x => x.datum === s);
const volno = dow === 0 || dow === 6 || !!(sv && sv.volno);
const vylet = events.find(e => (e.typ === 'vylet' || e.typ === 'pobyt') && s >= e.od && s <= (e.do || e.od));

const radky = [];
narozeniny.filter(n => n.datum.slice(5) === s.slice(5))
  .forEach(n => radky.push(`🎂 ${n.jmeno} má dnes narozeniny`));
if (sv) radky.push(`${sv.volno ? '🇨🇿' : '·'} ${sv.nazev}`);
if (vylet) radky.push(`${vylet.ikona || '📍'} ${vylet.nazev} — jste na cestách`);

events.filter(e => e.od === s && e.cas)
  .sort((a, b) => a.cas.localeCompare(b.cas))
  .forEach(e => radky.push(`${e.cas} ${e.ikona || ''} ${e.nazev}${e.misto ? ' · ' + e.misto : ''}`.replace(/\s+/g, ' ')));

if (!volno && !vylet && s >= SR.od && s <= SR.do) {
  const skola = people.filter(p => p.role === 'dite')
    .map(p => `${p.jmeno} do ${rozvrhy[p.id].konec[String(dow)]}`).filter(Boolean);
  if (skola.length) radky.push(`🎒 Škola: ${skola.join(' · ')}`);
  krouzky.filter(k => [k.den, k.denDalsi].includes(dow)
      && (!k.prvniLekce || s >= k.prvniLekce) && (!k.konecKurzu || s <= k.konecKurzu))
    .sort((a, b) => (a.od || '').localeCompare(b.od || ''))
    .forEach(k => radky.push(
      `${k.od}–${k.do} ${k.nazev} — ${k.kdo.map(jmeno).join(', ')}${k.misto ? ' · ' + k.misto : ''}${k.stav === 'kolize' ? ' ⚠️' : ''}`));
}

const upominky = sestavUpominky();
const casti = [];
if (radky.length) {
  casti.push(`*${DNY[dow][0].toUpperCase()}${DNY[dow].slice(1)} ${dnes.getDate()}. ${MES[dnes.getMonth()]}*\n` +
    radky.map(r => `• ${r}`).join('\n'));
}
if (upominky.length) casti.push(`*Upomínky*\n\n${upominky.join('\n\n')}`);
if (casti.length) console.log(casti.join('\n\n'));
