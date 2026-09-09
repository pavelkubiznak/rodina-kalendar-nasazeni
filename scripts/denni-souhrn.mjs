/* Textový souhrn na dnešek + zítřek + blížící se termíny. Používá ho denní workflow. */
import fs from 'node:fs';
const J = n => JSON.parse(fs.readFileSync(`data/${n}.json`, 'utf8'));
const people = J('people'), krouzky = J('krouzky'), events = J('events'),
      svatky = J('svatky'), narozeniny = J('narozeniny'), ukoly = J('ukoly'), rozvrhy = J('rozvrhy'), doklady = J('doklady');
const DNY = ['neděle','pondělí','úterý','středa','čtvrtek','pátek','sobota'];
const MES = ['ledna','února','března','dubna','května','června','července','srpna','září','října','listopadu','prosince'];
const jmeno = id => (people.find(p => p.id === id) || {}).jmeno || id;
const iso = d => d.toISOString().slice(0, 10);
const SR = { od: '2026-09-01', do: '2027-06-30' };

const dnes = new Date(); const zitra = new Date(Date.now() + 86400000);
const volno = s => { const d = new Date(s).getDay(); return d === 0 || d === 6 || svatky.some(x => x.datum === s && x.volno); };

function proDen(s) {
  const dow = new Date(s).getDay(); const r = [];
  narozeniny.filter(n => n.datum.slice(5) === s.slice(5)).forEach(n => r.push(`🎂 ${n.jmeno} má narozeniny`));
  svatky.filter(x => x.datum === s && x.volno).forEach(x => r.push(`🇨🇿 ${x.nazev}`));
  events.filter(e => s >= e.od && s <= (e.do || e.od)).forEach(e => r.push(`${e.ikona || '📍'} ${e.nazev}`));
  const vylet = events.some(e => (e.typ === 'vylet' || e.typ === 'pobyt') && s >= e.od && s <= (e.do || e.od));
  if (s >= SR.od && s <= SR.do && !volno(s) && !vylet) {
    for (const p of people.filter(x => x.role === 'dite')) {
      const konec = rozvrhy[p.id]?.konec?.[dow];
      if (konec) r.push(`🎒 ${p.jmeno} končí ve škole ${konec}`);
    }
    krouzky.filter(k => [k.den, k.denDalsi].includes(dow)
        && (!k.prvniLekce || s >= k.prvniLekce) && (!k.konecKurzu || s <= k.konecKurzu))
      .sort((a, b) => (a.od || '').localeCompare(b.od || ''))
      .forEach(k => r.push(`${k.od || '  ?  '}–${k.do || '?'} ${k.nazev} (${k.kdo.map(jmeno).join(', ')})${k.stav === 'kolize' ? ' ⚠️ KOLIZE' : ''}`));
  }
  return r;
}
const nadpis = d => `${DNY[d.getDay()]} ${d.getDate()}. ${MES[d.getMonth()]}`;
const blok = (t, r) => `${t}\n${r.length ? r.map(x => '  • ' + x).join('\n') : '  (nic naplánovaného)'}`;

const radky = [blok(`DNES — ${nadpis(dnes)}`, proDen(iso(dnes))), '', blok(`ZÍTRA — ${nadpis(zitra)}`, proDen(iso(zitra)))];

const terminy = krouzky.filter(k => k.platba?.splatnost && !k.platba.zaplaceno)
  .map(k => ({ k, dnu: Math.round((new Date(k.platba.splatnost) - dnes) / 86400000) }))
  .filter(x => x.dnu >= 0 && x.dnu <= 30);
if (terminy.length) {
  const uniq = [...new Set(terminy.map(x => `${x.dnu} dní: ${x.k.platba.kde} (${x.k.platba.splatnost})`))];
  radky.push('', 'PLATBY DO 30 DNŮ', ...uniq.map(x => '  • ' + x));
}
const otevrene = ukoly.filter(u => !u.hotovo)
  .map(u => ({ u, dnu: Math.round((new Date(u.doKdy) - dnes) / 86400000) }))
  .filter(x => x.dnu <= 30).sort((a, b) => a.dnu - b.dnu);
if (otevrene.length) {
  radky.push('', 'VYŽADUJE ROZHODNUTÍ',
    ...otevrene.map(x => `  • ${x.u.nazev} — ${x.dnu < 0 ? 'po termínu!' : 'zbývá ' + x.dnu + ' dní'}`));
}

const dok = doklady.map(d => ({ d, dnu: Math.round((new Date(d.platnostDo) - dnes) / 86400000) }))
  .filter(x => x.dnu <= Math.max(...(x.d.upominky || [90])) ).sort((a, b) => a.dnu - b.dnu);
if (dok.length) {
  radky.push('', 'PLATNOST DOKLADŮ',
    ...dok.map(x => `  • ${x.d.nazev} — ${x.dnu < 0 ? 'PROPADLO' : 'zbývá ' + Math.round(x.dnu / 30.4) + ' měsíců'}`));
}

console.log(radky.join('\n'));
