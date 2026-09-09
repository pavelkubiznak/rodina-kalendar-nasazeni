/* ================= Rodinný kalendář ================= */
const DNY = ['neděle','pondělí','úterý','středa','čtvrtek','pátek','sobota'];
const DNY_KR = ['Ne','Po','Út','St','Čt','Pá','So'];
const MESICE = ['leden','únor','březen','duben','květen','červen','červenec','srpen','září','říjen','listopad','prosinec'];
const MESICE_2 = ['ledna','února','března','dubna','května','června','července','srpna','září','října','listopadu','prosince'];

const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const parse = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
const addDays = (d,n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
const dnesISO = () => iso(new Date());
const diffDays = (a,b) => Math.round((parse(b) - parse(a)) / 86400000);
const kc = n => n.toLocaleString('cs-CZ') + ' Kč';
const datumKr = s => `${parse(s).getDate()}. ${MESICE_2[parse(s).getMonth()]}`;
const dnu = n => n === 1 ? 'den' : (n >= 2 && n <= 4) ? 'dny' : 'dní';

const state = { data:null, kurzor:new Date(), vybrany:null, filtr:new Set(), pohled:'mesic' };
const $ = s => document.querySelector(s);
const el = (t, cls, txt) => { const n = document.createElement(t); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };

async function nacti() {
  if (window.__DATA__) return window.__DATA__;
  const f = ['config','people','krouzky','events','rozvrhy','narozeniny','svatky','ukoly','doklady','knihovna','knihovna-plan'];
  const out = {};
  await Promise.all(f.map(async n => { out[n] = await (await fetch(`data/${n}.json`)).json(); }));
  return out;
}
const osoba = id => state.data.people.find(p => p.id === id) || { jmeno:id, barva:'#87838f' };

const SKOLNI_ROK = { od:'2026-09-01', do:'2027-06-30' };
const svatekDne = d => state.data.svatky.find(s => s.datum === d) || null;
function jeVolno(d) {
  const den = parse(d).getDay();
  if (den === 0 || den === 6) return true;
  const s = svatekDne(d); return !!(s && s.volno);
}
const naVylete = d => state.data.events.some(e =>
  (e.typ === 'vylet' || e.typ === 'pobyt') && d >= e.od && d <= (e.do || e.od));

function krouzkyDne(dISO) {
  const dow = parse(dISO).getDay();
  if (jeVolno(dISO) || naVylete(dISO)) return [];
  return state.data.krouzky.filter(k => {
    if (![k.den, k.denDalsi].filter(x => x != null).includes(dow)) return false;
    if (k.prvniLekce && dISO < k.prvniLekce) return false;
    if (k.konecKurzu && dISO > k.konecKurzu) return false;
    return true;
  }).sort((a,b) => (a.od || '').localeCompare(b.od || ''));
}
const akceDne = d => state.data.events.filter(e => d >= e.od && d <= (e.do || e.od));
// vícedenní = pruh přes kalendář; jednodenní = štítek v buňce
const jePruh = e => e.do && e.do !== e.od;
const pruhyDne = d => akceDne(d).filter(jePruh);
const bodyDne  = d => akceDne(d).filter(e => !jePruh(e));
const narozeninyDne = d => state.data.narozeniny.filter(n => n.datum.slice(5) === d.slice(5));

function projde(kdo) {
  if (!state.filtr.size) return true;
  if (!kdo || !kdo.length) return true;
  return kdo.some(k => state.filtr.has(k) || k === 'rodina');
}

/* ---------- ovládání ---------- */
function renderOvladani() {
  const box = $('#filtry'); box.innerHTML = '';
  for (const p of state.data.people) {
    if (p.role === 'spolecne') continue;
    const b = el('button','chip');
    b.style.setProperty('--c', p.barva);
    b.setAttribute('aria-pressed', state.filtr.size === 0 || state.filtr.has(p.id) ? 'true' : 'false');
    b.append(el('span','dot'), el('span', null, p.jmeno));
    b.onclick = () => {
      if (state.filtr.size === 0) state.data.people.forEach(x => { if (x.role !== 'spolecne') state.filtr.add(x.id); });
      state.filtr.has(p.id) ? state.filtr.delete(p.id) : state.filtr.add(p.id);
      const pocet = state.data.people.filter(x => x.role !== 'spolecne').length;
      if (state.filtr.size === pocet) state.filtr.clear();
      render();
    };
    box.append(b);
  }
}

/* ---------- hero ---------- */
function renderHero() {
  const box = $('#hero'); box.innerHTML = '';
  const d = dnesISO(), dd = parse(d);

  const c1 = el('div','card');
  c1.append(el('div','eyebrow','Dnes'));
  const nd = DNY[dd.getDay()];
  c1.append(el('h3', null, `${nd[0].toUpperCase()}${nd.slice(1)} ${dd.getDate()}. ${MESICE_2[dd.getMonth()]}`));
  const sv = svatekDne(d); if (sv) c1.append(el('div','hint', sv.nazev));

  const list = el('div','today-list');
  const polozky = [
    ...narozeninyDne(d).map(n => ({ t:'🎂', txt:`${n.jmeno} má narozeniny`, kdo:[n.kdo] })),
    ...akceDne(d).map(e => ({ t: e.cas || (e.ikona || '📍'), txt: e.nazev, kdo:e.kdo })),
    ...krouzkyDne(d).map(k => ({ t:k.od || '—', txt:`${k.nazev} (${k.kdo.map(x => osoba(x).jmeno).join(', ')})`, kdo:k.kdo })),
  ].filter(x => projde(x.kdo));
  if (!polozky.length) list.append(el('div','empty','Nic naplánovaného. Volný den.'));
  polozky.forEach(p => {
    const r = el('div','tl-row');
    r.append(el('span','tl-time', p.t), el('span', null, p.txt));
    list.append(r);
  });

  // konec školy dnes
  const dow = dd.getDay();
  if (dow >= 1 && dow <= 5 && !jeVolno(d) && !naVylete(d) && d >= SKOLNI_ROK.od && d <= SKOLNI_ROK.do) {
    const s = el('div','hint'); s.style.marginTop = '10px';
    s.textContent = state.data.people.filter(p => p.role === 'dite' && projde([p.id]))
      .map(p => `${p.jmeno} končí ${state.data.rozvrhy[p.id].konec[String(dow)]}`).join(' · ');
    if (s.textContent) c1.append(list, s); else c1.append(list);
  } else c1.append(list);
  box.append(c1);

  const budouci = state.data.events
    .filter(e => (e.typ === 'vylet' || e.typ === 'pobyt') && (e.do || e.od) >= d)
    .sort((a,b) => a.od.localeCompare(b.od)).slice(0,2);
  for (const e of budouci) {
    const c = el('div','card');
    c.append(el('div','eyebrow','Blíží se'));
    c.append(el('h3', null, `${e.ikona||''} ${e.nazev}`.trim()));
    const n = Math.max(0, diffDays(d, e.od));
    const cnt = el('div','count', n === 0 ? 'dnes' : String(n));
    if (n > 0) cnt.append(el('small', null, dnu(n)));
    c.append(cnt);
    c.append(el('div','hint', e.do && e.do !== e.od ? `${datumKr(e.od)} – ${datumKr(e.do)}` : datumKr(e.od)));
    box.append(c);
  }
}

/* ---------- společné: co je v daném dni ---------- */
function polozkyDne(s) {
  return {
    nar: narozeninyDne(s).filter(n => projde([n.kdo])),
    body: bodyDne(s).filter(e => projde(e.kdo)),
    pruhy: pruhyDne(s).filter(e => projde(e.kdo)),
    kr: krouzkyDne(s).filter(k => projde(k.kdo)),
    sv: svatekDne(s),
  };
}
function skolaDne(s) {
  const dow = parse(s).getDay();
  if (dow < 1 || dow > 5 || jeVolno(s) || naVylete(s) || s < SKOLNI_ROK.od || s > SKOLNI_ROK.do) return [];
  return state.data.people.filter(p => p.role === 'dite' && projde([p.id]))
    .map(p => ({ p, konec: state.data.rozvrhy[p.id].konec[String(dow)] }))
    .filter(x => x.konec);
}
function stitekKrouzku(k) {
  const p = el('div','pill krouzek', `${k.od ? k.od + ' ' : ''}${k.nazev}`);
  if (k.stav === 'kolize') p.classList.add('nejisty');
  p.style.setProperty('--c', osoba(k.kdo[0]).barva);
  return p;
}
function stitekAkce(e) {
  const p = el('div','pill akce', `${e.cas ? e.cas + ' ' : ''}${e.ikona || ''} ${e.nazev}`.replace(/\s+/g,' ').trim());
  p.style.setProperty('--c', osoba(e.kdo?.[0] || 'rodina').barva);
  return p;
}

/* ---------- měsíční mřížka s pruhy pro cesty ---------- */
function renderMesic() {
  $('#nadpis-mesice').textContent = `${MESICE[state.kurzor.getMonth()]} ${state.kurzor.getFullYear()}`;
  const g = $('#mrizka'); g.innerHTML = ''; g.className = 'mesic';

  const hlav = el('div','dowrow');
  ['Po','Út','St','Čt','Pá','So','Ne'].forEach(t => hlav.append(el('div','dow',t)));
  g.append(hlav);

  const prvni = new Date(state.kurzor.getFullYear(), state.kurzor.getMonth(), 1);
  const start = addDays(prvni, -((prvni.getDay() + 6) % 7));
  const dnes = dnesISO();

  for (let w = 0; w < 6; w++) {
    const zacTydne = addDays(start, w * 7);
    const dnyTydne = Array.from({length:7}, (_,i) => iso(addDays(zacTydne, i)));

    // pruhy: vícedenní akce protínající tenhle týden, rozdělené do drah
    const kandidati = [];
    const videno = new Set();
    for (const s2 of dnyTydne) for (const e of pruhyDne(s2)) {
      if (videno.has(e.id)) continue;
      videno.add(e.id);
      const od = Math.max(0, dnyTydne.indexOf(e.od) < 0 ? (e.od < dnyTydne[0] ? 0 : 0) : dnyTydne.indexOf(e.od));
      const doI = dnyTydne.indexOf(e.do) < 0 ? 6 : dnyTydne.indexOf(e.do);
      kandidati.push({ e, od, do: doI, zacina: e.od >= dnyTydne[0], konci: e.do <= dnyTydne[6] });
    }
    kandidati.sort((a,b) => a.od - b.od || (b.do - b.od) - (a.do - a.od));
    const drahy = [];
    for (const k of kandidati) {
      let i = drahy.findIndex(d => d.every(x => k.od > x.do || k.do < x.od));
      if (i < 0) { drahy.push([k]); i = drahy.length - 1; }
      else drahy[i].push(k);
      k.draha = i;
    }

    const row = el('div','week');
    row.style.setProperty('--drah', String(drahy.length));

    for (const s2 of dnyTydne) {
      const d = parse(s2);
      const b = el('button','day');
      if (d.getMonth() !== state.kurzor.getMonth()) b.classList.add('out');
      if ([0,6].includes(d.getDay())) b.classList.add('wknd');
      if (s2 === dnes) b.classList.add('today');
      if (s2 === state.vybrany) b.classList.add('sel');
      b.onclick = () => { state.vybrany = s2; otevriDen(s2); render(); };

      const P = polozkyDne(s2);
      const top = el('div','day-top');
      top.append(el('span','num', String(d.getDate())));
      if (P.sv && P.sv.volno) top.append(el('span','hol','svátek'));
      b.append(top);
      if (P.nar.length) { const x = el('span','bday','🎂'); x.title = P.nar.map(n => n.jmeno).join(', '); b.append(x); }

      let radku = 0;
      for (const e of P.body) { if (radku >= 3) break; b.append(stitekAkce(e)); radku++; }
      for (const k of P.kr)   { if (radku >= 3) break; b.append(stitekKrouzku(k)); radku++; }
      const zbyva = P.body.length + P.kr.length - radku;
      if (zbyva > 0) b.append(el('div','more', `+ ${zbyva} další`));

      const dr = el('div','dotrow');
      [...P.body, ...P.kr].forEach(x => {
        const i2 = document.createElement('i');
        i2.style.setProperty('--c', osoba((x.kdo && x.kdo[0]) || 'rodina').barva);
        dr.append(i2);
      });
      if (dr.children.length) b.append(dr);
      row.append(b);
    }

    for (const k of kandidati) {
      const r = el('div','ribbon');
      if (!k.zacina) r.classList.add('pokrac');
      if (!k.konci) r.classList.add('pokracuje');
      r.style.left = `calc(${k.od / 7 * 100}% + 3px)`;
      r.style.width = `calc(${(k.do - k.od + 1) / 7 * 100}% - 6px)`;
      r.style.top = `${6 + k.draha * 22}px`;
      r.style.setProperty('--c', osoba(k.e.kdo?.[0] || 'rodina').barva);
      r.textContent = `${k.zacina ? (k.e.ikona || '') + ' ' : '… '}${k.e.nazev}`.trim();
      r.title = `${k.e.nazev} · ${datumKr(k.e.od)} – ${datumKr(k.e.do)}`;
      r.onclick = ev => { ev.stopPropagation(); state.vybrany = k.e.od >= dnyTydne[0] ? k.e.od : dnyTydne[0]; otevriDen(state.vybrany); render(); };
      row.append(r);
    }
    g.append(row);
  }
}

/* ---------- týdenní pohled ---------- */
function renderTyden() {
  const zac = addDays(state.kurzor, -((state.kurzor.getDay() + 6) % 7));
  const konec = addDays(zac, 6);
  const stejnyMesic = zac.getMonth() === konec.getMonth();
  $('#nadpis-mesice').textContent = stejnyMesic
    ? `${zac.getDate()}. – ${konec.getDate()}. ${MESICE_2[konec.getMonth()]}`
    : `${zac.getDate()}. ${MESICE_2[zac.getMonth()]} – ${konec.getDate()}. ${MESICE_2[konec.getMonth()]}`;

  const g = $('#mrizka'); g.innerHTML = ''; g.className = 'tyden';
  const dnes = dnesISO();

  // cesty a pobyty, které do týdne zasahují — jeden pruh nahoře místo opakování v každém dni
  const dnyTydne = Array.from({length:7}, (_,i) => iso(addDays(zac, i)));
  const cesty = [];
  for (const s2 of dnyTydne) for (const e of pruhyDne(s2))
    if (!cesty.some(x => x.id === e.id)) cesty.push(e);
  if (cesty.length) {
    const wrap = el('div','tyden-cesty');
    for (const e of cesty) {
      const r = el('button','cesta-pruh');
      r.style.setProperty('--c', osoba(e.kdo?.[0] || 'rodina').barva);
      r.append(el('span','cp-ikona', e.ikona || '📍'));
      const w = el('span','cp-txt');
      w.append(el('span','cp-nazev', e.nazev));
      w.append(el('span','cp-datum', `${datumKr(e.od)} – ${datumKr(e.do)}`));
      r.append(w);
      r.onclick = () => { state.vybrany = e.od; otevriDen(e.od); };
      wrap.append(r);
    }
    g.append(wrap);
  }

  for (let i = 0; i < 7; i++) {
    const d = addDays(zac, i), s = iso(d);
    const P = polozkyDne(s), skola = skolaDne(s);
    const card = el('div','tden');
    if (s === dnes) card.classList.add('today');
    if ([0,6].includes(d.getDay())) card.classList.add('wknd');

    const hl = el('div','tden-h');
    hl.append(el('span','tden-num', String(d.getDate())));
    const dn = el('div','tden-den');
    dn.append(el('div', null, DNY[d.getDay()]));
    if (P.sv) dn.append(el('div','hint', P.sv.nazev));
    if (P.pruhy.length) dn.append(el('div','hint cestou',
      P.pruhy.map(e => `${e.ikona || '📍'} ${e.nazev}`).join(' · ')));
    hl.append(dn);
    card.append(hl);

    const body = el('div','tden-b');
    P.nar.forEach(n => {
      const r = el('div','tr-item');
      r.append(el('span','tr-t','🎂'), el('span', null, `${n.jmeno} má narozeniny`));
      body.append(r);
    });
    if (skola.length) {
      const r = el('div','tr-item skola');
      r.append(el('span','tr-t','🎒'));
      const w = el('span', null, skola.map(x => `${x.p.jmeno} končí ${x.konec}`).join(' · '));
      r.append(w); body.append(r);
    }
    for (const e of P.body) {
      const r = el('div','tr-item');
      r.style.setProperty('--c', osoba(e.kdo?.[0] || 'rodina').barva);
      r.classList.add('barevne');
      r.append(el('span','tr-t', e.cas || e.ikona || '·'), el('span', null, e.nazev));
      body.append(r);
    }
    for (const k of P.kr) {
      const r = el('div','tr-item barevne' + (k.stav === 'kolize' ? ' kolize' : ''));
      r.style.setProperty('--c', osoba(k.kdo[0]).barva);
      r.append(el('span','tr-t', k.od || '·'));
      const w = el('span');
      w.append(el('span', null, k.nazev));
      w.append(el('span','tr-kdo', ' · ' + k.kdo.map(x => osoba(x).jmeno).join(', ')));
      if (k.misto) w.append(el('div','hint', k.misto));
      r.append(w);
      body.append(r);
    }
    if (!body.children.length) body.append(el('div','empty','volno'));
    card.append(body);

    card.tabIndex = 0;
    card.setAttribute('role','button');
    card.title = 'Otevřít detail dne';
    const otevri = () => { state.vybrany = s; otevriDen(s); };
    card.onclick = otevri;
    card.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); otevri(); } };
    g.append(card);
  }
}

/* ---------- agenda ---------- */
function renderAgenda() {
  $('#nadpis-mesice').textContent = 'Co nás čeká';
  const g = $('#mrizka'); g.innerHTML = ''; g.className = 'agenda';
  const dnes = new Date();
  let mesic = null, pocet = 0;

  for (let i = 0; i < 120 && pocet < 40; i++) {
    const d = addDays(dnes, i), s = iso(d);
    const P = polozkyDne(s);
    const polozky = [...P.nar, ...P.pruhy.filter(e => e.od === s), ...P.body, ...P.kr];
    if (!polozky.length) continue;

    if (d.getMonth() !== mesic) {
      mesic = d.getMonth();
      g.append(el('div','ag-mesic', `${MESICE[mesic]} ${d.getFullYear()}`));
    }
    const row = el('div','ag-den');
    if (s === iso(dnes)) row.classList.add('today');
    const lev = el('div','ag-lev');
    lev.append(el('div','ag-num', String(d.getDate())), el('div','ag-dow', DNY_KR[d.getDay()]));
    row.append(lev);

    const prav = el('div','ag-prav');
    P.nar.forEach(n => prav.append(el('div','tr-item', `🎂 ${n.jmeno} má narozeniny`)));
    P.pruhy.filter(e => e.od === s).forEach(e => {
      const r = el('div','tr-item cesta barevne');
      r.style.setProperty('--c', osoba(e.kdo?.[0] || 'rodina').barva);
      r.append(el('span','tr-t', e.ikona || '📍'),
               el('span', null, `${e.nazev} — ${datumKr(e.od)} až ${datumKr(e.do)}`));
      prav.append(r);
    });
    P.body.forEach(e => {
      const r = el('div','tr-item barevne');
      r.style.setProperty('--c', osoba(e.kdo?.[0] || 'rodina').barva);
      r.append(el('span','tr-t', e.cas || e.ikona || '·'), el('span', null, e.nazev));
      prav.append(r);
    });
    P.kr.forEach(k => {
      const r = el('div','tr-item barevne' + (k.stav === 'kolize' ? ' kolize' : ''));
      r.style.setProperty('--c', osoba(k.kdo[0]).barva);
      r.append(el('span','tr-t', k.od || '·'),
               el('span', null, `${k.nazev} · ${k.kdo.map(x => osoba(x).jmeno).join(', ')}`));
      prav.append(r);
    });
    row.append(prav);
    row.onclick = () => { state.vybrany = s; otevriDen(s); };
    g.append(row);
    pocet++;
  }
  if (!pocet) g.append(el('div','empty','V nejbližších čtyřech měsících nic není.'));
}

function renderKalendar() {
  const nav = $('#nav-sipky');
  nav.style.visibility = state.pohled === 'agenda' ? 'hidden' : 'visible';
  document.querySelectorAll('#pohledy button').forEach(b =>
    b.setAttribute('aria-pressed', b.dataset.v === state.pohled ? 'true' : 'false'));
  if (state.pohled === 'mesic') renderMesic();
  else if (state.pohled === 'tyden') renderTyden();
  else renderAgenda();
}

/* ---------- detail dne ---------- */
function otevriDen(s) {
  $('#drawer').setAttribute('data-open','');
  const d = parse(s);
  $('#sheet-datum').textContent = `${DNY[d.getDay()]} ${d.getDate()}. ${MESICE_2[d.getMonth()]}`;
  $('#sheet-rok').textContent = d.getFullYear();
  const body = $('#sheet-body'); body.innerHTML = '';

  const sv = svatekDne(s), nar = narozeninyDne(s);
  if (sv || nar.length) {
    const blk = el('div','blk'); blk.append(el('h4', null, 'Den'));
    if (sv) blk.append(el('div','item', sv.nazev + (sv.volno ? ' · den pracovního klidu' : '')));
    nar.forEach(n => blk.append(el('div','item',
      `🎂 ${n.jmeno} — narozeniny (${d.getFullYear() - Number(n.datum.slice(0,4))} let)`)));
    body.append(blk);
  }

  const ak = akceDne(s).filter(e => projde(e.kdo));
  if (ak.length) {
    const blk = el('div','blk'); blk.append(el('h4', null, 'Program'));
    ak.forEach(e => {
      const it = el('div','item');
      it.append(el('span','t', e.cas || e.ikona || '📍'));
      const w = el('div');
      w.append(el('div', null, e.nazev + (e.casDo ? ` → ${e.casDo}` : '')));
      if (e.misto) w.append(el('div','hint', e.misto));
      if (e.popis) w.append(el('div','hint', e.popis));
      it.append(w); blk.append(it);
    });
    body.append(blk);
  }

  const dow = d.getDay();
  if (dow >= 1 && dow <= 5 && !jeVolno(s) && !naVylete(s) && s >= SKOLNI_ROK.od && s <= SKOLNI_ROK.do) {
    const blk = el('div','blk'); blk.append(el('h4', null, 'Škola'));
    const Z = state.data.rozvrhy.zvonky, P = state.data.rozvrhy.predmety;
    for (const p of state.data.people.filter(x => x.role === 'dite')) {
      if (!projde([p.id])) continue;
      const r = state.data.rozvrhy[p.id];
      const hod = r.dny[String(dow)] || [];
      const it = el('div','item');
      const w = el('span','who', p.jmeno); w.style.setProperty('--c', p.barva); it.append(w);
      const box = el('div');
      if (!hod.length) box.append(el('span','tbd','rozvrh nevyplněn'));
      else {
        const tbl = el('div','hodiny');
        hod.forEach(([n, subj]) => {
          const row = el('div','hod');
          row.append(el('span','hod-t', Z[String(n)]), el('span', null, P[subj] || subj));
          tbl.append(row);
        });
        box.append(tbl);
        const k = el('div','konec', `konec vyučování ${r.konec[String(dow)]}`);
        box.append(k);
      }
      it.append(box); blk.append(it);
    }
    body.append(blk);
  }

  const kr = krouzkyDne(s).filter(k => projde(k.kdo));
  if (kr.length) {
    const blk = el('div','blk'); blk.append(el('h4', null, 'Kroužky'));
    kr.forEach(k => {
      const it = el('div','item');
      it.append(el('span','t', k.od ? `${k.od}` : '—'));
      const w = el('div');
      w.append(el('div', null, `${k.nazev}${k.do ? ` → ${k.do}` : ''}`));
      const meta = [k.poskytovatel, k.misto].filter(Boolean).join(' · ');
      if (meta) w.append(el('div','hint', meta));
      if (k.stav === 'kolize') w.append(el('span','tbd','kolize — nutné dořešit'));
      if (k.poznamka) w.append(el('div','hint', k.poznamka));
      it.append(w);
      k.kdo.forEach(id => { const b = el('span','who', osoba(id).jmeno); b.style.setProperty('--c', osoba(id).barva); it.append(b); });
      blk.append(it);
    });
    body.append(blk);
  }

  if (!body.children.length) body.append(el('div','empty','Na tenhle den nic není.'));
}

/* ---------- úkoly a rozhodnutí ---------- */
function renderUkoly() {
  const box = $('#ukoly'); box.innerHTML = '';
  const d = dnesISO();
  const otevrene = state.data.ukoly.filter(u => !u.hotovo).sort((a,b) => a.doKdy.localeCompare(b.doKdy));
  if (!otevrene.length) { box.append(el('div','empty','Nic k rozhodnutí. Čisto.')); return; }
  for (const u of otevrene) {
    const n = diffDays(d, u.doKdy);
    const c = el('div','card ukol');
    if (n <= 7) c.classList.add('urgent');
    c.append(el('div','eyebrow', n < 0 ? 'Po termínu' : n === 0 ? 'Dnes' : `Zbývá ${n} ${dnu(n)}`));
    c.append(el('h3', null, `${u.ikona || ''} ${u.nazev}`.trim()));
    c.append(el('div','hint', u.popis));
    c.append(el('div','hint termin', `ideálně do ${datumKr(u.doKdy)}`));
    box.append(c);
  }
}

/* ---------- kroužky + platby ---------- */
const STAVY = { aktivni:['ok','Jede'], kolize:['danger','Kolize'], prihlaseno:['warn','Přihlášeno'] };

function renderTabulky() {
  const tb = $('#tab-krouzky'); tb.innerHTML = '';
  for (const k of state.data.krouzky) {
    if (!projde(k.kdo)) continue;
    const tr = el('tr');
    if (k.stav === 'kolize') tr.classList.add('rowbad');
    const c1 = el('td'); c1.append(el('div', null, k.nazev), el('div','hint', k.poskytovatel)); tr.append(c1);
    const c2 = el('td');
    k.kdo.forEach(id => {
      const b = el('span','badge', osoba(id).jmeno);
      b.style.background = osoba(id).barva; b.style.color = '#fff'; b.style.marginRight = '4px';
      c2.append(b);
    });
    tr.append(c2);
    const dny = [k.den, k.denDalsi].filter(x => x != null).map(x => DNY_KR[x]).join(' + ');
    tr.append(el('td', null, dny || '?'));
    tr.append(el('td','mono', k.od ? `${k.od}–${k.do}` : '—'));
    tr.append(el('td', null, k.prvniLekce ? datumKr(k.prvniLekce) : '—'));
    const c6 = el('td','mono'); c6.textContent = k.cena ? `${kc(k.cena)}/${k.za}` : '—'; tr.append(c6);
    const [cls, txt] = STAVY[k.stav] || ['','—'];
    const c7 = el('td'); c7.append(el('span','badge ' + cls, txt)); tr.append(c7);
    tb.append(tr);
  }

  const pc = $('#platby'); pc.innerHTML = '';
  const d = dnesISO();
  const otevrene = state.data.krouzky.filter(k => k.platba && !k.platba.zaplaceno && projde(k.kdo));
  const skupiny = new Map();
  for (const k of otevrene) {
    const key = `${k.platba.splatnost || 'neurceno'}|${k.platba.kde}`;
    if (!skupiny.has(key)) skupiny.set(key, []);
    skupiny.get(key).push(k);
  }
  if (!skupiny.size) { pc.append(el('div','empty','Žádné otevřené platby.')); return; }
  const razeni = [...skupiny.entries()].sort((a,b) => a[0].localeCompare(b[0]));
  for (const [key, ks] of razeni) {
    const [splatnost, kde] = key.split('|');
    const c = el('div','card');
    c.append(el('div','eyebrow', kde));
    const suma = ks.reduce((s,k) => s + (k.platba.castka || 0), 0);
    c.append(el('h3', null, kc(suma)));
    if (splatnost !== 'neurceno') {
      const n = diffDays(d, splatnost);
      if (n <= 14) c.classList.add('urgent');
      const cnt = el('div','count', n < 0 ? 'po termínu' : n === 0 ? 'dnes' : String(n));
      if (n > 0) cnt.append(el('small', null, dnu(n)));
      c.append(cnt);
      c.append(el('div','hint', `splatnost ${datumKr(splatnost)} ${splatnost.slice(0,4)}`));
    } else {
      c.append(el('div','hint','termín zatím neznámý — pokyny přijdou přes Bakaláře'));
    }
    const u = el('div','hint'); u.style.marginTop = '8px';
    u.textContent = ks.map(k => k.nazev + (k.stav === 'kolize' ? ' ⚠️' : '')).join(', ');
    c.append(u);
    const vs = ks.flatMap(k => k.vs ? Object.entries(k.vs).map(([kdo, v]) => `${osoba(kdo).jmeno} ${v}`) : []);
    if (vs.length) { const m = el('div','hint mono'); m.style.marginTop = '6px'; m.textContent = 'VS ' + vs.join(' · '); c.append(m); }
    if (ks.some(k => k.stav === 'kolize')) c.append(el('div','hint warnline','⚠️ Obsahuje kolizní přihlášky — ty zatím neplať.'));
    pc.append(c);
  }
}

/* ---------- doklady ---------- */
function renderDoklady() {
  const box = $('#doklady'); if (!box) return;
  box.innerHTML = '';
  const d = dnesISO();
  const list = (state.data.doklady || []).filter(x => projde(x.kdo))
    .sort((a2,b2) => a2.platnostDo.localeCompare(b2.platnostDo));
  if (!list.length) { box.append(el('div','empty','Žádné hlídané doklady.')); return; }
  for (const dok of list) {
    const n = diffDays(d, dok.platnostDo);
    const mes = Math.round(n / 30.4);
    const c = el('div','card ukol');
    if (n <= 90) c.classList.add('urgent');
    c.append(el('div','eyebrow', n < 0 ? 'Propadlé' : n <= 90 ? 'Zařídit brzy' : 'Platí'));
    c.append(el('h3', null, `${dok.ikona || '📄'} ${dok.nazev}`));
    const cnt = el('div','count', n < 0 ? '—' : String(mes));
    if (n >= 0) cnt.append(el('small', null, mes === 1 ? 'měsíc' : mes < 5 ? 'měsíce' : 'měsíců'));
    c.append(cnt);
    c.append(el('div','hint termin',
      `platnost do ${datumKr(dok.platnostDo)} ${dok.platnostDo.slice(0,4)}${dok.presne === false ? ' (datum ověřit)' : ''}`));
    if (dok.poznamka) c.append(el('div','hint', dok.poznamka));
    box.append(c);
  }
}

/* ---------- knihovna ---------- */
function renderKnihovna() {
  const box = $('#knihovna'); if (!box) return;
  box.innerHTML = '';
  const d = dnesISO();
  const otevrene = (state.data.knihovna || []).filter(v => !v.vraceno);
  if (!otevrene.length) { box.append(el('div','empty','Nic nemáte půjčené.')); return; }
  for (const v of otevrene) {
    const celkem = v.oddeleni.reduce((a,o) => a + o.tituly.length, 0);
    const n = diffDays(d, v.vratitDo);
    const c = el('div','card knihovna');
    if (n <= 7) c.classList.add('urgent');
    c.append(el('div','eyebrow', n < 0 ? 'Po termínu — hrozí pokuta' : n === 0 ? 'Vrátit dnes' : `Zbývá ${n} ${dnu(n)}`));
    c.append(el('h3', null, `📚 ${celkem} titulů k vrácení`));
    c.append(el('div','hint termin', `${v.knihovna} · do ${datumKr(v.vratitDo)}`));

    const plan = (state.data['knihovna-plan'] || []).find(x => x.id === v.id);
    if (plan) {
      const pl = el('div','plan');
      if (plan.nejlepsi) {
        const hl = el('div','plan-hlavni');
        hl.append(el('span','plan-ik','✅'));
        const w = el('div');
        w.append(el('div','plan-kdy', `${plan.nejlepsi.popis}, ${plan.nejlepsi.od}–${plan.nejlepsi.do}`));
        w.append(el('div','hint', plan.nejlepsi.vseOtevreno
          ? 'Všechna oddělení otevřená — stihnete i vybrat nové.'
          : `Zavřeno: ${plan.nejlepsi.zavrene.join(', ')}.`));
        if (plan.nejlepsi.brzda) w.append(el('div','hint', `Okno končí kvůli: ${plan.nejlepsi.brzda}`));
        hl.append(w);
        pl.append(hl);
        if (plan.nahradni.length) {
          pl.append(el('div','hint', 'Náhradní: ' +
            plan.nahradni.map(n => `${n.popis} ${n.od}–${n.do}`).join(' · ')));
        }
      } else {
        pl.append(el('div','plan-hlavni varovani', '⚠️ Do termínu se do knihovny nedostanete — všechny dny padají na zavřeno, školu nebo kroužky.'));
      }
      if (plan.denD) {
        pl.append(el('div','hint varovani',
          `⏱ V den termínu (${plan.denD.popis}) by zbylo jen ${plan.denD.od}–${plan.denD.do} kvůli: ${plan.denD.brzda}. Nespoléhal bych na to.`));
      }
      if (plan.box) {
        const bx = el('div','plan-box');
        bx.append(el('span','plan-ik','📦'));
        const w2 = el('div');
        w2.append(el('div','plan-kdy', `Bibliobox nejpozději ${plan.box.popis}`));
        w2.append(el('div','hint', 'Z boxu se konto odepisuje až následující pracovní den — vhozením v den termínu je pozdě.'));
        pl.append(bx.appendChild(w2) && bx);
      }
      c.append(pl);
    }
    for (const o of v.oddeleni) {
      const det = el('details','odd');
      const sum = el('summary');
      sum.append(el('span','odd-nazev', o.nazev));
      const b = el('span','who', osoba(o.ctenar).jmeno);
      b.style.setProperty('--c', osoba(o.ctenar).barva);
      sum.append(b, el('span','odd-pocet', `${o.tituly.length}×`));
      det.append(sum);
      const ul = el('ul','tituly');
      o.tituly.forEach(t => {
        const li = el('li');
        if (t.autor) li.append(el('span','aut', t.autor + ': '));
        li.append(el('span', null, t.nazev));
        ul.append(li);
      });
      det.append(ul);
      det.append(el('div','hint', `tel. ${o.telefon}`));
      c.append(det);
    }
    box.append(c);
  }
}

/* ---------- rychlé přidání: parser ---------- */
const MES_TVARY = ['led','únor|unor','břez|brez','dub','květ|kvet','červn|cervn|června|cervna',
  'červenc|cervenc|července|cervence','srp','září|zari','říj|rij','listopad','prosin'];

function urciDatum(low, dnes) {
  // 6.3. / 6. 3. 2027
  let m = low.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})?/);
  if (m) {
    const r = m[3] ? Number(m[3]) : dnes.getFullYear();
    const k = new Date(r, Number(m[2]) - 1, Number(m[1]));
    if (!m[3] && k < dnes) k.setFullYear(r + 1);
    return { datum: iso(k), presne: true };
  }
  // 6. března
  m = low.match(/(\d{1,2})\.\s*(ledna|února|března|dubna|května|června|července|srpna|září|října|listopadu|prosince)/);
  if (m) {
    const k = new Date(dnes.getFullYear(), MESICE_2.indexOf(m[2]), Number(m[1]));
    if (k < dnes) k.setFullYear(dnes.getFullYear() + 1);
    return { datum: iso(k), presne: true };
  }
  // začátkem / v polovině / koncem <měsíce>  ·  v březnu
  const mi = MES_TVARY.findIndex(re => new RegExp(`\\b(?:${re})\\w*`).test(low));
  if (mi >= 0) {
    let den = 1;
    if (/polovin|prostřed|prostred/.test(low)) den = 15;
    if (/konc\w*|na konci/.test(low)) den = 25;
    const k = new Date(dnes.getFullYear(), mi, den);
    if (k < dnes) k.setFullYear(dnes.getFullYear() + 1);
    return { datum: iso(k), presne: false };
  }
  // za X dní / týdnů / měsíců
  m = low.match(/za\s+(\d+|jeden|jednoho|dva|tři|tri|čtyři|ctyri|pět|pet|půl|pul)?\s*(den|dny|dní|dni|týden|tyden|týdny|tydny|týdnů|tydnu|měsíc|mesic|měsíce|mesice|měsíců|mesicu|rok|roku|roky)/);
  if (m) {
    const cisla = { '':1, 'jeden':1, 'jednoho':1, 'dva':2, 'tři':3, 'tri':3, 'čtyři':4, 'ctyri':4, 'pět':5, 'pet':5, 'půl':0.5, 'pul':0.5 };
    const n = m[1] && /^\d+$/.test(m[1]) ? Number(m[1]) : (cisla[m[1] || ''] ?? 1);
    const j = m[2];
    let dnu = n;
    if (/týd|tyd/.test(j)) dnu = n * 7;
    else if (/měs|mes/.test(j)) dnu = Math.round(n * 30.4);
    else if (/rok/.test(j)) dnu = Math.round(n * 365);
    return { datum: iso(addDays(dnes, Math.round(dnu))), presne: false };
  }
  if (/\bdnes\b/.test(low)) return { datum: dnesISO(), presne: true };
  if (/\bz[íi]tra\b/.test(low)) return { datum: iso(addDays(dnes, 1)), presne: true };
  if (/\bpoz[ií]tř[ií]\b/.test(low)) return { datum: iso(addDays(dnes, 2)), presne: true };
  const dn = ['neděli|nedeli','pondělí|pondeli','úterý|utery','středu|stredu','čtvrtek|ctvrtek','pátek|patek','sobotu'];
  const di = dn.findIndex(re => new RegExp(re).test(low));
  if (di >= 0) {
    let k = addDays(dnes, 1);
    while (k.getDay() !== di) k = addDays(k, 1);
    if (/př[íi]št[íi]|pris/.test(low)) k = addDays(k, 7);
    return { datum: iso(k), presne: true };
  }
  return { datum: null, presne: false };
}

function urciUpominky(low, vychozi) {
  const out = [];
  const re = /(\d+|jeden|dva|tři|tri|čtyři|ctyri|měsíc|mesic|týden|tyden)?\s*(den|dny|dní|dni|týden|tyden|týdny|tydny|týdnů|tydnu|měsíc|mesic|měsíce|mesice|měsíců|mesicu)\s*(předem|dopredu|dopředu|před t[íi]m|napřed)/g;
  let m;
  while ((m = re.exec(low))) {
    const cisla = { '':1, 'jeden':1, 'dva':2, 'tři':3, 'tri':3, 'čtyři':4, 'ctyri':4, 'měsíc':1, 'mesic':1, 'týden':1, 'tyden':1 };
    const n = m[1] && /^\d+$/.test(m[1]) ? Number(m[1]) : (cisla[m[1] || ''] ?? 1);
    const j = m[2];
    let dnu = n;
    if (/týd|tyd/.test(j)) dnu = n * 7;
    else if (/měs|mes/.test(j)) dnu = Math.round(n * 30.4);
    out.push(dnu);
  }
  return out.length ? [...new Set(out)].sort((a,b) => b - a) : vychozi;
}

function parseText(t) {
  const s = t.trim(); if (!s) return null;
  const low = s.toLowerCase().replace(/\s+/g,' ');
  const dnes = new Date();

  const { datum, presne } = urciDatum(low, dnes);
  const mc = low.match(/\b(\d{1,2})[:.](\d{2})\b/) || low.match(/\bv\s+(\d{1,2})\s*(?:hodin|hod|h)\b/);
  const cas = mc ? `${String(mc[1]).padStart(2,'0')}:${mc[2] || '00'}` : null;

  const kdo = [];
  if (/mat[ěe]j/.test(low)) kdo.push('matej');
  if (/tom[áa][šs]|tom[ií]k/.test(low)) kdo.push('tomas');
  if (/[šs][áa]rk/.test(low)) kdo.push('sarka');
  if (/\bpavl|\bpavel|\bj[áa]\b|\bmn[ěe]\b/.test(low)) kdo.push('pavel');
  if (/klu[kc]|oba|d[ěe]t[ei]|kluk[ůu]m/.test(low)) { kdo.length = 0; kdo.push('matej','tomas'); }
  if (!kdo.length) kdo.push('rodina');

  const jeDoklad = /(pas|cestovn[íi] doklad|ob[čc]ank|ob[čc]ansk|[řr]idi[čc]|stk|pojist|pojišt|revize|platnost)/.test(low)
    && /(kon[čc]|vypr[šs]|propad|expir|platnost)/.test(low);
  const jeUkol = !jeDoklad && /(nezapome|za[řr][íi]dit|objednat|zamluvit|rezervovat|koupit|vy[řr][íi]dit|zaplatit|domluvit|p[řr]ihl[áa]sit)/.test(low);

  let nazev = s.replace(/\s+/g,' ').trim();
  nazev = nazev.replace(/^(a\s+)?(pak\s+)?/i,'').replace(/^(v|ve|na)\s+/i,'');
  if (nazev.length > 80) nazev = nazev.slice(0,77) + '…';

  let misto = null;
  const mm = s.match(/\b(?:v|ve|na|u)\s+([A-ZÁ-Ž][\wÁ-Žá-ž]+(?:\s+[A-ZÁ-Ž][\wÁ-Žá-ž]+)*)/);
  if (mm && !/^(mat[ěe]j|tom[áa][šs]|tom[ií]k|[šs][áa]rk|pavl|pavel)/i.test(mm[1])) misto = mm[1];

  if (jeDoklad) {
    return { _typ:'doklad', soubor:'data/doklady.json',
      zaznam: { id:'dok-' + Date.now().toString(36), nazev, kdo,
        platnostDo: datum || iso(addDays(dnes, 180)), presne,
        upominky: urciUpominky(low, [90, 60, 30]), ikona:'🛂', poznamka:s },
      _chybiDatum: !datum };
  }
  if (jeUkol) {
    return { _typ:'ukol', soubor:'data/ukoly.json',
      zaznam: { id:'ukol-' + Date.now().toString(36), nazev,
        doKdy: datum || iso(addDays(dnes, 14)),
        popis: s, upominky: urciUpominky(low, [14, 3, 1]), hotovo:false, ikona:'✅' },
      _chybiDatum: !datum };
  }
  return { _typ:'akce', soubor:'data/events.json',
    zaznam: { id:'akce-' + Date.now().toString(36), nazev, kdo, typ:'akce',
      od: datum || dnesISO(), celodenni: !cas, cas, casDo:null, misto, popis:s,
      upominky: urciUpominky(low, [7, 1]), ikona:'📌' },
    _chybiDatum: !datum };
}

/* ---------- ukládání do GitHubu ---------- */
const gh = {
  nacti: () => { try { return JSON.parse(localStorage.getItem('rk-gh') || 'null'); } catch { return null; } },
  uloz: v => localStorage.setItem('rk-gh', JSON.stringify(v)),
  smaz: () => localStorage.removeItem('rk-gh'),
};
const b64 = str => btoa(String.fromCharCode(...new TextEncoder().encode(str)));
const zb64 = str => new TextDecoder().decode(Uint8Array.from(atob(str.replace(/\n/g,'')), c => c.charCodeAt(0)));

async function ulozDoRepa(soubor, zaznam, popisZmeny) {
  const cfg = gh.nacti();
  if (!cfg || !cfg.repo || !cfg.token) return { ok:false, duvod:'bez-tokenu' };
  const url = `https://api.github.com/repos/${cfg.repo}/contents/${soubor}`;
  const hlavicky = { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json' };
  const r1 = await fetch(url, { headers: hlavicky });
  if (!r1.ok) return { ok:false, duvod:`čtení selhalo (${r1.status})` };
  const meta = await r1.json();
  const pole = JSON.parse(zb64(meta.content));
  pole.push(zaznam);
  const r2 = await fetch(url, {
    method:'PUT', headers: { ...hlavicky, 'Content-Type':'application/json' },
    body: JSON.stringify({ message: popisZmeny, content: b64(JSON.stringify(pole, null, 2) + '\n'), sha: meta.sha }),
  });
  if (!r2.ok) return { ok:false, duvod:`zápis selhal (${r2.status})` };
  return { ok:true };
}

/* ---------- rychlé přidání: návrh a potvrzení ---------- */
function popisNavrhu(n) {
  const z = n.zaznam;
  const radky = [];
  if (n._typ === 'doklad') {
    radky.push(['Typ', 'Hlídání platnosti dokladu']);
    radky.push(['Platnost do', `${datumKr(z.platnostDo)} ${z.platnostDo.slice(0,4)}${z.presne === false ? ' (odhad — uprav)' : ''}`]);
    radky.push(['Koho se týká', z.kdo.map(k => osoba(k).jmeno).join(', ')]);
  } else if (n._typ === 'ukol') {
    radky.push(['Typ', 'Úkol s termínem']);
    radky.push(['Do kdy', `${datumKr(z.doKdy)} ${z.doKdy.slice(0,4)}`]);
  } else {
    radky.push(['Typ', 'Akce v kalendáři']);
    radky.push(['Datum', n._chybiDatum ? '⚠️ nerozpoznáno — dnes'
      : `${DNY[parse(z.od).getDay()]} ${datumKr(z.od)} ${z.od.slice(0,4)}`]);
    radky.push(['Čas', z.cas || 'celodenní']);
    radky.push(['Koho se týká', z.kdo.map(k => osoba(k).jmeno).join(', ')]);
    if (z.misto) radky.push(['Místo', z.misto]);
  }
  const u = z.upominky || [];
  radky.push(['Upomínky', u.length
    ? u.map(d => d >= 30 ? `${Math.round(d/30.4)} měs.` : d >= 7 ? `${Math.round(d/7)} týd.` : `${d} d.`).join(' · ') + ' předem'
    : 'žádné']);
  return radky;
}

function renderNavrh(n) {
  const box = $('#navrh');
  box.innerHTML = '';
  if (!n) { box.style.display = 'none'; return; }
  box.style.display = 'block';

  box.append(el('div','eyebrow','Návrh — zkontroluj a potvrď'));
  box.append(el('div','navrh-nazev', n.zaznam.nazev));
  const dl = el('dl');
  popisNavrhu(n).forEach(([k,v]) => dl.append(el('dt',null,k), el('dd',null,v)));
  box.append(dl);

  const r = el('div','row');
  const ok = el('button','btn primary','Potvrdit a uložit');
  const zrus = el('button','btn','Zahodit');
  r.append(ok, zrus); box.append(r);

  zrus.onclick = () => renderNavrh(null);
  ok.onclick = async () => {
    ok.disabled = true; ok.textContent = 'Ukládám…';
    // zobrazit hned lokálně
    if (n._typ === 'akce') state.data.events.push(n.zaznam);
    if (n._typ === 'ukol') state.data.ukoly.push(n.zaznam);
    if (n._typ === 'doklad') (state.data.doklady = state.data.doklady || []).push(n.zaznam);
    try {
      const klic = 'rk-lokalni-' + n._typ;
      const p2 = JSON.parse(localStorage.getItem(klic) || '[]'); p2.push(n.zaznam);
      localStorage.setItem(klic, JSON.stringify(p2));
    } catch {}
    $('#vstup').value = '';
    render();

    const v = await ulozDoRepa(n.soubor, n.zaznam, `feat: ${n.zaznam.nazev}`);
    box.innerHTML = '';
    if (v.ok) {
      box.append(el('div','eyebrow','Uloženo'));
      box.append(el('div','hint','Zapsáno do repozitáře. Web se přebuildí zhruba do minuty a uvidí to i Šárka. Do Google Kalendáře to dorazí s další aktualizací feedu.'));
    } else if (v.duvod === 'bez-tokenu') {
      box.append(el('div','eyebrow','Přidáno jen sem'));
      box.append(el('div','hint','Zatím to vidíš jen ty v tomhle prohlížeči. Vlož blok do ' + n.soubor + ', nebo si v ⚙ nastav ukládání do GitHubu a příště se to uloží samo.'));
      box.append(el('pre','json', JSON.stringify(n.zaznam, null, 2)));
      const cp = el('button','btn','Zkopírovat');
      cp.onclick = () => navigator.clipboard.writeText(JSON.stringify(n.zaznam, null, 2));
      const rr = el('div','row'); rr.append(cp); box.append(rr);
    } else {
      box.append(el('div','eyebrow','Uložení selhalo'));
      box.append(el('div','hint', `${v.duvod}. Zkontroluj repozitář a token v ⚙. Návrh je zatím jen v tomhle prohlížeči.`));
      box.append(el('pre','json', JSON.stringify(n.zaznam, null, 2)));
    }
  };
}

function render() { renderOvladani(); renderHero(); renderKalendar(); renderKnihovna(); renderDoklady(); renderUkoly(); renderTabulky(); }

(async function init() {
  state.data = await nacti();
  state.data.doklady = state.data.doklady || [];
  for (const [klic, cil] of [['akce','events'], ['ukol','ukoly'], ['doklad','doklady']]) {
    try {
      JSON.parse(localStorage.getItem('rk-lokalni-' + klic) || '[]')
        .forEach(e => { if (!state.data[cil].some(x => x.id === e.id)) state.data[cil].push(e); });
    } catch {}
  }

  if (new URLSearchParams(location.search).has('display')) {
    document.body.classList.add('display');
    setTimeout(() => location.reload(), 15 * 60 * 1000);
  }
  const t = localStorage.getItem('rk-tema');
  if (t) document.documentElement.setAttribute('data-theme', t);
  const ulozenyPohled = localStorage.getItem('rk-pohled');
  state.pohled = ulozenyPohled || (window.innerWidth < 760 ? 'tyden' : 'mesic');
  if (document.body.classList.contains('display')) state.pohled = 'mesic';

  const posun = smer => {
    if (state.pohled === 'tyden') state.kurzor = addDays(state.kurzor, 7 * smer);
    else state.kurzor.setMonth(state.kurzor.getMonth() + smer);
    render();
  };
  $('#prev').onclick = () => posun(-1);
  $('#next').onclick = () => posun(1);
  $('#dnes').onclick = () => { state.kurzor = new Date(); render(); };
  document.querySelectorAll('#pohledy button').forEach(b => {
    b.onclick = () => { state.pohled = b.dataset.v; localStorage.setItem('rk-pohled', state.pohled); render(); };
  });
  $('#tema').onclick = () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('rk-tema', next);
  };
  $('#zavri').onclick = () => $('#drawer').removeAttribute('data-open');
  $('#drawer .veil').onclick = () => $('#drawer').removeAttribute('data-open');
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#drawer').removeAttribute('data-open'); });
  $('#navrhni').onclick = () => renderNavrh(parseText($('#vstup').value));
  $('#vstup').addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') renderNavrh(parseText($('#vstup').value));
  });

  // plovoucí tlačítko na mobilu
  $('#fab').onclick = () => {
    $('#sekce-pridat').scrollIntoView({ behavior:'smooth', block:'center' });
    setTimeout(() => $('#vstup').focus(), 350);
  };

  // nastavení ukládání
  const panel = $('#nastaveni');
  const cfg = gh.nacti();
  if (cfg) { $('#gh-repo').value = cfg.repo || ''; $('#gh-token').value = cfg.token || ''; }
  const stav = () => {
    const c = gh.nacti();
    $('#stav-ulozeni').textContent = c && c.repo && c.token
      ? '● ukládá se do ' + c.repo : '○ ukládá se jen do tohohle prohlížeče';
    $('#stav-ulozeni').classList.toggle('ok', !!(c && c.repo && c.token));
  };
  stav();
  $('#nastaveni-btn').onclick = () => { panel.hidden = !panel.hidden; };
  $('#gh-ulozit').onclick = () => {
    gh.uloz({ repo: $('#gh-repo').value.trim(), token: $('#gh-token').value.trim() });
    panel.hidden = true; stav();
  };
  $('#gh-smazat').onclick = () => {
    gh.smaz(); $('#gh-repo').value = ''; $('#gh-token').value = ''; stav();
  };

  $('#stopa').textContent = state.data.config.aktualizovano;
  render();
})();
