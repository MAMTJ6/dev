// Vercel serverless function: /api/staff-login
// The entire authentication boundary for the staff/ identity/login layer
// (see admin/setup.sql §11's header comment for the full design writeup).
//
// CRITICAL: staff members NEVER become a Google-OAuth admin principal.
// Admin sessions are HMAC cookies (lib/db.js, via /api/auth); staff get
// only an opaque device_session_token. If staff logged in via the admin
// OAuth flow they'd hold a real admin session cookie capable of calling
// every admin API in this repo. This endpoint verifies staff identity
// independently — PBKDF2 PIN (staff-pin-pure.js, same file the admin's
// browser uses to generate a PIN) or Google's own tokeninfo endpoint —
// never via the admin session. These two paths stay disjoint; don't merge
// them "for consistency."
//
// Public paths (no session needed — staff devices are not admins):
//   GET  (no query)             — public name-only listing for the PIN
//     picker on staff/index.html. Never returns pin_hash/email/
//     device_session_token — only a has_email boolean.
//   POST {method:'pin'}         — { staff_id, pin } — rate-limited (5
//     failures = 15 min lock, see admin/staff/staff-pin-pure.js).
//   POST {method:'google'}      — { id_token } — Google Identity Services
//     ID token, verified against Google's tokeninfo endpoint, matched
//     against staff.email.
//   POST {method:'roster'}      — same as GET (legacy alias).
// Either successful login issues a fresh device_session_token, overwriting
// whatever was stored before — this IS the "single active session"
// mechanism: logging in on a new device silently invalidates the old one.
//
// Admin paths (cookie session + staff permission, for admin/staff/roster.html):
//   GET  ?action=list           — full roster (has_pin flag instead of the
//     hash itself — the browser only needs to know whether a PIN is set).
//   POST ?action=save           — {row:{id?, full_name, phone, email,
//     enabled, pin_hash?}} — insert or update (pin_hash only overwritten
//     when supplied; resets lockout counters with a new PIN).
//   POST ?action=delete         — {id}.
//   POST ?action=clear-lockout  — {id} — resets failed_pin_attempts/locked_until.
// Admin activity logging is done client-side via neonLog() to
// staff_activity_log (same as every other module) — this endpoint never
// writes there (the live failed_pin_attempts/locked_until columns already
// give roster.html everything it needs, see admin/setup.sql §11).
//
// Neon version (2026-10-14): Supabase REST replaced with await sql().
// PIN hash logic in staff-pin-pure.js reused as-is (dual-env file).
//
// Required Vercel environment variables:
//   NEON_DATABASE_URL, AUTH_SECRET (admin paths only, via lib/db.js)
//   GOOGLE_CLIENT_ID — must match the value in staff/script.js

const crypto = require('crypto');
const { sql, requireAdmin } = require('../lib/db');
const {
    isValidPinFormat, verifyPin, computeLockoutUpdate, isLocked, LOCKOUT_THRESHOLD,
} = require('../admin/staff/staff-pin-pure.js');

module.exports = async function handler(req, res) {
    // ── CORS ────────────────────────────────────────────────────────────────
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    // ── Admin roster-management branch (cookie session, staff permission) ───
    if (req.query && req.query.action) {
        return handleAdmin(req, res);
    }

    // ── Public staff-device branch (no session — staff are not admins) ──────
    const method = req.method === 'GET' ? 'roster' : (req.body && req.body.method);

    if (method === 'roster') {
        try {
            const rows = await sql()`SELECT id, full_name, email FROM staff WHERE enabled = true ORDER BY full_name ASC`;
            // has_email is a derived boolean only — the actual address is never
            // sent to the browser, same "no sensitive columns on this path"
            // guarantee as pin_hash/device_session_token.
            return res.status(200).json({ staff: rows.map(r => ({ id: r.id, full_name: r.full_name, has_email: !!r.email })) });
        } catch (e) {
            console.error('/api/staff-login roster failed:', e);
            return res.status(500).json({ error: 'Gagal memuatkan senarai staf' });
        }
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    if (method === 'pin') {
        return handlePinLogin(req, res);
    }
    if (method === 'google') {
        return handleGoogleLogin(req, res);
    }
    return res.status(400).json({ error: 'Unknown method' });
};

// ─── Admin roster CRUD ───────────────────────────────────────────────────────
async function handleAdmin(req, res) {
    const action = String(req.query.action || '');
    const { error: authErr } = await requireAdmin(req, 'staff');
    if (authErr) return res.status(authErr).json({ error: 'unauthorized' });

    try {
        // ── GET ?action=list ──
        if (req.method === 'GET' && action === 'list') {
            const rows = await sql()`SELECT id, full_name, phone, email, enabled, pin_hash IS NOT NULL AS has_pin, failed_pin_attempts, locked_until, created_at, updated_at FROM staff ORDER BY full_name ASC`;
            return res.status(200).json({ staff: rows });
        }
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

        const b = req.body || {};

        // ── POST ?action=save (insert when no id, update when id) ──
        if (action === 'save') {
            const r = b.row || {};
            if (!r.full_name || !String(r.full_name).trim()) {
                return res.status(400).json({ error: 'full_name required' });
            }
            const fullName = String(r.full_name).trim();
            const phone = r.phone ? String(r.phone).trim() || null : null;
            const email = r.email ? String(r.email).trim() || null : null;
            const enabled = r.enabled !== false;
            if (r.id) {
                if (r.pin_hash) {
                    await sql()`UPDATE staff SET full_name = ${fullName}, phone = ${phone}, email = ${email}, enabled = ${enabled}, pin_hash = ${r.pin_hash}, failed_pin_attempts = 0, locked_until = NULL, updated_at = NOW() WHERE id = ${r.id}`;
                } else {
                    await sql()`UPDATE staff SET full_name = ${fullName}, phone = ${phone}, email = ${email}, enabled = ${enabled}, updated_at = NOW() WHERE id = ${r.id}`;
                }
            } else {
                if (!r.pin_hash) return res.status(400).json({ error: 'pin required for new staff' });
                await sql()`INSERT INTO staff (full_name, phone, email, enabled, pin_hash) VALUES (${fullName}, ${phone}, ${email}, ${enabled}, ${r.pin_hash})`;
            }
            return res.status(200).json({ ok: true });
        }

        // ── POST ?action=delete ──
        if (action === 'delete') {
            if (!b.id) return res.status(400).json({ error: 'missing id' });
            await sql()`DELETE FROM staff WHERE id = ${b.id}`;
            return res.status(200).json({ ok: true });
        }

        // ── POST ?action=clear-lockout ──
        if (action === 'clear-lockout') {
            if (!b.id) return res.status(400).json({ error: 'missing id' });
            await sql()`UPDATE staff SET failed_pin_attempts = 0, locked_until = NULL, updated_at = NOW() WHERE id = ${b.id}`;
            return res.status(200).json({ ok: true });
        }

        return res.status(400).json({ error: 'unknown action' });
    } catch (e) {
        console.error('/api/staff-login admin failed:', e);
        return res.status(500).json({ error: 'server error', details: e.message });
    }
}

// ─── Public PIN login ────────────────────────────────────────────────────────
async function handlePinLogin(req, res) {
    const { staff_id, pin } = req.body || {};
    if (!staff_id || !isValidPinFormat(pin)) {
        return res.status(400).json({ error: 'PIN salah' });
    }

    let rows;
    try {
        rows = await sql()`SELECT id, full_name, pin_hash, failed_pin_attempts, locked_until, enabled FROM staff WHERE id = ${staff_id} LIMIT 1`;
    } catch (e) {
        console.error('/api/staff-login pin lookup failed:', e);
        return res.status(500).json({ error: 'Ralat pelayan' });
    }
    const staffRow = rows[0];

    // Never reveal missing vs. disabled vs. wrong-PIN — same generic error.
    if (!staffRow || !staffRow.enabled) {
        return res.status(401).json({ error: 'PIN salah' });
    }

    const now = new Date();
    if (isLocked(staffRow, now)) {
        return res.status(423).json({
            error: 'Akaun dikunci buat sementara waktu selepas terlalu banyak percubaan. Cuba lagi kemudian.',
            locked_until: staffRow.locked_until,
        });
    }

    const valid = await verifyPin(pin, staffRow.pin_hash);
    if (!valid) {
        const update = computeLockoutUpdate(staffRow.failed_pin_attempts, now);
        try {
            await sql()`UPDATE staff SET failed_pin_attempts = ${update.failed_pin_attempts}, locked_until = ${update.locked_until} WHERE id = ${staffRow.id}`;
        } catch (e) {
            console.error('/api/staff-login lockout write failed:', e);
        }

        if (update.locked_until) {
            return res.status(423).json({
                error: 'Akaun dikunci buat sementara waktu selepas terlalu banyak percubaan. Cuba lagi kemudian.',
                locked_until: update.locked_until,
            });
        }
        // Only surfaced once staffRow is confirmed real+enabled (above) —
        // a nonexistent/disabled id never reaches here, so this can't be
        // used to distinguish "no such account" from "wrong PIN" beyond
        // what the eventual lockout (423) already reveals.
        const attemptsRemaining = LOCKOUT_THRESHOLD - update.failed_pin_attempts;
        return res.status(401).json({
            error: `PIN salah. ${attemptsRemaining} percubaan lagi sebelum akaun dikunci.`,
            attempts_remaining: attemptsRemaining,
        });
    }

    return finalizeLogin(res, staffRow);
}

// ─── Public Google login ─────────────────────────────────────────────────────
async function handleGoogleLogin(req, res) {
    const { id_token } = req.body || {};
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    if (!id_token) return res.status(400).json({ error: 'Token tiada' });
    if (!googleClientId) return res.status(500).json({ error: 'Server misconfiguration: missing GOOGLE_CLIENT_ID' });

    // Verified independently against Google's own endpoint — NEVER via
    // the admin session (see the header comment — this is the load-bearing
    // security property of this whole file).
    let payload;
    try {
        const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(id_token)}`);
        if (!verifyRes.ok) return res.status(401).json({ error: 'Log masuk Google tidak sah' });
        payload = await verifyRes.json();
    } catch (e) {
        return res.status(401).json({ error: 'Log masuk Google tidak sah' });
    }

    if (payload.aud !== googleClientId || payload.email_verified !== 'true' || !payload.email) {
        return res.status(401).json({ error: 'Log masuk Google tidak sah' });
    }

    let rows;
    try {
        rows = await sql()`SELECT id, full_name, enabled FROM staff WHERE email ILIKE ${payload.email} LIMIT 1`;
    } catch (e) {
        console.error('/api/staff-login google lookup failed:', e);
        return res.status(500).json({ error: 'Ralat pelayan' });
    }
    const staffRow = rows[0];

    if (!staffRow || !staffRow.enabled) {
        return res.status(401).json({ error: 'Akaun tidak didaftarkan' });
    }

    return finalizeLogin(res, staffRow);
}

// Shared by both login paths. Identity proven via EITHER method resets
// failed_pin_attempts/locked_until too — proof of identity by any
// registered method clears unrelated-method failure counters, a
// deliberate decision, not an oversight.
async function finalizeLogin(res, staffRow) {
    const token = crypto.randomUUID();
    try {
        await sql()`UPDATE staff SET failed_pin_attempts = 0, locked_until = NULL, device_session_token = ${token}, device_session_started_at = NOW() WHERE id = ${staffRow.id}`;
    } catch (e) {
        console.error('/api/staff-login finalize failed:', e);
        return res.status(500).json({ error: 'Ralat pelayan' });
    }

    return res.status(200).json({
        token,
        staff: { id: staffRow.id, full_name: staffRow.full_name },
    });
}
