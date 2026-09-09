/* Spočítá, které upomínky mají padnout DNES, a vypíše je.
   Když není co hlásit, nevypíše nic (workflow pak nic neposílá). */
import fs from 'node:fs';
import { naplanuj, textPlanu } from './plan-knihovna.mjs';
const J = n => JSON.parse(fs.readFileSync(`data/${n}.json`, 'utf8'));
const people = J('people'), krouzky = J('krouzky'), events = J('events'),
      ukoly = J('ukoly'), doklady = J('doklady'), narozeniny = J('narozeniny'), knihovna = J('knihovna');

const MES = ['ledna','února','března','dubna','května','června','července','srpna','září','října','listopadu','prosince'];
const jmeno = id => (people.find(p => p.id === id) || {}).jmeno || id;
const dnes = new Date(); dnes.setHours(0,0,0,0);
const dnu = s => Math.round((new Date(s + 'T00:00:00') - dnes) / 86400000);
const datum = s => { const d = new Date(s + 'T00:00:00'); return `${d.getDate()}. ${MES[d.getMonth()]} ${d.getFullYear()}`; };
const zbyva = n => n === 0 ? 'DNES' : n === 1 ? 'zítra' :
  n < 14 ? `za ${n} dní` : n < 60 ? `za ${Math.round(n/7)} týdny` : `za ${Math.round(n/30.4)} měsíce`;

export function sestavUpominky() {
const out = [];
const pridej = (ikona, nadpis, kdy, detail) =>
  out.push(`${ikona} *${nadpis}*\n   ${zbyva(dnu(kdy))} — ${datum(kdy)}${detail ? '\n   ' + detail : ''}`);

// upomínka padne, když je počet dní do termínu přesně jedna z hodnot v `upominky`
const sedi = (kdy, lead) => (lead || []).includes(dnu(kdy)) || dnu(kdy) === 0;

for (const e of events) {
  if (!sedi(e.od, e.upominky)) continue;
  pridej(e.ikona || '📌', e.nazev, e.od,
    [e.cas, e.misto].filter(Boolean).join(' · '));
}
for (const u of ukoly) {
  if (u.hotovo || !sedi(u.doKdy, u.upominky)) continue;
  pridej(u.ikona || '✅', u.nazev, u.doKdy, u.popis);
}
for (const d of doklady) {
  if (!sedi(d.platnostDo, d.upominky)) continue;
  pridej(d.ikona || '📄', `Končí platnost: ${d.nazev}`, d.platnostDo,
    `${d.kdo.map(jmeno).join(', ')}${d.presne === false ? ' · datum ověřit v dokladu' : ''}`);
}
const platby = new Map();
for (const k of krouzky) {
  if (!k.platba?.splatnost || k.platba.zaplaceno) continue;
  if (!sedi(k.platba.splatnost, k.platba.upominky || [21, 7, 3, 1])) continue;
  const key = `${k.platba.splatnost}|${k.platba.kde}`;
  if (!platby.has(key)) platby.set(key, []);
  platby.get(key).push(k);
}
for (const [key, ks] of platby) {
  const [kdy, kde] = key.split('|');
  const suma = ks.reduce((a, k) => a + (k.platba.castka || 0), 0);
  pridej('💳', `Zaplatit ${suma.toLocaleString('cs-CZ')} Kč — ${kde}`, kdy,
    ks.map(k => k.nazev).join(', '));
}
for (const n of narozeniny) {
  const letos = `${dnes.getFullYear()}-${n.datum.slice(5)}`;
  const kdy = dnu(letos) < 0 ? `${dnes.getFullYear() + 1}-${n.datum.slice(5)}` : letos;
  if (!sedi(kdy, [14, 7, 1])) continue;
  pridej('🎂', `${n.jmeno} má narozeniny`, kdy, 'Nezapomenout na dárek.');
}

for (const v of knihovna) {
  if (v.vraceno || !sedi(v.vratitDo, v.upominky)) continue;
  const celkem = v.oddeleni.reduce((a, o) => a + o.tituly.length, 0);
  const seznam = v.oddeleni.map(o => {
    const hlavicka = `   _${o.nazev} — ${jmeno(o.ctenar)}_`;
    const knihy = o.tituly.map(t => `   • ${t.autor ? t.autor + ': ' : ''}${t.nazev}`).join('\n');
    return `${hlavicka}\n${knihy}`;
  }).join('\n');
  const plan = naplanuj().find(p => p.v.id === v.id);
  const planText = plan ? '\n\n' + textPlanu(plan) : '';
  out.push(`📚 *Vrátit do knihovny — ${celkem} titulů*\n   ${zbyva(dnu(v.vratitDo))} — ${datum(v.vratitDo)}\n${seznam}${planText}`);
}

return out;
}

if (process.argv[1] && process.argv[1].endsWith('upominky.mjs')) {
  const u = sestavUpominky();
  if (u.length) console.log(`*Rodinný kalendář — upomínky*\n\n${u.join('\n\n')}`);
}
