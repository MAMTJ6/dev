// GET /api/auth-login — start Google OAuth. Sets CSRF `state` cookie, redirects.
// Needs Vercel env: GOOGLE_CLIENT_ID, APP_URL (e.g. https://dev.mamtj6.com).
const crypto = require('node:crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  if (!clientId || !appUrl) return res.status(500).json({ error: 'missing GOOGLE_CLIENT_ID or APP_URL' });

  const state = crypto.randomBytes(16).toString('hex');
  res.setHeader('Set-Cookie', `mamtj6_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${appUrl}/api/auth-callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
};
