// GET /api/auth-logout — clear session, back to login.
module.exports = async function handler(req, res) {
  res.setHeader('Set-Cookie', 'mamtj6_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  res.redirect(302, '/admin/index.html');
};
