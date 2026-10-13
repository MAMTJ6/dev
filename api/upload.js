// POST /api/upload — poster/image upload to the GitHub repo (replaces
// Supabase Storage, which Neon doesn't have).
// Body: { folder: 'posters'|'posters-square'|'profiles'|'announcements',
//         filename, contentBase64, contentType }
// Returns: { path } — repo-relative public path to store in Neon.
// Limits: file < 4MB (Vercel body cap ~4.5MB incl. base64 overhead).
// Needs: kuliah write perm (posters/profiles) or news write perm (announcements).
const { requireAdmin } = require('../lib/db');

const FOLDERS = {
  'posters': 'kuliah/assets/poster-kuliah',
  'posters-square': 'kuliah/assets/poster-kuliah',
  'profiles': 'kuliah/assets/profiles',
  'announcements': 'news/assets/announcements',
};
const MAX_BASE64 = 6_000_000;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { admin, error: authErr } = await requireAdmin(req, null);
  if (authErr) return res.status(authErr).json({ error: 'Unauthorized' });
  const canKuliah = admin.role === 'super_admin' || (admin.role === 'editor' && admin.permissions && admin.permissions.kuliah === true);
  const canNews = admin.role === 'super_admin' || (admin.role === 'editor' && admin.permissions && admin.permissions.news === true);

  const b = req.body || {};
  const dir = FOLDERS[b.folder];
  if (!dir) return res.status(400).json({ error: 'bad folder' });
  if (b.folder === 'announcements' ? !canNews : !canKuliah) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (typeof b.contentBase64 !== 'string' || b.contentBase64.length > MAX_BASE64) {
    return res.status(413).json({ error: 'file too large (max ~4MB)' });
  }
  const safe = String(b.filename || '').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80);
  if (!safe || !/\.(png|jpe?g|webp|gif|svg)$/i.test(safe)) {
    return res.status(400).json({ error: 'bad filename (png/jpg/webp/gif/svg only)' });
  }

  const githubToken = process.env.GITHUB_TOKEN;
  const githubRepo = process.env.GITHUB_REPO;
  if (!githubToken || !githubRepo) {
    return res.status(500).json({ error: 'Server misconfiguration: missing GitHub env vars' });
  }

  const filePath = `${dir}/${Date.now()}-${safe}`;
  const put = await fetch(`https://api.github.com/repos/${githubRepo}/contents/${filePath}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: `[Admin] Upload ${safe}`,
      content: b.contentBase64,
      branch: 'main',
    }),
  });
  if (!put.ok) {
    const err = await put.json().catch(() => ({}));
    return res.status(500).json({ error: 'upload failed', details: err.message || put.statusText });
  }
  return res.status(200).json({ path: `/${filePath}` });
};
