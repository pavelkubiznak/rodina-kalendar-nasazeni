/* Sestaví datový objekt pro plakát na The Frame (tvar viz frame-auto/render/priklad-data.json).
   node scripts/build-frame-data.mjs [--datum 2026-09-11] > frame-data.json
   Na stdout jde jen JSON — workflow ho přesměrovává rovnou do souboru. */
import fs from 'node:fs';
import { planProWeb } from './plan-knihovna.mjs';

const J = n => JSON.parse(fs.readFileSync(`data/${n}.json`, 'utf8'));
const people = J('people'), krouzky = J('krouzky'), events = J('events'), svatky = J('svatky'),
      narozeniny = J('narozeniny'), ukoly = J('ukoly'), doklady = J('doklady'),
      rozvrhy = J('rozvrhy'), knihovna = J('knihovna'), oteviraci = J('knihovna-oteviraci');

const DNY = ['Neděle','Pondělí','Úterý','Středa','Čtvrtek','Pátek','Sobota'];
const V_DEN = ['v neděli','v pondělí','v úterý','ve středu','ve čtvrtek','v pátek','v sobotu'];
const MES = ['ledna','února','března','dubna','května','června','července','srpna','září','října','listopadu','prosince'];
const SR = { od:'2026-09-01', do:'2027-06-30' };
const OKNO_BLIZI = 30;      // kolik dní dopředu hledat „Blíží se"
const ZITREK_OD = 18;       // od této hodiny se renderuje plakát na zítřek (večerní běh v CI)

// datumy jsou řetězce YYYY-MM-DD počítané v UTC — výsledek nezávisí na časové zóně stroje
const parse = s => new Date(s + 'T00:00:00Z');
const plus = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = s => parse(s).getUTCDay();
const dnuMezi = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
const kratce = s => `${parse(s).getUTCDate()}. ${parse(s).getUTCMonth() + 1}.`;
const malym = t => t[0].toLowerCase() + t.slice(1);
const podle = (a, b) => (a > b) - (a < b);   // ne localeCompare — ta řadí '~' před číslice

function tydenISO(s) {
  const d = parse(s);
  d.setUTCDate(d.getUTCDate() + 3 - (d.getUTCDay() + 6) % 7);   // čtvrtek téhož týdne
  const leden4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - leden4) / 86400000 - 3 + (leden4.getUTCDay() + 6) % 7) / 7);
}

// GitHub Actions běží v UTC; datum i razítko chceme pražské
function tedVPraze() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return { datum: `${p.year}-${p.month}-${p.day}`, hodina: Number(p.hour), cas: `${Number(p.hour)}:${p.minute}` };
}

const deti = people.filter(p => p.role === 'dite');
const stitek = kdo => {
  const d = deti.filter(p => kdo.includes(p.id));
  if (!d.length) return undefined;
  return d.length > 1 && d.length === deti.length ? 'OBA' : d.map(p => p.jmeno.toUpperCase()).join(' + ');
};

const svatek = s => svatky.find(x => x.datum === s && x.volno);
const naCestach = s => events.find(e => (e.typ === 'vylet' || e.typ === 'pobyt') && s >= e.od && s <= (e.do || e.od));
const pracovni = s => dow(s) >= 1 && dow(s) <= 5 && !svatek(s);
const skolniDen = s => s >= SR.od && s <= SR.do && pracovni(s) && !naCestach(s);
const pristiPracovni = s => { let d = plus(s, 1); while (!pracovni(d)) d = plus(d, 1); return d; };
const krouzkyDne = s => !skolniDen(s) ? [] : krouzky
  .filter(k => [k.den, k.denDalsi].includes(dow(s))
    && (!k.prvniLekce || s >= k.prvniLekce) && (!k.konecKurzu || s <= k.konecKurzu))
  .sort((a, b) => podle(a.od, b.od));
const narozeninyDne = s => narozeniny.filter(n => n.datum.slice(5) === s.slice(5));
const ukolyDne = s => ukoly.filter(u => !u.hotovo && u.doKdy === s);
const dokladyDne = s => doklady.filter(d => d.platnostDo === s);
const letyDne = s => events.filter(e => e.typ === 'let' && e.od === s && e.cas);

// splatnosti seskupené stejně jako v ICS; kroužky v kolizi se zatím neplatí, do částky nejdou
const platby = (() => {
  const m = new Map();
  for (const k of krouzky) {
    if (!k.platba?.splatnost || k.platba.zaplaceno) continue;
    const key = `${k.platba.splatnost}|${k.platba.kde}`;
    if (!m.has(key)) m.set(key, []);
    m.get(key).push(k);
  }
  return [...m.values()].map(ks => {
    const platit = ks.filter(k => k.stav !== 'kolize');
    const odlozeno = ks.length - platit.length;
    const suma = platit.reduce((a, k) => a + (k.platba.castka || 0), 0);
    return {
      datum: ks[0].platba.splatnost, suma,
      text: ks.length === 1
        ? `Zaplatit ${malym(ks[0].nazev)} — ${suma.toLocaleString('cs-CZ')} Kč`
        : `Platba ${ks[0].poskytovatel} — ${suma.toLocaleString('cs-CZ')} Kč`,
      pozn: odlozeno ? `bez ${odlozeno} ${odlozeno === 1 ? 'kroužku' : 'kroužků'} v kolizi` : undefined,
    };
  }).filter(p => p.suma > 0);
})();

const vypujcky = knihovna.filter(v => !v.vraceno).map(v => ({
  v, celkem: v.oddeleni.reduce((a, o) => a + o.tituly.length, 0),
}));
// plán knihovny se počítá k datu plakátu (večer je to zítřek), nastavuje ho frameData()
let plany = [];
const planPro = v => plany.find(p => p.id === v.id);

/* levý sloupec — dnešek hodinu po hodině */
function dnes(s) {
  const bloky = [];   // klíč řazení: '' = celodenní nahoře, 'HH:MM' = podle času, '~' = termíny dole
  const pridej = (klic, ...radky) => bloky.push({ klic, radky });

  for (const n of narozeninyDne(s)) pridej('', { text: `${n.jmeno} má narozeniny`, hi: true });
  const sv = svatky.find(x => x.datum === s);
  if (sv) pridej('', { text: sv.nazev });

  const cesta = naCestach(s);
  if (cesta) pridej('', { text: cesta.nazev, pozn: cesta.od === s ? 'dnes odjezd'
    : cesta.do === s ? 'poslední den' : `${dnuMezi(cesta.od, s) + 1}. den z ${dnuMezi(cesta.od, cesta.do || cesta.od) + 1}` });
  for (const e of events.filter(e => e.od === s && e.typ !== 'vylet' && e.typ !== 'pobyt')) {
    if (e.cas) pridej(e.cas, { cas: e.casDo ? `${e.cas}—${e.casDo}` : e.cas, text: e.nazev, pozn: e.misto, hi: true });
    else pridej(e.typ === 'ubytovani' ? '24:00' : '', { text: e.nazev, pozn: e.misto });   // ubytování až za cestou
  }

  if (skolniDen(s)) {
    const konce = deti.map(p => ({ p, konec: rozvrhy[p.id]?.konec?.[String(dow(s))] }))
      .filter(x => x.konec).sort((a, b) => podle(a.konec, b.konec));
    if (konce.length) {
      const [prvni, ...dalsi] = konce;
      pridej(prvni.konec, dalsi.every(x => x.konec === prvni.konec)
        ? { cas: prvni.konec, kdo: stitek(konce.map(x => x.p.id)), text: 'konec vyučování' }
        : { cas: prvni.konec, kdo: stitek([prvni.p.id]), text: 'konec vyučování',
            pozn: dalsi.map(x => `${x.p.jmeno} až ${x.konec}`).join(', ') });
    }
    for (const k of krouzkyDne(s)) pridej(k.od, { cas: `${k.od}—${k.do}`, kdo: stitek(k.kdo), text: k.nazev,
      pozn: k.stav === 'kolize' ? 'kolize — zatím nerozhodnuto' : undefined });
  }

  for (const { v, celkem } of vypujcky) {
    const plan = planPro(v), nej = plan?.nejlepsi;
    if (nej?.datum === s) pridej(nej.od,
      { cas: `${nej.od}—${nej.do}`, text: `Knihovna — vrátit ${celkem} titulů`, pozn: oteviraci.adresa.split(',')[0], hi: true },
      nej.vseOtevreno
        ? { text: 'Vybrat nové knížky a CD', pozn: 'kvůli tomu se tam jede, ne kvůli vracení' }
        : { text: `Zavřeno: ${nej.zavrene.join(', ')}`, pozn: 'to doneste jindy' });
    if (plan?.box?.datum === s) pridej('~', { text: 'Bibliobox — poslední možnost',
      pozn: `z boxu se konto odepíše až ${V_DEN[dow(pristiPracovni(s))]}`, hi: true });
    if (v.vratitDo === s) pridej('~', { text: `Knihovna — dnes poslední den (${celkem} titulů)`, hi: true });
  }

  for (const u of ukolyDne(s)) pridej('~', { text: u.nazev, pozn: 'termín dnes', hi: true });
  for (const p of platby.filter(p => p.datum === s)) pridej('~', { text: p.text, pozn: p.pozn ?? 'splatnost dnes', hi: true });
  for (const d of dokladyDne(s)) pridej('~', { text: `Končí platnost: ${d.nazev}`, hi: true });

  const radky = bloky.sort((a, b) => podle(a.klic, b.klic)).flatMap(b => b.radky).map(r => ({ cas: '', ...r }));
  return radky.length ? radky : [{ cas: '', text: 'nic naplánovaného' }];
}

/* jeden řádek v pravém sloupci */
function souhrnDne(s) {
  const casti = [], pozn = [];
  let warn = false;

  for (const n of narozeninyDne(s)) { casti.push(`${n.jmeno} má narozeniny`); warn = true; }
  const sv = svatek(s);
  if (sv) casti.push(sv.nazev);
  const cesta = naCestach(s);
  if (cesta?.od === s) { casti.push(`Odjezd: ${cesta.nazev}`); warn = true; }
  else if (cesta) { casti.push(cesta.nazev); pozn.push('na cestách'); }
  for (const e of letyDne(s)) casti.push(`${e.cas} ${e.nazev}`);

  for (const k of krouzkyDne(s)) {
    casti.push(`${k.od} ${k.nazev}`);
    if (k.stav === 'kolize') pozn.push(`kolize: ${k.nazev}`);
  }

  for (const { v, celkem } of vypujcky) {
    const plan = planPro(v);
    if (plan?.nejlepsi?.datum === s) { casti.push(`${plan.nejlepsi.od} Knihovna — vrátit ${celkem} titulů`); warn = true; }
    if (plan?.box?.datum === s) {
      casti.push('Bibliobox — poslední možnost');
      pozn.push(`z boxu se konto odepíše až ${V_DEN[dow(pristiPracovni(s))]}`);
      warn = true;
    }
    if (v.vratitDo === s) { casti.push('Knihovna — poslední den vrácení'); warn = true; }
  }
  for (const u of ukolyDne(s)) { casti.push(`Termín: ${malym(u.nazev)}`); warn = true; }
  for (const p of platby.filter(p => p.datum === s)) { casti.push(p.text); warn = true; }
  for (const d of dokladyDne(s)) { casti.push(`Končí platnost: ${d.nazev}`); warn = true; }

  return {
    den: DNY[dow(s)],
    text: casti.length ? casti.join(' · ') : skolniDen(s) ? 'jen škola' : 'volno',
    pozn: pozn.join(' · ') || undefined,
    warn: warn || undefined,
    prazdny: !casti.length,
  };
}

/* pravý sloupec — pátek ukazuje víkend, čtvrtek zbytek týdne, jinak další tři dny
   (víc řádků se pod „Blíží se" na výšku nevejde) */
function dalsiDny(s) {
  const d = dow(s);
  const nadpis = d === 5 ? 'Víkend' : d === 4 ? 'Zbytek týdne' : 'Další dny';
  const dny = (d === 5 ? [1, 2] : [1, 2, 3]).map(i => plus(s, i));

  let radky = dny.map(den => ({ datum: den, ...souhrnDne(den) }));
  if (d !== 5) {   // prázdný víkend stačí jedním řádkem
    const so = radky.find(r => dow(r.datum) === 6), ne = radky.find(r => dow(r.datum) === 0);
    if (so?.prazdny && ne?.prazdny)
      radky = [...radky.filter(r => r !== so && r !== ne), { den: 'Víkend', text: 'volno' }];
  }
  return { nadpis, radky: radky.map(({ datum, prazdny, ...r }) => r), posledni: dny.at(-1) };
}

/* „Blíží se" — nejdřív co propadlo a není odškrtnuté, pak všechno s termínem po posledním dni pravého sloupce */
function blizi(s, po, doDne) {
  const out = [];
  const v = (datum, text, pozn) => { if (datum > po && datum <= doDne) out.push({ datum, text, pozn }); };

  // propadlé mají starší datum, takže se po seřazení samy dostanou nahoru
  ukoly.filter(u => !u.hotovo && u.doKdy < s).forEach(u => out.push({ datum: u.doKdy, text: u.nazev, pozn: 'po termínu' }));
  platby.filter(p => p.datum < s).forEach(p => out.push({ datum: p.datum, text: p.text, pozn: 'po splatnosti' }));

  platby.forEach(p => v(p.datum, p.text, p.pozn));
  ukoly.filter(u => !u.hotovo).forEach(u => v(u.doKdy, u.nazev));
  vypujcky.forEach(({ v: x, celkem }) => v(x.vratitDo, 'Vrátit knihy do knihovny', `${celkem} titulů`));
  events.filter(e => !['let', 'ubytovani', 'vylet'].includes(e.typ)).forEach(e => v(e.od, e.nazev, e.misto));
  const rok = Number(po.slice(0, 4));
  narozeniny.forEach(n => [rok, rok + 1].forEach(r => v(`${r}-${n.datum.slice(5)}`, `${n.jmeno} má narozeniny`)));
  // doklady se hlásí s delším předstihem, podle svých upomínek
  doklady.forEach(d => {
    if (d.platnostDo > po && dnuMezi(po, d.platnostDo) <= Math.max(...(d.upominky || [90])))
      out.push({ datum: d.platnostDo, text: `Končí platnost: ${d.nazev}`,
        pozn: d.presne === false ? 'datum ověřit v dokladu' : undefined });
  });

  return out.sort((a, b) => podle(a.datum, b.datum))
    .map(p => ({ datum: kratce(p.datum), text: p.text, pozn: p.pozn }));
}

/* odpočet do velkých cest; u každé i nevyřešené úkoly, které se týkají cílové destinace */
function cesty(s) {
  return events.filter(e => e.typ === 'vylet' && e.od > s)
    .sort((a, b) => podle(a.od, b.od))
    .map(c => {
      const dni = dnuMezi(s, c.od);
      const lety = letyDne(c.od);
      const cile = [c.nazev, ...lety.map(e => e.nazev.split('→').at(-1).trim())];
      const nevyreseno = ukoly.filter(u => !u.hotovo && u.doKdy <= c.od && cile.some(m => u.nazev.includes(m)));
      return {
        dni: String(dni), kam: c.nazev,
        pozn: [`${dni === 1 ? 'den' : dni <= 4 ? 'dny' : 'dní'} do ${lety.length ? 'odletu' : 'odjezdu'}`,
          kratce(c.od), ...nevyreseno.map(u => `nevyřešeno: ${malym(u.nazev)}`)].join(' · '),
      };
    });
}

export function frameData(datum) {
  const ted = tedVPraze();
  const s = datum ?? (ted.hodina >= ZITREK_OD ? plus(ted.datum, 1) : ted.datum);
  plany = planProWeb(s);
  const pravy = dalsiDny(s);
  return {
    datumIso: s,   // šablona nepoužívá; uploader podle něj pozná, že nestahuje včerejší plakát
    razitko: `aktualizováno ${kratce(ted.datum)} v ${ted.cas}`,
    den: DNY[dow(s)],
    datum: `${parse(s).getUTCDate()}. ${MES[parse(s).getUTCMonth()]} ${s.slice(0, 4)} · týden ${tydenISO(s)}`,
    dnes: dnes(s),
    cesty: cesty(s).slice(0, 2),
    nadpisVpravo: pravy.nadpis,
    dalsiDny: pravy.radky,
    blizi: blizi(s, pravy.posledni, plus(s, OKNO_BLIZI)).slice(0, 4),
  };
}

if (process.argv[1]?.endsWith('build-frame-data.mjs')) {
  const i = process.argv.indexOf('--datum');
  console.log(JSON.stringify(frameData(i > 0 ? process.argv[i + 1] : undefined), null, 2));
}
