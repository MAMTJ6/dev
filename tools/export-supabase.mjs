// Rescue dump from old Supabase via REST (service_role key).
// Run:  $env:SUPABASE_URL="https://qeantrmluevgybkwgvbq.supabase.co"
//       $env:SUPABASE_SERVICE_ROLE_KEY="<from Vercel Dashboard → Project → Settings → Environment Variables>"
//       node tools/export-supabase.mjs
// Output: tools/backup/<table>.json + image-urls.json (poster/image manifest).
// Needs Node 18+ (global fetch). No npm install. Read-only: never writes to Supabase.
import { writeFile, mkdir } from 'node:fs/promises';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.');
  process.exit(1);
}

const TABLES = [
  'admins', 'ustaz', 'schedule', 'activity_log',
  'infaq_projects', 'infaq_kutipan_mingguan', 'infaq_projek_kutipan',
  'infaq_perbelanjaan_bulanan', 'infaq_activity_log',
  'news_announcements', 'news_ticker', 'news_settings', 'news_activity_log',
  'staff', 'staff_activity_log',
  'khutbah_weeks', 'khutbah_settings', 'khutbah_activity_log',
  'calendar_activity_log',
];

async function getTable(name) {
  // Paginate: PostgREST defaults to 1000 rows per request.
  const rows = [];
  let from = 0;
  const size = 1000;
  for (;;) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${name}?select=*&offset=${from}&limit=${size}&order=created_at`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json' } }
    );
    if (!res.ok) {
      // Tables without created_at (e.g. news_settings) reject the order param — retry plain.
      const retry = await fetch(`${SUPABASE_URL}/rest/v1/${name}?select=*&offset=${from}&limit=${size}`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json' },
      });
      if (!retry.ok) throw new Error(`${name}: ${retry.status} ${await retry.text()}`);
      const batch = await retry.json();
      rows.push(...batch);
      if (batch.length < size) return rows;
      from += size;
      continue;
    }
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < size) return rows;
    from += size;
  }
}

await mkdir(new URL('./backup', import.meta.url), { recursive: true });
const summary = {};
for (const t of TABLES) {
  try {
    const rows = await getTable(t);
    await writeFile(new URL(`./backup/${t}.json`, import.meta.url), JSON.stringify(rows, null, 2));
    summary[t] = rows.length;
    console.log(`${t}: ${rows.length} rows`);
  } catch (e) {
    summary[t] = `ERROR: ${e.message}`;
    console.error(`${t}: FAILED — ${e.message}`);
  }
}

// Collect every stored image URL so posters can be downloaded into the repo
// (Neon has no Storage — images live at kuliah/assets/poster-kuliah/ etc).
const imgs = new Set();
const pick = (v) => { if (typeof v === 'string' && /^https?:\/\//.test(v) && v.includes('supabase')) imgs.add(v); };
try {
  const { readFile } = await import('node:fs/promises');
  for (const f of ['ustaz.json', 'news_announcements.json']) {
    try {
      const rows = JSON.parse(await readFile(new URL(`./backup/${f}`, import.meta.url), 'utf8'));
      rows.forEach((r) => ['poster_url', 'square_url', 'profile_url', 'image_url'].forEach((k) => pick(r[k])));
    } catch { /* table may have failed above — skip */ }
  }
} catch { /* ignore */ }
await writeFile(new URL('./backup/image-urls.json', import.meta.url), JSON.stringify([...imgs], null, 2));
console.log(`\nImage URLs: ${imgs.size} (see tools/backup/image-urls.json)`);
await writeFile(new URL('./backup/_summary.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), summary }, null, 2));
console.log('Done. DO NOT commit tools/backup/ if it contains staff emails/PIN hashes — keep it local + USB.');
