// GET /api/auth?action=login|callback|logout|me — Google OAuth session auth.
// Single file (not 4) because Vercel Hobby allows max 12 serverless functions.
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

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const action = (req.query && req.query.action) || 'login';
  if (action === 'login') return doLogin(req, res);
  if (action === 'callback') return doCallback(req, res);
  if (action === 'logout') return doLogout(req, res);
  if (action === 'me') return doMe(req, res);
  return res.status(400).json({ error: 'unknown action' });
};
