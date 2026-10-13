// GET /api/auth-callback?code=...&state=... — Google OAuth return.
// Verifies state, exchanges code, checks admins table in Neon, issues
// HttpOnly `mamtj6_session` cookie, redirects to dashboard.
// Needs Vercel env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_URL,
// NEON_DATABASE_URL, AUTH_SECRET.
const { sql, signSession, getCookie } = require('../lib/db');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  const fail = (msg) => res.redirect(302, `${appUrl || ''}/admin/index.html?denied=1&err=${encodeURIComponent(msg)}`);

  const { code, state } = req.query || {};
  if (!code || !state || state !== getCookie(req, 'mamtj6_oauth_state')) return fail('bad_state');
  res.setHeader('Set-Cookie', 'mamtj6_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');

  // Exchange code for tokens.
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${appUrl}/api/auth-callback`,
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!tokenRes.ok) return fail('token_exchange');
  const tokens = await tokenRes.json();

  // Who just logged in?
  const meRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!meRes.ok) return fail('userinfo');
  const me = await meRes.json();
  if (!me.email) return fail('no_email');

  // Must be a registered admin (same rule as old app.js requireAuth()).
  let admin = null;
  try {
    const rows = await sql()`SELECT email, name, role FROM admins WHERE email ILIKE ${me.email} LIMIT 1`;
    admin = rows[0] || null;
  } catch (e) {
    return res.status(500).json({ error: 'database unavailable' });
  }
  if (!admin) return fail('not_admin');

  const jwt = signSession({ email: admin.email, name: admin.name || me.name || null, exp: Date.now() + 12 * 3600 * 1000 });
  res.setHeader('Set-Cookie', `mamtj6_session=${encodeURIComponent(jwt)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`);
  res.redirect(302, `${appUrl}/admin/dashboard.html`);
};
