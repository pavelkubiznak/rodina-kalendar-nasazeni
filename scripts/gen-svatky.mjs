// Generuje české státní svátky a významné dny na několik let dopředu.
import fs from 'node:fs';

const FIXED = [
  ['01-01', 'Nový rok / Den obnovy samostatného českého státu', true],
  ['05-01', 'Svátek práce', true],
  ['05-08', 'Den vítězství', true],
  ['07-05', 'Den slovanských věrozvěstů Cyrila a Metoděje', true],
  ['07-06', 'Den upálení mistra Jana Husa', true],
  ['09-28', 'Den české státnosti', true],
  ['10-28', 'Den vzniku samostatného československého státu', true],
  ['11-17', 'Den boje za svobodu a demokracii', true],
  ['12-24', 'Štědrý den', true],
  ['12-25', '1. svátek vánoční', true],
  ['12-26', '2. svátek vánoční', true],
  // významné dny (nejsou dny pracovního klidu)
  ['12-05', 'Mikuláš', false],
  ['12-31', 'Silvestr', false],
  ['02-14', 'Valentýn', false],
  ['10-31', 'Halloween', false],
];

// Gaussův algoritmus – Velikonoční neděle (gregoriánský kalendář)
function easterSunday(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}
const iso = (d) => d.toISOString().slice(0, 10);
const shift = (d, n) => new Date(d.getTime() + n * 86400000);

const roky = [2026, 2027, 2028, 2029];
const out = [];
for (const y of roky) {
  for (const [md, nazev, volno] of FIXED) out.push({ datum: `${y}-${md}`, nazev, volno });
  const ne = easterSunday(y);
  out.push({ datum: iso(shift(ne, -2)), nazev: 'Velký pátek', volno: true });
  out.push({ datum: iso(ne), nazev: 'Velikonoční neděle', volno: false });
  out.push({ datum: iso(shift(ne, 1)), nazev: 'Velikonoční pondělí', volno: true });
  // Den matek = 2. neděle v květnu
  const kveten = new Date(Date.UTC(y, 4, 1));
  const prvniNe = (7 - kveten.getUTCDay()) % 7;
  out.push({ datum: iso(new Date(Date.UTC(y, 4, 1 + prvniNe + 7))), nazev: 'Den matek', volno: false });
}
out.sort((a, b) => a.datum.localeCompare(b.datum));
fs.writeFileSync('data/svatky.json', JSON.stringify(out, null, 1) + '\n');
console.log(`Vygenerováno ${out.length} záznamů (${roky[0]}–${roky.at(-1)}).`);
