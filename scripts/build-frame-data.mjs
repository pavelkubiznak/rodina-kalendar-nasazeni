/* Sestaví datový objekt pro plakát na The Frame (tvar viz frame-auto/render/priklad-data.json).
   node scripts/build-frame-data.mjs [--datum 2026-09-11 | --posun 1] > frame-data.json
   Na stdout jde jen JSON — workflow ho přesměrovává rovnou do souboru. */
import fs from 'node:fs';
import { planProWeb } from './plan-knihovna.mjs';
import { vsechnyEvents, tydenSedi, otevrenePlatby, kcText } from './udalosti.mjs';

const J = n => JSON.parse(fs.readFileSync(`data/${n}.json`, 'utf8'));
const people = J('people'), krouzky = J('krouzky'), events = vsechnyEvents(), svatky = J('svatky'),
      narozeniny = J('narozeniny'), ukoly = J('ukoly'), doklady = J('doklady'),
      rozvrhy = J('rozvrhy'), knihovna = J('knihovna'), oteviraci = J('knihovna-oteviraci'),
      hlasky = J('hlasky');

const DNY = ['Neděle','Pondělí','Úterý','Středa','Čtvrtek','Pátek','Sobota'];
const V_DEN = ['v neděli','v pondělí','v úterý','ve středu','ve čtvrtek','v pátek','v sobotu'];
const MES = ['ledna','února','března','dubna','května','června','července','srpna','září','října','listopadu','prosince'];
const SR = { od:'2026-09-01', do:'2027-06-30' };
const OKNO_BLIZI = 30;      // kolik dní dopředu hledat „Blíží se"
// víc informací (výchozí od 15. 9.): předměty dne pod koncem vyučování, šest dalších dní, víc položek „Blíží se"
let VIC = true;   // --strucne vrátí původní, kratší rozsah

// datumy jsou řetězce YYYY-MM-DD počítané v UTC — výsledek nezávisí na časové zóně stroje
const parse = s => new Date(s + 'T00:00:00Z');
const plus = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = s => parse(s).getUTCDay();
const dnuMezi = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
const kratce = s => `${parse(s).getUTCDate()}. ${parse(s).getUTCMonth() + 1}.`;
const malym = t => t[0].toLowerCase() + t.slice(1);
const podle = (a, b) => (a > b) - (a < b);   // ne localeCompare — ta řadí '~' před číslice
// kroužek, o kterém se ještě rozhoduje (kolize v rozvrhu, nebo dítě nechce chodit) — neplatí se, na plakátu s poznámkou
const nerozhodnuto = k => k.stav === 'kolize' || k.stav === 'nejiste';

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
  .filter(k => [k.den, k.denDalsi].includes(dow(s)) && tydenSedi(k, s)
    && (!k.prvniLekce || s >= k.prvniLekce) && (!k.konecKurzu || s <= k.konecKurzu))
  .sort((a, b) => podle(a.od, b.od));
const narozeninyDne = s => narozeniny.filter(n => n.datum.slice(5) === s.slice(5));
const ukolyDne = s => ukoly.filter(u => !u.hotovo && u.doKdy === s);
const dokladyDne = s => doklady.filter(d => d.platnostDo === s);
const letyDne = s => events.filter(e => e.typ === 'let' && e.od === s && e.cas);

/* Jednorázové akce — z events.json i ručně zapsané v Google Kalendáři. Cesty, lety a ubytování mají vlastní řádky. */
const jeAkce = e => !['let', 'ubytovani', 'vylet', 'pobyt'].includes(e.typ);
const bezDiakritiky = t => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
// „Doučování čeština" opakované v Google Kalendáři je tentýž kroužek, který už je v krouzky.json — stačí jednou.
// Porovnává se s rozvrhem kroužku, ne s tím, jestli se ten den koná: o prázdninách nemá zůstat viset ani kopie z Googlu.
const jeKopieKrouzku = e => !!e.cas && krouzky.some(k => [k.den, k.denDalsi].includes(dow(e.od)) && k.od === e.cas
  && (bezDiakritiky(e.nazev).startsWith(bezDiakritiky(k.nazev)) || bezDiakritiky(k.nazev).startsWith(bezDiakritiky(e.nazev))));
const akceDne = s => events.filter(e => e.od === s && jeAkce(e) && !jeKopieKrouzku(e));
/* Kdo diktuje „9.10. volby, zkrácená výuka", má datum i v názvu. Na plakátu stojí den hned vedle, takže se z názvu
   sundá — ale jen když je to opravdu datum té události. */
function nazevBezData(e) {
  const m = e.nazev.match(/^\s*(\d{1,2})\.\s*(?:(\d{1,2})\.(?:\s*\d{4})?|(ledna|února|března|dubna|května|června|července|srpna|září|října|listopadu|prosince))[\s,:–—-]*/i);
  if (!m || Number(m[1]) !== parse(e.od).getUTCDate()) return e.nazev;
  const mesic = m[2] ? Number(m[2]) - 1 : MES.indexOf(m[3].toLowerCase());
  if (mesic !== parse(e.od).getUTCMonth()) return e.nazev;
  return e.nazev.slice(m[0].length).replace(/^(?:v|ve)\s+(?=\d)/i, '') || e.nazev;
}
const maCasVNazvu = t => /\b\d{1,2}[:.]\d{2}\b|\b\d{1,2}\s*(?:hodin|hod|h)\b/i.test(t);
// text akce do jednoho řádku: čas z kalendáře jen tehdy, když ho neříká už název („12:30 až 12:45 podpis…")
const popisAkce = e => { const t = nazevBezData(e); return e.cas && !maCasVNazvu(t) ? `${e.cas} ${t}` : t; };

// splatnosti — každý kroužek na vlastním řádku (stejný text jako ve feedu);
// kroužky v kolizi a nerozhodnuté se zatím neplatí, na plakát nejdou
const platby = otevrenePlatby(krouzky).filter(p => !p.neplatit)
  .map(p => ({ datum: p.datum, suma: p.castka, text: p.text }));

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
  for (const e of events.filter(e => e.od === s && e.typ !== 'vylet' && e.typ !== 'pobyt' && !jeKopieKrouzku(e))) {
    const text = nazevBezData(e);
    if (e.cas) pridej(e.cas, { cas: e.casDo ? `${e.cas}—${e.casDo}` : e.cas, text, pozn: e.misto, hi: true });
    else pridej(e.typ === 'ubytovani' ? '24:00' : '', { text, pozn: e.misto });   // ubytování až za cestou
  }

  if (skolniDen(s)) {
    // každé dítě má svůj řádek, i když končí ve stejnou dobu (Pavel: „zvlášť")
    for (const p of deti) {
      const konec = rozvrhy[p.id]?.konec?.[String(dow(s))];
      if (!konec) continue;
      const hodiny = (rozvrhy[p.id]?.dny?.[String(dow(s))] || []).map(h => h[1]);
      pridej(konec, { cas: konec, kdo: stitek([p.id]), text: 'konec vyučování',
        pozn: VIC && hodiny.length ? hodiny.join(' · ') : undefined });
    }
    for (const k of krouzkyDne(s)) pridej(k.od, { cas: `${k.od}—${k.do}`, kdo: stitek(k.kdo), text: k.nazev,
      pozn: k.stav === 'kolize' ? 'kolize — zatím nerozhodnuto' : k.stav === 'nejiste' ? 'zatím nerozhodnuto' : undefined });
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
  // lety, kroužky a ruční akce z kalendáře dohromady podle času; celodenní akce před nimi
  const body = [];
  for (const e of letyDne(s)) body.push({ klic: e.cas, text: `${e.cas} ${e.nazev}` });
  for (const k of krouzkyDne(s)) {
    body.push({ klic: k.od, text: `${k.od} ${k.nazev}` });
    if (k.stav === 'kolize') pozn.push(`kolize: ${k.nazev}`);
    else if (k.stav === 'nejiste') pozn.push(`${k.nazev}: zatím nerozhodnuto`);
  }
  for (const e of akceDne(s)) {
    body.push({ klic: e.cas || '', text: popisAkce(e) });
    if (e.cas) warn = true;   // jednorázová věc s časem vybočuje z týdenní rutiny — stejně jako vlevo se zvýrazní
  }

  for (const { v, celkem } of vypujcky) {
    const plan = planPro(v);
    if (plan?.nejlepsi?.datum === s) {
      body.push({ klic: plan.nejlepsi.od, text: `${plan.nejlepsi.od} Knihovna — vrátit ${celkem} titulů` }); warn = true;
    }
    if (plan?.box?.datum === s) {
      body.push({ klic: '~', text: 'Bibliobox — poslední možnost' });   // '~' = termíny až za vším, co má čas
      pozn.push(`z boxu se konto odepíše až ${V_DEN[dow(pristiPracovni(s))]}`);
      warn = true;
    }
    if (v.vratitDo === s) { body.push({ klic: '~', text: 'Knihovna — poslední den vrácení' }); warn = true; }
  }
  casti.push(...body.sort((a, b) => podle(a.klic, b.klic)).map(b => b.text));
  for (const u of ukolyDne(s)) { casti.push(`Termín: ${malym(u.nazev)}`); warn = true; }
  // v jednořádkovém přehledu dne by se víc plateb nevešlo — tam jedním součtem
  const plDne = platby.filter(p => p.datum === s);
  if (plDne.length === 1) casti.push(plDne[0].text);
  else if (plDne.length) casti.push(`Platby kroužků (${plDne.length}) — ${kcText(plDne.reduce((a, p) => a + p.suma, 0))}`);
  if (plDne.length) warn = true;
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
  const nadpis = VIC ? 'Další dny' : d === 5 ? 'Víkend' : d === 4 ? 'Zbytek týdne' : 'Další dny';
  const dny = (VIC ? [1, 2, 3, 4, 5, 6] : d === 5 ? [1, 2] : [1, 2, 3]).map(i => plus(s, i));

  let radky = dny.map(den => ({ datum: den, ...souhrnDne(den) }));
  if (d !== 5) {   // prázdný víkend stačí jedním řádkem
    const so = radky.find(r => dow(r.datum) === 6), ne = radky.find(r => dow(r.datum) === 0);
    if (so?.prazdny && ne?.prazdny)   // řádek „Víkend" zůstává na místě soboty, ne na konci
      radky = radky.flatMap(r => r === so ? [{ den: 'Víkend', text: 'volno' }] : r === ne ? [] : [r]);
  }
  return { nadpis, radky: radky.map(({ datum, prazdny, ...r }) => r), posledni: dny.at(-1) };
}

/* „Blíží se" — napřed to, co teprve přijde (po posledním dni pravého sloupce), a až pod tím,
   co propadlo a nikdo to neodškrtl. Dřív stálo propadlé nahoře a v říjnu sekci vedlo září.
   Propadlé ale nesmí vypadnout úplně: z `mist` řádků si drží až dva, i když je před námi plno. */
function blizi(s, po, doDne, mist) {
  const ceka = [];
  const v = (datum, text, pozn, cas = '') => { if (datum > po && datum <= doDne) ceka.push({ datum, cas, text, pozn }); };

  platby.forEach(p => v(p.datum, p.text, p.pozn));
  ukoly.filter(u => !u.hotovo).forEach(u => v(u.doKdy, u.nazev));
  vypujcky.forEach(({ v: x, celkem }) => v(x.vratitDo, 'Vrátit knihy do knihovny', `${celkem} titulů`));
  events.filter(e => jeAkce(e) && !jeKopieKrouzku(e)).forEach(e => v(e.od, nazevBezData(e), e.misto, e.cas));
  const rok = Number(po.slice(0, 4));
  narozeniny.forEach(n => [rok, rok + 1].forEach(r => v(`${r}-${n.datum.slice(5)}`, `${n.jmeno} má narozeniny`)));
  // doklady se hlásí s delším předstihem, podle svých upomínek
  doklady.forEach(d => {
    if (d.platnostDo > po && dnuMezi(po, d.platnostDo) <= Math.max(...(d.upominky || [90])))
      ceka.push({ datum: d.platnostDo, cas: '', text: `Končí platnost: ${d.nazev}`,
        pozn: d.presne === false ? 'datum ověřit v dokladu' : undefined });
  });

  const propadle = [
    ...ukoly.filter(u => !u.hotovo && u.doKdy < s).map(u => ({ datum: u.doKdy, text: u.nazev, pozn: 'po termínu' })),
    ...platby.filter(p => p.datum < s).map(p => ({ datum: p.datum, text: p.text, pozn: 'po splatnosti' })),
  ];

  const radit = (a, b) => podle(a.datum, b.datum) || podle(a.cas ?? '', b.cas ?? '');
  propadle.sort(radit);
  const napred = ceka.sort(radit).slice(0, mist - Math.min(propadle.length, 2));
  return [...napred, ...propadle.slice(0, mist - napred.length)]
    .map(p => ({ datum: kratce(p.datum), text: p.text, pozn: p.pozn }));
}

/* odpočet do velkých cest; u každé i nevyřešené úkoly, které se týkají cílové destinace */
function cesty(s) {
  return events.filter(e => (e.typ === 'vylet' || e.typ === 'pobyt') && e.od > s)
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

/* Hláška dne pro kluky — každý den další v pořadí z data/hlasky.json, takže se neopakují, dokud seznam
   nedojde; pak se jede znovu od začátku. Nové patří na konec souboru: vložení doprostřed by pořadí
   posunulo a včerejší hláška by se ukázala ještě jednou. Patří ke dni plakátu, ne ke dni renderu —
   večerní plakát na zítřek má už zítřejší. */
const HLASKY_OD = '2026-10-06';
function hlaskaDne(s) {
  const n = hlasky.length;
  if (!n) return undefined;
  const h = hlasky[((dnuMezi(HLASKY_OD, s) % n) + n) % n];
  return { text: h.text, autor: h.autor };
}

/* Dálkové „nahraj to na televizi znovu". Uploader pozná změnu plakátu podle otisku frame-data.json (bez razítka);
   když na TV visí rozbitý obrázek, ale data jsou stejná, sám by ho nevyměnil. Stačí přepsat
   frame-auto/nahrat-znovu.txt (čímkoli jiným než dosud) a po nasazení si plakát do 10 minut nahraje znovu —
   bez přístupu k Macu nebo NASu, kde uploader běží. Šablona to pole nepoužívá. */
const nahratZnovu = (() => {
  try { return fs.readFileSync('frame-auto/nahrat-znovu.txt', 'utf8').trim() || undefined; } catch { return undefined; }
})();

/* datum = konkrétní den (YYYY-MM-DD), nebo posun = kolik dní od dneška (0 dnešek, 1 zítřek).
   CI renderuje oba: dnešek do frame.jpg a zítřek do frame-zitra.jpg; od 17:00 uploader
   na TV věší zítřek, aby večer už visel program na další den. */
export function frameData(datum, posun = 0) {
  const ted = tedVPraze();
  const s = datum ?? plus(ted.datum, posun);
  plany = planProWeb(s);
  const pravy = dalsiDny(s);
  return {
    datumIso: s,   // šablona nepoužívá; uploader podle něj pozná, že nestahuje včerejší plakát
    nahratZnovu,
    razitko: `aktualizováno ${kratce(ted.datum)} v ${ted.cas}`,
    den: DNY[dow(s)],
    datum: `${parse(s).getUTCDate()}. ${MES[parse(s).getUTCMonth()]} ${s.slice(0, 4)} · týden ${tydenISO(s)}`,
    hlaska: hlaskaDne(s),
    dnes: dnes(s),
    cesty: cesty(s).slice(0, 3),
    nadpisVpravo: pravy.nadpis,
    dalsiDny: pravy.radky,
    blizi: blizi(s, pravy.posledni, plus(s, OKNO_BLIZI), VIC ? 6 : 4),
  };
}

if (process.argv[1]?.endsWith('build-frame-data.mjs')) {
  const i = process.argv.indexOf('--datum'), j = process.argv.indexOf('--posun');
  VIC = !process.argv.includes('--strucne');
  console.log(JSON.stringify(frameData(i > 0 ? process.argv[i + 1] : undefined,
    j > 0 ? Number(process.argv[j + 1]) : 0), null, 2));
}
