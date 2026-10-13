// Rescue dump via the BROWSER — no keys needed.
// 1. Open https://dev.mamtj6.com/admin/kuliah/jadual.html and log in with Google.
// 2. Press F12 → Console tab.
// 3. Copy ALL of this file, paste into Console, press Enter.
// 4. A file backup-supabase-YYYY-MM-DD.json downloads automatically.
// Read-only: only SELECTs, never writes.
(async () => {
  const client = typeof db !== 'undefined' ? db : null;
  if (!client) {
    console.error('No supabase client found. Make sure you are logged in on an /admin/ page, then retry.');
    return;
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
  const out = {};
  for (const t of TABLES) {
    const rows = [];
    let from = 0;
    const size = 1000;
    for (;;) {
      const { data, error } = await client.from(t).select('*').range(from, from + size - 1);
      if (error) { console.error(t + ' FAILED: ' + error.message); out[t] = null; break; }
      rows.push(...(data || []));
      if (!data || data.length < size) break;
      from += size;
    }
    if (out[t] !== null) { out[t] = rows; console.log(t + ': ' + rows.length + ' rows'); }
  }
  const imgs = [];
  (out.ustaz || []).forEach((r) => ['poster_url', 'square_url', 'profile_url'].forEach((k) => {
    if (typeof r[k] === 'string' && r[k].includes('supabase')) imgs.push(r[k]);
  }));
  (out.news_announcements || []).forEach((r) => {
    if (typeof r.image_url === 'string' && r.image_url.includes('supabase')) imgs.push(r.image_url);
  });
  out._image_urls = [...new Set(imgs)];
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'backup-supabase-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  console.log('DONE. Image URLs: ' + out._image_urls.length);
})();
