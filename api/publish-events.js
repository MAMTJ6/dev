// Vercel serverless function: POST /api/publish-events
// Publishes calendar/hijri/data/events.json to GitHub.
// Neon version (2026-10-14): cookie session via lib/db.js requireAdmin(req,
// 'kalendar') + audit log to calendar_activity_log in Neon. Same shape as
// api/publish-ustaz.js — admin/calendar/senarai.html calls this with no
// Authorization header (cookie is sent automatically).
//
// Required Vercel environment variables:
//   NEON_DATABASE_URL, AUTH_SECRET, GITHUB_TOKEN, GITHUB_REPO

const { sql, requireAdmin } = require('../lib/db');

const FILE_PATH = 'calendar/hijri/data/events.json';

async function pushJsonToGitHub(ghHeaders, githubRepo, filePath, jsonObj, commitMessage) {
    const contentsRes = await fetch(`https://api.github.com/repos/${githubRepo}/contents/${filePath}`, { headers: ghHeaders });
    if (!contentsRes.ok && contentsRes.status !== 404) {
        throw new Error(`Failed to read ${filePath} from GitHub (status ${contentsRes.status})`);
    }
    let currentSha;
    if (contentsRes.ok) {
        currentSha = (await contentsRes.json()).sha;
    }

    const commitBody = {
        message: commitMessage,
        content: Buffer.from(JSON.stringify(jsonObj, null, 2), 'utf8').toString('base64'),
        branch: 'main',
    };
    if (currentSha) commitBody.sha = currentSha;

    const putRes = await fetch(`https://api.github.com/repos/${githubRepo}/contents/${filePath}`, {
        method: 'PUT', headers: ghHeaders, body: JSON.stringify(commitBody),
    });
    if (!putRes.ok) {
        const errData = await putRes.json().catch(() => ({}));
        throw new Error(errData.message || putRes.statusText);
    }
    return putRes.json();
}

module.exports = async function handler(req, res) {
    // ── CORS ────────────────────────────────────────────────────────────────
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // ── 1. Verify session (cookie, Google OAuth via /api/auth) ──────────────
    const { admin, error: authErr } = await requireAdmin(req, 'kalendar');
    if (authErr) return res.status(authErr).json({ success: false, message: 'Unauthorized' });
    const actorEmail = admin.email;
    const actorName = admin.name || null;

    const githubToken = process.env.GITHUB_TOKEN;
    const githubRepo = process.env.GITHUB_REPO;
    if (!githubToken || !githubRepo) {
        return res.status(500).json({ error: 'Server misconfiguration: missing GitHub env vars' });
    }

    // ── 2. Validate payload ─────────────────────────────────────────────────
    const { events } = req.body || {};
    if (!Array.isArray(events)) {
        return res.status(400).json({ success: false, message: 'Data acara tidak sah.' });
    }
    for (const e of events) {
        if (typeof e.eventName !== 'string' || typeof e.eventDate !== 'string' || typeof e.hijriDate !== 'string') {
            return res.status(400).json({ success: false, message: 'Setiap acara mesti mempunyai eventName, eventDate dan hijriDate.' });
        }
    }

    const sorted = events.slice().sort((a, b) => {
        if (!a.eventDate || !b.eventDate) return 0;
        return new Date(a.eventDate) - new Date(b.eventDate);
    });

    const now = new Date();
    // ms-MY emits PG/PTG day-periods — normalize to AM/PM admin-wide.
    const lastUpdated = `${now.toLocaleDateString('ms-MY', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' })}, ` +
        `${now.toLocaleTimeString('ms-MY', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kuala_Lumpur' })
            .replace(/\bPTG\b/g, 'PM').replace(/\bPG\b/g, 'AM')}`;

    const jsonOut = { lastUpdated, events: sorted };

    const ghHeaders = {
        'Authorization': `Bearer ${githubToken}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
    };

    try {
        const commit = await pushJsonToGitHub(ghHeaders, githubRepo, FILE_PATH, jsonOut, `[Admin] Kemas kini tarikh penting - ${now.toISOString()}`);
        try {
            await sql()`INSERT INTO calendar_activity_log (actor_email, actor_name, action, target_label, detail) VALUES (${actorEmail}, ${actorName}, 'publish_calendar', ${sorted.length + ' acara'}, ${'Diterbitkan ' + sorted.length + ' acara. lastUpdated: ' + lastUpdated})`;
        } catch (e) { console.error('calendar_activity_log insert failed:', e); }
        return res.status(200).json({
            success: true,
            message: 'Data berjaya disimpan ke GitHub!',
            commitUrl: commit.commit?.html_url ?? null,
            lastUpdated,
        });
    } catch (e) {
        return res.status(500).json({ success: false, message: `Ralat semasa proses menyimpan: ${e.message}` });
    }
};
