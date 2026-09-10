// Sestavi HTML plakat 3840x2160 z datoveho objektu.
// Typografie je vyladena na 65" ze vzdalenosti ~3 m - vsechny velikosti
// vychazi z toho, ze 1 px na 65" 4K = 0,375 mm. Pod 40 px uz to z gauce nikdo neprecte.

const esc = s => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

const ev = e => `<div class="ev${e.hi ? " hi" : ""}">
  <div class="t">${esc(e.cas ?? "")}</div>
  <div class="txt">${e.kdo ? `<span class="who">${esc(e.kdo)}</span>` : ""}${esc(e.text)}
  ${e.pozn ? `<span class="note">${esc(e.pozn)}</span>` : ""}</div></div>`;

const row = r => `<div class="row${r.warn ? " warn" : ""}">
  <div class="d">${esc(r.den)}</div>
  <div class="v">${esc(r.text)}${r.pozn ? `<small>${esc(r.pozn)}</small>` : ""}</div></div>`;

const soon = s => `<div class="sitem">
  <div class="dd">${esc(s.datum)}</div>
  <div class="ss">${esc(s.text)}${s.pozn ? `<small>${esc(s.pozn)}</small>` : ""}</div></div>`;

const trip = t => `<div class="trip">
  <div class="n">${esc(t.dni)}</div>
  <div class="l"><b>${esc(t.kam)}</b>${esc(t.pozn)}</div></div>`;

export function plakat(d) {
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#15171b;--ink:#f3efe6;--mut:#8b8578;--dim:#5c5a54;--acc:#d3a259;--line:#2b2d33}
html,body{width:3840px;height:2160px;background:var(--bg);color:var(--ink);
  font-family:"Liberation Sans","Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
body{padding:150px 170px 130px;display:flex;flex-direction:column}
.top{display:flex;justify-content:space-between;align-items:flex-start}
.eyebrow{font-size:40px;letter-spacing:.42em;color:var(--dim);text-transform:uppercase}
.stamp{font-size:38px;color:var(--dim);letter-spacing:.06em}
.main{display:flex;gap:150px;flex:1;margin-top:96px}
.today{width:56%;display:flex;flex-direction:column}
.dayname{font-family:Lora,Georgia,"Liberation Serif",serif;font-size:230px;line-height:.94;letter-spacing:-.015em}
.daydate{font-size:62px;color:var(--mut);margin-top:34px;letter-spacing:.05em}
.events{margin-top:88px}
.ev{display:flex;align-items:baseline;gap:44px;padding:36px 0;border-top:2px solid var(--line)}
.ev:last-child{border-bottom:2px solid var(--line)}
.ev .t{font-size:60px;color:var(--mut);min-width:330px;font-variant-numeric:tabular-nums}
.ev .txt{font-size:62px;line-height:1.24}
.ev .who{display:inline-block;font-size:34px;letter-spacing:.22em;color:var(--dim);
  border:2px solid var(--line);border-radius:8px;padding:9px 18px 7px;margin-right:22px;position:relative;top:-10px}
.ev.hi .txt,.ev.hi .t{color:var(--acc)}
.ev .note{display:block;font-size:40px;color:var(--mut);margin-top:12px}
.trips{margin-top:auto;padding-top:70px}
.trip{display:flex;align-items:baseline;gap:40px;padding:26px 0}
.trip .n{font-family:Lora,Georgia,serif;font-size:96px;line-height:1;color:var(--dim);min-width:190px;font-variant-numeric:tabular-nums}
.trip .l{font-size:48px;color:var(--mut);line-height:1.3}
.trip .l b{color:var(--ink);font-weight:400;display:block;font-size:52px;margin-bottom:6px}
.side{width:44%;display:flex;flex-direction:column}
.h{font-size:38px;letter-spacing:.4em;color:var(--dim);text-transform:uppercase;padding-bottom:30px;border-bottom:2px solid var(--line)}
.row{display:flex;gap:40px;padding:34px 0;border-bottom:2px solid var(--line);align-items:baseline}
.row .d{font-size:46px;color:var(--mut);min-width:220px}
.row .v{font-size:50px;line-height:1.26}
.row .v small{display:block;font-size:38px;color:var(--mut);margin-top:8px}
.row.warn .v{color:var(--acc)}
.soon{margin-top:110px}
.sitem{display:flex;gap:40px;padding:30px 0;border-bottom:2px solid var(--line);align-items:baseline}
.sitem .dd{font-size:46px;color:var(--acc);min-width:220px;font-variant-numeric:tabular-nums}
.sitem .ss{font-size:48px;line-height:1.24}
.sitem .ss small{display:block;font-size:36px;color:var(--mut);margin-top:6px}
</style></head><body>
<div class="top"><div class="eyebrow">Rodinný kalendář</div><div class="stamp">${esc(d.razitko)}</div></div>
<div class="main">
  <div class="today">
    <div class="dayname">${esc(d.den)}</div>
    <div class="daydate">${esc(d.datum)}</div>
    <div class="events">${(d.dnes ?? []).map(ev).join("")}</div>
    ${d.cesty?.length ? `<div class="trips"><div class="h">Cesty</div>${d.cesty.map(trip).join("")}</div>` : ""}
  </div>
  <div class="side">
    <div class="h">${esc(d.nadpisVpravo ?? "Zbytek týdne")}</div>${(d.dalsiDny ?? []).map(row).join("")}
    ${d.blizi?.length ? `<div class="soon"><div class="h">Blíží se</div>${d.blizi.map(soon).join("")}</div>` : ""}
  </div>
</div></body></html>`;
}
