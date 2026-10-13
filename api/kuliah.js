// /api/kuliah?action=... — kuliah data layer on Neon (replaces direct
// supabase-js calls from admin/kuliah/*.js). Single function (Hobby limit).
// Reads need any admin login; writes need kuliah permission.
// GET:
//   schedule&month=YYYY-MM  → { ustaz:[...], rows:[...] } for the month
//   ustaz                   → full ustaz registry (all columns)
//   last-published&label=.. → latest publish activity_log row or null
// POST (JSON body):
//   day {row}               → upsert one schedule day (date conflict key)
//   upsert-days {rows:[..]} → bulk upsert (Salin Data)
//   clear {start,end}       → delete month range
//   ustaz-save {row}        → insert (no id) or update (id); 409 on short_name clash
//   ustaz-delete {id}       → 409 if still referenced by schedule
//   log {action,target_label,detail,table?} → activity_log insert (fire-and-forget)
const { sql, requireAdmin } = require('../lib/db');

const USTAZ_COLS = 'id, short_name, full_name, tajuk_kuliah, poster_url, square_url, jawatan, profile_url, is_public';
const SCHED_COLS =
  'date, cuti_umum, subuh_ustaz_id, maghrib_ustaz_id, subuh_pending, maghrib_pending, subuh_khas, maghrib_khas, subuh_ditangguhkan, maghrib_ditangguhkan';

function monthRange(month) {  const m = /^(\d{4})-(\d{2})$/.exec(month || '');
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  if (mo < 1 || mo > 12) return null;
  const last = new Date(y, mo, 0).getDate();
  const p = String(mo).padStart(2, '0');
  return { start: `${m[1]}-${p}-01`, end: `${m[1]}-${p}-${String(last).padStart(2, '0')}` };
}

// Neon may return DATE as a Date object (serializes to full ISO datetime).
// Frontend keys scheduleMap by YYYY-MM-DD, so normalize here.
function dateStr(d) {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

module.exports = async function handler(req, res) {
  const action = (req.query && req.query.action) || '';
  const reading = req.method === 'GET' && (action === 'schedule' || action === 'ustaz' || action === 'last-published');
  const { admin, error } = await requireAdmin(req, reading ? null : 'kuliah');
  if (error) return res.status(error).json({ error: 'unauthorized' });

  try {
    // ── GET: month schedule + ustaz ──
    if (req.method === 'GET' && action === 'schedule') {
      const r = monthRange(req.query.month);
      if (!r) return res.status(400).json({ error: 'bad month' });
      const ulist = await sql()`SELECT id, short_name, full_name, tajuk_kuliah, poster_url FROM ustaz`;
      const schedRaw = await sql()`SELECT date, cuti_umum, subuh_ustaz_id, maghrib_ustaz_id, subuh_pending, maghrib_pending, subuh_khas, maghrib_khas, subuh_ditangguhkan, maghrib_ditangguhkan FROM schedule WHERE date >= ${r.start} AND date <= ${r.end} ORDER BY date`;
      const rows = schedRaw.map(row => ({ ...row, date: dateStr(row.date) }));
      return res.status(200).json({ ustaz: ulist, rows });
    }
    // ── GET: full ustaz registry ──
    if (req.method === 'GET' && action === 'ustaz') {
      const rows = await sql()`SELECT id, short_name, full_name, tajuk_kuliah, poster_url, square_url, jawatan, profile_url, is_public FROM ustaz`;
      return res.status(200).json({ ustaz: rows });
    }
    // ── GET: last publish note (kuliah month publish, or publish_ustaz) ──
    if (req.method === 'GET' && action === 'last-published') {
      const label = String(req.query.label || '');
      const logAction = req.query.logAction === 'publish_ustaz' ? 'publish_ustaz' : 'publish';
      const rows = await sql()`SELECT created_at, actor_name, actor_email FROM activity_log WHERE action = ${logAction} AND target_label = ${label} ORDER BY created_at DESC LIMIT 1`;
      return res.status(200).json({ row: rows[0] || null });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const b = req.body || {};
    // ── POST: upsert one day ──
    if (action === 'day') {
      const r = b.row || {};
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date || '')) return res.status(400).json({ error: 'bad date' });
      await sql()`INSERT INTO schedule (date, subuh_ustaz_id, maghrib_ustaz_id, subuh_pending, maghrib_pending, subuh_khas, maghrib_khas, subuh_ditangguhkan, maghrib_ditangguhkan, cuti_umum, updated_at)
        VALUES (${r.date}, ${r.subuh_ustaz_id || null}, ${r.maghrib_ustaz_id || null}, ${!!r.subuh_pending}, ${!!r.maghrib_pending}, ${!!r.subuh_khas}, ${!!r.maghrib_khas}, ${!!r.subuh_ditangguhkan}, ${!!r.maghrib_ditangguhkan}, ${r.cuti_umum || null}, NOW())
        ON CONFLICT (date) DO UPDATE SET subuh_ustaz_id = EXCLUDED.subuh_ustaz_id, maghrib_ustaz_id = EXCLUDED.maghrib_ustaz_id, subuh_pending = EXCLUDED.subuh_pending, maghrib_pending = EXCLUDED.maghrib_pending, subuh_khas = EXCLUDED.subuh_khas, maghrib_khas = EXCLUDED.maghrib_khas, subuh_ditangguhkan = EXCLUDED.subuh_ditangguhkan, maghrib_ditangguhkan = EXCLUDED.maghrib_ditangguhkan, cuti_umum = EXCLUDED.cuti_umum, updated_at = NOW()`;
      return res.status(200).json({ ok: true });
    }
    // ── POST: bulk upsert (Salin Data) ──
    if (action === 'upsert-days') {
      const rows = Array.isArray(b.rows) ? b.rows : [];
      if (!rows.length) return res.status(400).json({ error: 'empty' });
      for (const r of rows) {
        await sql()`INSERT INTO schedule (date, subuh_ustaz_id, maghrib_ustaz_id, updated_at)
          VALUES (${r.date}, ${r.subuh_ustaz_id || null}, ${r.maghrib_ustaz_id || null}, NOW())
          ON CONFLICT (date) DO UPDATE SET subuh_ustaz_id = EXCLUDED.subuh_ustaz_id, maghrib_ustaz_id = EXCLUDED.maghrib_ustaz_id, updated_at = NOW()`;
      }
      return res.status(200).json({ ok: true, count: rows.length });
    }
    // ── POST: clear month ──
    if (action === 'clear') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(b.end || ''))
        return res.status(400).json({ error: 'bad range' });
      await sql()`DELETE FROM schedule WHERE date >= ${b.start} AND date <= ${b.end}`;
      return res.status(200).json({ ok: true });
    }
    // ── POST: ustaz save ──
    if (action === 'ustaz-save') {
      const r = b.row || {};
      if (!r.short_name || !r.full_name) return res.status(400).json({ error: 'short_name + full_name required' });
      try {
        if (r.id) {
          await sql()`UPDATE ustaz SET short_name = ${r.short_name}, full_name = ${r.full_name}, tajuk_kuliah = ${r.tajuk_kuliah || null}, poster_url = ${r.poster_url || null}, square_url = ${r.square_url || null}, jawatan = ${r.jawatan || null}, profile_url = ${r.profile_url || null}, is_public = ${r.is_public !== false}, updated_at = NOW() WHERE id = ${r.id}`;
        } else {
          await sql()`INSERT INTO ustaz (short_name, full_name, tajuk_kuliah, poster_url, square_url, jawatan, profile_url, is_public) VALUES (${r.short_name}, ${r.full_name}, ${r.tajuk_kuliah || null}, ${r.poster_url || null}, ${r.square_url || null}, ${r.jawatan || null}, ${r.profile_url || null}, ${r.is_public !== false})`;
        }
      } catch (e) {
        if (String(e.message || '').includes('duplicate') || String(e.code) === '23505')
          return res.status(409).json({ error: 'short_name taken' });
        throw e;
      }
      return res.status(200).json({ ok: true });
    }
    // ── POST: ustaz delete (blocked if referenced) ──
    if (action === 'ustaz-delete') {
      if (!b.id) return res.status(400).json({ error: 'missing id' });
      const refs = await sql()`SELECT COUNT(*)::int AS n FROM schedule WHERE subuh_ustaz_id = ${b.id} OR maghrib_ustaz_id = ${b.id}`;
      if (b.checkOnly) return res.status(200).json({ ok: true, count: refs[0].n });
      if (refs[0].n > 0) return res.status(409).json({ error: 'referenced', count: refs[0].n });
      await sql()`DELETE FROM ustaz WHERE id = ${b.id}`;
      return res.status(200).json({ ok: true });
    }
    // ── POST: activity log (never fails the caller) ──
    if (action === 'log') {
      const entry = {
        email: admin.email,
        name: admin.name || null,
        act: b.action || 'note',
        label: b.target_label || null,
        detail: b.detail || null,
      };
      try {
        if (b.table === 'infaq_activity_log') {
          await sql()`INSERT INTO infaq_activity_log (actor_email, actor_name, action, target_label, detail) VALUES (${entry.email}, ${entry.name}, ${entry.act}, ${entry.label}, ${entry.detail})`;
        } else if (b.table === 'news_activity_log') {
          await sql()`INSERT INTO news_activity_log (actor_email, actor_name, action, target_label, detail) VALUES (${entry.email}, ${entry.name}, ${entry.act}, ${entry.label}, ${entry.detail})`;
        } else {
          await sql()`INSERT INTO activity_log (actor_email, actor_name, action, target_label, detail) VALUES (${entry.email}, ${entry.name}, ${entry.act}, ${entry.label}, ${entry.detail})`;
        }
      } catch (e) {
        console.error('log insert failed:', e.message);
      }
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    console.error('/api/kuliah failed:', e);
    return res.status(500).json({ error: 'server error', details: e.message });
  }
};

