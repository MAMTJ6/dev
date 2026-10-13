// Shared Neon + session helper for api/*.js.
// Lives OUTSIDE api/ on purpose: every file under api/ becomes a live Vercel
// route (same reason admin/news/publish-news-pure.js lives outside api/).
// Zero extra deps: neon driver (package.json) + node:crypto + global fetch.
const { neon } = require('@neondatabase/serverless');
const crypto = require('node:crypto');

let _sql = null;
function sql() {
  if (!_sql) {
    if (!process.env.NEON_DATABASE_URL) throw new Error('missing NEON_DATABASE_URL');
    _sql = neon(process.env.NEON_DATABASE_URL);
  }
  return _sql;
}

// Session JWT: base64url(payload).hex_hmac_sha256 — payload { email, name, exp }.
// Stored in HttpOnly cookie `mamtj6_session`, 12h expiry.
function signSession(payload) {
  if (!process.env.AUTH_SECRET) throw new Error('missing AUTH_SECRET');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', process.env.AUTH_SECRET).update(body).digest('hex');
  return `${body}.${sig}`;
}

function verifySession(token) {
  if (!token || !process.env.AUTH_SECRET) return null;
  const parts = String(token).split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const want = crypto.createHmac('sha256', process.env.AUTH_SECRET).update(body).digest('hex');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(want, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!p.exp || Date.now() > p.exp) return null;
    return p;
  } catch {
    return null;
  }
}

function getCookie(req, name) {
  const h = (req.headers && req.headers.cookie) || '';
  const m = h.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

// Returns { admin } or { error: 401|403, admin? }.
// moduleKey set = also enforce write access (super_admin, or editor+permission).
// Mirrors old app.js canWriteModule() + setup.sql admin_can_write().
async function requireAdmin(req, moduleKey) {
  const sess = verifySession(getCookie(req, 'mamtj6_session'));
  if (!sess || !sess.email) return { error: 401 };
  const rows = await sql()`SELECT email, name, role, permissions FROM admins WHERE email ILIKE ${sess.email} LIMIT 1`;
  const admin = rows[0] || null;
  if (!admin) return { error: 403 };
  if (moduleKey) {
    const ok =
      admin.role === 'super_admin' ||
      (admin.role === 'editor' && admin.permissions && admin.permissions[moduleKey] === true);
    if (!ok) return { error: 403, admin };
  }
  return { admin };
}

module.exports = { sql, signSession, verifySession, getCookie, requireAdmin };
