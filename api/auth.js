// GET /api/auth?action=login|callback|logout|me|users|logs — Google OAuth
// session auth + super-admin identity management (users) + activity-log
// reader (logs). Single file because Vercel Hobby allows max 12 serverless
// functions — this is the identity module, the natural home for the admins
// table (same reason requireAdmin() lives in lib/db.js).
// Needs Vercel env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_URL,
// NEON_DATABASE_URL, AUTH_SECRET.
const crypto = require('node:crypto');
const { sql, signSession, verifySession, getCookie, requireAdmin } = require('../lib/db');

const SESSION_COOKIE = 'mamtj6_session';
const STATE_COOKIE = 'mamtj6_oauth_state';

function appUrl() {
  return (process.env.APP_URL || '').replace(/\/$/, '');
}

async function doLogin(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const base = appUrl();
  if (!clientId || !base) return res.status(500).json({ error: 'missing GOOGLE_CLIENT_ID or APP_URL' });
  const state = crypto.randomBytes(16).toString('hex');
  const cookies = [`${STATE_COOKIE}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`];
  // Optional ?next=/admin/... return path (validated same-origin admin path only).
  const next = typeof req.query.next === 'string' && /^\/admin\/[a-zA-Z0-9/_.?-]*$/.test(req.query.next)
    ? req.query.next
    : null;
  if (next) cookies.push(`mamtj6_next=${encodeURIComponent(next)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  res.setHeader('Set-Cookie', cookies);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${base}/api/auth?action=callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}

async function doCallback(req, res) {
  const base = appUrl();
  const fail = (msg) => res.redirect(302, `${base || ''}/admin/index.html?denied=1&err=${encodeURIComponent(msg)}`);
  const { code, state } = req.query || {};
  if (!code || !state || state !== getCookie(req, STATE_COOKIE)) return fail('bad_state');
  res.setHeader('Set-Cookie', `${STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${base}/api/auth?action=callback`,
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!tokenRes.ok) return fail('token_exchange');

  const tokens = await tokenRes.json();
  const meRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!meRes.ok) return fail('userinfo');
  const me = await meRes.json();
  if (!me.email) return fail('no_email');

  let admin = null;
  try {
    const rows = await sql()`SELECT email, name, role FROM admins WHERE email ILIKE ${me.email} LIMIT 1`;
    admin = rows[0] || null;
  } catch (e) {
    return res.status(500).json({ error: 'database unavailable' });
  }
  if (!admin) return fail('not_admin');

  const jwt = signSession({ email: admin.email, name: admin.name || me.name || null, exp: Date.now() + 12 * 3600 * 1000 });
  const next = getCookie(req, 'mamtj6_next');
  const dest =
    next && /^\/admin\/[a-zA-Z0-9/_.?-]*$/.test(next) ? next : `${base}/admin/dashboard.html`;
  res.setHeader('Set-Cookie', [
    `${SESSION_COOKIE}=${encodeURIComponent(jwt)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`,
    'mamtj6_next=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
  ]);
  res.redirect(302, dest);
}

async function doLogout(req, res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  res.redirect(302, '/admin/index.html');
}

async function doMe(req, res) {
  const { admin, error } = await requireAdmin(req, null);
  if (error) return res.status(error).json({ error: 'unauthorized' });
  const rows = await sql()`SELECT email, name, role, permissions FROM admins WHERE email ILIKE ${admin.email} LIMIT 1`;
  res.status(200).json(rows[0]);
}

function needSuperAdmin(admin) {
  return admin && admin.role === 'super_admin';
}

const VALID_ROLES = new Set(['editor', 'super_admin', 'viewer']);

// GET users — full admins list for users.html + userlog.html filter dropdown.
async function doUsers(req, res) {
  const { admin, error } = await requireAdmin(req, null);
  if (error) return res.status(error).json({ error: 'unauthorized' });
  if (!needSuperAdmin(admin)) return res.status(403).json({ error: 'forbidden' });
  const rows = await sql()`SELECT email, name, role, permissions, created_at FROM admins ORDER BY created_at ASC`;
  res.status(200).json({ users: rows });
}

// POST save-user { user: { email, name, role, permissions, originalEmail? } }
// Insert when no originalEmail, update (by original email) otherwise.
async function doSaveUser(req, res) {
  const { admin, error } = await requireAdmin(req, null);
  if (error) return res.status(error).json({ error: 'unauthorized' });
  if (!needSuperAdmin(admin)) return res.status(403).json({ error: 'forbidden' });
  const u = (req.body && req.body.user) || {};
  const email = String(u.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'bad email' });
  if (!VALID_ROLES.has(u.role)) return res.status(400).json({ error: 'bad role' });
  const perms = u.role === 'super_admin' ? {} : (u.permissions && typeof u.permissions === 'object' ? u.permissions : {});
  try {
    if (u.originalEmail) {
      await sql()`UPDATE admins SET name = ${u.name ? String(u.name).trim() || null : null}, role = ${u.role}, permissions = ${JSON.stringify(perms)}::jsonb WHERE email ILIKE ${String(u.originalEmail)}`;
    } else {
      await sql()`INSERT INTO admins (email, name, role, permissions) VALUES (${email}, ${u.name ? String(u.name).trim() || null : null}, ${u.role}, ${JSON.stringify(perms)}::jsonb)`;
    }
  } catch (e) {
    if (String(e.message || '').includes('duplicate') || String(e.code) === '23505')
      return res.status(409).json({ error: 'email taken' });
    throw e;
  }
  res.status(200).json({ ok: true });
}

// POST delete-user { email } — self-delete blocked server-side (the UI hides
// the button, but that alone is bypassable from devtools).
async function doDeleteUser(req, res) {
  const { admin, error } = await requireAdmin(req, null);
  if (error) return res.status(error).json({ error: 'unauthorized' });
  if (!needSuperAdmin(admin)) return res.status(403).json({ error: 'forbidden' });
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'missing email' });
  if (email === String(admin.email || '').toLowerCase())
    return res.status(400).json({ error: 'cannot delete self' });
  await sql()`DELETE FROM admins WHERE email ILIKE ${email}`;
  res.status(200).json({ ok: true });
}

const LOG_TABLES = new Set([
  'activity_log',
  'calendar_activity_log',
  'infaq_activity_log',
  'news_activity_log',
  'staff_activity_log',
  'khutbah_activity_log',
]);

// GET logs?table=&limit=&actor=&logAction=&from=&to= — one table per call;
// userlog.html fans out one call per table and merges client-side (same
// shape as the old per-table supabase queries). Null filters are no-ops.
async function doLogs(req, res) {
  const { admin, error } = await requireAdmin(req, null);
  if (error) return res.status(error).json({ error: 'unauthorized' });
  if (!needSuperAdmin(admin)) return res.status(403).json({ error: 'forbidden' });
  const table = String(req.query.table || '');
  if (!LOG_TABLES.has(table)) return res.status(400).json({ error: 'bad table' });
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
  const actor = req.query.actor ? String(req.query.actor) : null;
  const logAction = req.query.logAction ? String(req.query.logAction) : null;
  const from = req.query.from ? String(req.query.from) : null;
  const to = req.query.to ? String(req.query.to) : null;
  let rows;
  if (table === 'activity_log') {
    rows = await sql()`SELECT * FROM activity_log WHERE (${actor}::text IS NULL OR actor_email = ${actor}) AND (${logAction}::text IS NULL OR action = ${logAction}) AND (${from}::timestamptz IS NULL OR created_at >= ${from}) AND (${to}::timestamptz IS NULL OR created_at <= ${to}) ORDER BY created_at DESC LIMIT ${limit}`;
  } else if (table === 'calendar_activity_log') {
    rows = await sql()`SELECT * FROM calendar_activity_log WHERE (${actor}::text IS NULL OR actor_email = ${actor}) AND (${logAction}::text IS NULL OR action = ${logAction}) AND (${from}::timestamptz IS NULL OR created_at >= ${from}) AND (${to}::timestamptz IS NULL OR created_at <= ${to}) ORDER BY created_at DESC LIMIT ${limit}`;
  } else if (table === 'infaq_activity_log') {
    rows = await sql()`SELECT * FROM infaq_activity_log WHERE (${actor}::text IS NULL OR actor_email = ${actor}) AND (${logAction}::text IS NULL OR action = ${logAction}) AND (${from}::timestamptz IS NULL OR created_at >= ${from}) AND (${to}::timestamptz IS NULL OR created_at <= ${to}) ORDER BY created_at DESC LIMIT ${limit}`;
  } else if (table === 'news_activity_log') {
    rows = await sql()`SELECT * FROM news_activity_log WHERE (${actor}::text IS NULL OR actor_email = ${actor}) AND (${logAction}::text IS NULL OR action = ${logAction}) AND (${from}::timestamptz IS NULL OR created_at >= ${from}) AND (${to}::timestamptz IS NULL OR created_at <= ${to}) ORDER BY created_at DESC LIMIT ${limit}`;
  } else if (table === 'staff_activity_log') {
    rows = await sql()`SELECT * FROM staff_activity_log WHERE (${actor}::text IS NULL OR actor_email = ${actor}) AND (${logAction}::text IS NULL OR action = ${logAction}) AND (${from}::timestamptz IS NULL OR created_at >= ${from}) AND (${to}::timestamptz IS NULL OR created_at <= ${to}) ORDER BY created_at DESC LIMIT ${limit}`;
  } else {
    rows = await sql()`SELECT * FROM khutbah_activity_log WHERE (${actor}::text IS NULL OR actor_email = ${actor}) AND (${logAction}::text IS NULL OR action = ${logAction}) AND (${from}::timestamptz IS NULL OR created_at >= ${from}) AND (${to}::timestamptz IS NULL OR created_at <= ${to}) ORDER BY created_at DESC LIMIT ${limit}`;
  }
  res.status(200).json({ rows });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const action = (req.query && req.query.action) || 'login';
  if (req.method === 'GET' && action === 'login') return doLogin(req, res);
  if (req.method === 'GET' && action === 'callback') return doCallback(req, res);
  if (req.method === 'GET' && action === 'logout') return doLogout(req, res);
  if (req.method === 'GET' && action === 'me') return doMe(req, res);
  if (req.method === 'GET' && action === 'users') return doUsers(req, res);
  if (req.method === 'GET' && action === 'logs') return doLogs(req, res);
  if (req.method === 'POST' && action === 'save-user') {
    try {
      return await doSaveUser(req, res);
    } catch (e) {
      console.error('/api/auth save-user failed:', e);
      return res.status(500).json({ error: 'server error', details: e.message });
    }
  }
  if (req.method === 'POST' && action === 'delete-user') {
    try {
      return await doDeleteUser(req, res);
    } catch (e) {
      console.error('/api/auth delete-user failed:', e);
      return res.status(500).json({ error: 'server error', details: e.message });
    }
  }
  return res.status(400).json({ error: 'unknown action' });
};
