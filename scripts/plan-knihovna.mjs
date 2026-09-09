/* Najde nejlepší termín pro společnou návštěvu knihovny před koncem výpůjčky.
   Priorita: jít tam s dětma a půjčit si nové. Až když to nevyjde, spočítá poslední
   termín pro vhození do biblioboxu, aby se konto odepsalo včas. */
import fs from 'node:fs';
const J = n => JSON.parse(fs.readFileSync(`data/${n}.json`, 'utf8'));
const people = J('people'), krouzky = J('krouzky'), events = J('events'), svatky = J('svatky'),
      rozvrhy = J('rozvrhy'), knihovna = J('knihovna'), oteviraci = J('knihovna-oteviraci');

const MES = ['ledna','února','března','dubna','května','června','července','srpna','září','října','listopadu','prosince'];
const DNY = ['neděle','pondělí','úterý','středa','čtvrtek','pátek','sobota'];
const SR = { od:'2026-09-01', do:'2027-06-30' };
const jmeno = id => (people.find(p => p.id === id) || {}).jmeno || id;
const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const parse = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
const addDays = (d,n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
const min = t => Number(t.slice(0,2)) * 60 + Number(t.slice(3,5));
const hhmm = m => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const datum = s => `${DNY[parse(s).getDay()]} ${parse(s).getDate()}. ${MES[parse(s).getMonth()]}`;

const svatek = s => svatky.find(x => x.datum === s && x.volno);
const pracovni = s => { const d = parse(s).getDay(); return d >= 1 && d <= 5 && !svatek(s); };
const naVylete = s => events.some(e => (e.typ === 'vylet' || e.typ === 'pobyt') && s >= e.od && s <= (e.do || e.od));

/* poslední den, kdy má smysl hodit do biblioboxu */
function boxTermin(deadline) {
  for (let i = 0; i <= 14; i++) {
    const d = iso(addDays(parse(deadline), -i));
    // odepíše se následující pracovní den po vhození
    let n = addDays(parse(d), 1);
    while (!pracovni(iso(n))) n = addDays(n, 1);
    if (iso(n) <= deadline) return d;
  }
  return null;
}

/* volné okno v daný den */
function oknoDne(s, oddeleniPotreba, kdoJde) {
  if (svatek(s) || naVylete(s)) return null;
  const dow = String(parse(s).getDay());

  // průnik otevíracích dob potřebných oddělení
  let od = 0, doo = 24 * 60;
  const zavrene = [];
  for (const o of oddeleniPotreba) {
    const h = oteviraci.oddeleni[o]?.[dow];
    if (!h) { zavrene.push(o); continue; }
    od = Math.max(od, min(h[0]));
    doo = Math.min(doo, min(h[1]));
  }
  if (zavrene.length === oddeleniPotreba.length) return null;

  // odkdy jsou kluci volní
  let volniOd = od;
  const d = parse(s).getDay();
  if (d >= 1 && d <= 5 && !svatek(s) && s >= SR.od && s <= SR.do) {
    for (const id of kdoJde) {
      const konec = rozvrhy[id]?.konec?.[String(d)];
      if (konec) volniOd = Math.max(volniOd, min(konec) + oteviraci.cestaMinut);
    }
  }

  // nejbližší kroužek toho dne = musíme být pryč
  let doKdy = doo;
  let brzda = null;
  for (const k of krouzky) {
    if (![k.den, k.denDalsi].includes(d)) continue;
    if (k.prvniLekce && s < k.prvniLekce) continue;
    if (k.konecKurzu && s > k.konecKurzu) continue;
    if (!k.kdo.some(x => kdoJde.includes(x))) continue;
    const start = min(k.od) - oteviraci.cestaMinut;
    if (start < doKdy) { doKdy = start; brzda = k; }
  }

  const delka = doKdy - volniOd;
  if (delka < oteviraci.potrebaMinut) return { s, nevejde:true, brzda, zavrene, volniOd, doKdy };
  return { s, od: volniOd, do: doKdy, delka, brzda, zavrene };
}

export function naplanuj() {
  const dnes = iso(new Date());
  const out = [];
  for (const v of knihovna) {
    if (v.vraceno) continue;
    const oddeleniPotreba = [...new Set(v.oddeleni.map(o => o.nazev))];
    // do knihovny jede celá parta — čtenáři plus obě děti
    const kdoJde = [...new Set([...v.oddeleni.map(o => o.ctenar),
      ...people.filter(x => x.role === 'dite').map(x => x.id)])];
    const box = boxTermin(v.vratitDo);

    const kandidati = [];
    for (let d = parse(dnes); iso(d) <= v.vratitDo; d = addDays(d, 1)) {
      const o = oknoDne(iso(d), oddeleniPotreba, kdoJde);
      if (o && !o.nevejde) kandidati.push(o);
    }
    // nejlepší = všechna oddělení otevřená, pak nejdelší okno, pak nejdřív
    kandidati.sort((a, b) =>
      a.zavrene.length - b.zavrene.length || b.delka - a.delka || a.s.localeCompare(b.s));

    const denD = oknoDne(v.vratitDo, oddeleniPotreba, kdoJde);
    out.push({ v, box, kandidati, oddeleniPotreba, kdoJde, denD });
  }
  return out;
}

export function textPlanu(p) {
  const { v, box, kandidati } = p;
  const r = [];
  const nej = kandidati[0];
  if (nej) {
    r.push(`✅ *Nejlepší termín: ${datum(nej.s)}, ${hhmm(nej.od)}–${hhmm(nej.do)}*`);
    if (nej.zavrene.length) r.push(`   Zavřeno: ${nej.zavrene.join(', ')} — to doneste jindy.`);
    else r.push(`   Všechna tři oddělení otevřená, stihnete i vybrat nové.`);
    if (nej.brzda) r.push(`   Konec okna kvůli: ${nej.brzda.nazev} v ${nej.brzda.od}.`);
    const dalsi = kandidati.slice(1, 3)
      .map(k => `${datum(k.s)} ${hhmm(k.od)}–${hhmm(k.do)}`).join(' · ');
    if (dalsi) r.push(`   Náhradní: ${dalsi}`);
  } else {
    r.push(`⚠️ *Do termínu se do knihovny nedostanete* — všechny dny padají na zavřeno, školu nebo kroužky.`);
  }
  if (p.denD && !p.denD.nevejde && p.denD.brzda) {
    r.push(`⏱ V den termínu (${datum(v.vratitDo)}) by zbylo jen ${hhmm(p.denD.od)}–${hhmm(p.denD.do)} kvůli: ${p.denD.brzda.nazev} v ${p.denD.brzda.od}. Nespoléhal bych na to.`);
  } else if (p.denD && p.denD.nevejde) {
    r.push(`⏱ V den termínu (${datum(v.vratitDo)}) to nevyjde${p.denD.brzda ? ' — ' + p.denD.brzda.nazev + ' v ' + p.denD.brzda.od : ''}.`);
  }
  if (box) {
    r.push(`📦 *Bibliobox nejpozději ${datum(box)}* — z boxu se konto odepisuje až následující pracovní den.`);
    r.push(`   Pozor: vhozením ${datum(v.vratitDo)} už je pozdě, odepsalo by se to den po termínu.`);
  }
  const stari = Math.round((new Date() - new Date(oteviraci.overenoDne)) / 86400000);
  if (stari > 90) r.push(`   ℹ️ Otevírací doba ověřená před ${stari} dny — mrkni na ${oteviraci._zdroj}.`);
  return r.join('\n');
}

/* strukturovaný plán pro web — generuje se při buildu, aby stránka nemusela nic počítat */
export function planProWeb() {
  return naplanuj().map(p => ({
    id: p.v.id,
    vratitDo: p.v.vratitDo,
    nejlepsi: p.kandidati[0] ? {
      datum: p.kandidati[0].s, popis: datum(p.kandidati[0].s),
      od: hhmm(p.kandidati[0].od), do: hhmm(p.kandidati[0].do),
      vseOtevreno: p.kandidati[0].zavrene.length === 0,
      zavrene: p.kandidati[0].zavrene,
      brzda: p.kandidati[0].brzda ? `${p.kandidati[0].brzda.nazev} v ${p.kandidati[0].brzda.od}` : null,
    } : null,
    nahradni: p.kandidati.slice(1, 3).map(k => ({
      popis: datum(k.s), od: hhmm(k.od), do: hhmm(k.do) })),
    denD: p.denD && !p.denD.nevejde && p.denD.brzda
      ? { popis: datum(p.v.vratitDo), od: hhmm(p.denD.od), do: hhmm(p.denD.do),
          brzda: `${p.denD.brzda.nazev} v ${p.denD.brzda.od}` }
      : null,
    box: p.box ? { datum: p.box, popis: datum(p.box) } : null,
    overenoDne: oteviraci.overenoDne,
    zdroj: oteviraci._zdroj,
  }));
}

if (process.argv[1] && process.argv[1].endsWith('plan-knihovna.mjs')) {
  if (process.argv.includes('--write')) {
    fs.writeFileSync('data/knihovna-plan.json', JSON.stringify(planProWeb(), null, 2) + '\n');
    console.log('data/knihovna-plan.json vygenerován.');
  } else {
    for (const p of naplanuj()) {
      const celkem = p.v.oddeleni.reduce((a, o) => a + o.tituly.length, 0);
      console.log(`Vrátit ${celkem} titulů do ${datum(p.v.vratitDo)}\n`);
      console.log(textPlanu(p));
    }
  }
}
