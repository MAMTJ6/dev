// POST /api/upload — image upload to Supabase Storage (Neon has no Storage).
// Body: { folder: 'posters'|'posters-square'|'profiles'|'announcements',
//         filename, contentBase64, contentType }
// Returns: { path } — public https URL to store in Neon (TEXT column).
// Limits: file < 4MB (Vercel body cap ~4.5MB incl. base64 overhead).
// Needs: kuliah write perm (posters/profiles) or news write perm (announcements).
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (server only, never exposed).
const { requireAdmin } = require('../lib/db');

// folder -> { bucket, prefix } in Supabase Storage (all buckets Public).
const FOLDERS = {
  'posters':         { bucket: 'posters',       prefix: '' },
  'posters-square':  { bucket: 'posters',       prefix: 'square/' },
  'profiles':       { bucket: 'profiles',      prefix: '' },
  'announcements':   { bucket: 'announcements', prefix: '' },
};
const MAX_BASE64 = 6_000_000;
const ALLOWED_EXT = /\.(png|jpe?g|webp|gif|svg)$/i;
const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml',
]);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { admin, error: authErr } = await requireAdmin(req, null);
  if (authErr) return res.status(authErr).json({ error: 'Unauthorized' });
  const canKuliah = admin.role === 'super_admin' || (admin.role === 'editor' && admin.permissions && admin.permissions.kuliah === true);
  const canNews = admin.role === 'super_admin' || (admin.role === 'editor' && admin.permissions && admin.permissions.news === true);

  const b = req.body || {};
  const target = FOLDERS[b.folder];
  if (!target) return res.status(400).json({ error: 'bad folder' });
  if (b.folder === 'announcements' ? !canNews : !canKuliah) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (typeof b.contentBase64 !== 'string' || b.contentBase64.length > MAX_BASE64) {
    return res.status(413).json({ error: 'file too large (max ~4MB)' });
  }
  const safe = String(b.filename || '').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80);
  if (!safe || !ALLOWED_EXT.test(safe)) {
    return res.status(400).json({ error: 'bad filename (png/jpg/webp/gif/svg only)' });
  }
  const contentType = String(b.contentType || '');
  if (contentType && !ALLOWED_MIME.has(contentType)) {
    return res.status(400).json({ error: 'bad content type' });
  }

  const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Server misconfiguration: missing Supabase env vars' });
  }

  let buf;
  try {
    buf = Buffer.from(b.contentBase64, 'base64');
  } catch {
    return res.status(400).json({ error: 'bad base64' });
  }
  if (!buf.length) return res.status(400).json({ error: 'empty file' });

  const objectPath = `${target.prefix}${Date.now()}-${safe}`;
  const put = await fetch(
    `${supabaseUrl}/storage/v1/object/${target.bucket}/${objectPath}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        'Content-Type': contentType || 'application/octet-stream',
        'x-upsert': 'false',
      },
      body: buf,
    }
  );
  if (!put.ok) {
    const errText = await put.text().catch(() => '');
    return res.status(500).json({ error: 'upload failed', details: errText.slice(0, 300) || put.statusText });
  }
  const publicUrl = `${supabaseUrl}/storage/v1/object/public/${target.bucket}/${objectPath}`;
  return res.status(200).json({ path: publicUrl });
};
