/* Přihlášení ke Google Calendar API přes service account.
   Klíč čte z proměnné GOOGLE_SA_KEY (celý JSON, jak ho stáhne Google Cloud).
   Žádná knihovna — JWT se podepisuje nodí crypto, token platí hodinu. */
import crypto from 'node:crypto';

export const KAL = {
  // kam píše člověk (jen čteme)
  rucni: '2e353d2ebce2f69421426398bfeeddc9fced97e446ec27d7de1cf264f4c81633@group.calendar.google.com',
  // kam píše robot z dat v gitu (čteme i zapisujeme)
  auto: '629c4eb8e076dc92556eb84b294f5e4f1c996c4a4bcec1c3e215485a021acab4@group.calendar.google.com',
};

const b64 = v => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

function klic() {
  const raw = process.env.GOOGLE_SA_KEY;
  if (!raw) throw new Error('Chybí GOOGLE_SA_KEY — nastav ho v Settings → Secrets and variables → Actions.');
  try { return JSON.parse(raw); }
  catch { throw new Error('GOOGLE_SA_KEY není platný JSON — vlož celý obsah staženého souboru včetně závorek.'); }
}

let cache = null;
export async function token() {
  if (cache && cache.do > Date.now() + 60000) return cache.t;
  const k = klic();
  const ted = Math.floor(Date.now() / 1000);
  const hlava = b64({ alg: 'RS256', typ: 'JWT' });
  const telo = b64({
    iss: k.client_email,
    scope: 'https://www.googleapis.com/auth/calendar',
    aud: 'https://oauth2.googleapis.com/token',
    iat: ted, exp: ted + 3600,
  });
  const podpis = crypto.createSign('RSA-SHA256').update(`${hlava}.${telo}`).sign(k.private_key).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${hlava}.${telo}.${podpis}`,
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Google nevydal token (${r.status}): ${JSON.stringify(j)}`);
  cache = { t: j.access_token, do: Date.now() + (j.expires_in - 60) * 1000 };
  return cache.t;
}

/* Jedno volání Calendar API. cesta začíná lomítkem, např. '/calendars/x/events'. */
export async function api(metoda, cesta, telo) {
  const t = await token();
  const r = await fetch(`https://www.googleapis.com/calendar/v3${cesta}`, {
    method: metoda,
    headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
    body: telo ? JSON.stringify(telo) : undefined,
  });
  if (r.status === 204) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(`${metoda} ${cesta} → ${r.status}: ${j.error?.message || JSON.stringify(j)}`);
    e.status = r.status;
    throw e;
  }
  return j;
}

/* Stránkovaný výpis událostí. */
export async function udalosti(kalendar, params) {
  const out = [];
  let pageToken;
  do {
    const q = new URLSearchParams({ maxResults: '2500', ...params, ...(pageToken ? { pageToken } : {}) });
    const j = await api('GET', `/calendars/${encodeURIComponent(kalendar)}/events?${q}`);
    out.push(...(j.items || []));
    pageToken = j.nextPageToken;
  } while (pageToken);
  return out;
}
