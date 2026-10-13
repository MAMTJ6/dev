// GET /api/auth-me — current admin (email/name/role/permissions) or 401.
// Used by admin pages to replace supabase getSession()+admins lookup.
const { sql, requireAdmin } = require('../lib/db');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { admin, error } = await requireAdmin(req, null);
  if (error) return res.status(error).json({ error: 'unauthorized' });
  const rows = await sql()`SELECT email, name, role, permissions FROM admins WHERE email ILIKE ${admin.email} LIMIT 1`;
  res.status(200).json(rows[0]);
};
