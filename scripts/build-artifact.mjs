/* Vyrobí jednosouborový náhled (artifact.html) s daty i kódem uvnitř. */
import fs from 'node:fs';
const css = fs.readFileSync('assets/style.css', 'utf8');
const js  = fs.readFileSync('assets/app.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const telo = html.split('<body>')[1].split('</body>')[0]
  .replace('<script src="assets/app.js"></script>', '');
const data = {};
for (const n of ['config','people','krouzky','events','rozvrhy','narozeniny','svatky','ukoly','doklady','knihovna','knihovna-plan'])
  data[n] = JSON.parse(fs.readFileSync(`data/${n}.json`, 'utf8'));

const out = `<title>Rodinný kalendář Kubizňákových</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,500;8..60,600&display=swap" rel="stylesheet">
<style>
${css}
</style>
${telo}
<script>window.__DATA__ = ${JSON.stringify(data)};</script>
<script>
${js}
</script>
`;
fs.writeFileSync('artifact.html', out);
console.log('artifact.html', (out.length / 1024).toFixed(0) + ' kB');
